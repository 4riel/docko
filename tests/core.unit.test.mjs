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
  assert.equal(resolution.source, 'env');
  assert.equal(resolution.sessionId, 'env-session');

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

  assert.throws(
    () => bouncer.requireOwner(freeResource, 'owner'),
    /Resource is not claimed/
  );

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

  assert.throws(
    () => bouncer.requireClaimable(claimedResource),
    /Resource is already claimed/
  );
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
      reason: 'delegated-child',
      session_id: 'child',
      resource_id: 'app-alpha',
      owner_session_id: 'owner'
    }
  );

  assert.deepEqual(
    bouncer.authorizeFileWrite(registry, 'intruder', path.join(workspaceRoot, 'slots', 'app-alpha', 'src', 'index.ts')),
    {
      allowed: false,
      reason: 'unrelated-session',
      session_id: 'intruder',
      resource_id: 'app-alpha',
      owner_session_id: 'owner'
    }
  );

  assert.deepEqual(
    bouncer.authorizeFileWrite(registry, 'owner', path.join(workspaceRoot, 'slots', 'app-beta', 'file.txt')),
    {
      allowed: false,
      reason: 'slot-not-claimed',
      session_id: 'owner',
      resource_id: 'app-beta',
      owner_session_id: null
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
    assert.equal(authorization.reason, 'owner-session');
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
