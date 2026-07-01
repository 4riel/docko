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

test('Claude adapter exposes the expected hook settings fragment', async () => {
  const { buildClaudeCodeSettingsFragment } = await loadAdapterModule();
  const fragment = buildClaudeCodeSettingsFragment();
  assert.equal(
    fragment.hooks.PreToolUse[0].hooks[0].command,
    'node ".claude-plugin/docko/scripts/docko-claude-hook.mjs" pre-tool-use'
  );
  assert.equal(fragment.hooks.SubagentStart[0].hooks[0].timeout, 10);
});

test('Claude adapter emits shell-neutral hook commands on Windows', async () => {
  const { buildClaudeCodeSettingsFragment } = await loadAdapterModule();
  const fragment = buildClaudeCodeSettingsFragment('win32');
  assert.equal(
    fragment.hooks.SessionStart[0].hooks[0].command,
    'node ".claude-plugin/docko/scripts/docko-claude-hook.mjs" session-start'
  );
  assert.doesNotMatch(fragment.hooks.SessionStart[0].hooks[0].command, /CLAUDE_PROJECT_DIR|%/);
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
  assert.match(hookScript, /shell: process\.platform === 'win32'/);

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

test('Installed Claude settings commands run real session and write-authorization flows', async () => {
  const { installClaudeCodeAdapter } = await loadAdapterModule();
  const root = await makeWorkspace();
  await runCli(['init', '--root', root]);
  await installClaudeCodeAdapter({ workspaceRoot: root, writeSettingsLocal: true });
  // The hook launcher only opts into a shell on Windows. On POSIX (shell: false) DOCKO_BIN must be
  // a single spawnable executable, so point it straight at the shebang'd, build-chmodded bin; on
  // Windows a multi-token `node "<path>"` works because the shell re-parses it.
  const dockoScript = path.join(repoRoot, 'bin', 'docko.js');
  const dockoBinCommand = process.platform === 'win32' ? `node ${JSON.stringify(dockoScript)}` : dockoScript;

  const settings = JSON.parse(await readFile(path.join(root, '.claude', 'settings.local.json'), 'utf8'));
  const sessionStartCommand = settings.hooks.SessionStart[0].hooks[0].command;
  const sessionStart = await runShellJson(sessionStartCommand, {
    cwd: root,
    env: {
      DOCKO_BIN: dockoBinCommand,
      CLAUDE_PROJECT_DIR: root
    }
  });

  assert.equal(sessionStart.env.DOCKO_RUNTIME, 'claude-code');
  const sessionId = sessionStart.env.DOCKO_SESSION_ID;

  await runCli([
    'claim',
    '--root',
    root,
    '--session',
    sessionId,
    '--resource',
    'slot',
    '--id',
    'app-alpha',
    '--branch',
    'feat/claude',
    '--task',
    'wire claude adapter'
  ]);

  const preToolUseCommand = settings.hooks.PreToolUse[0].hooks[0].command;
  const allowed = await runShellJson(preToolUseCommand, {
    cwd: root,
    env: {
      DOCKO_BIN: dockoBinCommand,
      DOCKO_SESSION_ID: sessionId,
      CLAUDE_PROJECT_DIR: root
    },
    input: JSON.stringify({
      tool_name: 'Write',
      tool_input: {
        file_path: path.join(root, 'slots', 'app-alpha', 'src', 'index.ts')
      }
    })
  });

  assert.equal(allowed.allow, true);
  assert.equal(allowed.reason, 'owner-session');
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

test('Claude adapter install reports skipped files when local managed files diverge without force', async () => {
  const { installClaudeCodeAdapter } = await loadAdapterModule();
  const root = await makeWorkspace();
  await installClaudeCodeAdapter({ workspaceRoot: root, writeSettingsLocal: true });

  const pluginFile = path.join(root, '.claude-plugin', 'docko', 'plugin.json');
  const generatedSettings = path.join(root, '.claude', 'settings.docko.json');
  await writeFile(pluginFile, '{ "local": true }\n', 'utf8');
  await writeFile(generatedSettings, '{ "local": true }\n', 'utf8');

  const result = await installClaudeCodeAdapter({ workspaceRoot: root });

  assert.ok(result.skipped_files.includes(pluginFile));
  assert.ok(result.skipped_files.includes(generatedSettings));
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
