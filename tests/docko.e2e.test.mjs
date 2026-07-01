import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  makeRoot,
  makeWorkspace,
  parseStdout,
  repoRoot,
  runCli,
  runCliBin,
  runShellCommand
} from './helpers/cli-test-helpers.mjs';

const test = (name, fn) => nodeTest(name, { concurrency: false }, fn);

test('init scaffolds an empty root into a starter workspace', async () => {
  const root = await makeRoot('docko-init-empty-');
  const init = parseStdout(await runCli(['init', '--root', root]));

  assert.equal(init.mode, 'workspace');
  assert.deepEqual(init.starter_slots, ['main']);
  assert.equal(existsSync(path.join(root, 'docs')), false);
  assert.equal(existsSync(path.join(root, 'plans')), false);
  assert.equal(existsSync(path.join(root, 'investigations')), false);
  assert.equal(existsSync(path.join(root, 'slots', 'main')), true);

  const status = parseStdout(await runCli(['status', '--root', root]));
  assert.deepEqual(
    status.resources.map((resource) => resource.resource_id),
    ['main']
  );
});

test('init auto-detects repo mode and keeps scaffolding minimal', async () => {
  const root = await makeRoot('docko-init-repo-');
  await writeFile(path.join(root, 'package.json'), '{\n  "name": "example"\n}\n', 'utf8');

  const init = parseStdout(await runCli(['init', '--root', root]));

  assert.equal(init.mode, 'repo');
  assert.equal(existsSync(path.join(root, 'docs')), false);
  assert.equal(existsSync(path.join(root, 'plans')), false);
  assert.equal(existsSync(path.join(root, 'investigations')), false);
  assert.equal(existsSync(path.join(root, 'slots', 'main')), true);
});

test('init --claude chains the Claude adapter install', async () => {
  const root = await makeRoot('docko-init-claude-');
  const init = parseStdout(await runCli(['init', '--root', root, '--claude']));

  assert.ok(init.claude);
  assert.equal(existsSync(path.join(root, '.claude', 'settings.local.json')), true);
  assert.equal(existsSync(path.join(root, '.claude-plugin', 'docko', 'plugin.json')), true);
});

test('init supports Claude and Codex onboarding together with instruction injection', async () => {
  const root = await makeRoot('docko-init-both-');
  const init = parseStdout(
    await runCli(['init', '--root', root, '--claude', '--codex', '--inject-claude', '--inject-codex'])
  );

  assert.ok(init.claude);
  assert.ok(init.codex);
  assert.equal(existsSync(path.join(root, 'CLAUDE.md')), true);
  assert.equal(existsSync(path.join(root, 'AGENTS.md')), true);

  const claudeFile = await readFile(path.join(root, 'CLAUDE.md'), 'utf8');
  const agentsFile = await readFile(path.join(root, 'AGENTS.md'), 'utf8');
  assert.match(claudeFile, /docko:begin:claude/);
  assert.match(agentsFile, /docko:begin:codex/);
});

test('init prompt duplicates numbered clones from one primary repo by default', async () => {
  const root = await makeRoot('docko-init-prompt-clones-');
  const workspaceRoot = path.join(root, 'workspace');
  const sourceRepo = path.join(root, 'source-repo');

  await runCli(['init', '--root', sourceRepo]);
  await writeFile(path.join(sourceRepo, 'README.md'), '# source repo\n', 'utf8');

  const init = parseStdout(
    await runCli(['init', '--root', workspaceRoot, '--prompt', '--json'], {
      cwd: root,
      input: ['y', 'n', 'n', sourceRepo, 'y', '2'].join('\n')
    })
  );

  assert.deepEqual(init.starter_slots, ['source-repo_1', 'source-repo_2']);
  assert.equal(init.duplicated_slots.length, 2);
  assert.equal(existsSync(path.join(workspaceRoot, 'slots', 'source-repo_1', 'README.md')), true);
  assert.equal(existsSync(path.join(workspaceRoot, 'slots', 'source-repo_2', 'README.md')), true);

  const status = parseStdout(await runCli(['status', '--root', workspaceRoot]));
  assert.deepEqual(
    status.resources.map((resource) => resource.resource_id),
    ['source-repo_1', 'source-repo_2']
  );
});

test('init --existing imports already-existing clones into managed slots', async () => {
  const root = await makeRoot('docko-init-prompt-existing-');
  const workspaceRoot = path.join(root, 'workspace');
  const existingCloneOne = path.join(root, 'legacy-clone-a');
  const existingCloneTwo = path.join(root, 'legacy-clone-b');

  await runCli(['init', '--root', existingCloneOne]);
  await writeFile(path.join(existingCloneOne, 'README.md'), '# legacy clone a\n', 'utf8');

  await runCli(['init', '--root', existingCloneTwo]);
  await writeFile(path.join(existingCloneTwo, 'README.md'), '# legacy clone b\n', 'utf8');

  const init = parseStdout(
    await runCli(['init', '--root', workspaceRoot, '--prompt', '--json', '--existing'], {
      cwd: root,
      input: ['y', 'n', 'n', `${existingCloneOne}, ${existingCloneTwo}`].join('\n')
    })
  );

  assert.deepEqual(init.starter_slots, ['legacy-clone-a', 'legacy-clone-b']);
  assert.equal(init.duplicated_slots.length, 2);
  assert.equal(existsSync(path.join(workspaceRoot, 'slots', 'legacy-clone-a', 'README.md')), true);
  assert.equal(existsSync(path.join(workspaceRoot, 'slots', 'legacy-clone-b', 'README.md')), true);
});

test('slot duplicate copies an existing slot into a new managed slot', async () => {
  const root = await makeWorkspace('docko-duplicate-slot-');
  await writeFile(path.join(root, 'slots', 'app-alpha', 'README.md'), '# source\n', 'utf8');
  await runCli(['init', '--root', root]);

  const duplicated = parseStdout(
    await runCli(['slot', 'duplicate', '--root', root, '--from', 'app-alpha', '--to', 'app-copy'])
  );

  assert.equal(duplicated.slot_id, 'app-copy');
  assert.equal(existsSync(path.join(root, 'slots', 'app-copy', 'README.md')), true);

  const status = parseStdout(await runCli(['status', '--root', root]));
  assert.deepEqual(
    status.resources.map((resource) => resource.resource_id),
    ['app-alpha', 'app-beta', 'app-copy']
  );
});

test('slot acquire claims the first free managed slot for the active session', async () => {
  const root = await makeWorkspace('docko-acquire-free-');
  await runCli(['init', '--root', root]);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'worker']);

  const acquired = parseStdout(
    await runCli([
      'slot',
      'acquire',
      '--root',
      root,
      '--session',
      'worker',
      '--branch',
      'feat/acquire',
      '--task',
      'take the next free slot'
    ])
  );

  assert.equal(acquired.action, 'claimed-existing-slot');
  assert.equal(acquired.slot_id, 'app-alpha');
  assert.equal(acquired.clone, null);
  assert.equal(acquired.claim.claim.owner_session_id, 'worker');
  assert.equal(acquired.claim.claim.branch, 'feat/acquire');
  assert.equal(acquired.availability.free_slots_before, 2);
});

test('slot acquire clones and claims a new managed slot when every slot is busy', async () => {
  const root = await makeWorkspace('docko-acquire-clone-');
  await writeFile(path.join(root, 'slots', 'app-alpha', 'README.md'), '# source\n', 'utf8');
  await writeFile(path.join(root, 'slots', 'app-alpha', 'big.txt'), 'x'.repeat(20_000), 'utf8');
  await runCli(['init', '--root', root]);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'busy-owner']);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'worker']);
  await runCli(['claim', '--root', root, '--session', 'busy-owner', '--resource', 'slot', '--id', 'app-alpha']);
  await runCli(['claim', '--root', root, '--session', 'busy-owner', '--resource', 'slot', '--id', 'app-beta']);

  const acquired = parseStdout(
    await runCli([
      'slot',
      'acquire',
      '--root',
      root,
      '--session',
      'worker',
      '--clone-when-busy',
      '--clone-from',
      'app-alpha',
      '--clone-slot',
      'app-hotfix',
      '--branch',
      'feat/hotfix',
      '--task',
      'work from a fresh clone'
    ])
  );

  assert.equal(acquired.action, 'cloned-and-claimed');
  assert.equal(acquired.slot_id, 'app-hotfix');
  assert.equal(acquired.claim.claim.owner_session_id, 'worker');
  assert.equal(acquired.claim.claim.task, 'work from a fresh clone');
  assert.equal(acquired.clone.source_kind, 'slot');
  assert.equal(acquired.clone.slot_id, 'app-hotfix');
  assert.ok(acquired.clone.size_bytes >= 20_000);
  assert.ok(acquired.clone.size_mb >= 0.01);
  assert.equal(existsSync(path.join(root, 'slots', 'app-hotfix', 'big.txt')), true);

  const status = parseStdout(await runCli(['status', '--root', root, '--resource', 'slot', '--id', 'app-hotfix']));
  assert.equal(status.resources[0].status, 'claimed');
  assert.equal(status.resources[0].claim.owner_session_id, 'worker');
});

test('slot acquire rotates round-robin and skips the just-released slot', async () => {
  const root = await makeWorkspace('docko-acquire-rotate-');
  await mkdir(path.join(root, 'slots', 'app-gamma'));
  await runCli(['init', '--root', root]);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'worker']);

  const claimed = [];
  for (let i = 0; i < 3; i += 1) {
    const acquired = parseStdout(
      await runCli(['slot', 'acquire', '--root', root, '--session', 'worker', '--task', 'rotate'])
    );
    claimed.push(acquired.slot_id);
    await runCli(['release', '--root', root, '--session', 'worker', '--resource', 'slot', '--id', acquired.slot_id]);
  }

  // Cold start picks the lowest; thereafter each acquire starts AFTER the last claim, so the
  // just-released slot is never the immediate next pick.
  assert.deepEqual(claimed, ['app-alpha', 'app-beta', 'app-gamma']);

  const registry = JSON.parse(await readFile(path.join(root, 'docko', 'registry.json'), 'utf8'));
  assert.equal(registry.workspace.config.scheduler.last_slot_id._default, 'app-gamma');
});

test('the round-robin cursor survives slot discovery on later mutations', async () => {
  const root = await makeWorkspace('docko-cursor-persist-');
  await runCli(['init', '--root', root]);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'worker']);

  const acquired = parseStdout(
    await runCli(['slot', 'acquire', '--root', root, '--session', 'worker', '--task', 'first'])
  );
  await runCli(['release', '--root', root, '--session', 'worker', '--resource', 'slot', '--id', acquired.slot_id]);

  // A plain status runs discovery (which rebuilds free slots) — the cursor must not be wiped.
  await runCli(['status', '--root', root]);
  const registry = JSON.parse(await readFile(path.join(root, 'docko', 'registry.json'), 'utf8'));
  assert.equal(registry.workspace.config.scheduler.last_slot_id._default, acquired.slot_id);
});

test('a manual claim does not advance the round-robin cursor', async () => {
  const root = await makeWorkspace('docko-manual-claim-');
  await mkdir(path.join(root, 'slots', 'app-gamma'));
  await runCli(['init', '--root', root]);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'worker']);

  // Auto-acquire sets the cursor to app-alpha (cold start).
  const first = parseStdout(await runCli(['slot', 'acquire', '--root', root, '--session', 'worker', '--task', 'auto']));
  assert.equal(first.slot_id, 'app-alpha');
  await runCli(['release', '--root', root, '--session', 'worker', '--resource', 'slot', '--id', 'app-alpha']);

  // A targeted manual claim/release of app-gamma must NOT move the cursor.
  await runCli(['claim', '--root', root, '--session', 'worker', '--resource', 'slot', '--id', 'app-gamma']);
  await runCli(['release', '--root', root, '--session', 'worker', '--resource', 'slot', '--id', 'app-gamma']);

  // Next auto-acquire still rotates app-alpha -> app-beta, proving the manual claim left it alone.
  const second = parseStdout(
    await runCli(['slot', 'acquire', '--root', root, '--session', 'worker', '--task', 'auto'])
  );
  assert.equal(second.slot_id, 'app-beta');
});

test('round-robin cursors rotate independently per application', async () => {
  const root = await makeRoot('docko-multi-rotate-');
  await mkdir(path.join(root, 'slots', 'backend', 'be_1'), { recursive: true });
  await mkdir(path.join(root, 'slots', 'backend', 'be_2'), { recursive: true });
  await mkdir(path.join(root, 'slots', 'frontend', 'fe_1'), { recursive: true });
  await mkdir(path.join(root, 'slots', 'frontend', 'fe_2'), { recursive: true });
  await runCli(['init', '--root', root]);
  await runCli(['app', 'ensure', '--root', root, '--id', 'backend', '--keyword', 'backend']);
  await runCli(['app', 'ensure', '--root', root, '--id', 'frontend', '--keyword', 'frontend']);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'worker']);

  const acquireRelease = async (application) => {
    const acquired = parseStdout(
      await runCli([
        'slot',
        'acquire',
        '--root',
        root,
        '--session',
        'worker',
        '--application',
        application,
        '--task',
        application
      ])
    );
    await runCli(['release', '--root', root, '--session', 'worker', '--resource', 'slot', '--id', acquired.slot_id]);
    return acquired.slot_id;
  };

  // Interleave the two pools: each application's cursor must advance on its own, not be skewed
  // by acquisitions in the other pool.
  const b1 = await acquireRelease('backend');
  const f1 = await acquireRelease('frontend');
  const b2 = await acquireRelease('backend');
  const f2 = await acquireRelease('frontend');

  assert.deepEqual([b1, b2], ['backend.be_1', 'backend.be_2']);
  assert.deepEqual([f1, f2], ['frontend.fe_1', 'frontend.fe_2']);

  const registry = JSON.parse(await readFile(path.join(root, 'docko', 'registry.json'), 'utf8'));
  assert.equal(registry.workspace.config.scheduler.last_slot_id.backend, 'backend.be_2');
  assert.equal(registry.workspace.config.scheduler.last_slot_id.frontend, 'frontend.fe_2');
});

test('multi-application workspaces can seed backend and frontend slot pools and infer the right application from task text', async () => {
  const root = await makeRoot('docko-multi-app-');
  const workspaceRoot = path.join(root, 'workspace');
  const backendSource = path.join(root, 'backend-source');
  const frontendSource = path.join(root, 'frontend-source');

  await mkdir(backendSource, { recursive: true });
  await mkdir(frontendSource, { recursive: true });
  await writeFile(path.join(backendSource, 'README.md'), '# backend\n', 'utf8');
  await writeFile(path.join(backendSource, 'service.txt'), 'backend service\n', 'utf8');
  await writeFile(path.join(frontendSource, 'README.md'), '# frontend\n', 'utf8');
  await writeFile(path.join(frontendSource, 'ui.txt'), 'frontend ui\n', 'utf8');

  await runCli(['init', '--root', workspaceRoot, '--claude', '--codex']);
  const backend = parseStdout(
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
      'Backend API service',
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
  const frontend = parseStdout(
    await runCli([
      'app',
      'ensure',
      '--root',
      workspaceRoot,
      '--id',
      'frontend',
      '--name',
      'Frontend',
      '--description',
      'Frontend web app',
      '--keyword',
      'frontend',
      '--keyword',
      'web',
      '--source',
      frontendSource,
      '--slots',
      '2'
    ])
  );

  assert.deepEqual(backend.discovered_slots, ['backend.main_1', 'backend.main_2']);
  assert.deepEqual(frontend.discovered_slots, ['frontend.main_1', 'frontend.main_2']);

  await runCli(['session', 'start', '--root', workspaceRoot, '--runtime', 'shell', '--session', 'backend-worker']);
  await runCli(['session', 'start', '--root', workspaceRoot, '--runtime', 'shell', '--session', 'frontend-worker']);
  await runCli(['session', 'start', '--root', workspaceRoot, '--runtime', 'shell', '--session', 'backend-hotfix']);

  const backendAcquire = parseStdout(
    await runCli([
      'slot',
      'acquire',
      '--root',
      workspaceRoot,
      '--session',
      'backend-worker',
      '--branch',
      'feat/backend-auth',
      '--task',
      'update backend auth flow'
    ])
  );
  assert.equal(backendAcquire.application_id, 'backend');
  assert.equal(backendAcquire.slot_id, 'backend.main_1');
  assert.equal(existsSync(path.join(workspaceRoot, 'slots', 'backend', 'main_1', 'service.txt')), true);

  const frontendAcquire = parseStdout(
    await runCli([
      'slot',
      'acquire',
      '--root',
      workspaceRoot,
      '--session',
      'frontend-worker',
      '--task',
      'update frontend landing page'
    ])
  );
  assert.equal(frontendAcquire.application_id, 'frontend');
  assert.equal(frontendAcquire.slot_id, 'frontend.main_1');
  assert.equal(existsSync(path.join(workspaceRoot, 'slots', 'frontend', 'main_1', 'ui.txt')), true);

  await runCli([
    'claim',
    '--root',
    workspaceRoot,
    '--session',
    'backend-worker',
    '--resource',
    'slot',
    '--id',
    'backend.main_2'
  ]);
  const backendHotfix = parseStdout(
    await runCli([
      'slot',
      'acquire',
      '--root',
      workspaceRoot,
      '--session',
      'backend-hotfix',
      '--application',
      'backend',
      '--clone-when-busy',
      '--clone-slot',
      'hotfix',
      '--task',
      'urgent backend hotfix'
    ])
  );
  assert.equal(backendHotfix.action, 'cloned-and-claimed');
  assert.equal(backendHotfix.application_id, 'backend');
  assert.equal(backendHotfix.slot_id, 'backend.hotfix');
  assert.equal(existsSync(path.join(workspaceRoot, 'slots', 'backend', 'hotfix', 'service.txt')), true);

  const status = parseStdout(await runCli(['status', '--root', workspaceRoot, '--application', 'backend']));
  assert.deepEqual(
    status.resources.map((resource) => resource.resource_id),
    ['backend.hotfix', 'backend.main_1', 'backend.main_2']
  );
  assert.deepEqual(
    status.applications.map((application) => application.application_id),
    ['backend', 'frontend']
  );

  const mirror = await readFile(path.join(workspaceRoot, 'docko', 'registry.md'), 'utf8');
  assert.match(mirror, /## Applications/);
  assert.match(mirror, /\| backend \| Backend \| backend, api \| Backend API service \|/);
  assert.match(mirror, /\| frontend \| Frontend \| frontend, web \| Frontend web app \|/);

  const agentsSnippet = await readFile(path.join(workspaceRoot, '.claude', 'snippets', 'AGENTS.docko.md'), 'utf8');
  const claudeSnippet = await readFile(path.join(workspaceRoot, '.claude', 'snippets', 'CLAUDE.docko.md'), 'utf8');
  assert.match(agentsSnippet, /--application/);
  assert.match(agentsSnippet, /backend/);
  assert.match(claudeSnippet, /--application/);
});

test('slot acquire can prompt for the busy-slot clone fallback and cleanly abort when declined', async () => {
  const root = await makeWorkspace('docko-acquire-prompt-');
  await runCli(['init', '--root', root]);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'busy-owner']);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'worker']);
  await runCli(['claim', '--root', root, '--session', 'busy-owner', '--resource', 'slot', '--id', 'app-alpha']);
  await runCli(['claim', '--root', root, '--session', 'busy-owner', '--resource', 'slot', '--id', 'app-beta']);

  const acquired = await runCli(['slot', 'acquire', '--root', root, '--session', 'worker', '--prompt'], {
    input: 'n\n'
  });

  assert.equal(acquired.code, 2);
  assert.match(acquired.stderr, /Create and claim a fresh managed clone now\?/);
  assert.match(acquired.stderr, /NO_FREE_SLOT/);
  assert.equal(existsSync(path.join(root, 'slots', 'app-alpha_2')), false);
});

test('bootstrap from empty workspace discovers slot resources and renders mirror', async () => {
  const root = await makeWorkspace();
  const init = await runCli(['init', '--root', root]);
  assert.equal(init.code, 0);

  const status = await runCli(['status', '--root', root]);
  const payload = parseStdout(status);
  assert.equal(payload.resources.length, 2);
  assert.deepEqual(
    payload.resources.map((resource) => resource.resource_id),
    ['app-alpha', 'app-beta']
  );

  const mirror = await readFile(path.join(root, 'docko', 'registry.md'), 'utf8');
  assert.match(mirror, /app-alpha/);
  assert.match(mirror, /app-beta/);
});

test('relative CLI roots persist an absolute workspace root in the registry', async () => {
  const root = await makeRoot('docko-relative-root-');

  const init = parseStdout(await runCli(['init', '--root', '.'], { cwd: root }));
  assert.equal(init.workspace_root, '.');
  assert.equal(init.workspace_root_absolute, root);
  assert.equal(init.root_check.root, '.');
  assert.equal(init.root_check.absolute_root, root);

  const status = parseStdout(await runCli(['status', '--root', '.'], { cwd: root }));
  assert.equal(status.workspace.workspace_root, root);
});

test('running from inside a slot resolves up to the workspace root with no leaked registry', async () => {
  const root = await makeWorkspace('docko-walkup-');
  await runCli(['init', '--root', root]);
  const slotDir = path.join(root, 'slots', 'app-alpha');

  // cwd is the slot and no --root is given: docko must walk up to the owning workspace.
  const status = parseStdout(await runCli(['status'], { cwd: slotDir }));
  assert.equal(status.workspace.workspace_root, root);
  assert.equal(existsSync(path.join(slotDir, 'docko')), false);
});

test('an explicit --root pointing inside a managed slot is refused, not fragmented', async () => {
  const root = await makeWorkspace('docko-root-in-slot-');
  await runCli(['init', '--root', root]);
  const slotDir = path.join(root, 'slots', 'app-alpha');

  const result = await runCli(['status', '--root', '.'], { cwd: slotDir });
  assert.equal(result.code, 1);
  const payload = JSON.parse(result.stderr);
  assert.equal(payload.error.code, 'ROOT_INSIDE_SLOT');
  assert.equal(payload.error.workspace_root, root);
  assert.equal(existsSync(path.join(slotDir, 'docko')), false);
});

test('init never walks up so a nested workspace can still be scaffolded', async () => {
  const root = await makeWorkspace('docko-init-nowalkup-');
  await runCli(['init', '--root', root]);
  const nested = path.join(root, 'slots', 'app-alpha', 'child');
  await mkdir(nested, { recursive: true });

  const init = parseStdout(await runCli(['init', '--root', '.'], { cwd: nested }));
  assert.equal(init.workspace_root_absolute, nested);
  assert.equal(existsSync(path.join(nested, 'docko', 'registry.json')), true);
});

test('CLI launcher delegates through the checked-in bin entrypoint', async () => {
  const result = await runCliBin(['--help'], { cwd: repoRoot });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /runtime-agnostic workspace docking/i);
});

test('local npx package flow works from the repo root package', async () => {
  const result = await runShellCommand(
    `npx --yes --package ${JSON.stringify(pathToFileURL(repoRoot).href)} docko --help`,
    {
      cwd: repoRoot
    }
  );

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Usage: docko <command>/);
});

test('packed tarball is created from the repo root package', async () => {
  const packDir = await makeRoot('docko-pack-');

  try {
    const pack = await runShellCommand(`npm pack --ignore-scripts --pack-destination ${JSON.stringify(packDir)}`, {
      cwd: repoRoot
    });

    assert.equal(pack.code, 0, pack.stderr);

    const tarballName = pack.stdout.split(/\r?\n/).at(-1);
    assert.ok(tarballName);
    const tarballPath = path.join(packDir, tarballName);
    const metadata = await stat(tarballPath);
    assert.equal(metadata.isFile(), true);
    assert.ok(metadata.size > 0);
  } finally {
    await rm(packDir, { recursive: true, force: true });
  }
});

test('packed tarball installs cleanly and runs through local install and npx package flow', async () => {
  const packDir = await makeRoot('docko-pack-install-');
  const installDir = await makeRoot('docko-pack-install-workspace-');

  try {
    const pack = await runShellCommand(`npm pack --pack-destination ${JSON.stringify(packDir)}`, {
      cwd: repoRoot
    });
    assert.equal(pack.code, 0, pack.stderr || pack.stdout);

    const tarballName = pack.stdout.split(/\r?\n/).at(-1);
    assert.ok(tarballName);
    const tarballPath = path.join(packDir, tarballName);

    const npxPackaged = await runShellCommand(`npx --yes --package ${JSON.stringify(tarballPath)} docko --help`, {
      cwd: installDir
    });
    assert.equal(npxPackaged.code, 0, npxPackaged.stderr || npxPackaged.stdout);
    assert.match(npxPackaged.stdout, /Usage: docko <command>/);

    const initPackage = await runShellCommand('npm init -y', { cwd: installDir });
    assert.equal(initPackage.code, 0, initPackage.stderr || initPackage.stdout);

    const installed = await runShellCommand(`npm install ${JSON.stringify(tarballPath)}`, { cwd: installDir });
    assert.equal(installed.code, 0, installed.stderr || installed.stdout);

    const installedHelp = await runShellCommand('npx docko --help', { cwd: installDir });
    assert.equal(installedHelp.code, 0, installedHelp.stderr || installedHelp.stdout);
    assert.match(installedHelp.stdout, /Usage: docko <command>/);
  } finally {
    await rm(packDir, { recursive: true, force: true });
    await rm(installDir, { recursive: true, force: true });
  }
});

test('status drops free slot resources that were deleted from the workspace', async () => {
  const root = await makeWorkspace();
  await runCli(['init', '--root', root]);

  await rm(path.join(root, 'slots', 'app-beta'), { recursive: true, force: true });

  const status = parseStdout(await runCli(['status', '--root', root]));
  assert.deepEqual(
    status.resources.map((resource) => resource.resource_id),
    ['app-alpha']
  );
});

test('resource ensure registers non-slot resources for flexible shared environments', async () => {
  const root = await makeWorkspace();
  await runCli(['init', '--root', root]);

  const ensured = parseStdout(
    await runCli([
      'resource',
      'ensure',
      '--root',
      root,
      '--resource',
      'shared-env',
      '--id',
      'staging',
      '--path',
      'shared/staging'
    ])
  );

  assert.equal(ensured.resource_type, 'shared-env');
  assert.equal(ensured.resource_id, 'staging');

  const status = parseStdout(await runCli(['status', '--root', root, '--resource', 'shared-env', '--id', 'staging']));
  assert.equal(status.resources.length, 1);
  assert.equal(status.resources[0].path, 'shared/staging');
});

test('resource ensure updates the path of an existing non-slot resource', async () => {
  const root = await makeWorkspace();
  await runCli(['init', '--root', root]);
  await runCli([
    'resource',
    'ensure',
    '--root',
    root,
    '--resource',
    'shared-env',
    '--id',
    'staging',
    '--path',
    'shared/old'
  ]);

  const updated = parseStdout(
    await runCli([
      'resource',
      'ensure',
      '--root',
      root,
      '--resource',
      'shared-env',
      '--id',
      'staging',
      '--path',
      'shared/new'
    ])
  );

  assert.equal(updated.path, 'shared/new');
});

test('resource ensure refuses to mutate the path of a claimed resource', async () => {
  const root = await makeWorkspace();
  await runCli(['init', '--root', root]);
  await runCli([
    'resource',
    'ensure',
    '--root',
    root,
    '--resource',
    'shared-env',
    '--id',
    'staging',
    '--path',
    'shared/old'
  ]);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'owner']);
  await runCli(['claim', '--root', root, '--session', 'owner', '--resource', 'shared-env', '--id', 'staging']);

  const updated = await runCli([
    'resource',
    'ensure',
    '--root',
    root,
    '--resource',
    'shared-env',
    '--id',
    'staging',
    '--path',
    'shared/new'
  ]);

  assert.equal(updated.code, 2);
  assert.match(updated.stderr, /RESOURCE_MUTATION_DENIED/);
});

test('claim, heartbeat, release, and session-end cleanup work end to end', async () => {
  const root = await makeWorkspace();
  await runCli(['init', '--root', root]);

  const session = parseStdout(await runCli(['session', 'start', '--root', root, '--runtime', 'shell']));
  const sessionId = session.session_id;

  const claim = await runCli([
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
    'feat/protocol',
    '--task',
    'build protocol'
  ]);
  assert.equal(claim.code, 0);

  const heartbeat = parseStdout(
    await runCli(['heartbeat', '--root', root, '--session', sessionId, '--resource', 'slot', '--id', 'app-alpha'])
  );
  assert.equal(heartbeat.claim.owner_session_id, sessionId);

  const released = parseStdout(
    await runCli(['release', '--root', root, '--session', sessionId, '--resource', 'slot', '--id', 'app-alpha'])
  );
  assert.equal(released.claim.owner_session_id, sessionId);

  await runCli(['claim', '--root', root, '--session', sessionId, '--resource', 'slot', '--id', 'app-beta']);

  const end = await runCli(['session', 'end', '--root', root, '--session', sessionId]);
  assert.equal(end.code, 0);

  const status = parseStdout(await runCli(['status', '--root', root, '--resource', 'slot', '--id', 'app-beta']));
  assert.equal(status.resources[0].status, 'free');
});

test('ambiguous resolution requires explicit --session', async () => {
  const root = await makeWorkspace();
  await runCli(['init', '--root', root]);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'ses_a']);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'ses_b']);

  const claim = await runCli(['claim', '--root', root, '--resource', 'slot', '--id', 'app-alpha']);
  assert.equal(claim.code, 3);
  assert.match(claim.stderr, /AMBIGUOUS_SESSION/);
  const error = JSON.parse(claim.stderr).error;
  assert.deepEqual(
    error.active_sessions.map((session) => session.session_id),
    ['ses_a', 'ses_b']
  );
  assert.equal(error.active_sessions[0].runtime, 'shell');
  assert.equal(
    error.next_steps.some((step) => step.includes('--session <id>')),
    true
  );
  assert.equal(
    error.next_steps.some((step) => /Do not end sessions/.test(step)),
    true
  );
});

test('claim fails cleanly when there is no active session', async () => {
  const root = await makeWorkspace();
  await runCli(['init', '--root', root]);

  const claim = await runCli(['claim', '--root', root, '--resource', 'slot', '--id', 'app-alpha']);
  assert.equal(claim.code, 4);
  assert.match(claim.stderr, /NO_ACTIVE_SESSION/);
});

test('brief output summarizes status, slot acquire, and session list', async () => {
  const root = await makeWorkspace();
  await runCli(['init', '--root', root]);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'worker']);

  const before = parseStdout(await runCli(['status', '--root', root, '--brief']));
  assert.deepEqual(before.slots, { total: 2, free: 2, claimed: 0 });
  assert.deepEqual(
    before.resources.map((resource) => ({
      id: resource.id,
      status: resource.status,
      owner: resource.owner_session_id
    })),
    [
      { id: 'app-alpha', status: 'free', owner: null },
      { id: 'app-beta', status: 'free', owner: null }
    ]
  );
  assert.equal(before.janitor_released, 0);

  const acquired = parseStdout(
    await runCli([
      'slot',
      'acquire',
      '--root',
      root,
      '--session',
      'worker',
      '--branch',
      'feat/brief-output',
      '--task',
      'verify brief acquire',
      '--brief'
    ])
  );
  assert.deepEqual(acquired, {
    ok: true,
    action: 'claimed-existing-slot',
    session_id: 'worker',
    slot_id: 'app-alpha',
    application_id: null,
    slot_name: 'app-alpha',
    slot_path: path.join(root, 'slots', 'app-alpha'),
    availability: {
      total_slots: 2,
      free_slots_before: 2,
      claimed_slots_before: 0
    },
    clone: null
  });

  const after = parseStdout(
    await runCli(['status', '--root', root, '--resource', 'slot', '--id', 'app-alpha', '--brief'])
  );
  assert.deepEqual(after.slots, { total: 1, free: 0, claimed: 1 });
  assert.equal(after.resources[0].owner_session_id, 'worker');
  assert.equal(after.resources[0].task, 'verify brief acquire');

  const sessions = parseStdout(await runCli(['session', 'list', '--root', root, '--brief']));
  assert.equal(sessions.active_session_count, 1);
  assert.equal(sessions.active_sessions[0].session_id, 'worker');
  assert.equal(sessions.active_sessions[0].runtime, 'shell');
});

test('claim fails with usage error when resource arguments are missing', async () => {
  const root = await makeWorkspace();
  await runCli(['init', '--root', root]);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'owner']);

  const claim = await runCli(['claim', '--root', root, '--session', 'owner']);
  assert.equal(claim.code, 1);
  assert.match(claim.stderr, /USAGE_ERROR/);
});

test('claim rejects resource ids containing path traversal characters', async () => {
  const root = await makeWorkspace();
  await runCli(['init', '--root', root]);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'owner']);

  const traversal = await runCli([
    'claim',
    '--root',
    root,
    '--session',
    'owner',
    '--resource',
    'slot',
    '--id',
    '../escape'
  ]);
  assert.equal(traversal.code, 1);
  assert.match(traversal.stderr, /INVALID_ID/);

  const spaces = await runCli([
    'claim',
    '--root',
    root,
    '--session',
    'owner',
    '--resource',
    'custom',
    '--id',
    'has spaces'
  ]);
  assert.equal(spaces.code, 1);
  assert.match(spaces.stderr, /INVALID_ID/);
});

test('claim rejects unknown slot names', async () => {
  const root = await makeWorkspace();
  await runCli(['init', '--root', root]);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'owner']);

  const claim = await runCli([
    'claim',
    '--root',
    root,
    '--session',
    'owner',
    '--resource',
    'slot',
    '--id',
    'missing-slot'
  ]);
  assert.equal(claim.code, 1);
  assert.match(claim.stderr, /RESOURCE_NOT_FOUND/);
});

test('non-owner release is denied', async () => {
  const root = await makeWorkspace();
  await runCli(['init', '--root', root]);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'owner']);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'other']);

  await runCli(['claim', '--root', root, '--session', 'owner', '--resource', 'slot', '--id', 'app-alpha']);
  const denied = await runCli([
    'release',
    '--root',
    root,
    '--session',
    'other',
    '--resource',
    'slot',
    '--id',
    'app-alpha'
  ]);
  assert.equal(denied.code, 2);
  assert.match(denied.stderr, /RESOURCE_OWNED_BY_OTHER_SESSION/);
});

test('force release allows explicit recovery by a non-owner', async () => {
  const root = await makeWorkspace();
  await runCli(['init', '--root', root]);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'owner']);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'operator']);
  await runCli(['claim', '--root', root, '--session', 'owner', '--resource', 'slot', '--id', 'app-alpha']);

  const released = parseStdout(
    await runCli([
      'release',
      '--root',
      root,
      '--session',
      'operator',
      '--resource',
      'slot',
      '--id',
      'app-alpha',
      '--force'
    ])
  );

  assert.equal(released.claim.release_reason, 'force-release');

  const status = parseStdout(await runCli(['status', '--root', root, '--resource', 'slot', '--id', 'app-alpha']));
  assert.equal(status.resources[0].status, 'free');
});

test('delegated teammate inherits parent authority through Claude subagent start', async () => {
  const root = await makeWorkspace();
  await runCli(['init', '--root', root]);

  const parent = parseStdout(
    await runCli(['adapter', 'claude-code', 'session-start', '--root', root], {
      input: JSON.stringify({ session_id: 'parent-session' })
    })
  );
  const parentSessionId = parent.env.DOCKO_SESSION_ID;

  await runCli(['claim', '--root', root, '--session', parentSessionId, '--resource', 'slot', '--id', 'app-alpha']);

  const child = parseStdout(
    await runCli(['adapter', 'claude-code', 'subagent-start', '--root', root, '--session', parentSessionId], {
      input: JSON.stringify({ parent_session_id: parentSessionId })
    })
  );
  const childSessionId = child.env.DOCKO_SESSION_ID;

  const auth = parseStdout(
    await runCli(['adapter', 'claude-code', 'pre-tool-use', '--root', root, '--session', childSessionId], {
      input: JSON.stringify({ tool_input: { file_path: 'slots/app-alpha/src/index.ts' } })
    })
  );

  assert.equal(auth.allow, true);
  assert.equal(auth.reason, 'delegated-child');
});

test('pre-tool-use recognizes absolute paths inside managed slots', async () => {
  const root = await makeWorkspace();
  await runCli(['init', '--root', root]);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'owner']);
  await runCli(['claim', '--root', root, '--session', 'owner', '--resource', 'slot', '--id', 'app-alpha']);

  const absolutePath = path.join(root, 'slots', 'app-alpha', 'src', 'index.ts');
  const auth = parseStdout(
    await runCli(['adapter', 'claude-code', 'pre-tool-use', '--root', root, '--session', 'owner'], {
      input: JSON.stringify({ file_path: absolutePath })
    })
  );

  assert.equal(auth.allow, true);
  assert.equal(auth.reason, 'owner-session');
});

test(
  'pre-tool-use recognizes Windows-style relative paths inside managed slots',
  { skip: process.platform !== 'win32' },
  async () => {
    const root = await makeWorkspace();
    await runCli(['init', '--root', root]);
    await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'owner']);
    await runCli(['claim', '--root', root, '--session', 'owner', '--resource', 'slot', '--id', 'app-alpha']);

    const auth = parseStdout(
      await runCli(['adapter', 'claude-code', 'pre-tool-use', '--root', root, '--session', 'owner'], {
        input: JSON.stringify({ file_path: 'slots\\app-alpha\\src\\index.ts' })
      })
    );

    assert.equal(auth.allow, true);
    assert.equal(auth.reason, 'owner-session');
  }
);

test('session start rejects delegated startup when parent session is missing', async () => {
  const root = await makeWorkspace();
  await runCli(['init', '--root', root]);

  const session = await runCli([
    'session',
    'start',
    '--root',
    root,
    '--runtime',
    'shell',
    '--session',
    'child',
    '--parent-session',
    'missing-parent',
    '--actor-mode',
    'delegated'
  ]);

  assert.equal(session.code, 4);
  assert.match(session.stderr, /SESSION_NOT_FOUND/);
});

test('unrelated session is denied by pre-tool-use authorization', async () => {
  const root = await makeWorkspace();
  await runCli(['init', '--root', root]);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'owner']);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'outsider']);
  await runCli(['claim', '--root', root, '--session', 'owner', '--resource', 'slot', '--id', 'app-alpha']);

  const auth = parseStdout(
    await runCli(['adapter', 'claude-code', 'pre-tool-use', '--root', root, '--session', 'outsider'], {
      input: JSON.stringify({ file_path: 'slots/app-alpha/file.ts' })
    })
  );

  assert.equal(auth.allow, false);
  assert.equal(auth.reason, 'unrelated-session');
});

test('pre-tool-use allows paths outside managed slots', async () => {
  const root = await makeWorkspace();
  await runCli(['init', '--root', root]);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'owner']);

  const auth = parseStdout(
    await runCli(['adapter', 'claude-code', 'pre-tool-use', '--root', root, '--session', 'owner'], {
      input: JSON.stringify({ file_path: 'docs/readme.md' })
    })
  );

  assert.equal(auth.allow, true);
  assert.equal(auth.reason, 'path-not-managed');
});

test('pre-tool-use denies writes into free slots', async () => {
  const root = await makeWorkspace();
  await runCli(['init', '--root', root]);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'owner']);

  const auth = parseStdout(
    await runCli(['adapter', 'claude-code', 'pre-tool-use', '--root', root, '--session', 'owner'], {
      input: JSON.stringify({ file_path: 'slots/app-alpha/file.ts' })
    })
  );

  assert.equal(auth.allow, false);
  assert.equal(auth.reason, 'slot-not-claimed');
});

test('stale claims are recovered and another session can reclaim the slot', async () => {
  const root = await makeWorkspace();
  await runCli(['init', '--root', root]);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'first']);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'second']);

  await runCli([
    'claim',
    '--root',
    root,
    '--session',
    'first',
    '--resource',
    'slot',
    '--id',
    'app-alpha',
    '--stale-after-ms',
    '1'
  ]);

  await new Promise((resolve) => setTimeout(resolve, 100));

  const status = parseStdout(await runCli(['status', '--root', root, '--resource', 'slot', '--id', 'app-alpha']));
  assert.equal(status.resources[0].status, 'free');
  assert.equal(status.janitor.released_claims.length, 1);
  assert.equal(status.janitor.released_claims[0].resource_id, 'app-alpha');
  assert.equal(status.janitor.released_claims[0].claim.release_reason, 'stale-recovery');

  const registry = JSON.parse(await readFile(path.join(root, 'docko', 'registry.json'), 'utf8'));
  assert.equal(registry.resources[0].status, 'free');
  assert.equal(registry.resources[0].claim, null);

  const reclaim = await runCli([
    'claim',
    '--root',
    root,
    '--session',
    'second',
    '--resource',
    'slot',
    '--id',
    'app-alpha'
  ]);
  assert.equal(reclaim.code, 0);

  const logs = parseStdout(await runCli(['logs', '--root', root, '--limit', '20']));
  assert.equal(
    logs.entries.some((entry) => entry.operation === 'stale-recovery' && entry.resource_id === 'app-alpha'),
    true
  );
});

test('fresh session activity prevents janitor cleanup even when claim timestamps are old', async () => {
  const root = await makeWorkspace();
  await runCli(['init', '--root', root]);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'owner']);
  await runCli([
    'claim',
    '--root',
    root,
    '--session',
    'owner',
    '--resource',
    'slot',
    '--id',
    'app-alpha',
    '--stale-after-ms',
    '2000'
  ]);

  const registryPath = path.join(root, 'docko', 'registry.json');
  const registry = JSON.parse(await readFile(registryPath, 'utf8'));
  registry.resources[0].claim.updated_at = '2026-01-01T00:00:00.000Z';
  registry.resources[0].claim.heartbeat_at = '2026-01-01T00:00:00.000Z';
  await writeFile(registryPath, JSON.stringify(registry, null, 2), 'utf8');

  await runCli(['session', 'current', '--root', root, '--session', 'owner']);

  const status = parseStdout(await runCli(['status', '--root', root, '--resource', 'slot', '--id', 'app-alpha']));
  assert.equal(status.resources[0].status, 'claimed');
  assert.deepEqual(status.janitor.released_claims, []);
});

test('init can configure the default slot stale timeout for future claims', async () => {
  const root = await makeWorkspace();
  const init = parseStdout(await runCli(['init', '--root', root, '--slot-stale-after-ms', '14400000']));
  assert.equal(init.workspace_config.janitor.slot_stale_after_ms, 14400000);

  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'owner']);
  const claim = parseStdout(
    await runCli(['claim', '--root', root, '--session', 'owner', '--resource', 'slot', '--id', 'app-alpha'])
  );
  assert.equal(claim.claim.stale_after_ms, 14400000);
});

test('claims inherit session runtime metadata and the mirror note reflects the workspace stale default', async () => {
  const root = await makeWorkspace();
  await runCli(['init', '--root', root, '--slot-stale-after-ms', '2000']);
  await runCli(['session', 'start', '--root', root, '--runtime', 'codex', '--session', 'owner']);

  const claim = parseStdout(
    await runCli(['claim', '--root', root, '--session', 'owner', '--resource', 'slot', '--id', 'app-alpha'])
  );
  assert.equal(claim.claim.runtime, 'codex');
  assert.equal(claim.claim.stale_after_ms, 2000);

  const mirror = await readFile(path.join(root, 'docko', 'registry.md'), 'utf8');
  assert.match(mirror, /Slot claims default to 2 second stale recovery\./);
});

test('shared env resources use a shorter stale timeout and are claimable', async () => {
  const root = await makeWorkspace();
  await runCli(['init', '--root', root]);
  await runCli(['resource', 'ensure', '--root', root, '--resource', 'shared-env', '--id', 'staging']);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'owner']);

  const claim = parseStdout(
    await runCli(['claim', '--root', root, '--session', 'owner', '--resource', 'shared-env', '--id', 'staging'])
  );
  assert.equal(claim.claim.stale_after_ms, 10 * 60 * 1000);
});

test('delegate rejects missing child sessions', async () => {
  const root = await makeWorkspace();
  await runCli(['init', '--root', root]);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'leader']);
  await runCli(['claim', '--root', root, '--session', 'leader', '--resource', 'slot', '--id', 'app-alpha']);

  const delegated = await runCli([
    'delegate',
    '--root',
    root,
    '--session',
    'leader',
    '--child-session',
    'missing-child',
    '--resource',
    'slot',
    '--id',
    'app-alpha'
  ]);

  assert.equal(delegated.code, 4);
  assert.match(delegated.stderr, /SESSION_NOT_FOUND/);
});

test('corrupted registry fails fast with a schema error', async () => {
  const root = await makeWorkspace();
  await runCli(['init', '--root', root]);
  await writeFile(path.join(root, 'docko', 'registry.json'), '{not-json', 'utf8');

  const status = await runCli(['status', '--root', root]);
  assert.equal(status.code, 5);
  assert.match(status.stderr, /CORRUPTED_REGISTRY/);
});

test('malformed hook payload degrades cleanly', async () => {
  const root = await makeWorkspace();
  await runCli(['init', '--root', root]);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'one']);

  const result = parseStdout(
    await runCli(['adapter', 'claude-code', 'pre-tool-use', '--root', root, '--session', 'one'], {
      input: 'not-json'
    })
  );

  assert.equal(result.allow, true);
  assert.equal(result.reason, 'no-file-path');
});

test('pre-tool-use rejects a spoofed or missing session id even if the claim exists', async () => {
  const root = await makeWorkspace();
  await runCli(['init', '--root', root]);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'owner']);
  await runCli(['claim', '--root', root, '--session', 'owner', '--resource', 'slot', '--id', 'app-alpha']);
  await rm(path.join(root, 'docko', 'sessions', 'owner.json'));

  const auth = await runCli(['adapter', 'claude-code', 'pre-tool-use', '--root', root, '--session', 'owner'], {
    input: JSON.stringify({ file_path: 'slots/app-alpha/file.ts' })
  });

  assert.equal(auth.code, 4);
  assert.match(auth.stderr, /SESSION_NOT_FOUND/);
});

test('session current supports id-only output and session list excludes ended sessions', async () => {
  const root = await makeWorkspace();
  await runCli(['init', '--root', root]);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'live']);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'ending']);
  await runCli(['session', 'end', '--root', root, '--session', 'ending']);

  const current = await runCli(['session', 'current', '--root', root, '--session', 'live', '--id-only']);
  assert.equal(current.stdout, 'live');

  const listed = parseStdout(await runCli(['session', 'list', '--root', root]));
  assert.deepEqual(
    listed.active_sessions.map((session) => session.session_id),
    ['live']
  );
});

test('adapter session-end without any known session is a harmless no-op', async () => {
  const root = await makeWorkspace();
  await runCli(['init', '--root', root]);

  const result = parseStdout(await runCli(['adapter', 'claude-code', 'session-end', '--root', root]));
  assert.equal(result.ok, true);
});

test('session start rejects session id reuse while the original session is active', async () => {
  const root = await makeWorkspace();
  await runCli(['init', '--root', root]);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'duplicate']);

  const duplicate = await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'duplicate']);
  assert.equal(duplicate.code, 2);
  assert.match(duplicate.stderr, /SESSION_ID_CONFLICT/);
});

test('delegate command records inherited authority and mirror reflects delegations', async () => {
  const root = await makeWorkspace();
  await runCli(['init', '--root', root]);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'leader']);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'teammate']);
  await runCli(['claim', '--root', root, '--session', 'leader', '--resource', 'slot', '--id', 'app-alpha']);

  const delegated = parseStdout(
    await runCli([
      'delegate',
      '--root',
      root,
      '--session',
      'leader',
      '--child-session',
      'teammate',
      '--resource',
      'slot',
      '--id',
      'app-alpha'
    ])
  );

  assert.equal(delegated.delegations.length, 1);
  assert.equal(delegated.delegations[0].child_session_id, 'teammate');

  const mirror = await readFile(path.join(root, 'docko', 'registry.md'), 'utf8');
  assert.match(mirror, /\| app-alpha \| CLAIMED \|/);
  assert.match(mirror, /\| 1 \|/);
});

test('read-scoped delegation does not authorize file writes', async () => {
  const root = await makeWorkspace();
  await runCli(['init', '--root', root]);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'leader']);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'reader']);
  await runCli(['claim', '--root', root, '--session', 'leader', '--resource', 'slot', '--id', 'app-alpha']);
  await runCli([
    'delegate',
    '--root',
    root,
    '--session',
    'leader',
    '--child-session',
    'reader',
    '--resource',
    'slot',
    '--id',
    'app-alpha',
    '--scope',
    'read'
  ]);

  const auth = parseStdout(
    await runCli(['adapter', 'claude-code', 'pre-tool-use', '--root', root, '--session', 'reader'], {
      input: JSON.stringify({ file_path: 'slots/app-alpha/src/index.ts' })
    })
  );

  assert.equal(auth.allow, false);
  assert.equal(auth.reason, 'unrelated-session');
});

test('releasing the parent claim invalidates child write access', async () => {
  const root = await makeWorkspace();
  await runCli(['init', '--root', root]);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'leader']);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'child']);
  await runCli(['claim', '--root', root, '--session', 'leader', '--resource', 'slot', '--id', 'app-alpha']);
  await runCli([
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
    'app-alpha'
  ]);

  // Child can write while parent holds the claim.
  const allowed = parseStdout(
    await runCli(['adapter', 'claude-code', 'pre-tool-use', '--root', root, '--session', 'child'], {
      input: JSON.stringify({ file_path: 'slots/app-alpha/src/index.ts' })
    })
  );
  assert.equal(allowed.allow, true);

  // Parent releases the slot.
  await runCli(['release', '--root', root, '--session', 'leader', '--resource', 'slot', '--id', 'app-alpha']);

  // Child's access is now invalid.
  const denied = parseStdout(
    await runCli(['adapter', 'claude-code', 'pre-tool-use', '--root', root, '--session', 'child'], {
      input: JSON.stringify({ file_path: 'slots/app-alpha/src/index.ts' })
    })
  );
  assert.equal(denied.allow, false);
  assert.equal(denied.reason, 'slot-not-claimed');
});

test('session end marks delegated children ended and preserves absolute workspace roots in manifests', async () => {
  const root = await makeWorkspace();
  await runCli(['init', '--root', root]);
  await runCli(['session', 'start', '--root', root, '--runtime', 'claude-code', '--session', 'leader']);

  const child = parseStdout(
    await runCli([
      'session',
      'start',
      '--root',
      root,
      '--runtime',
      'claude-code',
      '--session',
      'child',
      '--actor-mode',
      'delegated',
      '--parent-session',
      'leader',
      '--delegated-from-session',
      'leader'
    ])
  );
  assert.equal(child.session_id, 'child');

  await runCli(['session', 'end', '--root', root, '--session', 'leader']);

  const activeSessions = parseStdout(await runCli(['session', 'list', '--root', root]));
  assert.deepEqual(activeSessions.active_sessions, []);

  const leaderManifest = JSON.parse(await readFile(path.join(root, 'docko', 'sessions', 'leader.json'), 'utf8'));
  const childManifest = JSON.parse(await readFile(path.join(root, 'docko', 'sessions', 'child.json'), 'utf8'));
  assert.equal(path.isAbsolute(leaderManifest.workspace_root), true);
  assert.equal(path.isAbsolute(childManifest.workspace_root), true);
  assert.equal(typeof leaderManifest.ended_at, 'string');
  assert.equal(typeof childManifest.ended_at, 'string');
});

test('concurrent claims serialize and only one session wins', async () => {
  const root = await makeWorkspace();
  await runCli(['init', '--root', root]);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'one']);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'two']);

  const [first, second] = await Promise.all([
    runCli(['claim', '--root', root, '--session', 'one', '--resource', 'slot', '--id', 'app-alpha']),
    runCli(['claim', '--root', root, '--session', 'two', '--resource', 'slot', '--id', 'app-alpha'])
  ]);

  const codes = [first.code, second.code].sort((left, right) => left - right);
  assert.deepEqual(codes, [0, 2]);
});

test('logs returns recent entries in newest-first order and respects the limit', async () => {
  const root = await makeWorkspace();
  await runCli(['init', '--root', root]);
  await runCli(['session', 'start', '--root', root, '--runtime', 'shell', '--session', 'owner']);
  await runCli(['claim', '--root', root, '--session', 'owner', '--resource', 'slot', '--id', 'app-alpha']);
  await runCli(['heartbeat', '--root', root, '--session', 'owner', '--resource', 'slot', '--id', 'app-alpha']);

  const logs = parseStdout(await runCli(['logs', '--root', root, '--limit', '2']));
  assert.equal(logs.retention_days, 3);
  assert.equal(logs.entries.length, 2);
  assert.deepEqual(
    logs.entries.map((entry) => entry.operation),
    ['heartbeat', 'claim']
  );
});
