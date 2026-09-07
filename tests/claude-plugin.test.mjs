import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { repoRoot } from './helpers/cli-test-helpers.mjs';

const test = (name, fn) => nodeTest(name, { concurrency: false }, fn);

const pluginRoot = path.join(repoRoot, 'packages', 'adapters', 'claude-code', 'plugin');

async function readJson(...segments) {
  return JSON.parse(await readFile(path.join(...segments), 'utf8'));
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
