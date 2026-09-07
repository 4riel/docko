import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  atomicWriteJson,
  pathExists,
  retryTransientWrite,
  sweepStaleTempArtifacts
} from '../packages/core/dist/fs-utils.js';
import { SessionSherpa } from '../packages/core/dist/session-sherpa.js';
import { DockoService } from '../packages/core/dist/service.js';
import { AUTHORIZATION_REASONS } from '../packages/core/dist/lock-bouncer.js';
import { makeWorkspace } from './helpers/cli-test-helpers.mjs';

async function makeTempDir(prefix = 'docko-persistence-') {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

function transientError(code) {
  const error = new Error(`${code}: simulated`);
  error.code = code;
  return error;
}

function registryPath(root) {
  return path.join(root, 'docko', 'registry.json');
}

async function readRegistry(root) {
  return JSON.parse(await readFile(registryPath(root), 'utf8'));
}

async function writeRegistry(root, registry) {
  await writeFile(registryPath(root), JSON.stringify(registry, null, 2), 'utf8');
}

async function ageSessionManifest(root, sessionId, updatedAt) {
  const manifestPath = path.join(root, 'docko', 'sessions', `${sessionId}.json`);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.updated_at = updatedAt;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
}

test('atomic writes retry transient rename failures and give up with an actionable error', async () => {
  let attempts = 0;
  const flaky = await retryTransientWrite(async () => {
    attempts += 1;
    if (attempts < 3) {
      throw transientError('EPERM');
    }
    return 'written';
  }, 'C:/workspace/docko/registry.json');

  assert.equal(flaky, 'written');
  assert.equal(attempts, 3);

  let exhaustedAttempts = 0;
  await assert.rejects(
    () =>
      retryTransientWrite(async () => {
        exhaustedAttempts += 1;
        throw transientError('EBUSY');
      }, 'registry.json'),
    (error) => {
      assert.equal(error.code, 'ATOMIC_WRITE_FAILED');
      assert.equal(error.details.file_path, 'registry.json');
      assert.equal(error.details.attempts, 6);
      assert.equal(error.details.cause_code, 'EBUSY');
      return true;
    }
  );
  assert.equal(exhaustedAttempts, 6);

  let fatalAttempts = 0;
  await assert.rejects(
    () =>
      retryTransientWrite(async () => {
        fatalAttempts += 1;
        throw transientError('ENOSPC');
      }, 'registry.json'),
    /ENOSPC/
  );
  assert.equal(fatalAttempts, 1);
});

test('atomic writes leave no temp siblings on success or failure', async () => {
  const root = await makeTempDir();
  const target = path.join(root, 'registry.json');

  await atomicWriteJson(target, { ok: true });
  assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), { ok: true });
  assert.deepEqual(
    (await readdir(root)).filter((entry) => entry.endsWith('.tmp')),
    []
  );

  // A destination that is a non-empty directory cannot be replaced by a rename.
  const blocked = path.join(root, 'blocked.json');
  await mkdir(blocked);
  await writeFile(path.join(blocked, 'child.txt'), 'x', 'utf8');

  await assert.rejects(() => atomicWriteJson(blocked, { ok: true }));
  assert.deepEqual(
    (await readdir(root)).filter((entry) => entry.endsWith('.tmp')),
    []
  );
});

test('sweepStaleTempArtifacts reclaims old write artifacts and leaves fresh ones alone', async () => {
  const root = await makeTempDir();
  const staleDir = path.join(root, '.docko-tmp-abc');
  const staleFile = path.join(root, 'registry.json.deadbeef.tmp');
  const freshFile = path.join(root, 'registry.json.cafe.tmp');
  const keptFile = path.join(root, 'registry.json');

  await mkdir(staleDir);
  await writeFile(path.join(staleDir, 'registry.json'), '{}', 'utf8');
  await writeFile(staleFile, '{}', 'utf8');
  await writeFile(freshFile, '{}', 'utf8');
  await writeFile(keptFile, '{}', 'utf8');

  const old = new Date(Date.now() - 60 * 60 * 1000);
  await utimes(staleDir, old, old);
  await utimes(staleFile, old, old);

  assert.equal(await sweepStaleTempArtifacts(root), 2);
  assert.deepEqual((await readdir(root)).sort(), ['registry.json', 'registry.json.cafe.tmp']);
  assert.equal(await sweepStaleTempArtifacts(path.join(root, 'missing')), 0);
});

test('SessionSherpa moves ended manifests out of the hot directory and still resolves them', async () => {
  const root = await makeTempDir();
  const sherpa = new SessionSherpa(root);
  const sessionsDir = path.join(root, 'docko', 'sessions');

  await sherpa.start({ sessionId: 'alive', runtime: 'shell', workspaceRoot: root });
  await sherpa.start({ sessionId: 'done', runtime: 'shell', workspaceRoot: root });
  await sherpa.end('done');

  assert.equal(await pathExists(path.join(sessionsDir, 'done.json')), false);
  assert.equal(await pathExists(path.join(sessionsDir, 'ended', 'done.json')), true);
  assert.deepEqual(
    (await sherpa.listActive()).map((session) => session.session_id),
    ['alive']
  );

  const ended = await sherpa.get('done');
  assert.equal(ended.session_id, 'done');
  assert.equal(typeof ended.ended_at, 'string');

  // Restarting a finished id reclaims it from the ended directory.
  await sherpa.start({ sessionId: 'done', runtime: 'shell', workspaceRoot: root });
  assert.equal(await pathExists(path.join(sessionsDir, 'ended', 'done.json')), false);
  assert.equal((await sherpa.get('done')).ended_at, null);
});

test('SessionSherpa migrates legacy ended manifests and deletes them past retention', async () => {
  const root = await makeTempDir();
  const sherpa = new SessionSherpa(root);
  const sessionsDir = path.join(root, 'docko', 'sessions');
  await mkdir(sessionsDir, { recursive: true });

  await writeFile(
    path.join(sessionsDir, 'legacy.json'),
    JSON.stringify({
      schema_version: '0.1.0',
      session_id: 'legacy',
      runtime: 'shell',
      actor_mode: 'interactive',
      parent_session_id: null,
      delegated_from_session_id: null,
      started_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T01:00:00.000Z',
      ended_at: '2026-01-01T01:00:00.000Z',
      workspace_root: root,
      metadata: {}
    }),
    'utf8'
  );

  assert.equal(await sherpa.relocateEndedManifests(), 1);
  assert.equal(await pathExists(path.join(sessionsDir, 'legacy.json')), false);
  assert.equal(await pathExists(path.join(sessionsDir, 'ended', 'legacy.json')), true);
  assert.deepEqual(await sherpa.listActive(), []);

  const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  await utimes(path.join(sessionsDir, 'ended', 'legacy.json'), old, old);

  assert.equal(await sherpa.countEndedOlderThan(7 * 24 * 60 * 60 * 1000), 1);
  assert.equal(await sherpa.deleteEndedOlderThan(7 * 24 * 60 * 60 * 1000), 1);
  assert.equal(await pathExists(path.join(sessionsDir, 'ended', 'legacy.json')), false);
  assert.equal(await sherpa.deleteEndedOlderThan(0), 0);
});

test('authorizeFileWrite answers unmanaged paths without the lock, the janitor, or any write', async () => {
  const root = await makeWorkspace('docko-fastpath-');
  const service = new DockoService(root);
  await service.init();
  await service.sessionStart({ sessionId: 'owner', runtime: 'shell', workspaceRoot: root });

  const lockDir = path.join(root, 'docko', '.registry.lock');
  await mkdir(lockDir);
  await writeFile(
    path.join(lockDir, 'owner.json'),
    JSON.stringify({ pid: process.pid, hostname: os.hostname(), acquired_at: new Date().toISOString() }),
    'utf8'
  );

  const registryBefore = await readFile(registryPath(root), 'utf8');
  const manifestPath = path.join(root, 'docko', 'sessions', 'owner.json');
  const manifestBefore = await readFile(manifestPath, 'utf8');

  const startedAt = Date.now();
  const authorization = await service.authorizeFileWrite('owner', 'docs/readme.md');

  assert.equal(authorization.allowed, true);
  assert.equal(authorization.reason, 'path-not-managed');
  // The locked path would have burned the full lock timeout before failing.
  assert.ok(Date.now() - startedAt < 2_000);
  assert.equal(await readFile(registryPath(root), 'utf8'), registryBefore);
  assert.equal(await readFile(manifestPath, 'utf8'), manifestBefore);

  await rm(lockDir, { recursive: true, force: true });
});

test('read-only status leaves registry.json and registry.md untouched', async () => {
  const root = await makeWorkspace('docko-readonly-');
  const service = new DockoService(root);
  await service.init();
  await service.status();

  const mirrorPath = path.join(root, 'docko', 'registry.md');
  const registryBefore = await stat(registryPath(root));
  const mirrorBefore = await stat(mirrorPath);
  const registryBytes = await readFile(registryPath(root), 'utf8');

  const status = await service.status();
  assert.equal(status.janitor.ended_sessions_truncated, false);
  assert.equal(status.janitor.deleted_manifests, 0);
  assert.equal((await stat(registryPath(root))).mtimeMs, registryBefore.mtimeMs);
  assert.equal((await stat(mirrorPath)).mtimeMs, mirrorBefore.mtimeMs);
  assert.equal(await readFile(registryPath(root), 'utf8'), registryBytes);

  // A real change still writes both files.
  await service.sessionStart({ sessionId: 'owner', runtime: 'shell', workspaceRoot: root });
  await service.claim({ sessionId: 'owner', resourceType: 'slot', resourceId: 'app-alpha' });
  assert.notEqual(await readFile(registryPath(root), 'utf8'), registryBytes);
});

test('an authorized write refreshes the claim heartbeat at most once per throttle window', async () => {
  const root = await makeWorkspace('docko-heartbeat-');
  const service = new DockoService(root);
  await service.init();
  await service.sessionStart({ sessionId: 'owner', runtime: 'shell', workspaceRoot: root });
  await service.claim({ sessionId: 'owner', resourceType: 'slot', resourceId: 'app-alpha' });

  const stalePulse = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const registry = await readRegistry(root);
  const resource = registry.resources.find((entry) => entry.resource_id === 'app-alpha');
  resource.claim.heartbeat_at = stalePulse;
  resource.claim.updated_at = stalePulse;
  await writeRegistry(root, registry);

  const first = await service.authorizeFileWrite('owner', 'slots/app-alpha/src/index.ts');
  assert.equal(first.allowed, true);
  assert.equal(first.reason, 'owner');
  assert.equal(first.owner_session_active, true);

  const refreshed = (await readRegistry(root)).resources.find((entry) => entry.resource_id === 'app-alpha');
  assert.notEqual(refreshed.claim.heartbeat_at, stalePulse);

  await service.authorizeFileWrite('owner', 'slots/app-alpha/src/other.ts');
  const throttled = (await readRegistry(root)).resources.find((entry) => entry.resource_id === 'app-alpha');
  assert.equal(throttled.claim.heartbeat_at, refreshed.claim.heartbeat_at);
});

test('a write into a slot whose claim lapsed is denied as claim-expired', async () => {
  const root = await makeWorkspace('docko-expired-');
  const service = new DockoService(root);
  await service.init();
  await service.sessionStart({ sessionId: 'owner', runtime: 'shell', workspaceRoot: root });
  await service.sessionStart({ sessionId: 'other', runtime: 'shell', workspaceRoot: root });
  await service.claim({
    sessionId: 'owner',
    resourceType: 'slot',
    resourceId: 'app-alpha',
    branch: 'feat/lapsed',
    task: 'lapsed work',
    staleAfterMs: 1
  });

  // Quiet owner activity is what makes the claim stale; the session itself stays active.
  await ageSessionManifest(root, 'owner', new Date(Date.now() - 10 * 60 * 1000).toISOString());

  const expired = await service.authorizeFileWrite('owner', 'slots/app-alpha/file.ts');
  assert.equal(expired.allowed, false);
  assert.equal(expired.reason, 'claim-expired');
  assert.equal(expired.owner_session_id, null);
  assert.equal(expired.previous_owner_session_id, 'owner');
  assert.equal(expired.owner_branch, 'feat/lapsed');
  assert.equal(expired.owner_task, 'lapsed work');
  assert.equal(typeof expired.expired_at, 'string');

  const foreign = await service.authorizeFileWrite('other', 'slots/app-alpha/file.ts');
  assert.equal(foreign.reason, 'slot-not-claimed');
  assert.equal(foreign.owner_session_id, null);
  assert.equal(foreign.previous_owner_session_id, 'owner');

  assert.deepEqual(
    [...AUTHORIZATION_REASONS],
    ['path-not-managed', 'owner', 'delegated', 'slot-not-claimed', 'claim-expired', 'unrelated-session']
  );
});

test('the janitor ends stale sessions in bounded batches and reports truncation', async () => {
  const root = await makeWorkspace('docko-janitor-cap-');
  const service = new DockoService(root);
  await service.init();

  const sessionsDir = path.join(root, 'docko', 'sessions');
  await mkdir(sessionsDir, { recursive: true });
  for (let index = 0; index < 120; index += 1) {
    await writeFile(
      path.join(sessionsDir, `ghost_${String(index).padStart(3, '0')}.json`),
      JSON.stringify({
        schema_version: '0.1.0',
        session_id: `ghost_${String(index).padStart(3, '0')}`,
        runtime: 'shell',
        actor_mode: 'interactive',
        parent_session_id: null,
        delegated_from_session_id: null,
        started_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        ended_at: null,
        workspace_root: root,
        metadata: {}
      }),
      'utf8'
    );
  }

  const first = await service.status();
  assert.equal(first.janitor.ended_sessions.length, 100);
  assert.equal(first.janitor.ended_sessions_truncated, true);

  const second = await service.status();
  assert.equal(second.janitor.ended_sessions.length, 20);
  assert.equal(second.janitor.ended_sessions_truncated, false);

  assert.deepEqual(
    (await readdir(sessionsDir)).filter((entry) => entry.endsWith('.json')),
    []
  );
  assert.equal((await readdir(path.join(sessionsDir, 'ended'))).length, 120);
});

test('session prune deletes ended manifests past the retention window', async () => {
  const root = await makeWorkspace('docko-prune-retention-');
  const service = new DockoService(root);
  await service.init();
  await service.sessionStart({ sessionId: 'done', runtime: 'shell', workspaceRoot: root });
  await service.sessionEnd('done');

  const endedDir = path.join(root, 'docko', 'sessions', 'ended');
  const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  await utimes(path.join(endedDir, 'done.json'), old, old);

  const preview = await service.sessionPrune({ dryRun: true, deleteEndedOlderThanMs: 24 * 60 * 60 * 1000 });
  assert.equal(preview.dry_run, true);
  assert.equal(preview.retention_ms, 24 * 60 * 60 * 1000);
  assert.equal(preview.deleted_manifests, 1);
  assert.equal(await pathExists(path.join(endedDir, 'done.json')), true);

  const pruned = await service.sessionPrune({ deleteEndedOlderThanMs: 24 * 60 * 60 * 1000 });
  assert.equal(pruned.dry_run, false);
  assert.equal(pruned.retention_ms, 24 * 60 * 60 * 1000);
  assert.equal(pruned.deleted_manifests, 1);
  assert.equal(await pathExists(path.join(endedDir, 'done.json')), false);

  const kept = await service.sessionPrune();
  assert.equal(kept.retention_ms, 7 * 24 * 60 * 60 * 1000);
  assert.equal(kept.deleted_manifests, 0);
});

test('session resolution ignores an unknown environment id and caps ambiguous candidates', async () => {
  const root = await makeWorkspace('docko-resolution-');
  const service = new DockoService(root);
  await service.init();
  await service.sessionStart({ sessionId: 'only', runtime: 'shell', workspaceRoot: root });

  assert.equal(await service.resolveSessionId(null, 'ses_never_started'), 'only');
  assert.equal(await service.resolveSessionId(null, 'only'), 'only');

  for (let index = 0; index < 11; index += 1) {
    await service.sessionStart({
      sessionId: `worker_${String(index).padStart(2, '0')}`,
      runtime: 'shell',
      workspaceRoot: root
    });
  }

  await assert.rejects(
    () => service.resolveSessionId(null, 'ses_never_started'),
    (error) => {
      assert.equal(error.code, 'AMBIGUOUS_SESSION');
      assert.equal(error.details.active_session_count, 12);
      assert.equal(error.details.active_sessions.length, 10);
      assert.equal(error.details.newest_session_id, 'worker_10');
      assert.equal(error.details.active_sessions[0].session_id, 'worker_10');
      assert.equal(error.details.resolution.env_session_id, 'ses_never_started');
      return true;
    }
  );
});

test('a slot directory discovered on disk is never writable before it is claimed', async () => {
  const root = await makeWorkspace('docko-fresh-slot-');
  const service = new DockoService(root);
  await service.init();
  await service.sessionStart({ sessionId: 'owner', runtime: 'shell', workspaceRoot: root });

  // Created after the last registry mutation, so the unlocked snapshot knows nothing about it.
  await mkdir(path.join(root, 'slots', 'fresh'), { recursive: true });

  const authorization = await service.authorizeFileWrite('owner', 'slots/fresh/index.ts');
  assert.equal(authorization.allowed, false);
  assert.equal(authorization.reason, 'slot-not-claimed');
  assert.equal(authorization.resource_id, 'fresh');

  // Discovery ran on the locked path, so a claim on the new slot is immediately possible.
  await service.claim({ sessionId: 'owner', resourceType: 'slot', resourceId: 'fresh' });
  const allowed = await service.authorizeFileWrite('owner', 'slots/fresh/index.ts');
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.reason, 'owner');
  assert.equal(allowed.slot_path, 'slots/fresh');
});

test('a short stale window still gets a heartbeat between authorized writes', async () => {
  const root = await makeWorkspace('docko-short-stale-');
  const service = new DockoService(root);
  await service.init();
  await service.sessionStart({ sessionId: 'owner', runtime: 'shell', workspaceRoot: root });
  await service.claim({
    sessionId: 'owner',
    resourceType: 'slot',
    resourceId: 'app-alpha',
    staleAfterMs: 3000
  });

  // A fixed 30 s throttle never fired inside a 3 s window, so the janitor reclaimed the slot from
  // under a session that had been writing to it the whole time.
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const authorization = await service.authorizeFileWrite('owner', 'slots/app-alpha/src/index.ts');
    assert.equal(authorization.allowed, true, authorization.reason);
    assert.equal(authorization.reason, 'owner');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const resource = (await readRegistry(root)).resources.find((entry) => entry.resource_id === 'app-alpha');
  assert.equal(resource.status, 'claimed');
  assert.equal(resource.claim.owner_session_id, 'owner');
});

test('stale write artifacts are reclaimed on the read path, including the ended-session directory', async () => {
  const root = await makeWorkspace('docko-sweep-read-');
  const service = new DockoService(root);
  await service.init();
  await service.sessionStart({ sessionId: 'owner', runtime: 'shell', workspaceRoot: root });
  await service.sessionEnd('owner');

  const old = new Date(Date.now() - 10 * 60 * 1000);
  const artifacts = [
    path.join(root, 'docko', 'registry.json.deadbeef.tmp'),
    path.join(root, 'docko', 'sessions', 'owner.json.deadbeef.tmp'),
    path.join(root, 'docko', 'sessions', 'ended', 'owner.json.deadbeef.tmp')
  ];
  for (const artifact of artifacts) {
    await writeFile(artifact, 'partial', 'utf8');
    await utimes(artifact, old, old);
  }

  // A read-only authorization: writeRegistry never runs, so the sweep has to happen here or the
  // artifacts survive forever in a workspace whose registry no longer changes.
  const reader = new DockoService(root);
  const authorization = await reader.authorizeFileWrite('owner', 'docs/readme.md');
  assert.equal(authorization.reason, 'path-not-managed');

  for (const artifact of artifacts) {
    assert.equal(await pathExists(artifact), false, artifact);
  }
});
