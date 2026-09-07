import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DockoError, toErrorPayload } from '../packages/core/dist/errors.js';
import {
  atomicWriteJson,
  atomicWriteText,
  ensureDir,
  listDirectories,
  pathExists,
  readJsonFile,
  safeUnlink
} from '../packages/core/dist/fs-utils.js';
import { LockBouncer } from '../packages/core/dist/lock-bouncer.js';
import { MutationGate } from '../packages/core/dist/mutation-gate.js';
import { SessionSherpa } from '../packages/core/dist/session-sherpa.js';

async function makeTempDir(prefix = 'docko-unit-') {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

test('toErrorPayload handles DockoError, generic Error, and unknown values', () => {
  const known = toErrorPayload(new DockoError('nope', 'KNOWN', 2, { a: 1 }));
  assert.deepEqual(known, { error: { code: 'KNOWN', message: 'nope', a: 1 } });

  const generic = toErrorPayload(new Error('boom'));
  assert.deepEqual(generic, { error: { code: 'UNEXPECTED_ERROR', message: 'boom' } });

  const unknown = toErrorPayload('bad');
  assert.deepEqual(unknown, { error: { code: 'UNEXPECTED_ERROR', message: 'Unknown error' } });
});

test('fs helpers cover json, text, existence, listing, and safe unlink paths', async () => {
  const root = await makeTempDir();
  const nestedDir = path.join(root, 'nested');
  const jsonFile = path.join(nestedDir, 'file.json');
  const textFile = path.join(nestedDir, 'file.txt');
  const subdir = path.join(root, 'dirs', 'a');
  const otherFile = path.join(root, 'dirs', 'note.txt');

  await ensureDir(nestedDir);
  await atomicWriteJson(jsonFile, { ok: true });
  await atomicWriteText(textFile, 'hello\n');
  assert.deepEqual(await readJsonFile(jsonFile), { ok: true });
  assert.equal(await readFile(textFile, 'utf8'), 'hello\n');

  assert.equal(await pathExists(jsonFile), true);
  assert.equal(await pathExists(path.join(root, 'missing.json')), false);

  await mkdir(subdir, { recursive: true });
  await writeFile(otherFile, 'x', 'utf8');
  assert.deepEqual(await listDirectories(path.join(root, 'dirs')), ['a']);
  assert.deepEqual(await listDirectories(path.join(root, 'no-dirs-here')), []);

  await safeUnlink(otherFile);
  assert.equal(existsSync(otherFile), false);
  await safeUnlink(otherFile);
});

test('SessionSherpa covers missing session paths and resolution modes', async () => {
  const root = await makeTempDir();
  const sherpa = new SessionSherpa(root);

  assert.equal(await sherpa.get('missing'), null);
  assert.equal(await sherpa.end('missing'), null);
  await assert.rejects(() => sherpa.touch('missing'), /Session not found/);

  let resolution = await sherpa.resolve(null, null);
  assert.equal(resolution.source, 'none');
  assert.equal(resolution.sessionId, null);

  const single = await sherpa.start({
    sessionId: 'single',
    runtime: 'shell',
    workspaceRoot: root
  });

  resolution = await sherpa.resolve(null, null);
  assert.equal(resolution.source, 'single-active');
  assert.equal(resolution.sessionId, single.session_id);

  resolution = await sherpa.resolve('explicit', null);
  assert.equal(resolution.source, 'explicit');
  assert.equal(resolution.sessionId, 'explicit');

  resolution = await sherpa.resolve(null, 'env-session');
  assert.equal(resolution.source, 'single-active');
  assert.equal(resolution.sessionId, single.session_id);
  assert.equal(resolution.envSessionMatched, false);

  resolution = await sherpa.resolve(null, 'single');
  assert.equal(resolution.source, 'env');
  assert.equal(resolution.sessionId, 'single');
  assert.equal(resolution.envSessionMatched, true);

  await sherpa.start({
    sessionId: 'second',
    runtime: 'shell',
    workspaceRoot: root
  });
  resolution = await sherpa.resolve(null, null);
  assert.equal(resolution.source, 'ambiguous');
  assert.equal(resolution.sessionId, null);

  await sherpa.cleanupEnded('single');
  assert.equal(await pathExists(path.join(root, 'docko', 'sessions', 'single.json')), false);
  await sherpa.cleanupEnded('missing');
});

test('SessionSherpa defaults workspace_root to the current working directory when omitted', async () => {
  const root = await makeTempDir();
  const sherpa = new SessionSherpa(root);

  const session = await sherpa.start({
    sessionId: 'cwd-default',
    runtime: 'shell'
  });

  assert.equal(session.workspace_root, path.resolve('.'));
});

test('LockBouncer covers no-claim and claimed-resource denial branches', () => {
  const bouncer = new LockBouncer('/workspace');

  const freeResource = {
    resource_type: 'slot',
    resource_id: 'app-alpha',
    path: 'slots/app-alpha',
    status: 'free',
    claim: null,
    delegations: []
  };

  assert.throws(() => bouncer.requireOwner(freeResource, 'owner'), /Resource is not claimed/);

  const claimedResource = {
    ...freeResource,
    status: 'claimed',
    claim: {
      owner_session_id: 'owner',
      runtime: 'shell',
      branch: null,
      task: null,
      claimed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      heartbeat_at: new Date().toISOString(),
      stale_after_ms: 1000,
      release_reason: null
    }
  };

  assert.throws(() => bouncer.requireClaimable(claimedResource), /Resource is already claimed/);
});

test('LockBouncer covers delegated, unrelated, free-slot, and malformed claimed authorization paths', () => {
  const now = new Date().toISOString();
  const workspaceRoot = process.platform === 'win32' ? 'C:\\workspace' : '/workspace';
  const bouncer = new LockBouncer(workspaceRoot);
  const registry = {
    schema_version: '0.1.0',
    generated_at: now,
    workspace: {
      workspace_id: 'wk_test',
      workspace_root: workspaceRoot,
      name: 'workspace'
    },
    resources: [
      {
        resource_type: 'slot',
        resource_id: 'app-alpha',
        path: 'slots/app-alpha',
        status: 'claimed',
        claim: {
          owner_session_id: 'owner',
          runtime: 'shell',
          branch: null,
          task: null,
          claimed_at: now,
          updated_at: now,
          heartbeat_at: now,
          stale_after_ms: 1000,
          release_reason: null
        },
        delegations: [
          {
            child_session_id: 'child',
            granted_by_session_id: 'owner',
            granted_at: now,
            scope: 'write'
          }
        ]
      },
      {
        resource_type: 'slot',
        resource_id: 'app-beta',
        path: 'slots/app-beta',
        status: 'free',
        claim: null,
        delegations: []
      }
    ]
  };

  assert.deepEqual(
    bouncer.authorizeFileWrite(registry, 'child', path.join(workspaceRoot, 'slots', 'app-alpha', 'src', 'index.ts')),
    {
      allowed: true,
      reason: 'delegated',
      session_id: 'child',
      resource_id: 'app-alpha',
      owner_session_id: 'owner',
      owner_task: null,
      owner_branch: null,
      owner_session_active: null,
      expired_at: null,
      claim_stale_after_ms: 1000,
      previous_owner_session_id: null,
      application_id: null,
      slot_path: 'slots/app-alpha',
      invalid_slot_dir: null,
      session_known: null
    }
  );

  assert.deepEqual(
    bouncer.authorizeFileWrite(registry, 'intruder', path.join(workspaceRoot, 'slots', 'app-alpha', 'src', 'index.ts')),
    {
      allowed: false,
      reason: 'unrelated-session',
      session_id: 'intruder',
      resource_id: 'app-alpha',
      owner_session_id: 'owner',
      owner_task: null,
      owner_branch: null,
      owner_session_active: null,
      expired_at: null,
      claim_stale_after_ms: 1000,
      previous_owner_session_id: null,
      application_id: null,
      slot_path: 'slots/app-alpha',
      invalid_slot_dir: null,
      session_known: null
    }
  );

  assert.deepEqual(
    bouncer.authorizeFileWrite(registry, 'owner', path.join(workspaceRoot, 'slots', 'app-beta', 'file.txt')),
    {
      allowed: false,
      reason: 'slot-not-claimed',
      session_id: 'owner',
      resource_id: 'app-beta',
      owner_session_id: null,
      owner_task: null,
      owner_branch: null,
      owner_session_active: null,
      expired_at: null,
      claim_stale_after_ms: null,
      previous_owner_session_id: null,
      application_id: null,
      slot_path: 'slots/app-beta',
      invalid_slot_dir: null,
      session_known: null
    }
  );

  assert.throws(
    () =>
      bouncer.requireClaimable({
        resource_type: 'slot',
        resource_id: 'broken-slot',
        path: 'slots/broken-slot',
        status: 'claimed',
        claim: null,
        delegations: []
      }),
    (error) => {
      assert.equal(error.code, 'RESOURCE_ALREADY_CLAIMED');
      assert.equal(error.owner_session_id, undefined);
      return true;
    }
  );
});

test(
  'LockBouncer recognizes Windows absolute paths against slash-normalized slot paths',
  { skip: process.platform !== 'win32' },
  () => {
    const bouncer = new LockBouncer('C:\\workspace');
    const now = new Date().toISOString();
    const registry = {
      version: 1,
      workspace_root: 'C:\\workspace',
      generated_at: now,
      resources: [
        {
          resource_type: 'slot',
          resource_id: 'app-alpha',
          path: 'slots/app-alpha',
          status: 'claimed',
          claim: {
            owner_session_id: 'owner',
            runtime: 'shell',
            branch: null,
            task: null,
            claimed_at: now,
            updated_at: now,
            heartbeat_at: now,
            stale_after_ms: 1000,
            release_reason: null
          },
          delegations: []
        }
      ],
      sessions: []
    };

    const authorization = bouncer.authorizeFileWrite(
      registry,
      'owner',
      'C:\\workspace\\slots\\app-alpha\\src\\index.ts'
    );

    assert.equal(authorization.allowed, true);
    assert.equal(authorization.reason, 'owner');
  }
);

test('MutationGate reports timeout when lock directory cannot be acquired', async () => {
  const root = await makeTempDir();
  const lockPath = path.join(root, 'lock');
  await writeFile(lockPath, 'occupied', 'utf8');

  const gate = new MutationGate(lockPath);
  const originalNow = Date.now;
  let tick = 0;
  Date.now = () => {
    tick += 6000;
    return originalNow() + tick;
  };

  try {
    await assert.rejects(() => gate.run(async () => 'nope'), /Timed out waiting for registry lock/);
  } finally {
    Date.now = originalNow;
  }
});

test('the write heartbeat throttle stays inside the claim stale window', async () => {
  const { claimHeartbeatThrottleMs } = await import('../packages/core/dist/service.js');
  const { CLAIM_WRITE_HEARTBEAT_THROTTLE_MS, CLAIM_WRITE_HEARTBEAT_MIN_THROTTLE_MS } =
    await import('../packages/core/dist/constants.js');

  // A long window keeps the default cap; a short one scales down so several refreshes fit inside
  // it, which is what stops a 3 s claim expiring between two authorized writes.
  assert.equal(claimHeartbeatThrottleMs(60 * 60 * 1000), CLAIM_WRITE_HEARTBEAT_THROTTLE_MS);
  assert.equal(claimHeartbeatThrottleMs(3000), 1000);
  assert.equal(claimHeartbeatThrottleMs(40_000), 10_000);
  // Never below the floor, and an unusable value falls back to the default.
  assert.equal(claimHeartbeatThrottleMs(100), CLAIM_WRITE_HEARTBEAT_MIN_THROTTLE_MS);
  for (const bad of [null, undefined, 0, -1, Number.NaN]) {
    assert.equal(claimHeartbeatThrottleMs(bad), CLAIM_WRITE_HEARTBEAT_THROTTLE_MS, String(bad));
  }
});

test('a session touch is a no-op once the session has ended', async () => {
  const root = await makeTempDir('docko-touch-ended-');
  const sherpa = new SessionSherpa(root);

  await sherpa.start({ sessionId: 'ses_x', runtime: 'shell', workspaceRoot: root });
  const ended = await sherpa.end('ses_x');
  const endedPath = path.join(root, 'docko', 'sessions', 'ended', 'ses_x.json');
  const before = await readFile(endedPath, 'utf8');

  // Ended manifests are deleted by file age, so a touch here would restart their retention clock.
  const touched = await sherpa.touch('ses_x');
  assert.equal(touched.updated_at, ended.updated_at);
  assert.equal(await readFile(endedPath, 'utf8'), before);
});

test('a future-dated owner stamp never wedges the lock', async () => {
  const root = await makeTempDir('docko-lock-skew-');
  const lockDir = path.join(root, '.registry.lock');
  await mkdir(lockDir);
  // Regression: staleness was measured from acquired_at alone, so a clock-skewed stamp made every
  // command fail with REGISTRY_LOCK_TIMEOUT until someone deleted the directory by hand.
  await writeFile(
    path.join(lockDir, 'owner.json'),
    JSON.stringify({ pid: 999999, hostname: 'ghost', acquired_at: '2030-01-01T00:00:00.000Z' }),
    'utf8'
  );

  const gate = new MutationGate(lockDir, { timeoutMs: 3000, staleMs: 5, refreshMs: 60_000 });
  assert.equal(await gate.run(async () => 'recovered'), 'recovered');
  assert.equal(existsSync(lockDir), false);
});

test('a live lock holder is not broken by a waiter', async () => {
  const root = await makeTempDir('docko-lock-live-');
  const lockDir = path.join(root, '.registry.lock');

  // The refresh runs 20x more often than the stale window, so a loaded machine cannot make a live
  // holder look abandoned.
  const holder = new MutationGate(lockDir, { timeoutMs: 5000, staleMs: 800, refreshMs: 40 });
  const waiter = new MutationGate(lockDir, { timeoutMs: 900, staleMs: 800, refreshMs: 40 });
  let waiterEnteredLock = false;

  await holder.run(async () => {
    // The holder outlives the stale window several times over; its refresh keeps it fresh.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await assert.rejects(
      () =>
        waiter.run(async () => {
          waiterEnteredLock = true;
        }),
      /Timed out waiting for registry lock/
    );
    // Still ours, so the pre-write guard stays silent.
    await holder.assertStillHeld();
  });

  assert.equal(waiterEnteredLock, false);
});

test('a holder whose lock was broken refuses to write', async () => {
  const root = await makeTempDir('docko-lock-lost-');
  const lockDir = path.join(root, '.registry.lock');
  const abandoned = new MutationGate(lockDir, { timeoutMs: 5000, staleMs: 10, refreshMs: 60_000 });
  const breaker = new MutationGate(lockDir, { timeoutMs: 5000, staleMs: 10, refreshMs: 60_000 });

  await assert.rejects(
    () =>
      abandoned.run(async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        await breaker.run(async () => 'stole it');
        await abandoned.assertStillHeld();
      }),
    (error) => error.code === 'REGISTRY_LOCK_LOST' && error.exitCode === 2
  );
});

test('slots containment follows the platform path rules, not string prefixes', async () => {
  const { isPathInside } = await import('../packages/core/dist/paths.js');

  // Windows: drive-letter case and segment case must not change the answer.
  assert.equal(isPathInside('C:\\ws\\slots', 'c:/ws/SLOTS/a/x.ts', path.win32), true);
  assert.equal(isPathInside('C:\\ws\\slots', 'C:\\ws\\slots', path.win32), true);
  assert.equal(isPathInside('C:\\ws\\slots', 'C:\\ws\\slotsx\\x.ts', path.win32), false);
  assert.equal(isPathInside('C:\\ws\\slots', 'C:\\ws\\other\\x.ts', path.win32), false);
  // POSIX stays case-sensitive.
  assert.equal(isPathInside('/ws/slots', '/ws/SLOTS/a/x.ts', path.posix), false);
  assert.equal(isPathInside('/ws/slots', '/ws/slots/a/x.ts', path.posix), true);
  // A child whose name merely starts with '..' is still a child.
  assert.equal(isPathInside('/ws/slots', '/ws/slots/..hidden/x.ts', path.posix), true);
  assert.equal(isPathInside('/ws/slots', '/ws/slots/../escape.ts', path.posix), false);
});

test('the bouncer treats a case-different slots path as managed', () => {
  const workspaceRoot = process.platform === 'win32' ? 'C:\\ws' : '/ws';
  const bouncer = new LockBouncer(workspaceRoot);

  assert.equal(bouncer.isInsideSlotsTree(path.join(workspaceRoot, 'slots', 'a', 'x.ts')), true);
  if (process.platform === 'win32') {
    // Regression: `===`/startsWith let c:\ws\SLOTS\a\x.ts answer path-not-managed, so the hook
    // allowed the write.
    assert.equal(bouncer.isInsideSlotsTree('c:\\ws\\SLOTS\\a\\x.ts'), true);
    assert.equal(
      bouncer.findManagedSlot(
        { resources: [{ resource_type: 'slot', resource_id: 'a', path: 'slots/a', status: 'free' }] },
        'c:\\ws\\SLOTS\\a\\x.ts'
      )?.resource_id,
      'a'
    );
  }
});

test('a write into a slot directory with an unusable name is denied, not allowed', () => {
  const workspaceRoot = process.platform === 'win32' ? 'C:\\ws' : '/ws';
  const bouncer = new LockBouncer(workspaceRoot);
  const registry = { resources: [] };

  const denied = bouncer.authorizeFileWrite(
    registry,
    'ses_1',
    path.join(workspaceRoot, 'slots', 'my slot', 'index.ts'),
    { ignoredSlotDirs: ['slots/my slot'], sessionKnown: true }
  );
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, 'slot-not-claimed');
  assert.equal(denied.invalid_slot_dir, 'slots/my slot');
  assert.equal(denied.session_known, true);

  // A path that is not under an ignored directory is unaffected.
  const allowed = bouncer.authorizeFileWrite(registry, 'ses_1', path.join(workspaceRoot, 'README.md'), {
    ignoredSlotDirs: ['slots/my slot']
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.reason, 'path-not-managed');
  assert.equal(allowed.invalid_slot_dir, null);
  assert.equal(allowed.session_known, null);
});
