import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { makeRoot, repoRoot, runProcess } from './helpers/cli-test-helpers.mjs';

const test = (name, fn) => nodeTest(name, { concurrency: false }, fn);

const pluginRoot = path.join(repoRoot, 'packages', 'adapters', 'claude-code', 'plugin');
const launcherPath = path.join(pluginRoot, 'scripts', 'docko-claude-hook.mjs');

async function readJson(...segments) {
  return JSON.parse(await readFile(path.join(...segments), 'utf8'));
}

// A workspace the launcher accepts (it no-ops without docko/registry.json) plus a slot to write into.
async function makeWorkspace(prefix) {
  const root = await makeRoot(prefix);
  await mkdir(path.join(root, 'docko'), { recursive: true });
  await mkdir(path.join(root, 'slots', 'app-alpha'), { recursive: true });
  return root;
}

// A fake docko binary that prints one fixed CLI payload, so the launcher's own translation is
// what is under test rather than core's authorization.
async function writeStubDocko(workspace, name, payload) {
  const stubPath = path.join(workspace, `stub-docko-${name}.mjs`);
  await writeFile(
    stubPath,
    `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(`${JSON.stringify(payload)}\n`)});\n`,
    'utf8'
  );
  if (process.platform !== 'win32') {
    await chmod(stubPath, 0o755);
    return stubPath;
  }

  // On Windows the launcher spawns through a shell, so a multi-token DOCKO_BIN works.
  return `node ${JSON.stringify(stubPath)}`;
}

function runLauncher(subcommand, options) {
  return runProcess(process.execPath, [launcherPath, subcommand], options);
}

test('plugin manifest is valid and tracks the adapter package version', async () => {
  const manifest = await readJson(pluginRoot, '.claude-plugin', 'plugin.json');
  const adapterPackage = await readJson(repoRoot, 'packages', 'adapters', 'claude-code', 'package.json');

  assert.equal(manifest.name, 'docko');
  assert.match(manifest.name, /^[a-z0-9-]+$/);
  assert.equal(manifest.version, adapterPackage.version);
  assert.equal(manifest.license, 'MIT');
  assert.ok(manifest.description.length > 0);
  assert.ok(manifest.author.name.length > 0);
});

test('marketplace manifest points at the committed plugin bundle', async () => {
  const marketplace = await readJson(repoRoot, '.claude-plugin', 'marketplace.json');

  assert.equal(marketplace.name, 'docko');
  assert.ok(marketplace.owner.name.length > 0);
  assert.equal(marketplace.plugins.length, 1);

  const entry = marketplace.plugins[0];
  assert.equal(entry.name, 'docko');
  assert.match(entry.source, /^\.\//);

  const sourceDir = path.resolve(repoRoot, entry.source);
  assert.equal(sourceDir, pluginRoot);
  const manifest = await readJson(sourceDir, '.claude-plugin', 'plugin.json');
  assert.equal(manifest.name, entry.name);
});

test('plugin hooks manifest covers all adapter events with portable commands', async () => {
  const hooks = (await readJson(pluginRoot, 'hooks', 'hooks.json')).hooks;

  assert.deepEqual(Object.keys(hooks).sort(), ['PreToolUse', 'SessionEnd', 'SessionStart', 'SubagentStart']);

  const expectedSubcommands = {
    SessionStart: 'session-start',
    SessionEnd: 'session-end',
    PreToolUse: 'pre-tool-use',
    SubagentStart: 'subagent-start'
  };

  for (const [eventName, subcommand] of Object.entries(expectedSubcommands)) {
    const entries = hooks[eventName];
    assert.equal(entries.length, 1, eventName);
    const command = entries[0].hooks[0].command;
    // ${CLAUDE_PLUGIN_ROOT} must be quoted so paths with spaces survive the shell.
    assert.equal(command, `node "\${CLAUDE_PLUGIN_ROOT}/scripts/docko-claude-hook.mjs" ${subcommand}`);
    assert.equal(entries[0].hooks[0].type, 'command');
    assert.ok(entries[0].hooks[0].timeout > 0);
  }

  // Only tool events take a matcher; SessionStart/SessionEnd/SubagentStart must not.
  assert.equal(hooks.PreToolUse[0].matcher, 'Edit|Write');
  assert.equal('matcher' in hooks.SessionStart[0], false);
  assert.equal('matcher' in hooks.SessionEnd[0], false);
  assert.equal('matcher' in hooks.SubagentStart[0], false);
});

test('plugin bundle ships the commands, skill, and hook launcher', async () => {
  const commands = (await readdir(path.join(pluginRoot, 'commands'))).sort();
  assert.deepEqual(commands, [
    'dock-claim.md',
    'dock-doctor.md',
    'dock-heartbeat.md',
    'dock-release.md',
    'dock-status.md'
  ]);

  const skill = await readFile(path.join(pluginRoot, 'skills', 'workspace-orchestration', 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: workspace-orchestration\n/);
  assert.match(skill, /## Quick Path/);

  const launcher = await readFile(path.join(pluginRoot, 'scripts', 'docko-claude-hook.mjs'), 'utf8');
  assert.match(launcher, /hookSpecificOutput/);
  assert.match(launcher, /permissionDecision/);
  assert.match(launcher, /registry\.json/);
  assert.match(launcher, /docko-workspace@alpha/);
});

test('hook launcher translates CLI payloads into the Claude hook protocol', async () => {
  // Protocol-shape guards on the launcher source: deny must ride on
  // hookSpecificOutput.permissionDecision, and allow must stay silent so docko
  // never widens the user's normal permission flow.
  const launcher = await readFile(path.join(pluginRoot, 'scripts', 'docko-claude-hook.mjs'), 'utf8');

  assert.match(launcher, /permissionDecision: 'deny'/);
  assert.doesNotMatch(launcher, /permissionDecision: 'allow'/);
  assert.match(launcher, /additionalContext/);
  // Failures must fail open (exit 0) because the lock protocol is an operational
  // control, not a security boundary.
  assert.match(launcher, /failed open/);
});

test('hook launcher version header tracks the adapter package version', async () => {
  const launcher = await readFile(path.join(pluginRoot, 'scripts', 'docko-claude-hook.mjs'), 'utf8');
  const adapterPackage = await readJson(repoRoot, 'packages', 'adapters', 'claude-code', 'package.json');

  // The installer and `adapter claude-code doctor` compare this header, so it must be present,
  // well formed, and bumped in lockstep with the packages.
  const match = launcher.match(/^\/\/ docko-launcher-version: (\S+)$/m);
  assert.ok(match, 'launcher is missing its docko-launcher-version header');
  assert.equal(match[1], adapterPackage.version);
});

test('hook launcher exports the session id through CLAUDE_ENV_FILE', async () => {
  const workspace = await makeWorkspace('docko-plugin-envfile-');
  const envFile = path.join(workspace, 'claude-env');
  await writeFile(envFile, '', 'utf8');
  await writeFile(path.join(workspace, 'docko', 'registry.json'), '{}\n', 'utf8');

  const stub = await writeStubDocko(workspace, 'session-start', {
    additionalContext: 'ctx',
    env: { DOCKO_SESSION_ID: 'ses_env', DOCKO_RUNTIME: 'claude-code', bad_key: 'x', BAD_VALUE: 'a\nb' }
  });

  const result = await runLauncher('session-start', {
    cwd: workspace,
    env: { DOCKO_BIN: stub, CLAUDE_PROJECT_DIR: workspace, CLAUDE_ENV_FILE: envFile },
    input: JSON.stringify({ session_id: 'ses_env', hook_event_name: 'SessionStart', cwd: workspace })
  });

  assert.equal(result.code, 0, result.stderr);
  const exported = await readFile(envFile, 'utf8');
  assert.match(exported, /^DOCKO_SESSION_ID=ses_env$/m);
  assert.match(exported, /^DOCKO_RUNTIME=claude-code$/m);
  // The workspace root travels with the session id so later commands need no --root.
  assert.match(exported, /^DOCKO_ROOT=/m);
  assert.equal(exported.endsWith('\n'), true);
  // A lowercase key and a newline-bearing value must never reach the file.
  assert.doesNotMatch(exported, /bad_key/);
  assert.doesNotMatch(exported, /BAD_VALUE/);
});

test('hook launcher still emits context when CLAUDE_ENV_FILE is absent', async () => {
  const workspace = await makeWorkspace('docko-plugin-noenvfile-');
  await writeFile(path.join(workspace, 'docko', 'registry.json'), '{}\n', 'utf8');
  const stub = await writeStubDocko(workspace, 'session-start', {
    additionalContext: 'Your docko session id is ses_plain',
    env: { DOCKO_SESSION_ID: 'ses_plain' }
  });

  const result = await runLauncher('session-start', {
    cwd: workspace,
    env: { DOCKO_BIN: stub, CLAUDE_PROJECT_DIR: workspace },
    input: JSON.stringify({ session_id: 'ses_plain', hook_event_name: 'SessionStart', cwd: workspace })
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, 'Your docko session id is ses_plain');
});

test('hook launcher renders one recovery command per deny reason', async () => {
  const workspace = await makeWorkspace('docko-plugin-deny-');
  await writeFile(path.join(workspace, 'docko', 'registry.json'), '{}\n', 'utf8');

  const cases = [
    {
      name: 'slot-not-claimed',
      payload: {
        allow: false,
        reason: 'slot-not-claimed',
        session_id: 'ses_me',
        resource_id: 'backend.web_2',
        workspace_root: workspace,
        previous_owner_session_id: 'ses_old'
      },
      expectations: [
        /backend\.web_2 is not claimed/,
        /last held by session ses_old/,
        /docko slot acquire .*--session ses_me .*--prefer backend\.web_2 --branch <branch> --task "<task>" --brief/
      ]
    },
    {
      name: 'claim-expired',
      payload: {
        allow: false,
        reason: 'claim-expired',
        session_id: 'ses_me',
        resource_id: 'backend.web_2',
        owner_session_id: 'ses_me',
        owner_branch: 'feat/x',
        owner_task: 'ship it',
        expired_at: '2026-09-07T10:00:00.000Z',
        claim_stale_after_ms: 3600000,
        workspace_root: workspace
      },
      expectations: [
        /your claim on backend\.web_2 expired at 2026-09-07T10:00:00\.000Z \(no heartbeat for 1h\)/,
        /docko claim .*--session ses_me --resource slot --id backend\.web_2 --branch feat\/x --task "ship it"/
      ]
    },
    {
      name: 'unrelated-session',
      payload: {
        allow: false,
        reason: 'unrelated-session',
        session_id: 'ses_me',
        resource_id: 'backend.web_2',
        owner_session_id: 'ses_owner',
        owner_branch: 'feat/x',
        owner_task: 'ship it',
        owner_session_active: true,
        workspace_root: workspace
      },
      expectations: [
        /the slot backend\.web_2 is claimed by session ses_owner \(task "ship it", branch feat\/x, still active\)/,
        /docko release .*--session ses_me --resource slot --id backend\.web_2 --force/
      ]
    }
  ];

  for (const testCase of cases) {
    const stub = await writeStubDocko(workspace, testCase.name, testCase.payload);
    const result = await runLauncher('pre-tool-use', {
      cwd: workspace,
      env: { DOCKO_BIN: stub, CLAUDE_PROJECT_DIR: workspace },
      input: JSON.stringify({
        session_id: 'ses_me',
        tool_name: 'Write',
        tool_input: { file_path: path.join(workspace, 'slots', 'app-alpha', 'a.ts') }
      })
    });

    assert.equal(result.code, 0, result.stderr);
    const output = JSON.parse(result.stdout).hookSpecificOutput;
    assert.equal(output.permissionDecision, 'deny', testCase.name);
    for (const expectation of testCase.expectations) {
      assert.match(output.permissionDecisionReason, expectation, testCase.name);
    }
  }
});

test('shipped commands and skill teach the behavior docko actually implements', async () => {
  const commandsDir = path.join(pluginRoot, 'commands');
  const commandFiles = await readdir(commandsDir);
  const skill = await readFile(path.join(pluginRoot, 'skills', 'workspace-orchestration', 'SKILL.md'), 'utf8');

  for (const file of commandFiles) {
    const content = await readFile(path.join(commandsDir, file), 'utf8');
    // `--root .` was the documented form that used to fail from inside a slot; walk-up
    // discovery makes it redundant, so no shipped example should still teach it.
    assert.doesNotMatch(content, /--root \./, file);
    assert.doesNotMatch(content, /resolve the session automatically/, file);
  }

  assert.match(skill, /round-robin/);
  assert.match(skill, /--application <id>/);
  assert.match(skill, /DOCKO_SESSION_ID/);
  assert.match(skill, /Never invent a session id/);
  assert.match(skill, /`branch` is claim metadata/);
  assert.match(skill, /Claims are slot-scoped/);
  assert.match(skill, /Subagents started with the Agent tool share the parent's session id/);
  assert.doesNotMatch(skill, /--root \./);
});

test('AGENTS.md describes the shipped repository layout', async () => {
  const agents = await readFile(path.join(repoRoot, 'AGENTS.md'), 'utf8');

  assert.doesNotMatch(agents, /templates\/plugin/);
  assert.match(agents, /marketplace\.json/);
});

test("this repository's own Claude install matches the bundle it ships", async () => {
  // The repo dogfoods its own adapter. A stale committed copy here means docko ships a broken
  // example of its own product, which is exactly what happened before the plugin migration.
  const pairs = [
    [
      path.join(pluginRoot, 'scripts', 'docko-claude-hook.mjs'),
      path.join(repoRoot, '.claude-plugin', 'docko', 'scripts', 'docko-claude-hook.mjs')
    ],
    [
      path.join(pluginRoot, 'skills', 'workspace-orchestration', 'SKILL.md'),
      path.join(repoRoot, '.claude', 'skills', 'workspace-orchestration', 'SKILL.md')
    ]
  ];

  for (const [shipped, installed] of pairs) {
    assert.equal(await readFile(installed, 'utf8'), await readFile(shipped, 'utf8'), installed);
  }

  const bundledCommands = (await readdir(path.join(pluginRoot, 'commands'))).sort();
  const installedCommands = (await readdir(path.join(repoRoot, '.claude', 'commands'))).sort();
  assert.deepEqual(installedCommands, bundledCommands);
  for (const file of bundledCommands) {
    assert.equal(
      await readFile(path.join(repoRoot, '.claude', 'commands', file), 'utf8'),
      await readFile(path.join(pluginRoot, 'commands', file), 'utf8'),
      file
    );
  }

  // Committed hook config must stay machine-independent.
  const settings = await readFile(path.join(repoRoot, '.claude', 'settings.docko.json'), 'utf8');
  assert.match(settings, /\$CLAUDE_PROJECT_DIR/);
  assert.doesNotMatch(settings, /[A-Za-z]:\\\\|\/home\/|\/Users\//);
});
