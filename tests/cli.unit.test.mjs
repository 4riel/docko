import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

import {
  cliPath,
  ensureBuiltArtifacts,
  makeRoot,
  makeWorkspace,
  parseStdout,
  repoRoot,
  runProcess,
  runCliDirect as runCli,
  runCliDirectModule as runCliModule
} from './helpers/cli-test-helpers.mjs';

const test = (name, fn) => nodeTest(name, { concurrency: false }, fn);

async function loadCliInternals() {
  await ensureBuiltArtifacts();
  const module = await import(pathToFileURL(cliPath).href);
  return module.__test__;
}

test('CLI covers help, version, missing command, and unknown command branches', async () => {
  const pkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));

  const version = await runCli(['--version']);
  assert.equal(version.code, 0);
  assert.equal(version.stdout, pkg.version);

  const help = await runCli(['help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /Usage: docko <command>/);

  const missing = await runCli([]);
  assert.equal(missing.code, 1);
  assert.match(missing.stdout, /Global options:/);

  const unknown = await runCli(['unknown']);
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /Unknown command: unknown/);
});

test('CLI handles TTY stdin, delayed stdin settlement, and repeated options', async () => {
  const root = await makeWorkspace('docko-cli-unit-');
  await runCli(['init', '--root', root]);
  await runCli(['resource', 'ensure', '--root', root, '--resource', 'shared-env', '--id', 'staging']);

  const ttyStart = parseStdout(
    await runCliModule(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'tty-session'], {
      stdinIsTTY: true
    })
  );
  assert.equal(ttyStart.session_id, 'tty-session');
  assert.equal(ttyStart.runtime, 'shell');

  const delayedStart = parseStdout(
    await runCliModule(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'timer-session'], {
      inputDelayMs: 50
    })
  );
  assert.equal(delayedStart.session_id, 'timer-session');

  const repeated = parseStdout(
    await runCli([
      'status',
      '--root',
      root,
      '--resource',
      'slot',
      '--resource',
      'shared-env',
      '--resource',
      'shared-env',
      '--id',
      'app-alpha',
      '--id',
      'staging',
      '--id',
      'staging'
    ])
  );
  assert.equal(repeated.resources.length, 1);
  assert.equal(repeated.resources[0].resource_type, 'shared-env');
  assert.equal(repeated.resources[0].resource_id, 'staging');
});

test('CLI init honors explicit modes and repeated slot flags', async () => {
  const root = await makeRoot('docko-cli-init-');
  const init = parseStdout(
    await runCli([
      'init',
      '--root',
      root,
      '--mode',
      'workspace',
      '--slot',
      'main',
      '--slot',
      'worker',
      '--slot',
      'worker'
    ])
  );

  assert.equal(init.mode, 'workspace');
  assert.deepEqual(init.starter_slots, ['main', 'worker']);
  assert.equal(existsSync(path.join(root, 'slots', 'worker')), true);
  assert.equal(existsSync(path.join(root, 'docs')), false);
});

test('CLI init prompt shows path examples when CLAUDE.md and AGENTS.md are not found', async () => {
  const root = await makeRoot('docko-cli-prompt-');
  const freshRoot = path.join(root, 'fresh-workspace');
  const result = await runCli(['init', '--root', freshRoot, '--prompt'], {
    cwd: root,
    input: ['y', 'y', 'y', '', 'y', '', 'y', '', 'n'].join('\n')
  });

  assert.equal(result.code, 0);
  assert.match(result.stderr, /docko init/);
  assert.match(result.stderr, /Workspace root: fresh-workspace/);
  assert.match(result.stderr, /Root check:/);
  assert.match(result.stderr, /Root check: fresh-workspace does not exist yet\. docko will create it\./);
  assert.match(result.stderr, /Use this root path\?/);
  assert.match(result.stderr, /I couldn't find CLAUDE\.md automatically/);
  assert.match(result.stderr, /Examples: fresh-workspace\/CLAUDE\.md, fresh-workspace\/\.claude\/CLAUDE\.md, CLAUDE\.md/);
  assert.match(result.stderr, /I couldn't find AGENTS\.md automatically/);
  assert.match(result.stderr, /Examples: fresh-workspace\/AGENTS\.md, fresh-workspace\/docs\/AGENTS\.md, AGENTS\.md/);
  assert.match(result.stderr, /Clone setup:/);
  assert.match(result.stderr, /relative paths when they make sense here, and absolute paths when they do not/);
  assert.match(result.stderr, /Examples: \., \.\.\/my-app, my-app/);
  assert.match(result.stderr, /Where is the primary repository with your source code\?/);
  assert.doesNotMatch(result.stderr, /How many managed clones should I create from that primary repo\?/);
  assert.doesNotMatch(result.stderr, /Do you already have existing clones to import\?/);
  assert.doesNotMatch(result.stderr, /C:\\Users\\you\\project/);
  assert.match(result.stdout, /docko is ready\./);
  assert.match(result.stdout, /Workspace: fresh-workspace/);
  assert.match(result.stdout, /Claude: installed and guidance injected into fresh-workspace\/CLAUDE\.md/);
  assert.match(result.stdout, /Codex: guidance ready in fresh-workspace\/AGENTS\.md/);
  assert.doesNotMatch(result.stdout, /^\s*\{/);

  const claudeFile = await readFile(path.join(freshRoot, 'CLAUDE.md'), 'utf8');
  const agentsFile = await readFile(path.join(freshRoot, 'AGENTS.md'), 'utf8');
  assert.match(claudeFile, /docko:begin:claude/);
  assert.match(agentsFile, /docko:begin:codex/);
});

test('CLI init prompt auto-detects existing CLAUDE.md and AGENTS.md files', async () => {
  const root = await makeRoot('docko-cli-detect-');
  await runCli(['init', '--root', root]);
  await Promise.all([
    writeFile(path.join(root, 'CLAUDE.md'), '# existing claude\n', 'utf8'),
    writeFile(path.join(root, 'AGENTS.md'), '# existing agents\n', 'utf8')
  ]);

  const result = await runCli(['init', '--root', root, '--prompt'], {
    input: ['y', 'y', 'y', 'y', '', 'n'].join('\n')
  });

  assert.equal(result.code, 0);
  assert.match(result.stderr, /Root check:/);
  assert.match(result.stderr, /Found CLAUDE\.md at/);
  assert.match(result.stderr, /Found AGENTS\.md at/);
  assert.doesNotMatch(result.stderr, /Where should I read or write CLAUDE\.md/);
  assert.doesNotMatch(result.stderr, /Where should I read or write AGENTS\.md/);
});

test('CLI init prompt auto-detects CLAUDE.md and AGENTS.md from common workspace locations', async () => {
  const root = await makeRoot('docko-cli-detect-common-');
  await runCli(['init', '--root', root]);
  await Promise.all([
    mkdir(path.join(root, '.claude'), { recursive: true }),
    mkdir(path.join(root, 'docs'), { recursive: true })
  ]);
  await Promise.all([
    writeFile(path.join(root, '.claude', 'CLAUDE.md'), '# nested claude\n', 'utf8'),
    writeFile(path.join(root, 'docs', 'AGENTS.md'), '# nested agents\n', 'utf8')
  ]);

  const result = await runCli(['init', '--root', root, '--prompt'], {
    input: ['y', 'y', 'y', 'y', '', 'n'].join('\n')
  });

  assert.equal(result.code, 0);
  assert.match(result.stderr, /Found CLAUDE\.md at .*\.claude[\\/]+CLAUDE\.md/);
  assert.match(result.stderr, /Found AGENTS\.md at .*docs[\\/]+AGENTS\.md/);
  assert.doesNotMatch(result.stderr, /Where should I read or write CLAUDE\.md/);
  assert.doesNotMatch(result.stderr, /Where should I read or write AGENTS\.md/);
});

test('CLI init rejects roots whose parent directory does not exist', async () => {
  const base = await makeRoot('docko-cli-missing-parent-');
  const root = path.join(base, 'this-parent-should-not-exist', 'child');
  const result = await runCli(['init', '--root', root]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /ROOT_PARENT_NOT_FOUND/);
  assert.match(result.stderr, /Check the path you typed/);
});

test('CLI init prompt shows a root-check hint when the parent directory is missing', async () => {
  const base = await makeRoot('docko-cli-missing-parent-prompt-');
  const root = path.join(base, 'this-parent-should-not-exist', 'child');
  const result = await runCli(['init', '--root', root, '--prompt']);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /docko init/);
  assert.match(result.stderr, /Root check: parent folder does not exist yet/);
  assert.match(result.stderr, /Please check the root path you typed and try again/);
  assert.match(result.stderr, /docko-workspace/);
  assert.match(result.stderr, /Init failed \[ROOT_PARENT_NOT_FOUND\]/);
});

test('CLI init prompt duplicates numbered managed clones from one primary repo by default', async () => {
  const root = await makeRoot('docko-cli-clones-');
  const freshRoot = path.join(root, 'fresh-workspace');
  const sourceRepo = path.join(root, 'source-repo');

  await runCli(['init', '--root', sourceRepo]);
  await writeFile(path.join(sourceRepo, 'README.md'), '# source repo\n', 'utf8');

  const result = await runCli(['init', '--root', freshRoot, '--prompt', '--json'], {
    cwd: root,
    input: ['y', 'n', 'n', sourceRepo, 'y', '3'].join('\n')
  });

  assert.equal(result.code, 0);
  assert.match(result.stderr, /Using source (repository|folder):/);
  assert.match(result.stderr, /Use this folder as the source repository\?/);
  assert.match(result.stderr, /How many managed clones should I create from that primary repo\?/);
  assert.doesNotMatch(result.stderr, /List the existing clone folders, comma-separated/);

  const payload = parseStdout(result);
  assert.deepEqual(payload.starter_slots, ['source-repo_1', 'source-repo_2', 'source-repo_3']);
  assert.equal(payload.duplicated_slots.length, 3);

  assert.equal(existsSync(path.join(freshRoot, 'slots', 'source-repo_1', 'README.md')), true);
  assert.equal(existsSync(path.join(freshRoot, 'slots', 'source-repo_2', 'README.md')), true);
  assert.equal(existsSync(path.join(freshRoot, 'slots', 'source-repo_3', 'README.md')), true);
});

test('CLI init prompt rejects empty source folders before creating managed clones', async () => {
  const root = await makeRoot('docko-cli-empty-source-');
  const freshRoot = path.join(root, 'fresh-workspace');
  const emptySource = path.join(root, 'empty-source');
  const sourceRepo = path.join(root, 'source-repo');

  await mkdir(emptySource, { recursive: true });
  await runCli(['init', '--root', sourceRepo]);
  await writeFile(path.join(sourceRepo, 'README.md'), '# source repo\n', 'utf8');

  const result = await runCli(['init', '--root', freshRoot, '--prompt', '--json'], {
    cwd: root,
    input: ['y', 'n', 'n', emptySource, sourceRepo, 'y', '1'].join('\n')
  });

  assert.equal(result.code, 0);
  assert.match(result.stderr, /does not contain any files or folders yet/);

  const payload = parseStdout(result);
  assert.equal(payload.duplicated_slots.length, 1);
  assert.equal(existsSync(path.join(freshRoot, 'slots', 'source-repo', 'README.md')), true);
});

test('CLI init --existing imports already-existing clones instead of asking for a primary repo', async () => {
  const root = await makeRoot('docko-cli-existing-');
  const freshRoot = path.join(root, 'fresh-workspace');
  const existingCloneOne = path.join(root, 'legacy-clone-a');
  const existingCloneTwo = path.join(root, 'legacy-clone-b');

  await runCli(['init', '--root', existingCloneOne]);
  await runCli(['init', '--root', existingCloneTwo]);
  await writeFile(path.join(existingCloneOne, 'README.md'), '# legacy clone a\n', 'utf8');
  await writeFile(path.join(existingCloneTwo, 'README.md'), '# legacy clone b\n', 'utf8');

  const result = await runCli(['init', '--root', freshRoot, '--prompt', '--json', '--existing'], {
    cwd: root,
    input: ['y', 'n', 'n', `${existingCloneOne}, ${existingCloneTwo}`].join('\n')
  });

  assert.equal(result.code, 0);
  assert.match(result.stderr, /already has clones or slots/);
  assert.match(result.stderr, /List the existing clone folders, comma-separated/);
  assert.doesNotMatch(result.stderr, /primary repository/);

  const payload = parseStdout(result);
  assert.deepEqual(payload.starter_slots, ['legacy-clone-a', 'legacy-clone-b']);
  assert.equal(payload.duplicated_slots.length, 2);
});

test('CLI init formats success payload paths relative to the current terminal folder when possible', async () => {
  const root = await makeRoot('docko-cli-relative-paths-');
  const workspaceRoot = path.join(root, 'workspace');
  const sourceRepo = path.join(root, 'source-repo');

  await runCli(['init', '--root', sourceRepo]);
  await writeFile(path.join(sourceRepo, 'README.md'), '# source repo\n', 'utf8');

  const result = await runCli(
    ['init', '--root', workspaceRoot, '--claude', '--codex', '--inject-claude', '--inject-codex', '--clone-source', sourceRepo],
    { cwd: root }
  );

  assert.equal(result.code, 0);

  const payload = parseStdout(result);
  assert.equal(payload.workspace_root, 'workspace');
  assert.equal(payload.workspace_root_absolute, workspaceRoot);
  assert.equal(payload.root_check.root, 'workspace');
  assert.equal(payload.root_check.absolute_root, workspaceRoot);
  assert.match(payload.root_check.message, /^Root check: workspace /);
  assert.equal(payload.duplicated_slot.source_path, 'source-repo');
  assert.equal(payload.duplicated_slot.slot_path, 'workspace/slots/main');
  assert.equal(payload.claude.plugin_root, 'workspace/.claude-plugin/docko');
  assert.equal(payload.codex.agents_file, 'workspace/AGENTS.md');
  assert.equal(payload.injected_files.some((entry) => entry.file === 'workspace/CLAUDE.md'), true);
  assert.equal(payload.injected_files.some((entry) => entry.file === 'workspace/AGENTS.md'), true);
});

test('CLI init resolves non-interactive --clone-source relative to the current terminal folder', async () => {
  const root = await makeRoot('docko-cli-clone-source-relative-');
  const workspaceRoot = path.join(root, 'workspace');
  const sourceRepo = path.join(root, 'source-repo');

  await runCli(['init', '--root', sourceRepo]);
  await writeFile(path.join(sourceRepo, 'README.md'), '# source repo\n', 'utf8');

  const result = await runCli(['init', '--root', workspaceRoot, '--clone-source', 'source-repo'], { cwd: root });

  assert.equal(result.code, 0);

  const payload = parseStdout(result);
  assert.equal(payload.duplicated_slot.source_path, 'source-repo');
  assert.equal(payload.duplicated_slot.slot_path, 'workspace/slots/main');
  assert.equal(existsSync(path.join(workspaceRoot, 'slots', 'main', 'README.md')), true);
});

test('CLI init next steps stay truthful when Codex guidance is not injected', async () => {
  const root = await makeRoot('docko-cli-next-steps-');
  const payload = parseStdout(await runCli(['init', '--root', root, '--codex']));

  assert.match(payload.next_steps[2], /Add docko guidance to .*AGENTS\.md before opening Codex/);

  const claudeOnlyRoot = await makeRoot('docko-cli-next-steps-claude-');
  const claudeOnly = parseStdout(await runCli(['init', '--root', claudeOnlyRoot, '--claude']));
  assert.equal(
    claudeOnly.next_steps.some((step) =>
      /Merge .*\.claude\/snippets\/CLAUDE\.docko\.md into CLAUDE\.md before opening Claude/.test(step)
    ),
    true
  );

  const bothRoot = await makeRoot('docko-cli-next-steps-both-');
  const both = parseStdout(await runCli(['init', '--root', bothRoot, '--claude', '--codex']));
  assert.equal(
    both.next_steps.some((step) =>
      /Merge .*\.claude\/snippets\/AGENTS\.docko\.md into AGENTS\.md before opening Codex/.test(step)
    ),
    true
  );

  const outsideRoot = await makeRoot('docko-cli-next-steps-outside-');
  const externalGuideDir = await makeRoot('docko-cli-external-guides-');
  const outside = parseStdout(
    await runCli([
      'init',
      '--root',
      outsideRoot,
      '--claude',
      '--claude-file',
      path.join(externalGuideDir, 'CLAUDE.external.md')
    ])
  );
  assert.equal(
    outside.next_steps.some((step) =>
      /Merge .*CLAUDE\.docko\.md into .*CLAUDE\.external\.md before opening Claude/.test(step)
    ),
    true
  );

  const injectedRoot = await makeRoot('docko-cli-next-steps-injected-');
  const injected = parseStdout(
    await runCli(['init', '--root', injectedRoot, '--claude', '--codex', '--inject-claude', '--inject-codex'])
  );
  assert.equal(
    injected.next_steps.some((step) => /Open Claude from the workspace root after reviewing .*CLAUDE\.md/.test(step)),
    true
  );
  assert.equal(
    injected.next_steps.some((step) => /Open Codex from the workspace root after reviewing .*AGENTS\.md/.test(step)),
    true
  );
});

test('CLI app ensure registers application metadata and creates nested managed slots', async () => {
  const root = await makeRoot('docko-cli-app-ensure-');
  const workspaceRoot = path.join(root, 'workspace');
  const backendSource = path.join(root, 'backend-source');

  await mkdir(backendSource, { recursive: true });
  await writeFile(path.join(backendSource, 'README.md'), '# backend\n', 'utf8');
  await runCli(['init', '--root', workspaceRoot]);

  const ensured = parseStdout(
    await runCli([
      'app',
      'ensure',
      '--root',
      workspaceRoot,
      '--id',
      'backend',
      '--name',
      'Backend',
      '--description',
      'API service',
      '--keyword',
      'backend',
      '--keyword',
      'api',
      '--source',
      backendSource,
      '--slots',
      '2'
    ])
  );

  assert.equal(ensured.application.application_id, 'backend');
  assert.deepEqual(ensured.discovered_slots, ['backend.main_1', 'backend.main_2']);
  assert.equal(existsSync(path.join(workspaceRoot, 'slots', 'backend', 'main_1', 'README.md')), true);
  assert.equal(existsSync(path.join(workspaceRoot, 'slots', 'backend', 'main_2', 'README.md')), true);

  const status = parseStdout(await runCli(['status', '--root', workspaceRoot, '--application', 'backend']));
  assert.deepEqual(
    status.resources.map((resource) => resource.resource_id),
    ['backend.main_1', 'backend.main_2']
  );
});

test('CLI usage validation covers invalid integers and enums', async () => {
  const root = await makeWorkspace('docko-cli-unit-');
  await runCli(['init', '--root', root]);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'leader']);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'child']);
  await runCli(['claim', '--root', root, '--session', 'leader', '--resource', 'slot', '--id', 'app-alpha']);

  const staleAfter = await runCli([
    'claim',
    '--root',
    root,
    '--session',
    'leader',
    '--resource',
    'slot',
    '--id',
    'app-beta',
    '--stale-after-ms',
    '0'
  ]);
  assert.equal(staleAfter.code, 1);
  assert.match(staleAfter.stderr, /--stale-after-ms must be a positive integer/);

  const slotStaleAfter = await runCli([
    'init',
    '--root',
    path.join(root, 'slot-stale-workspace'),
    '--slot-stale-after-ms',
    '0'
  ]);
  assert.equal(slotStaleAfter.code, 1);
  assert.match(slotStaleAfter.stderr, /--slot-stale-after-ms must be a positive integer/);

  const scope = await runCli([
    'delegate',
    '--root',
    root,
    '--session',
    'leader',
    '--child-session',
    'child',
    '--resource',
    'slot',
    '--id',
    'app-alpha',
    '--scope',
    'admin'
  ]);
  assert.equal(scope.code, 1);
  assert.match(scope.stderr, /--scope must be one of: read, write/);

  const actorMode = await runCli([
    'session',
    'start',
    '--root',
    root,
    '--runtime',
    'shell',
    '--session',
    'bad-mode',
    '--actor-mode',
    'robot'
  ]);
  assert.equal(actorMode.code, 1);
  assert.match(actorMode.stderr, /--actor-mode must be one of: interactive, delegated, automation/);
});

test('CLI slot acquire prompt reports a single busy slot and the default clone source', async () => {
  const root = await makeRoot('docko-cli-single-busy-slot-');
  const sourceRepo = path.join(root, 'source-repo');
  await runCli(['init', '--root', sourceRepo]);
  await writeFile(path.join(sourceRepo, 'README.md'), '# source repo\n', 'utf8');
  await runCli(['init', '--root', root, '--clone-source', sourceRepo, '--slot', 'main']);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'busy-owner']);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'worker']);
  await runCli(['claim', '--root', root, '--session', 'busy-owner', '--resource', 'slot', '--id', 'main']);

  const acquired = await runCli(['slot', 'acquire', '--root', root, '--session', 'worker', '--prompt'], {
    input: 'n\n'
  });

  assert.equal(acquired.code, 2);
  assert.match(acquired.stderr, /All 1 managed slot is currently claimed\./);
  assert.match(acquired.stderr, /docko will duplicate main if you continue\./);
  assert.match(acquired.stderr, /NO_FREE_SLOT/);
});

test('CLI delayed stdin readers stay stable during longer adapter startup work', async () => {
  const root = await makeWorkspace('docko-cli-module-');
  const session = parseStdout(
    await runCliModule(['adapter', 'claude-code', 'session-start', '--root', root], {
      inputDelayMs: 60
    })
  );

  assert.equal(session.env.DOCKO_RUNTIME, 'claude-code');
  assert.match(session.additionalContext, /docko session ID/i);
});

test('CLI render, session current, and session-end no-op branches respond predictably', async () => {
  const root = await makeWorkspace('docko-cli-unit-');
  await runCli(['init', '--root', root]);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'live']);

  const rendered = parseStdout(await runCli(['render', '--root', root]));
  assert.deepEqual(rendered, { ok: true });

  const current = parseStdout(await runCli(['session', 'current', '--root', root, '--session', 'live']));
  assert.equal(current.session_id, 'live');
  assert.equal(current.runtime, 'shell');

  const ended = parseStdout(await runCli(['session', 'end', '--root', root]));
  assert.deepEqual(ended, { ok: true, released: false });
});

test('CLI adapter session-end releases claims and subagent-start requires a parent', async () => {
  const root = await makeWorkspace('docko-cli-unit-');
  await runCli(['init', '--root', root]);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'owner']);
  await runCli(['claim', '--root', root, '--session', 'owner', '--resource', 'slot', '--id', 'app-alpha']);

  const ended = parseStdout(await runCli(['adapter', 'claude-code', 'session-end', '--root', root, '--session', 'owner']));
  assert.deepEqual(ended, { ok: true });

  const status = parseStdout(await runCli(['status', '--root', root, '--resource', 'slot', '--id', 'app-alpha']));
  assert.equal(status.resources[0].status, 'free');

  const missingParent = await runCli(['adapter', 'claude-code', 'subagent-start', '--root', root]);
  assert.equal(missingParent.code, 1);
  assert.match(missingParent.stderr, /Missing parent session for Claude subagent/);
});

test('CLI internals cover helper branches around parsing, path formatting, and scaffolding', async () => {
  const cli = await loadCliInternals();
  const root = await makeRoot('docko-cli-internals-');
  const plainDir = path.join(root, 'plain');
  const emptyDir = path.join(root, 'empty');
  const workspaceDir = path.join(root, 'workspace-like');
  const repoDir = path.join(root, 'repo-like');
  const filePath = path.join(root, 'not-a-dir.txt');

  await Promise.all([
    mkdir(plainDir, { recursive: true }),
    mkdir(emptyDir, { recursive: true }),
    mkdir(path.join(workspaceDir, 'docko'), { recursive: true }),
    mkdir(repoDir, { recursive: true })
  ]);
  await Promise.all([
    writeFile(path.join(repoDir, 'package.json'), '{ "name": "repo-like" }\n', 'utf8'),
    writeFile(filePath, 'hello\n', 'utf8')
  ]);
  await writeFile(path.join(plainDir, 'README.md'), '# plain\n', 'utf8');

  assert.equal(cli.option({ root: 'workspace' }, 'root'), 'workspace');
  assert.equal(cli.option({ root: ['workspace', 'workspace-2'] }, 'root'), 'workspace-2');
  assert.equal(cli.option({ root: [] }, 'root'), null);
  assert.deepEqual(cli.optionList({ slot: 'main' }, 'slot'), ['main']);
  assert.deepEqual(cli.optionList({ slot: [] }, 'slot'), []);
  assert.deepEqual(cli.optionList({ slot: 42 }, 'slot'), []);
  assert.equal(cli.workspaceRoot({ root: '.' }), '.');
  assert.throws(() => cli.requiredOption({}, 'root'), /Missing required option --root/);
  assert.equal(cli.parsePositiveInt(null, 'test'), undefined);
  assert.equal(cli.parsePositiveInt('5', 'test'), 5);
  assert.equal(cli.parseEnum('repo', ['workspace', 'repo'], 'mode'), 'repo');
  assert.equal(cli.extractHookFilePath({ tool_input: { file_path: 'nested.txt' } }), 'nested.txt');
  assert.equal(cli.extractHookFilePath({ tool_input: { nope: true } }), null);
  assert.equal(cli.toDisplayPath(process.cwd()), '.');
  assert.match(cli.toDisplayPath(path.join(path.dirname(process.cwd()), 'sibling')), /^\.\.\//);
  assert.equal(cli.toDisplayPath('D:\\docko-test'), 'D:\\docko-test');
  assert.deepEqual(cli.buildPathExamples([path.join(root, 'CLAUDE.md'), path.join(root, 'CLAUDE.md')]), [cli.toDisplayPath(path.join(root, 'CLAUDE.md'))]);
  assert.deepEqual(cli.buildInstructionExamples(root, 'CLAUDE.md'), [
    cli.toDisplayPath(path.join(root, 'CLAUDE.md')),
    cli.toDisplayPath(path.join(root, '.claude', 'CLAUDE.md')),
    'CLAUDE.md'
  ]);
  assert.equal(cli.sanitizeSlotId('... weird slot name !!!'), '_weird_slot_name_');
  assert.equal(cli.sanitizeSlotId('...'), 'slot');

  const used = new Set(['main']);
  assert.equal(cli.allocateSlotId('main', used), 'main_2');
  assert.deepEqual(cli.buildCloneSlotIds('main', 1, new Set()), ['main']);
  assert.equal(cli.buildCloneSlotBase(path.join(root, 'source-repo')), 'source-repo');
  assert.throws(() => cli.parsePositivePromptCount('0', 'Count'), /whole number greater than 0/);
  assert.equal(cli.parsePositivePromptCount('3', 'Count'), 3);
  assert.equal(cli.parseYesNoAnswer('yes', false), true);
  assert.equal(cli.parseYesNoAnswer('no', true), false);
  assert.equal(cli.parseYesNoAnswer('maybe', true), true);

  assert.equal(await cli.pathExists(path.join(root, 'missing')), false);
  assert.equal(await cli.isDirectory(path.join(root, 'missing')), false);
  assert.deepEqual(await cli.listDirectories(path.join(root, 'missing')), []);

  const created = [];
  await cli.ensureDirectory(path.join(root, 'new-dir'), created, root);
  await cli.ensureDirectory(path.join(root, 'new-dir'), created, root);
  assert.deepEqual(created, ['new-dir']);

  await mkdir(path.join(root, '.claude'), { recursive: true });
  await writeFile(path.join(root, '.claude', 'CLAUDE.md'), '# claude\n', 'utf8');
  await mkdir(path.join(root, 'docs'), { recursive: true });
  await writeFile(path.join(root, 'docs', 'AGENTS.md'), '# agents\n', 'utf8');
  assert.equal(await cli.detectInstructionFile(root, 'CLAUDE.md'), path.join(root, '.claude', 'CLAUDE.md'));
  assert.equal(await cli.detectInstructionFile(root, 'AGENTS.md'), path.join(root, 'docs', 'AGENTS.md'));
  await writeFile(path.join(root, 'CONTRIBUTING.md'), '# contributing\n', 'utf8');
  assert.equal(await cli.detectInstructionFile(root, 'CONTRIBUTING.md'), path.join(root, 'CONTRIBUTING.md'));

  assert.match(await cli.validateCloneSourceDirectory(emptyDir), /does not contain any files or folders yet/);
  assert.equal(await cli.validateCloneSourceDirectory(plainDir), null);
  assert.match(
    cli.renderCloneSourceDetails({ sourcePath: plainDir, entryCount: 1, looksLikeRepo: true }),
    /Using source repository:[\s\S]*1 item there and it looks like a repo root/
  );
  assert.match(
    cli.renderCloneSourceDetails({ sourcePath: plainDir, entryCount: 2, looksLikeRepo: true }),
    /Using source repository:[\s\S]*2 items there and it looks like a repo root/
  );
  assert.equal(await cli.resolveDirectoryInput(root, ''), null);
  assert.equal(await cli.resolveDirectoryInput(root, plainDir), plainDir);
  const workspaceRelativeDir = path.join(root, 'workspace-relative');
  await mkdir(workspaceRelativeDir, { recursive: true });
  assert.equal(await cli.resolveDirectoryInput(root, 'workspace-relative'), workspaceRelativeDir);
  assert.equal(await cli.resolveCloneSourceInput(root, plainDir), plainDir);
  await assert.rejects(() => cli.resolveCloneSourceInput(root, path.join(root, 'missing')), /existing non-empty folder/);
  await assert.rejects(() => cli.resolveCloneSourceInput(root, emptyDir), /does not contain any files or folders yet/);

  const missingRootCheck = await cli.inspectRoot(path.join(root, 'missing-parent', 'child'));
  assert.equal(missingRootCheck.parentExists, false);
  assert.match(missingRootCheck.message, /parent folder does not exist yet/);
  const fileRootCheck = await cli.inspectRoot(filePath);
  assert.equal(fileRootCheck.isDirectory, false);
  const workspaceRootCheck = await cli.inspectRoot(workspaceDir);
  assert.equal(workspaceRootCheck.looksLikeWorkspace, true);
  const repoRootCheck = await cli.inspectRoot(repoDir);
  assert.equal(repoRootCheck.looksLikeRepo, true);
  const emptyRootCheck = await cli.inspectRoot(emptyDir);
  assert.equal(emptyRootCheck.isEmpty, true);
  const plainRootCheck = await cli.inspectRoot(plainDir);
  assert.match(plainRootCheck.message, /exists and is non-empty/);

  assert.equal(await cli.resolveInitMode(root, 'workspace'), 'workspace');
  assert.equal(await cli.resolveInitMode(repoDir, 'auto'), 'repo');
  assert.equal(await cli.resolveInitMode(plainDir, 'auto'), 'workspace');

  const scaffoldRoot = await makeRoot('docko-cli-scaffold-');
  await mkdir(path.join(scaffoldRoot, 'slots', 'existing'), { recursive: true });
  const scaffold = await cli.scaffoldWorkspace(scaffoldRoot, [], []);
  assert.deepEqual(scaffold.slots, ['existing']);
  const reservedScaffold = await cli.scaffoldWorkspace(path.join(root, 'reserved-test'), ['main_1'], ['main_1']);
  assert.deepEqual(reservedScaffold.slots, ['main_1']);

  assert.equal(cli.promptEnabled({ prompt: true }), true);
  assert.equal(cli.promptEnabled({}), process.stdin.isTTY);
  assert.equal(cli.colorize('hi', '32'), process.stderr.isTTY ? '\u001b[32mhi\u001b[0m' : 'hi');
  assert.ok(cli.bold('x').includes('x'));
  assert.ok(cli.cyan('x').includes('x'));
  assert.ok(cli.green('x').includes('x'));
  assert.ok(cli.dim('x').includes('x'));
  assert.match(cli.renderInitIntro('.'), /docko init/);
  assert.match(cli.renderInitIntro(path.join(process.cwd(), 'workspace')), /Workspace root: workspace/);
  const cloneSourceDetails = await cli.inspectCloneSource(repoDir);
  assert.equal(cloneSourceDetails.looksLikeRepo, true);
  assert.match(cli.renderCloneSourceDetails(cloneSourceDetails), /Using source repository:/);
  assert.deepEqual(cli.buildInstructionExamples(root, 'AGENTS.md'), ['AGENTS.md', 'docs/AGENTS.md']);
  assert.deepEqual(cli.buildInstructionExamples(root, 'CONTRIBUTING.md'), [
    cli.toDisplayPath(path.join(root, 'CONTRIBUTING.md')),
    cli.toDisplayPath(path.resolve(process.cwd(), 'CONTRIBUTING.md'))
  ]);

  assert.equal(cli.formatInitPath(null), null);
  assert.deepEqual(cli.formatInitPathList([plainDir]), [cli.toDisplayPath(plainDir)]);
  assert.equal(cli.formatInitRootCheckMessage(repoRootCheck), repoRootCheck.message.split(repoRootCheck.root).join(cli.toDisplayPath(repoRootCheck.root)));
  const formattedDuplicate = cli.formatInitDuplicateResult({ source_path: plainDir, slot_path: path.join(root, 'slots', 'a') });
  assert.equal(formattedDuplicate.source_path, cli.toDisplayPath(plainDir));
  assert.deepEqual(cli.formatInitDuplicateResult({ source_path: null, slot_path: 42 }), { source_path: null, slot_path: 42 });
  assert.equal(cli.shouldRenderInteractiveInit({ options: { prompt: true }, command: ['init'] }, 'init'), true);
  assert.equal(cli.shouldRenderInteractiveInit({ options: { prompt: true, json: true }, command: ['init'] }, 'init'), false);
  assert.match(cli.renderInteractiveError(new Error('boom')), /Init failed \[/);
  assert.equal(cli.renderInteractiveError({ error: { message: 'partial' } }), 'Init failed [ERROR]: partial\n');
  assert.equal(cli.renderInteractiveError({ error: { code: 'PARTIAL' } }), 'Init failed [PARTIAL]: docko init failed.\n');
  assert.equal(cli.renderInteractiveError({}), 'Init failed [UNEXPECTED_ERROR]: Unknown error\n');
  assert.match(
    cli.renderInitSummary({
      workspace_root: '.',
      mode: 'workspace',
      starter_slots: ['main_1', 'main_2'],
      duplicated_slots: [{ source_path: 'source-repo', slot_id: 'main_1' }],
      claude: { plugin_root: '.claude-plugin/docko' },
      codex: { agents_file: 'AGENTS.md' },
      injected_files: [
        { target: 'claude', injected: true, file: 'CLAUDE.md' },
        { target: 'codex', injected: true, file: 'AGENTS.md' }
      ],
      next_steps: ['Run `docko status --root .`']
    }),
    /docko is ready\./
  );
  assert.match(
    cli.renderInitSummary({
      workspace_root: '.',
      duplicated_slots: [{ source_path: 'source-repo', slot_id: 'main_1' }],
      next_steps: []
    }),
    /Cloned from source-repo: main_1/
  );
  const groupedSummary = cli.renderInitSummary({
    workspace_root: '.',
    duplicated_slots: [
      { slot_id: 'main_0' },
      { source_path: 'source-repo' },
      { source_path: 'source-repo', slot_id: 'main_1' },
      { source_path: 'source-repo', slot_id: null }
    ],
    next_steps: []
  });
  assert.match(groupedSummary, /Cloned from source: main_0/);
  assert.match(groupedSummary, /Cloned from source-repo: main_1/);
  assert.doesNotMatch(groupedSummary, /undefined|null/);
  assert.match(
    cli.renderInitSummary({
      workspace_root: '.',
      claude: { plugin_root: '.claude-plugin/docko' },
      injected_files: [],
      next_steps: []
    }),
    /Claude: installed/
  );
  assert.match(
    cli.renderInitSummary({
      workspace_root: '.',
      codex: { agents_file: 'AGENTS.md' },
      injected_files: [],
      next_steps: []
    }),
    /Codex: configured/
  );

  const auth = cli.serializeAuthorization({
    allowed: true,
    reason: 'ok',
    session_id: 's1',
    resource_id: 'r1',
    owner_session_id: 's1'
  });
  assert.deepEqual(auth, { allow: true, reason: 'ok', session_id: 's1', resource_id: 'r1', owner_session_id: 's1' });

  let stdout = '';
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk, encoding, callback) => {
    stdout += chunk instanceof Uint8Array ? Buffer.from(chunk).toString('utf8') : String(chunk);
    if (typeof encoding === 'function') {
      encoding();
    }
    if (typeof callback === 'function') {
      callback();
    }
    return true;
  });
  try {
    cli.printText('plain text');
    cli.printText('already done\n');
  } finally {
    process.stdout.write = originalStdoutWrite;
  }
  assert.equal(stdout, 'plain text\nalready done\n');
});

test('CLI internals cover duplicate-slot and injected-instruction edge branches', async () => {
  const cli = await loadCliInternals();
  const root = await makeRoot('docko-cli-duplicate-');
  const slotsRoot = path.join(root, 'slots');
  const sourceDir = path.join(root, 'source');
  const emptySourceDir = path.join(root, 'empty-source');
  const fileTarget = path.join(slotsRoot, 'not-a-dir');

  await Promise.all([
    mkdir(path.join(slotsRoot, 'slot-a'), { recursive: true }),
    mkdir(sourceDir, { recursive: true }),
    mkdir(emptySourceDir, { recursive: true }),
    mkdir(path.dirname(fileTarget), { recursive: true })
  ]);
  await Promise.all([
    writeFile(path.join(slotsRoot, 'slot-a', 'README.md'), '# slot source\n', 'utf8'),
    writeFile(path.join(sourceDir, 'README.md'), '# source\n', 'utf8'),
    writeFile(fileTarget, 'not a directory\n', 'utf8')
  ]);

  const fromSlot = await cli.resolveDuplicateSource(root, 'slot-a');
  assert.equal(fromSlot.source_kind, 'slot');
  const fromPath = await cli.resolveDuplicateSource(root, sourceDir);
  assert.equal(fromPath.source_kind, 'path');
  const originalCwd = process.cwd();
  const externalRoot = await makeRoot('docko-cli-external-source-');
  const externalSource = path.join(externalRoot, 'shared-source');
  await mkdir(externalSource, { recursive: true });
  await writeFile(path.join(externalSource, 'README.md'), '# external\n', 'utf8');
  process.chdir(externalRoot);
  try {
    const fromCwd = await cli.resolveDuplicateSource(root, 'shared-source');
    assert.equal(fromCwd.source_kind, 'path');
    assert.equal(fromCwd.source_path, externalSource);
  } finally {
    process.chdir(originalCwd);
  }
  await assert.rejects(() => cli.resolveDuplicateSource(root, 'missing-source'), /Source clone or slot directory not found/);

  await assert.rejects(() => cli.duplicateSlotDirectory(root, emptySourceDir, 'copy-empty'), /Source clone directory is empty/);
  await mkdir(path.join(slotsRoot, 'slot-empty'), { recursive: true });
  await assert.rejects(() => cli.duplicateSlotDirectory(root, 'slot-empty', 'copy-empty-slot'), /Source slot directory is empty/);
  await assert.rejects(() => cli.duplicateSlotDirectory(root, 'slot-a', 'slot-a'), /Source and target slot paths must be different/);
  await assert.rejects(() => cli.duplicateSlotDirectory(root, sourceDir, 'not-a-dir'), /not a directory/);

  await mkdir(path.join(slotsRoot, 'occupied'), { recursive: true });
  await writeFile(path.join(slotsRoot, 'occupied', 'README.md'), '# occupied\n', 'utf8');
  await assert.rejects(() => cli.duplicateSlotDirectory(root, sourceDir, 'occupied'), /not empty/);

  const duplicated = await cli.duplicateSlotDirectory(root, sourceDir, 'copy-ok');
  assert.equal(duplicated.slot_id, 'copy-ok');
  assert.equal(existsSync(path.join(slotsRoot, 'copy-ok', 'README.md')), true);

  const freshGuide = path.join(root, 'CLAUDE.md');
  const firstInject = await cli.injectManagedInstructions(freshGuide, 'hello world', 'claude');
  assert.equal(firstInject.injected, true);
  const duplicateInject = await cli.injectManagedInstructions(freshGuide, 'hello world', 'claude');
  assert.equal(duplicateInject.injected, false);

  const appendedGuide = path.join(root, 'AGENTS.md');
  await writeFile(appendedGuide, '# existing\n', 'utf8');
  const appended = await cli.injectManagedInstructions(appendedGuide, 'extra rules', 'codex');
  assert.equal(appended.injected, true);
  const appendedText = await readFile(appendedGuide, 'utf8');
  assert.match(appendedText, /# existing/);
  assert.match(appendedText, /docko:begin:codex/);

  const noNewlineGuide = path.join(root, 'CLAUDE.no-newline.md');
  await writeFile(noNewlineGuide, '# heading', 'utf8');
  const appendedWithoutNewline = await cli.injectManagedInstructions(noNewlineGuide, 'fresh rules', 'claude');
  assert.equal(appendedWithoutNewline.injected, true);
  const appendedWithoutNewlineText = await readFile(noNewlineGuide, 'utf8');
  assert.match(appendedWithoutNewlineText, /# heading\n\n<!-- docko:begin:claude -->/);

  assert.deepEqual(cli.INJECTION_MARKERS.claude, {
    start: '<!-- docko:begin:claude -->',
    end: '<!-- docko:end:claude -->'
  });
  await assert.rejects(() => cli.injectManagedInstructions(root, 'oops', 'claude'), /EISDIR|illegal operation on a directory/i);
});

test('CLI internals cover slot-acquire helpers for clone defaults and size reporting', async () => {
  const cli = await loadCliInternals();
  const root = await makeRoot('docko-cli-acquire-helpers-');
  const slotDir = path.join(root, 'slots', 'main');
  const nestedDir = path.join(slotDir, 'nested');
  await mkdir(slotDir, { recursive: true });
  await mkdir(nestedDir, { recursive: true });
  await writeFile(path.join(slotDir, 'README.md'), '# hello\n', 'utf8');
  await writeFile(path.join(slotDir, 'big.txt'), 'x'.repeat(15_000), 'utf8');
  await writeFile(path.join(nestedDir, 'nested.txt'), 'nested\n', 'utf8');

  assert.deepEqual(
    cli.listManagedSlots({
      resources: [
        { resource_type: 'shared-env', resource_id: 'staging', status: 'free', path: 'shared/staging' },
        { resource_type: 'slot', resource_id: 'worker', status: 'claimed', path: 'slots/worker' },
        { resource_type: 'slot', resource_id: 'main', status: 'free', path: 'slots/main' }
      ]
    }).map((resource) => resource.resource_id),
    ['main', 'worker']
  );
  assert.equal(cli.chooseDefaultCloneSource([{ resource_id: 'worker' }, { resource_id: 'main' }]), 'main');
  assert.equal(cli.chooseDefaultCloneSource([{ resource_id: 'worker' }]), 'worker');
  assert.throws(() => cli.chooseDefaultCloneSource([]), /NO_MANAGED_SLOTS|nothing it can duplicate/);
  assert.equal(cli.buildCloneSlotBase('   '), 'slot');
  assert.equal(cli.buildCloneSlotBase('feature/path'), 'path');
  assert.equal(cli.buildCloneSlotBase('slot-name'), 'slot-name');

  const sizeBytes = await cli.directorySizeBytes(slotDir);
  const singleFileSize = await cli.directorySizeBytes(path.join(slotDir, 'README.md'));
  assert.ok(singleFileSize > 0);
  assert.ok(sizeBytes >= 15_000 + singleFileSize);
  assert.ok(cli.sizeInMegabytes(sizeBytes) >= 0.01);
  assert.deepEqual(
    cli.buildSlotClaimOptions(
      {
        command: ['slot', 'acquire'],
        options: { branch: 'feat/acquire', task: 'take slot', runtime: 'shell', 'stale-after-ms': '5000' },
        root,
        service: null,
        sessionEnv: null
      },
      'worker',
      'main',
      'backend'
    ),
    {
      sessionId: 'worker',
      resourceType: 'slot',
      resourceId: 'main',
      branch: 'feat/acquire',
      task: 'take slot',
      runtime: 'shell',
      staleAfterMs: 5000,
      advanceSchedulerKey: 'backend'
    }
  );
});

test('CLI internals cover immediate busy-slot clone confirmation and direct dist execution', async () => {
  const cli = await loadCliInternals();

  assert.equal(
    await cli.confirmBusySlotClone({ options: { prompt: false } }, 2, 'app-alpha'),
    false
  );
  assert.equal(
    await cli.confirmBusySlotClone({ options: { prompt: false, 'clone-when-busy': true } }, 2, 'app-alpha'),
    true
  );

  const directHelp = await runProcess(process.execPath, [cliPath, '--help'], { cwd: repoRoot });
  assert.equal(directHelp.code, 0);
  assert.match(directHelp.stdout, /Usage: docko <command>/);
});

test('CLI internals retry slot acquire when concurrent claims win or clone targets already exist', async () => {
  const cli = await loadCliInternals();
  await ensureBuiltArtifacts();
  const { DockoError } = await import(pathToFileURL(path.join(repoRoot, 'packages', 'core', 'dist', 'index.js')).href);

  const racedRoot = await makeRoot('docko-cli-acquire-raced-');
  const racedContext = {
    command: ['slot', 'acquire'],
    options: {},
    root: racedRoot,
    sessionEnv: null,
    service: {
      async resolveSessionId(requested) {
        return requested ?? 'worker';
      },
      async status() {
        return {
          resources: [
            { resource_type: 'slot', resource_id: 'app-alpha', status: 'free', path: path.join(racedRoot, 'slots', 'app-alpha') },
            { resource_type: 'slot', resource_id: 'app-beta', status: 'free', path: path.join(racedRoot, 'slots', 'app-beta') }
          ]
        };
      },
      async claim(options) {
        throw new DockoError(
          `Slot ${options.resourceId} was claimed concurrently.`,
          options.resourceId === 'app-alpha' ? 'RESOURCE_ALREADY_CLAIMED' : 'RESOURCE_OWNED_BY_OTHER_SESSION',
          2
        );
      }
    }
  };

  await assert.rejects(
    () => cli.acquireSlot(racedContext),
    (error) =>
      error instanceof DockoError &&
      error.code === 'SLOT_ACQUIRE_RETRY_EXHAUSTED' &&
      /retrying concurrent workspace changes/.test(error.message)
  );

  const cloneRoot = await makeRoot('docko-cli-acquire-target-exists-');
  await mkdir(path.join(cloneRoot, 'slots', 'app-alpha'), { recursive: true });
  await mkdir(path.join(cloneRoot, 'slots', 'app-hotfix'), { recursive: true });
  await writeFile(path.join(cloneRoot, 'slots', 'app-alpha', 'README.md'), '# source\n', 'utf8');
  await writeFile(path.join(cloneRoot, 'slots', 'app-hotfix', 'README.md'), '# occupied\n', 'utf8');

  const cloneContext = {
    command: ['slot', 'acquire'],
    options: { 'clone-when-busy': true, 'clone-from': 'app-alpha', 'clone-slot': 'app-hotfix' },
    root: cloneRoot,
    sessionEnv: null,
    service: {
      async resolveSessionId(requested) {
        return requested ?? 'worker';
      },
      async status() {
        return {
          resources: [
            { resource_type: 'slot', resource_id: 'app-alpha', status: 'claimed', path: path.join(cloneRoot, 'slots', 'app-alpha') },
            { resource_type: 'slot', resource_id: 'app-beta', status: 'claimed', path: path.join(cloneRoot, 'slots', 'app-beta') }
          ]
        };
      },
      async init() {
        throw new Error('init should not run when the target already exists');
      },
      async claim() {
        throw new Error('claim should not run when the target already exists');
      }
    }
  };

  await assert.rejects(
    () => cli.acquireSlot(cloneContext),
    (error) =>
      error instanceof DockoError &&
      error.code === 'SLOT_ACQUIRE_RETRY_EXHAUSTED' &&
      /retrying concurrent workspace changes/.test(error.message)
  );

  const defaultCloneRoot = await makeRoot('docko-cli-acquire-default-clone-');
  await mkdir(path.join(defaultCloneRoot, 'slots', 'main'), { recursive: true });
  await mkdir(path.join(defaultCloneRoot, 'slots', 'worker'), { recursive: true });
  await writeFile(path.join(defaultCloneRoot, 'slots', 'main', 'README.md'), '# main source\n', 'utf8');

  const defaultCloneContext = {
    command: ['slot', 'acquire'],
    options: { 'clone-when-busy': true },
    root: defaultCloneRoot,
    sessionEnv: null,
    service: {
      async resolveSessionId(requested) {
        return requested ?? 'worker-session';
      },
      async status() {
        return {
          resources: [
            { resource_type: 'slot', resource_id: 'main', status: 'claimed', path: path.join(defaultCloneRoot, 'slots', 'main') },
            { resource_type: 'slot', resource_id: 'worker', status: 'claimed', path: path.join(defaultCloneRoot, 'slots', 'worker') }
          ]
        };
      },
      async init() {},
      async claim(options) {
        return {
          ok: true,
          claim: {
            owner_session_id: options.sessionId,
            resource_type: options.resourceType,
            resource_id: options.resourceId
          }
        };
      }
    }
  };

  const defaultCloned = await cli.acquireSlot(defaultCloneContext);
  assert.equal(defaultCloned.action, 'cloned-and-claimed');
  assert.equal(defaultCloned.slot_id, 'main_2');
  assert.equal(defaultCloned.clone.source_kind, 'slot');
  assert.equal(existsSync(path.join(defaultCloneRoot, 'slots', 'main_2', 'README.md')), true);
});

test('CLI internals surface non-retryable slot acquire failures directly', async () => {
  const cli = await loadCliInternals();
  await ensureBuiltArtifacts();
  const { DockoError } = await import(pathToFileURL(path.join(repoRoot, 'packages', 'core', 'dist', 'index.js')).href);

  const emptyRoot = await makeRoot('docko-cli-acquire-empty-');
  const emptyContext = {
    command: ['slot', 'acquire'],
    options: {},
    root: emptyRoot,
    sessionEnv: null,
    service: {
      async resolveSessionId(requested) {
        return requested ?? 'worker';
      },
      async status() {
        return { resources: [] };
      }
    }
  };
  await assert.rejects(
    () => cli.acquireSlot(emptyContext),
    (error) => error instanceof DockoError && error.code === 'NO_MANAGED_SLOTS'
  );

  const claimRoot = await makeRoot('docko-cli-acquire-claim-error-');
  const claimError = new Error('claim exploded');
  const claimContext = {
    command: ['slot', 'acquire'],
    options: {},
    root: claimRoot,
    sessionEnv: null,
    service: {
      async resolveSessionId(requested) {
        return requested ?? 'worker';
      },
      async status() {
        return {
          resources: [{ resource_type: 'slot', resource_id: 'app-alpha', status: 'free', path: path.join(claimRoot, 'slots', 'app-alpha') }]
        };
      },
      async claim() {
        throw claimError;
      }
    }
  };
  await assert.rejects(() => cli.acquireSlot(claimContext), claimError);

  const cloneRoot = await makeRoot('docko-cli-acquire-clone-error-');
  const cloneContext = {
    command: ['slot', 'acquire'],
    options: { 'clone-when-busy': true, 'clone-from': 'missing-source', 'clone-slot': 'app-hotfix' },
    root: cloneRoot,
    sessionEnv: null,
    service: {
      async resolveSessionId(requested) {
        return requested ?? 'worker';
      },
      async status() {
        return {
          resources: [{ resource_type: 'slot', resource_id: 'app-alpha', status: 'claimed', path: path.join(cloneRoot, 'slots', 'app-alpha') }]
        };
      },
      async init() {
        throw new Error('init should not run when duplication fails');
      },
      async claim() {
        throw new Error('claim should not run when duplication fails');
      }
    }
  };
  await assert.rejects(
    () => cli.acquireSlot(cloneContext),
    (error) => error instanceof DockoError && error.code === 'SOURCE_NOT_FOUND'
  );
});

test('CLI internals cover prompt reader fallback branches', async () => {
  const cli = await loadCliInternals();
  const originalSetEncoding = process.stdin.setEncoding.bind(process.stdin);
  const originalOn = process.stdin.on.bind(process.stdin);
  const originalResume = process.stdin.resume.bind(process.stdin);

  const handlers = new Map();
  process.stdin.setEncoding = () => process.stdin;
  process.stdin.on = (event, handler) => {
    handlers.set(event, handler);
    return process.stdin;
  };
  process.stdin.resume = () => process.stdin;

  try {
    const readSuccess = cli.readPromptAnswers();
    handlers.get('data')?.('one\ntwo');
    handlers.get('end')?.();
    assert.deepEqual(await readSuccess, ['one', 'two']);

    handlers.clear();
    const readError = cli.readPromptAnswers();
    handlers.get('error')?.(new Error('boom'));
    assert.deepEqual(await readError, []);
  } finally {
    process.stdin.setEncoding = originalSetEncoding;
    process.stdin.on = originalOn;
    process.stdin.resume = originalResume;
  }
});

test('CLI prompt internals cover path retries, tty prompt sessions, and generic clone-count failures', async () => {
  const cli = await loadCliInternals();
  const root = await makeRoot('docko-cli-prompt-internals-');
  const validDir = path.join(root, 'valid');
  const emptyDir = path.join(root, 'empty');
  await mkdir(validDir, { recursive: true });
  await mkdir(emptyDir, { recursive: true });
  await writeFile(path.join(validDir, 'README.md'), '# valid\n', 'utf8');

  let stderr = '';
  const originalWrite = process.stderr.write.bind(process.stderr);
  const originalIsTTY = process.stderr.isTTY;
  process.stderr.write = ((chunk, encoding, callback) => {
    stderr += chunk instanceof Uint8Array ? Buffer.from(chunk).toString('utf8') : String(chunk);
    if (typeof encoding === 'function') {
      encoding();
    }
    if (typeof callback === 'function') {
      callback();
    }
    return true;
  });
  Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true });

  try {
    assert.equal(cli.colorize('hi', '32'), '\u001b[32mhi\u001b[0m');

    const originalStdinIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    const createdPromptSession = await cli.createPromptSession();
    createdPromptSession.close();
    Object.defineProperty(process.stdin, 'isTTY', { value: originalStdinIsTTY, configurable: true });

    let textCursor = 0;
    const directorySession = {
      async askText() {
        const answers = ['missing-dir', ''];
        return answers[textCursor++] ?? '';
      },
      async askYesNo() {
        return false;
      },
      close() {}
    };
    assert.equal(
      await cli.promptExistingDirectory(directorySession, root, 'Directory?', validDir, ['example'], true),
      null
    );
    assert.match(stderr, /I couldn't find a folder at missing-dir/);
    const blankDefaultSession = {
      async askText() {
        return '';
      },
      async askYesNo() {
        return false;
      },
      close() {}
    };
    assert.equal(
      await cli.promptExistingDirectory(blankDefaultSession, root, 'Directory?', validDir, ['example'], false),
      validDir
    );

    let listCursor = 0;
    const listSession = {
      async askText() {
        const answers = ['', `missing-clone, ${emptyDir}`, validDir];
        return answers[listCursor++] ?? '';
      },
      async askYesNo() {
        return false;
      },
      close() {}
    };
    assert.deepEqual(await cli.promptExistingDirectoryList(listSession, root, 'List?', ['example']), []);
    assert.deepEqual(await cli.promptExistingDirectoryList(listSession, root, 'List?', ['example']), [validDir]);
    assert.match(stderr, /I couldn't find these clone folders: missing-clone/);
    assert.match(stderr, /These clone folders are empty and cannot seed managed slots yet/);

    let confirmedSourceTextCursor = 0;
    let confirmedSourceYesNoCursor = 0;
    const confirmedSourceSession = {
      async askText() {
        const answers = [validDir, validDir];
        return answers[confirmedSourceTextCursor++] ?? '';
      },
      async askYesNo() {
        const answers = [false, true];
        return answers[confirmedSourceYesNoCursor++] ?? true;
      },
      close() {}
    };
    assert.equal(await cli.promptConfirmedCloneSource(confirmedSourceSession, root, '', ['example']), validDir);
    assert.match(stderr, /Using source folder:/);
    assert.match(stderr, /Okay, let.s try a different source path\./);

    assert.equal(cli.parseYesNoAnswer('', true), true);

    const ttyQuestions = [];
    let ttyClosed = false;
    const ttySession = cli.createTTYPromptSession({
      async question(prompt) {
        ttyQuestions.push(prompt);
        return ttyQuestions.length === 1 ? 'custom-guide' : 'n';
      },
      close() {
        ttyClosed = true;
      }
    });
    assert.equal(await ttySession.askText('Guide path', 'CLAUDE.md'), 'custom-guide');
    assert.equal(await ttySession.askYesNo('Inject?', true), false);
    assert.equal(await ttySession.askText('Notes'), 'n');
    assert.equal(await ttySession.askYesNo('Skip?', false), false);
    ttySession.close();
    assert.equal(ttyClosed, true);
    assert.match(ttyQuestions[0], /Guide path \[CLAUDE\.md\]/);
    assert.match(ttyQuestions[1], /Inject\? \[Y\/n\]/);
    assert.match(ttyQuestions[2], /Notes: /);
    assert.match(ttyQuestions[3], /Skip\? \[y\/N\]/);

    const ttyDefaultQuestions = [];
    const ttyDefaultSession = cli.createTTYPromptSession({
      async question(prompt) {
        ttyDefaultQuestions.push(prompt);
        return '';
      },
      close() {}
    });
    assert.equal(await ttyDefaultSession.askText('Guide path', 'DEFAULT.md'), 'DEFAULT.md');
    assert.equal(await ttyDefaultSession.askText('Empty path'), '');
    assert.equal(await ttyDefaultSession.askYesNo('Default no?', false), false);

    const originalStdinIsTTYBuffered = process.stdin.isTTY;
    const originalSetEncodingBuffered = process.stdin.setEncoding.bind(process.stdin);
    const originalOnBuffered = process.stdin.on.bind(process.stdin);
    const originalResumeBuffered = process.stdin.resume.bind(process.stdin);
    const bufferedHandlers = new Map();
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    process.stdin.setEncoding = () => process.stdin;
    process.stdin.on = (event, handler) => {
      bufferedHandlers.set(event, handler);
      return process.stdin;
    };
    process.stdin.resume = () => {
      bufferedHandlers.get('data')?.('\n\n');
      bufferedHandlers.get('end')?.();
      return process.stdin;
    };
    try {
      const bufferedSession = await cli.createPromptSession();
      assert.equal(await bufferedSession.askText('Buffered default', 'BUFFER.md'), 'BUFFER.md');
      assert.equal(await bufferedSession.askYesNo('Buffered no', false), false);
      bufferedSession.close();
    } finally {
      process.stdin.setEncoding = originalSetEncodingBuffered;
      process.stdin.on = originalOnBuffered;
      process.stdin.resume = originalResumeBuffered;
      Object.defineProperty(process.stdin, 'isTTY', { value: originalStdinIsTTYBuffered, configurable: true });
    }

    const originalStdinIsTTYTyped = process.stdin.isTTY;
    const originalSetEncodingTyped = process.stdin.setEncoding.bind(process.stdin);
    const originalOnTyped = process.stdin.on.bind(process.stdin);
    const originalResumeTyped = process.stdin.resume.bind(process.stdin);
    const typedHandlers = new Map();
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    process.stdin.setEncoding = () => process.stdin;
    process.stdin.on = (event, handler) => {
      typedHandlers.set(event, handler);
      return process.stdin;
    };
    process.stdin.resume = () => {
      typedHandlers.get('data')?.('typed-value\n');
      typedHandlers.get('end')?.();
      return process.stdin;
    };
    try {
      const typedAnswerSession = await cli.createPromptSession();
      assert.equal(await typedAnswerSession.askText('Typed answer'), 'typed-value');
      typedAnswerSession.close();
    } finally {
      process.stdin.setEncoding = originalSetEncodingTyped;
      process.stdin.on = originalOnTyped;
      process.stdin.resume = originalResumeTyped;
      Object.defineProperty(process.stdin, 'isTTY', { value: originalStdinIsTTYTyped, configurable: true });
    }

    const originalStdinIsTTYMissing = process.stdin.isTTY;
    const originalSetEncodingMissing = process.stdin.setEncoding.bind(process.stdin);
    const originalOnMissing = process.stdin.on.bind(process.stdin);
    const originalResumeMissing = process.stdin.resume.bind(process.stdin);
    const missingHandlers = new Map();
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    process.stdin.setEncoding = () => process.stdin;
    process.stdin.on = (event, handler) => {
      missingHandlers.set(event, handler);
      return process.stdin;
    };
    process.stdin.resume = () => {
      missingHandlers.get('end')?.();
      return process.stdin;
    };
    try {
      const missingAnswerSession = await cli.createPromptSession();
      assert.equal(await missingAnswerSession.askText('Missing answer', 'fallback.md'), 'fallback.md');
      assert.equal(await missingAnswerSession.askText('Missing empty'), '');
      assert.equal(await missingAnswerSession.askYesNo('Missing confirm', false), false);
      missingAnswerSession.close();
    } finally {
      process.stdin.setEncoding = originalSetEncodingMissing;
      process.stdin.on = originalOnMissing;
      process.stdin.resume = originalResumeMissing;
      Object.defineProperty(process.stdin, 'isTTY', { value: originalStdinIsTTYMissing, configurable: true });
    }

    const rootCheck = await cli.inspectRoot(root);
    const sourceRepo = path.join(root, 'source');
    await mkdir(sourceRepo, { recursive: true });
    await writeFile(path.join(sourceRepo, 'README.md'), '# source\n', 'utf8');

    const failingSession = {
      async askYesNo(label) {
        if (label === 'Set up Claude Code integration?') return false;
        if (label === 'Set up Codex / AGENTS.md guidance?') return false;
        return true;
      },
      async askText(label) {
        if (label.includes('primary repository')) {
          return sourceRepo;
        }
        return { bad: true };
      },
      close() {}
    };

    await assert.rejects(
      () =>
        cli.collectInitPromptConfig(
          {
            command: ['init'],
            options: { prompt: true },
            root,
            service: null,
            sessionEnv: null
          },
          rootCheck,
          failingSession
        ),
      /trim/
    );
  } finally {
    process.stderr.write = originalWrite;
    Object.defineProperty(process.stderr, 'isTTY', { value: originalIsTTY, configurable: true });
  }
});

test('CLI direct commands cover prompt cancellation, explicit guide files, payload fallbacks, and generic exits', async () => {
  const root = await makeRoot('docko-cli-direct-coverage-');
  const fileRoot = path.join(root, 'root.txt');
  await writeFile(fileRoot, 'not a directory\n', 'utf8');

  const promptFileRoot = await runCli(['init', '--root', fileRoot, '--prompt']);
  assert.equal(promptFileRoot.code, 1);
  assert.match(promptFileRoot.stderr, /Init failed \[ROOT_NOT_DIRECTORY\]/);

  const nonPromptFileRoot = await runCli(['init', '--root', fileRoot]);
  assert.equal(nonPromptFileRoot.code, 1);
  assert.match(nonPromptFileRoot.stderr, /ROOT_NOT_DIRECTORY/);

  const cancelledRoot = path.join(root, 'cancelled-workspace');
  const cancelled = await runCli(['init', '--root', cancelledRoot, '--prompt'], {
    input: ['n'].join('\n')
  });
  assert.equal(cancelled.code, 1);
  assert.match(cancelled.stderr, /Init failed \[INIT_CANCELLED\]/);

  const explicitRoot = path.join(root, 'explicit-workspace');
  const explicit = parseStdout(
    await runCli(
      [
        'init',
        '--root',
        explicitRoot,
        '--prompt',
        '--json',
        '--claude-file',
        'guides/CLAUDE.custom.md',
        '--agents-file',
        'meta/AGENTS.custom.md'
      ],
      {
        cwd: root,
        input: ['y', 'y', 'y', 'y', 'y', '', 'n'].join('\n')
      }
    )
  );
  assert.match(explicit.codex.agents_file, /meta\/AGENTS\.custom\.md$/);
  assert.equal(explicit.injected_files.some((entry) => /guides\/CLAUDE\.custom\.md$/.test(entry.file)), true);
  assert.equal(explicit.injected_files.some((entry) => /meta\/AGENTS\.custom\.md$/.test(entry.file)), true);

  const countRoot = path.join(root, 'count-workspace');
  const countSource = path.join(root, 'count-source');
  await mkdir(countSource, { recursive: true });
  await writeFile(path.join(countSource, 'README.md'), '# count source\n', 'utf8');
  const invalidCount = await runCli(['init', '--root', countRoot, '--prompt', '--json'], {
    cwd: root,
    input: ['y', 'n', 'n', countSource, 'y', '0', '1'].join('\n')
  });
  assert.equal(invalidCount.code, 0);
  assert.match(invalidCount.stderr, /whole number greater than 0/);

  const payloadRoot = await makeRoot('docko-cli-payload-coverage-');
  await runCli(['init', '--root', payloadRoot]);
  const payloadParent = parseStdout(
    await runCli(['session', 'start', '--root', payloadRoot], {
      env: { DOCKO_RUNTIME: 'env-runtime' },
      input: JSON.stringify({ session_id: 'payload-parent' })
    })
  );
  assert.equal(payloadParent.session_id, 'payload-parent');
  assert.equal(payloadParent.runtime, 'env-runtime');

  const payloadChild = parseStdout(
    await runCli(['session', 'start', '--root', payloadRoot, '--actor-mode', 'delegated'], {
      env: { DOCKO_RUNTIME: 'env-runtime' },
      input: JSON.stringify({
        session_id: 'payload-child',
        parent_session_id: 'payload-parent',
        delegated_from_session_id: 'payload-parent'
      })
    })
  );
  assert.equal(payloadChild.session_id, 'payload-child');

  const settings = parseStdout(await runCli(['adapter', 'claude-code', 'settings', '--root', payloadRoot]));
  assert.ok(settings.hooks);

  const payloadEnded = parseStdout(
    await runCli(['adapter', 'claude-code', 'session-end', '--root', payloadRoot], {
      input: JSON.stringify({ session_id: 'payload-child' })
    })
  );
  assert.equal(payloadEnded.ok, true);

  await runCli(['session', 'start', '--root', payloadRoot, '--runtime', 'shell', '--session', 'payload-ended']);
  const genericPayloadEnded = parseStdout(
    await runCli(['session', 'end', '--root', payloadRoot], {
      input: JSON.stringify({ session_id: 'payload-ended' })
    })
  );
  assert.equal(genericPayloadEnded.released, true);
  assert.equal(genericPayloadEnded.session_id, 'payload-ended');

  const portableSession = parseStdout(
    await runCli(['session', 'start', '--root', payloadRoot], {
      env: { DOCKO_RUNTIME: null },
      input: JSON.stringify({ session_id: 'portable-session' })
    })
  );
  assert.equal(portableSession.runtime, 'portable');

  const payloadSubagent = parseStdout(
    await runCli(['adapter', 'claude-code', 'subagent-start', '--root', payloadRoot], {
      input: JSON.stringify({ parent_session_id: 'payload-parent' })
    })
  );
  assert.equal(payloadSubagent.env.DOCKO_PARENT_SESSION_ID, 'payload-parent');

  await runCli(['session', 'start', '--root', payloadRoot, '--runtime', 'shell', '--session', 'env-ended']);
  const envEnded = parseStdout(
    await runCli(['session', 'end', '--root', payloadRoot], {
      env: { DOCKO_SESSION_ID: 'env-ended' }
    })
  );
  assert.equal(envEnded.released, true);
  assert.equal(envEnded.session_id, 'env-ended');

  const installCollisionRoot = await makeRoot('docko-cli-install-collision-');
  await mkdir(path.join(installCollisionRoot, '.claude-plugin', 'docko', 'plugin.json'), { recursive: true });
  const collision = await runCli(['adapter', 'claude-code', 'install', '--root', installCollisionRoot]);
  assert.equal(collision.code, 1);
});
