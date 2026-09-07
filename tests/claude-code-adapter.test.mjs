import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ensureBuiltArtifacts,
  makeWorkspace,
  parseStdout,
  repoRoot,
  runCli,
  runShellCommand
} from './helpers/cli-test-helpers.mjs';

const test = (name, fn) => nodeTest(name, { concurrency: false }, fn);

async function loadAdapterModule() {
  await ensureBuiltArtifacts();
  return import(pathToFileURL(path.join(repoRoot, 'packages', 'adapters', 'claude-code', 'dist', 'index.js')).href);
}

async function runShellJson(command, options) {
  let result = await runShellCommand(command, options);
  for (let attempt = 0; attempt < 2 && (result.code !== 0 || !result.stdout); attempt += 1) {
    result = await runShellCommand(command, options);
  }
  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.notEqual(result.stdout, '');
  return parseStdout(result);
}

test('Claude adapter anchors the hook command and matches the plugin bundle timeouts', async () => {
  const { buildClaudeCodeSettingsFragment } = await loadAdapterModule();

  // Without a known workspace root the command anchors on Claude Code's project variable.
  const portable = buildClaudeCodeSettingsFragment();
  assert.equal(
    portable.hooks.PreToolUse[0].hooks[0].command,
    'node "$CLAUDE_PROJECT_DIR/.claude-plugin/docko/scripts/docko-claude-hook.mjs" pre-tool-use'
  );

  // An install knows the root, so the command is absolute and resolves from any cwd or shell.
  const anchored = buildClaudeCodeSettingsFragment({ workspaceRoot: path.join(repoRoot, 'fixture') });
  assert.equal(
    anchored.hooks.SessionStart[0].hooks[0].command,
    `node "${path.join(repoRoot, 'fixture', '.claude-plugin', 'docko', 'scripts', 'docko-claude-hook.mjs')}" session-start`
  );

  assert.equal(anchored.hooks.SessionStart[0].hooks[0].timeout, 60);
  assert.equal(anchored.hooks.SessionEnd[0].hooks[0].timeout, 15);
  assert.equal(anchored.hooks.PreToolUse[0].hooks[0].timeout, 30);
  assert.equal(anchored.hooks.SubagentStart[0].hooks[0].timeout, 30);
});

test('Claude adapter only emits a matcher for tool events', async () => {
  const { buildClaudeCodeSettingsFragment } = await loadAdapterModule();
  const fragment = buildClaudeCodeSettingsFragment('win32');

  assert.equal(fragment.hooks.PreToolUse[0].matcher, 'Edit|Write');
  assert.equal('matcher' in fragment.hooks.SessionStart[0], false);
  assert.equal('matcher' in fragment.hooks.SessionEnd[0], false);
  assert.equal('matcher' in fragment.hooks.SubagentStart[0], false);
});

test('generated hook fragment matches the distributable plugin bundle', async () => {
  const { buildClaudeCodeSettingsFragment } = await loadAdapterModule();
  const fragment = buildClaudeCodeSettingsFragment();
  const bundle = JSON.parse(
    await readFile(path.join(repoRoot, 'packages', 'adapters', 'claude-code', 'plugin', 'hooks', 'hooks.json'), 'utf8')
  ).hooks;

  assert.deepEqual(Object.keys(fragment.hooks).sort(), Object.keys(bundle).sort());
  for (const eventName of Object.keys(bundle)) {
    const generated = fragment.hooks[eventName][0];
    const shipped = bundle[eventName][0];
    assert.equal(generated.matcher, shipped.matcher, eventName);
    assert.equal(generated.hooks[0].timeout, shipped.hooks[0].timeout, eventName);
    // Same launcher, same subcommand; only the path anchor differs between install paths.
    assert.equal(generated.hooks[0].command.split('" ')[1], shipped.hooks[0].command.split('" ')[1], eventName);
  }
});

test('Claude adapter reads both managed snippets from the installed package templates', async () => {
  const { readClaudeCodeSnippet } = await loadAdapterModule();
  const [claudeSnippet, agentsSnippet] = await Promise.all([
    readClaudeCodeSnippet('claude'),
    readClaudeCodeSnippet('agents')
  ]);

  assert.match(claudeSnippet, /## docko Workspace Rules/);
  assert.match(claudeSnippet, /Quick path:/);
  assert.match(agentsSnippet, /This repo uses `docko` for writable workspace coordination\./);
  assert.match(agentsSnippet, /DOCKO_BIN/);
});

test('Claude adapter install writes repo-local assets and merges settings idempotently', async () => {
  await loadAdapterModule();
  const root = await makeWorkspace();
  await runCli(['init', '--root', root]);
  await mkdir(path.join(root, '.claude'), { recursive: true });
  await writeFile(
    path.join(root, '.claude', 'settings.local.json'),
    `${JSON.stringify({ hooks: { Notification: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo hi', timeout: 1 }] }] } }, null, 2)}\n`,
    'utf8'
  );

  const first = parseStdout(
    await runCli(['adapter', 'claude-code', 'install', '--root', root, '--write-settings-local'])
  );
  const second = parseStdout(
    await runCli(['adapter', 'claude-code', 'install', '--root', root, '--write-settings-local'])
  );

  assert.ok(
    first.written_files.some((file) =>
      path.normalize(file).endsWith(path.join('.claude-plugin', 'docko', 'plugin.json'))
    )
  );
  assert.ok(second);

  // The generated plugin manifest must stamp the live adapter version, never a hardcoded literal
  // that drifts between releases.
  const pluginManifest = JSON.parse(await readFile(path.join(root, '.claude-plugin', 'docko', 'plugin.json'), 'utf8'));
  const adapterPackage = JSON.parse(
    await readFile(path.join(repoRoot, 'packages', 'adapters', 'claude-code', 'package.json'), 'utf8')
  );
  assert.equal(pluginManifest.version, adapterPackage.version);

  // The hook launcher must only opt into a shell on Windows; shell: true on POSIX re-parses args.
  const hookScript = await readFile(
    path.join(root, '.claude-plugin', 'docko', 'scripts', 'docko-claude-hook.mjs'),
    'utf8'
  );
  assert.match(hookScript, /useShell = process\.platform === 'win32'/);
  // The installed launcher is the same file the distributable plugin ships.
  const bundledScript = await readFile(
    path.join(repoRoot, 'packages', 'adapters', 'claude-code', 'plugin', 'scripts', 'docko-claude-hook.mjs'),
    'utf8'
  );
  assert.equal(hookScript, bundledScript);

  const settings = JSON.parse(await readFile(path.join(root, '.claude', 'settings.local.json'), 'utf8'));
  assert.equal(settings.hooks.Notification.length, 1);
  assert.equal(settings.hooks.SessionStart.length, 1);
  assert.match(settings.hooks.SessionStart[0].hooks[0].command, /docko-claude-hook\.mjs/);

  const skill = await readFile(path.join(root, '.claude', 'skills', 'workspace-orchestration', 'SKILL.md'), 'utf8');
  assert.match(skill, /## Quick Path/);
  assert.match(skill, /Prefer slash commands when installed/);
  assert.match(skill, /If `docko` is not runnable, check `DOCKO_BIN`|If `docko` is not on PATH, try `DOCKO_BIN`/);
  assert.match(skill, /Do not inspect slots one by one or replace the CLI with `docko\/registry\.json`/);

  const claudeSnippet = await readFile(path.join(root, '.claude', 'snippets', 'CLAUDE.docko.md'), 'utf8');
  assert.match(claudeSnippet, /Quick path:/);
  assert.match(
    claudeSnippet,
    /If every slot is busy and docko asks whether it should create a fresh managed clone, answer explicitly/
  );
  assert.match(claudeSnippet, /Do not inspect slots one by one or use `docko\/registry\.json` as a normal fallback/);

  const agentsSnippet = await readFile(path.join(root, '.claude', 'snippets', 'AGENTS.docko.md'), 'utf8');
  assert.match(agentsSnippet, /Quick path:/);
  assert.match(
    agentsSnippet,
    /If `docko` is not runnable, check `DOCKO_BIN`|If `docko` is not on PATH, try `DOCKO_BIN`/
  );
  assert.match(agentsSnippet, /Do not inspect slots one by one or use `docko\/registry\.json` as a normal fallback/);
});

test('Installed hook launcher speaks the Claude Code hook output protocol', async () => {
  const { installClaudeCodeAdapter } = await loadAdapterModule();
  const root = await makeWorkspace();
  await runCli(['init', '--root', root]);
  await installClaudeCodeAdapter({ workspaceRoot: root, writeSettingsLocal: true });
  // The hook launcher only opts into a shell on Windows. On POSIX (shell: false) DOCKO_BIN must be
  // a single spawnable executable, so point it straight at the shebang'd, build-chmodded bin; on
  // Windows a multi-token `node "<path>"` works because the shell re-parses it.
  const dockoScript = path.join(repoRoot, 'bin', 'docko.js');
  const dockoBinCommand = process.platform === 'win32' ? `node ${JSON.stringify(dockoScript)}` : dockoScript;
  const hookEnv = {
    DOCKO_BIN: dockoBinCommand,
    CLAUDE_PROJECT_DIR: root
  };

  const settings = JSON.parse(await readFile(path.join(root, '.claude', 'settings.local.json'), 'utf8'));
  const sessionStartCommand = settings.hooks.SessionStart[0].hooks[0].command;
  const preToolUseCommand = settings.hooks.PreToolUse[0].hooks[0].command;

  // SessionStart adopts Claude's session id and injects context via hookSpecificOutput.
  const ownerSessionId = 'claude-hook-owner';
  const sessionStart = await runShellJson(sessionStartCommand, {
    cwd: root,
    env: hookEnv,
    input: JSON.stringify({ session_id: ownerSessionId, hook_event_name: 'SessionStart', cwd: root })
  });
  assert.equal(sessionStart.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(sessionStart.hookSpecificOutput.additionalContext, new RegExp(ownerSessionId));

  await runCli([
    'claim',
    '--root',
    root,
    '--session',
    ownerSessionId,
    '--resource',
    'slot',
    '--id',
    'app-alpha',
    '--branch',
    'feat/claude',
    '--task',
    'wire claude adapter'
  ]);

  // Authorized writes emit nothing: docko only vetoes, it never grants permission.
  const allowed = await runShellCommand(preToolUseCommand, {
    cwd: root,
    env: hookEnv,
    input: JSON.stringify({
      session_id: ownerSessionId,
      tool_name: 'Write',
      tool_input: {
        file_path: path.join(root, 'slots', 'app-alpha', 'src', 'index.ts')
      }
    })
  });
  assert.equal(allowed.code, 0, allowed.stderr || allowed.stdout);
  assert.equal(allowed.stdout, '');

  // A different active session writing into the owner's slot gets a deny decision.
  const outsiderSessionId = 'claude-hook-outsider';
  await runShellJson(sessionStartCommand, {
    cwd: root,
    env: hookEnv,
    input: JSON.stringify({ session_id: outsiderSessionId, hook_event_name: 'SessionStart', cwd: root })
  });
  const denied = await runShellJson(preToolUseCommand, {
    cwd: root,
    env: hookEnv,
    input: JSON.stringify({
      session_id: outsiderSessionId,
      tool_name: 'Write',
      tool_input: {
        file_path: path.join(root, 'slots', 'app-alpha', 'src', 'index.ts')
      }
    })
  });
  assert.equal(denied.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(denied.hookSpecificOutput.permissionDecisionReason, /docko blocked this write/);
});

test('Hook launcher stays silent outside docko workspaces', async () => {
  const { installClaudeCodeAdapter } = await loadAdapterModule();
  const root = await makeWorkspace();
  await installClaudeCodeAdapter({ workspaceRoot: root });

  const dockoScript = path.join(repoRoot, 'bin', 'docko.js');
  const dockoBinCommand = process.platform === 'win32' ? `node ${JSON.stringify(dockoScript)}` : dockoScript;

  // No `docko init` ran, so there is no docko/registry.json: the launcher must no-op
  // so the plugin can stay enabled globally without touching unrelated projects.
  const result = await runShellCommand('node ".claude-plugin/docko/scripts/docko-claude-hook.mjs" session-start', {
    cwd: root,
    env: {
      DOCKO_BIN: dockoBinCommand,
      CLAUDE_PROJECT_DIR: root
    },
    input: JSON.stringify({ session_id: 'claude-noop', hook_event_name: 'SessionStart', cwd: root })
  });

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('Claude adapter install fails cleanly on invalid existing settings JSON', async () => {
  const root = await makeWorkspace();
  await mkdir(path.join(root, '.claude'), { recursive: true });
  await writeFile(path.join(root, '.claude', 'settings.local.json'), '{not-json}\n', 'utf8');

  const result = await runCli(['adapter', 'claude-code', 'install', '--root', root, '--write-settings-local']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /CLAUDE_SETTINGS_INVALID/);
});

test('Claude adapter install throws a DockoError for invalid existing settings JSON when called directly', async () => {
  const { installClaudeCodeAdapter } = await loadAdapterModule();
  const root = await makeWorkspace();
  await mkdir(path.join(root, '.claude'), { recursive: true });
  await writeFile(path.join(root, '.claude', 'settings.local.json'), '{not-json}\n', 'utf8');

  await assert.rejects(
    () => installClaudeCodeAdapter({ workspaceRoot: root, writeSettingsLocal: true }),
    (error) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'CLAUDE_SETTINGS_INVALID' &&
      error.message.includes('settings.local.json')
  );
});

test('Claude adapter install always refreshes generated files and preserves edited ones', async () => {
  const { installClaudeCodeAdapter } = await loadAdapterModule();
  const root = await makeWorkspace();
  const first = await installClaudeCodeAdapter({ workspaceRoot: root, writeSettingsLocal: true });

  const generated = [
    path.join(root, '.claude-plugin', 'docko', 'plugin.json'),
    path.join(root, '.claude-plugin', 'docko', 'hooks', 'hooks.json'),
    path.join(root, '.claude', 'settings.docko.json')
  ];
  const command = path.join(root, '.claude', 'commands', 'dock-status.md');
  assert.ok(first.written_files.includes(generated[0]));

  const originals = new Map();
  for (const file of generated) {
    originals.set(file, await readFile(file, 'utf8'));
    await writeFile(file, '{ "local": true }\n', 'utf8');
  }
  await writeFile(command, 'local edit\n', 'utf8');

  const second = await installClaudeCodeAdapter({ workspaceRoot: root });

  // Generated hook config is docko's machine state, so it comes back on every install...
  for (const file of generated) {
    assert.ok(second.written_files.includes(file), file);
    assert.equal(second.skipped_files.includes(file), false, file);
    assert.equal(await readFile(file, 'utf8'), originals.get(file), file);
  }

  // ...while a hand-edited command stays a user asset until --force.
  assert.ok(second.skipped_files.includes(command));
  assert.equal(await readFile(command, 'utf8'), 'local edit\n');

  // Rewriting identical content still reports unchanged, so written_files stays honest.
  const third = await installClaudeCodeAdapter({ workspaceRoot: root });
  for (const file of generated) {
    assert.ok(third.unchanged_files.includes(file), file);
    assert.equal(third.written_files.includes(file), false, file);
  }
});

test('Claude adapter install applies executable bits on non-Windows hook scripts', async () => {
  const { installClaudeCodeAdapter } = await loadAdapterModule();
  const root = await makeWorkspace();
  const originalPlatform = process.platform;
  Object.defineProperty(process, 'platform', { value: 'linux' });

  try {
    const result = await installClaudeCodeAdapter({ workspaceRoot: root });
    const hookScript = path.join(root, '.claude-plugin', 'docko', 'scripts', 'docko-claude-hook.mjs');
    const metadata = await stat(hookScript);

    assert.ok(result.written_files.includes(hookScript));
    assert.equal(metadata.isFile(), true);
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  }
});

test('Claude adapter install rethrows unexpected filesystem errors from managed files and settings merges', async () => {
  const { installClaudeCodeAdapter } = await loadAdapterModule();
  const pluginCollisionRoot = await makeWorkspace();
  await mkdir(path.join(pluginCollisionRoot, '.claude-plugin', 'docko', 'plugin.json'), { recursive: true });
  await assert.rejects(
    () => installClaudeCodeAdapter({ workspaceRoot: pluginCollisionRoot }),
    /EISDIR|illegal operation on a directory/i
  );

  const settingsCollisionRoot = await makeWorkspace();
  await mkdir(path.join(settingsCollisionRoot, '.claude', 'settings.local.json'), { recursive: true });
  await assert.rejects(
    () => installClaudeCodeAdapter({ workspaceRoot: settingsCollisionRoot, writeSettingsLocal: true }),
    /EISDIR|illegal operation on a directory/i
  );
});

test('install refreshes an outdated hook launcher without --force', async () => {
  const { installClaudeCodeAdapter } = await loadAdapterModule();
  const root = await makeWorkspace();
  await installClaudeCodeAdapter({ workspaceRoot: root });

  const launcher = path.join(root, '.claude-plugin', 'docko', 'scripts', 'docko-claude-hook.mjs');
  const shipped = await readFile(launcher, 'utf8');

  // An install left behind by an older release: same file, older version header.
  await writeFile(
    launcher,
    shipped.replace(/^\/\/ docko-launcher-version: .*$/m, '// docko-launcher-version: 0.0.1'),
    'utf8'
  );
  const refreshed = await installClaudeCodeAdapter({ workspaceRoot: root });
  assert.ok(refreshed.written_files.includes(launcher));
  assert.equal(await readFile(launcher, 'utf8'), shipped);

  // A local edit that keeps the current version is a user change and is preserved.
  const edited = `${shipped}\n// local tweak\n`;
  await writeFile(launcher, edited, 'utf8');
  const preserved = await installClaudeCodeAdapter({ workspaceRoot: root });
  assert.ok(preserved.skipped_files.includes(launcher));
  assert.equal(await readFile(launcher, 'utf8'), edited);

  // --force still restores it.
  const forced = await installClaudeCodeAdapter({ workspaceRoot: root, force: true });
  assert.ok(forced.written_files.includes(launcher));
  assert.equal(await readFile(launcher, 'utf8'), shipped);

  // A second identical install reports files as unchanged rather than written.
  const again = await installClaudeCodeAdapter({ workspaceRoot: root });
  assert.ok(again.unchanged_files.includes(launcher));
  assert.equal(again.written_files.includes(launcher), false);
  assert.equal(again.launcher_version.length > 0, true);
});

test('install anchors hook commands on a custom destination and never duplicates a registration', async () => {
  const { installClaudeCodeAdapter } = await loadAdapterModule();
  const root = await makeWorkspace();

  const result = await installClaudeCodeAdapter({
    workspaceRoot: root,
    destination: path.join('tools', 'docko'),
    writeSettingsLocal: true
  });

  const expectedLauncher = path.join(root, 'tools', 'docko', 'scripts', 'docko-claude-hook.mjs');
  assert.equal(
    result.settings_fragment.hooks.SessionStart[0].hooks[0].command,
    `node "${expectedLauncher}" session-start`
  );

  // Re-installing must replace the docko entry, not append a second one.
  await installClaudeCodeAdapter({
    workspaceRoot: root,
    destination: path.join('tools', 'docko'),
    writeSettingsLocal: true
  });
  const settings = JSON.parse(await readFile(path.join(root, '.claude', 'settings.local.json'), 'utf8'));
  assert.equal(settings.hooks.SessionStart.length, 1);
  assert.equal(settings.hooks.PreToolUse.length, 1);
});

test('doctor reports a healthy install and diagnoses a stale duplicate registration', async () => {
  const { doctorClaudeCodeAdapter, installClaudeCodeAdapter } = await loadAdapterModule();
  const root = await makeWorkspace();
  await installClaudeCodeAdapter({ workspaceRoot: root, writeSettingsLocal: true });

  const healthy = await doctorClaudeCodeAdapter({
    workspaceRoot: root,
    sessionEnv: { DOCKO_BIN: 'docko', DOCKO_SESSION_ID: 'ses_x' }
  });
  assert.equal(healthy.ok, true);
  assert.equal(healthy.launcher.exists, true);
  assert.equal(healthy.launcher.up_to_date, true);
  assert.equal(healthy.session.resolved_session_id, 'ses_x');
  assert.equal(healthy.docko_binary.docko_bin_env, 'docko');

  // A leftover registration from a previous layout: the launcher it names is gone.
  const settingsPath = path.join(root, '.claude', 'settings.json');
  await writeFile(
    settingsPath,
    `${JSON.stringify(
      {
        hooks: {
          SessionStart: [
            {
              hooks: [{ type: 'command', command: 'node "old/docko-claude-hook.mjs" session-start', timeout: 10 }]
            },
            {
              hooks: [
                {
                  type: 'command',
                  command: `node "${path.join(root, '.claude-plugin', 'docko', 'scripts', 'docko-claude-hook.mjs')}" session-start`,
                  timeout: 60
                }
              ]
            }
          ],
          Notification: [{ hooks: [{ type: 'command', command: 'echo hi', timeout: 1 }] }]
        }
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  const diagnosed = await doctorClaudeCodeAdapter({ workspaceRoot: root, sessionEnv: { DOCKO_BIN: 'docko' } });
  assert.equal(diagnosed.ok, false);
  assert.equal(
    diagnosed.issues.some((issue) => issue.code === 'HOOK_LAUNCHER_MISSING'),
    true
  );
  assert.equal(
    diagnosed.issues.some((issue) => issue.code === 'DUPLICATE_HOOK_REGISTRATION'),
    true
  );
  // Nothing is written without --fix.
  const untouched = JSON.parse(await readFile(settingsPath, 'utf8'));
  assert.equal(untouched.hooks.SessionStart.length, 2);

  const fixed = await doctorClaudeCodeAdapter({
    workspaceRoot: root,
    fix: true,
    sessionEnv: { DOCKO_BIN: 'docko' }
  });
  assert.equal(fixed.fixed.length, 1);
  const repaired = JSON.parse(await readFile(settingsPath, 'utf8'));
  assert.equal(repaired.hooks.SessionStart.length, 1);
  assert.match(repaired.hooks.SessionStart[0].hooks[0].command, /\.claude-plugin/);
  // Unrelated hooks are left alone.
  assert.equal(repaired.hooks.Notification.length, 1);
});

test('doctor flags a missing launcher, version drift, and an unresolvable binary', async () => {
  const { doctorClaudeCodeAdapter, installClaudeCodeAdapter } = await loadAdapterModule();
  const root = await makeWorkspace();

  const missing = await doctorClaudeCodeAdapter({ workspaceRoot: root, sessionEnv: { PATH: '' } });
  assert.equal(
    missing.issues.some((issue) => issue.code === 'LAUNCHER_MISSING'),
    true
  );
  assert.equal(
    missing.issues.some((issue) => issue.code === 'DOCKO_BINARY_NOT_RESOLVED'),
    true
  );
  assert.equal(
    missing.issues.some((issue) => issue.code === 'SESSION_ID_NOT_EXPORTED'),
    true
  );
  assert.match(missing.docko_binary.fallback, /npx/);

  await installClaudeCodeAdapter({ workspaceRoot: root });
  const launcher = path.join(root, '.claude-plugin', 'docko', 'scripts', 'docko-claude-hook.mjs');
  const shipped = await readFile(launcher, 'utf8');
  await writeFile(
    launcher,
    shipped.replace(/^\/\/ docko-launcher-version: .*$/m, '// docko-launcher-version: 0.0.1'),
    'utf8'
  );

  const drifted = await doctorClaudeCodeAdapter({ workspaceRoot: root, sessionEnv: { DOCKO_BIN: 'docko' } });
  assert.equal(drifted.launcher.version, '0.0.1');
  assert.equal(drifted.launcher.up_to_date, false);
  const issue = drifted.issues.find((entry) => entry.code === 'LAUNCHER_OUTDATED');
  assert.ok(issue);
  assert.match(issue.message, /docko adapter claude-code install/);
});

test('doctor is reachable from the CLI', async () => {
  const root = await makeWorkspace();
  await runCli(['init', '--root', root]);
  await runCli(['adapter', 'claude-code', 'install', '--root', root, '--write-settings-local']);

  const report = parseStdout(await runCli(['adapter', 'claude-code', 'doctor', '--root', root]));
  assert.equal(report.workspace_root, root);
  assert.equal(report.launcher.up_to_date, true);
  assert.equal(Array.isArray(report.issues), true);
});

test('doctor reports plugin manifest drift in the repo-local install', async () => {
  const { doctorClaudeCodeAdapter, installClaudeCodeAdapter } = await loadAdapterModule();
  const root = await makeWorkspace();
  await installClaudeCodeAdapter({ workspaceRoot: root });

  const healthy = await doctorClaudeCodeAdapter({ workspaceRoot: root, sessionEnv: { DOCKO_BIN: 'docko' } });
  assert.equal(healthy.plugin_manifest.exists, true);
  assert.equal(healthy.plugin_manifest.up_to_date, true);

  const manifestPath = path.join(root, '.claude-plugin', 'docko', 'plugin.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  await writeFile(manifestPath, `${JSON.stringify({ ...manifest, version: '0.0.1' }, null, 2)}\n`, 'utf8');

  const drifted = await doctorClaudeCodeAdapter({ workspaceRoot: root, sessionEnv: { DOCKO_BIN: 'docko' } });
  assert.equal(drifted.plugin_manifest.version, '0.0.1');
  assert.equal(drifted.plugin_manifest.up_to_date, false);
  const issue = drifted.issues.find((entry) => entry.code === 'PLUGIN_MANIFEST_OUTDATED');
  assert.ok(issue);
  assert.match(issue.message, /docko adapter claude-code install/);

  // An install brings the generated manifest back without --force.
  await installClaudeCodeAdapter({ workspaceRoot: root });
  const repaired = await doctorClaudeCodeAdapter({ workspaceRoot: root, sessionEnv: { DOCKO_BIN: 'docko' } });
  assert.equal(repaired.plugin_manifest.up_to_date, true);
});

test('doctor --fix collapses duplicate registrations and reports the post-fix state', async () => {
  const { doctorClaudeCodeAdapter, installClaudeCodeAdapter } = await loadAdapterModule();
  const root = await makeWorkspace();
  await installClaudeCodeAdapter({ workspaceRoot: root });

  const launcher = path.join(root, '.claude-plugin', 'docko', 'scripts', 'docko-claude-hook.mjs');
  const entry = (subcommand) => ({
    hooks: [{ type: 'command', command: `node "${launcher}" ${subcommand}`, timeout: 60 }]
  });
  const settingsPath = path.join(root, '.claude', 'settings.json');
  await writeFile(
    settingsPath,
    `${JSON.stringify({ hooks: { SessionStart: [entry('session-start'), entry('session-start')] } }, null, 2)}\n`,
    'utf8'
  );

  const sessionEnv = { DOCKO_BIN: 'docko', DOCKO_SESSION_ID: 'ses_x' };
  const diagnosed = await doctorClaudeCodeAdapter({ workspaceRoot: root, sessionEnv });
  const duplicate = diagnosed.issues.find((issue) => issue.code === 'DUPLICATE_HOOK_REGISTRATION');
  assert.ok(duplicate);
  assert.equal(duplicate.fixable, true);

  const fixed = await doctorClaudeCodeAdapter({ workspaceRoot: root, fix: true, sessionEnv });
  const repaired = JSON.parse(await readFile(settingsPath, 'utf8'));
  assert.equal(repaired.hooks.SessionStart.length, 1);
  assert.equal(fixed.fixed.length, 1);
  // The report describes the install as it is now, not as it was before --fix ran.
  assert.equal(
    fixed.issues.some((issue) => issue.code === 'DUPLICATE_HOOK_REGISTRATION'),
    false
  );
  assert.equal(fixed.ok, true);
});
