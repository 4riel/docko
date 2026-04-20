import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, utimes, writeFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DEFAULT_CUSTOM_STALE_MS } from '../packages/core/dist/constants.js';
import { listDirectories, pathExists } from '../packages/core/dist/fs-utils.js';
import { LockBouncer } from '../packages/core/dist/lock-bouncer.js';
import { LogScribe } from '../packages/core/dist/log-scribe.js';
import { MirrorSmith } from '../packages/core/dist/mirror-smith.js';
import { MutationGate } from '../packages/core/dist/mutation-gate.js';
import { RegistryScribe } from '../packages/core/dist/registry-scribe.js';
import { ResourceCatalog } from '../packages/core/dist/resource-catalog.js';
import { DockoService } from '../packages/core/dist/service.js';
import { StaleJanitor } from '../packages/core/dist/stale-janitor.js';
import { makeWorkspace } from './helpers/cli-test-helpers.mjs';

async function makeTempDir(prefix = 'docko-core-unit-') {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

test('fs helpers rethrow non-ENOENT listDirectories errors', async () => {
  const root = await makeTempDir();
  const filePath = path.join(root, 'not-a-directory');
  await writeFile(filePath, 'x', 'utf8');

  await assert.rejects(() => listDirectories(filePath), /ENOTDIR|not a directory/i);
});

test('MirrorSmith renders blank timestamps for invalid dates', () => {
  const mirror = new MirrorSmith().render({
    schema_version: '0.1.0',
    generated_at: new Date().toISOString(),
    workspace: {
      workspace_id: 'wk_test',
      workspace_root: '/workspace',
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
          branch: 'feat/test',
          task: 'cover mirror',
          claimed_at: 'invalid-date',
          updated_at: 'invalid-date',
          heartbeat_at: 'invalid-date',
          stale_after_ms: 1000,
          release_reason: null
        },
        delegations: []
      },
      {
        resource_type: 'shared-env',
        resource_id: 'staging',
        path: 'shared/staging',
        status: 'claimed',
        claim: {
          owner_session_id: 'owner',
          runtime: 'shell',
          branch: null,
          task: null,
          claimed_at: 'invalid-date',
          updated_at: 'invalid-date',
          heartbeat_at: 'invalid-date',
          stale_after_ms: 1000,
          release_reason: null
        },
        delegations: []
      }
    ]
  });

  assert.match(mirror, /\| app-alpha \| CLAIMED \| feat\/test \| cover mirror \|  \| owner \| 0 \|/);
  assert.match(mirror, /\| staging \| shared-env \| CLAIMED \|  \| owner \|  \|/);
});

test('MirrorSmith renders free slots with empty claim cells and omits the other-resources section when unused', () => {
  const mirror = new MirrorSmith().render({
    schema_version: '0.1.0',
    generated_at: new Date().toISOString(),
    workspace: {
      workspace_id: 'wk_test',
      workspace_root: '/workspace',
      name: 'workspace'
    },
    resources: [
      {
        resource_type: 'slot',
        resource_id: 'app-free',
        path: 'slots/app-free',
        status: 'free',
        claim: null
      }
    ]
  });

  assert.match(mirror, /\| app-free \| FREE \|  \|  \|  \|  \| 0 \|/);
  assert.doesNotMatch(mirror, /## Other Resources/);
});

test('MirrorSmith renders minute-based slot stale notes from workspace config', () => {
  const mirror = new MirrorSmith().render({
    schema_version: '0.1.0',
    generated_at: new Date().toISOString(),
    workspace: {
      workspace_id: 'wk_test',
      workspace_root: '/workspace',
      name: 'workspace',
      config: {
        janitor: {
          slot_stale_after_ms: 120000
        }
      }
    },
    resources: []
  });

  assert.match(mirror, /Slot claims default to 2 minute stale recovery/);
});

test('RegistryScribe rejects structurally invalid registry shapes', async () => {
  const root = await makeTempDir();
  const scribe = new RegistryScribe(root);
  await mkdir(path.dirname(scribe.getPaths().registryPath), { recursive: true });
  await writeFile(
    scribe.getPaths().registryPath,
    JSON.stringify({
      schema_version: '0.1.0',
      generated_at: new Date().toISOString(),
      workspace: {
        workspace_id: 'wk_test',
        workspace_root: '/wrong-root',
        name: 'workspace'
      },
      resources: null
    }),
    'utf8'
  );

  await assert.rejects(() => scribe.ensureRegistry(), (error) => {
    assert.equal(error.code, 'CORRUPTED_REGISTRY');
    return true;
  });
});

test('RegistryScribe normalizes optional config and delegations fields when loading registry state', async () => {
  const root = await makeTempDir();
  const scribe = new RegistryScribe(root);
  await mkdir(path.dirname(scribe.getPaths().registryPath), { recursive: true });
  await writeFile(
    scribe.getPaths().registryPath,
    JSON.stringify({
      schema_version: '0.1.0',
      generated_at: new Date().toISOString(),
      workspace: {
        workspace_id: 'wk_test',
        workspace_root: '/wrong-root',
        name: 'workspace',
        config: {}
      },
      resources: [
        {
          resource_type: 'slot',
          resource_id: 'app-alpha',
          path: 'slots/app-alpha',
          status: 'free',
          claim: null
        }
      ]
    }),
    'utf8'
  );

  const registry = await scribe.ensureRegistry();
  assert.equal(registry.workspace.workspace_root, root);
  assert.deepEqual(registry.workspace.config, { janitor: undefined });
  assert.deepEqual(registry.resources[0].delegations, []);
});

test('RegistryScribe discovers nested application slots from configured applications', async () => {
  const root = await makeTempDir();
  const scribe = new RegistryScribe(root);
  await mkdir(path.join(root, 'slots', 'backend', 'main_1'), { recursive: true });
  await mkdir(path.join(root, 'slots', 'frontend', 'main_1'), { recursive: true });

  const registry = await scribe.init();
  scribe.upsertApplication(registry, {
    application_id: 'backend',
    name: 'Backend',
    keywords: ['backend', 'api']
  });
  scribe.upsertApplication(registry, {
    application_id: 'frontend',
    name: 'Frontend',
    keywords: ['frontend', 'web']
  });

  await scribe.discoverSlotResources(registry);

  assert.deepEqual(
    registry.resources.map((resource) => ({
      resource_id: resource.resource_id,
      application_id: resource.application_id,
      slot_name: resource.slot_name,
      path: resource.path
    })),
    [
      {
        resource_id: 'backend.main_1',
        application_id: 'backend',
        slot_name: 'main_1',
        path: 'slots/backend/main_1'
      },
      {
        resource_id: 'frontend.main_1',
        application_id: 'frontend',
        slot_name: 'main_1',
        path: 'slots/frontend/main_1'
      }
    ]
  );
});

test('ResourceCatalog discovers slot resources and covers custom stale defaults', async () => {
  const root = await makeWorkspace('docko-core-catalog-');
  const scribe = new RegistryScribe(root);
  const registry = await scribe.init();
  const catalog = new ResourceCatalog(scribe);

  assert.equal(catalog.defaultStaleAfter(registry, 'custom-runtime'), DEFAULT_CUSTOM_STALE_MS);

  const slot = await catalog.ensure(registry, {
    resourceType: 'slot',
    resourceId: 'app-alpha',
    path: 'ignored-for-slots'
  });
  assert.equal(slot.resource_id, 'app-alpha');
  assert.equal(slot.path, 'slots/app-alpha');
});

test('LockBouncer treats slot resources without a path as unmanaged', () => {
  const now = new Date().toISOString();
  const authorization = new LockBouncer('/workspace').authorizeFileWrite(
    {
      schema_version: '0.1.0',
      generated_at: now,
      workspace: {
        workspace_id: 'wk_test',
        workspace_root: '/workspace',
        name: 'workspace'
      },
      resources: [
        {
          resource_type: 'slot',
          resource_id: 'app-alpha',
          path: null,
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
      ]
    },
    'owner',
    '/workspace/slots/app-alpha/src/index.ts'
  );

  assert.equal(authorization.allowed, true);
  assert.equal(authorization.reason, 'path-not-managed');
});

test('DockoService covers getPaths, render, missing resources, release reasons, and delegation updates', async () => {
  const root = await makeWorkspace('docko-core-service-');
  const service = new DockoService(root);
  await service.init();

  assert.equal(service.getPaths().workspaceRoot, root);

  await service.sessionStart({ sessionId: 'leader', runtime: 'shell', workspaceRoot: root });
  await service.sessionStart({ sessionId: 'child', runtime: 'shell', workspaceRoot: root });
  await service.claim({ sessionId: 'leader', resourceType: 'slot', resourceId: 'app-alpha' });

  await service.delegate({ sessionId: 'leader', childSessionId: 'child', resourceType: 'slot', resourceId: 'app-alpha', scope: 'read' });
  const updatedDelegation = await service.delegate({
    sessionId: 'leader',
    childSessionId: 'child',
    resourceType: 'slot',
    resourceId: 'app-alpha',
    scope: 'write'
  });
  assert.equal(updatedDelegation.delegations.length, 1);
  assert.equal(updatedDelegation.delegations[0].scope, 'write');

  const released = await service.release({
    sessionId: 'leader',
    resourceType: 'slot',
    resourceId: 'app-alpha',
    reason: 'handoff'
  });
  assert.equal(released.claim.release_reason, 'handoff');

  await service.render();
  const mirror = await readFile(path.join(root, 'docko', 'registry.md'), 'utf8');
  assert.match(mirror, /## Slots/);

  await assert.rejects(() => service.release({ sessionId: 'leader', resourceType: 'slot', resourceId: 'missing-slot' }), (error) => {
    assert.equal(error.code, 'RESOURCE_NOT_FOUND');
    return true;
  });

  const logs = await service.logs({ limit: 20 });
  assert.equal(logs.retention_days, 3);
  assert.equal(logs.entries.some((entry) => entry.operation === 'claim' && entry.outcome === 'ok'), true);
  assert.equal(
    logs.entries.some(
      (entry) =>
        entry.operation === 'release' &&
        entry.outcome === 'error' &&
        entry.details?.error?.code === 'RESOURCE_NOT_FOUND'
    ),
    true
  );
});

test('DockoService ensures applications and surfaces them in status and the mirror', async () => {
  const root = await makeTempDir('docko-core-application-');
  await mkdir(path.join(root, 'slots', 'backend', 'main_1'), { recursive: true });
  const service = new DockoService(root);
  await service.init();

  const application = await service.ensureApplication({
    applicationId: 'backend',
    name: 'Backend',
    description: 'API service',
    keywords: ['backend', 'api'],
    sourcePath: 'C:/code/backend'
  });
  assert.equal(application.application_id, 'backend');

  const status = await service.status();
  assert.equal(status.applications.length, 1);
  assert.equal(status.applications[0].application_id, 'backend');
  assert.equal(status.resources[0].resource_id, 'backend.main_1');
  assert.equal(status.resources[0].application_id, 'backend');
  assert.equal(status.resources[0].slot_name, 'main_1');

  const mirror = await readFile(path.join(root, 'docko', 'registry.md'), 'utf8');
  assert.match(mirror, /## Applications/);
  assert.match(mirror, /\| backend \| Backend \| backend, api \| API service \| C:\/code\/backend \|/);
  assert.match(mirror, /\| backend \| main_1 \| FREE \|/);
});

test('LogScribe keeps only the retained daily files and reads newest entries first', async () => {
  const root = await makeWorkspace('docko-core-logs-');
  const logs = new LogScribe(root);

  await logs.append(
    { operation: 'day-1', outcome: 'ok', session_id: null, resource_type: null, resource_id: null },
    new Date('2026-01-01T10:00:00.000Z')
  );
  await logs.append(
    { operation: 'day-2', outcome: 'ok', session_id: null, resource_type: null, resource_id: null },
    new Date('2026-01-02T10:00:00.000Z')
  );
  await logs.append(
    { operation: 'day-4', outcome: 'ok', session_id: null, resource_type: null, resource_id: null },
    new Date('2026-01-04T10:00:00.000Z')
  );

  const files = await readdir(path.join(root, 'docko', 'logs'));
  assert.deepEqual(files.sort(), ['2026-01-02.jsonl', '2026-01-04.jsonl']);

  const result = await logs.list({ days: 3 }, new Date('2026-01-04T12:00:00.000Z'));
  assert.equal(result.days, 3);
  assert.deepEqual(
    result.entries.map((entry) => entry.operation),
    ['day-4', 'day-2']
  );
});

test('LogScribe covers missing-dir, malformed-line, and non-directory error paths', async () => {
  const missingRoot = await makeTempDir();
  const missingLogs = new LogScribe(missingRoot);
  assert.deepEqual(await missingLogs.readEntries(new Set(['2026-01-01'])), []);
  await missingLogs.pruneExpired(new Date('2026-01-01T00:00:00.000Z'));

  const malformedRoot = await makeTempDir();
  const malformedLogDir = path.join(malformedRoot, 'docko', 'logs');
  await mkdir(malformedLogDir, { recursive: true });
  await writeFile(
    path.join(malformedLogDir, '2026-01-02.jsonl'),
    ['{"timestamp":"2026-01-02T10:00:00.000Z","operation":"good","outcome":"ok","session_id":null,"resource_type":null,"resource_id":null}', '{not-json}', ''].join('\n'),
    'utf8'
  );

  const malformedLogs = new LogScribe(malformedRoot);
  const listed = await malformedLogs.list(
    { days: 0, limit: Number.NaN },
    new Date('2026-01-02T12:00:00.000Z')
  );
  assert.equal(listed.days, 3);
  assert.deepEqual(
    listed.entries.map((entry) => entry.operation),
    ['good']
  );

  const invalidRoot = await makeTempDir();
  const invalidLogDir = path.join(invalidRoot, 'docko', 'logs');
  await mkdir(path.dirname(invalidLogDir), { recursive: true });
  await writeFile(invalidLogDir, 'not-a-directory', 'utf8');

  const invalidLogs = new LogScribe(invalidRoot);
  await assert.rejects(() => invalidLogs.readEntries(new Set(['2026-01-01'])), /ENOTDIR|not a directory/i);
  await assert.rejects(
    () => invalidLogs.pruneExpired(new Date('2026-01-01T00:00:00.000Z')),
    /ENOTDIR|not a directory/i
  );
});

test('StaleJanitor releases claims with invalid timestamps', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const registry = {
    schema_version: '0.1.0',
    generated_at: now.toISOString(),
    workspace: {
      workspace_id: 'wk_test',
      workspace_root: '/workspace',
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
          claimed_at: 'not-a-date',
          updated_at: null,
          heartbeat_at: null,
          stale_after_ms: 1000,
          release_reason: null
        },
        delegations: [{ child_session_id: 'child', granted_by_session_id: 'owner', granted_at: now.toISOString(), scope: 'write' }]
      }
    ]
  };

  const released = new StaleJanitor().releaseStaleClaims(registry, { now });
  assert.equal(released.length, 1);
  assert.equal(released[0].claim.release_reason, 'stale-recovery');
  assert.equal(registry.resources[0].status, 'free');
  assert.equal(registry.resources[0].claim, null);
  assert.deepEqual(registry.resources[0].delegations, []);
});

test('StaleJanitor treats invalid active session timestamps as stale recovery candidates', () => {
  const now = new Date('2026-01-01T00:00:05.000Z');
  const registry = {
    schema_version: '0.1.0',
    generated_at: now.toISOString(),
    workspace: {
      workspace_id: 'wk_test',
      workspace_root: '/workspace',
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
          claimed_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
          heartbeat_at: '2026-01-01T00:00:00.000Z',
          stale_after_ms: 1000,
          release_reason: null
        },
        delegations: []
      }
    ]
  };

  const released = new StaleJanitor().releaseStaleClaims(registry, {
    now,
    sessions: [
      {
        schema_version: '0.1.0',
        session_id: 'owner',
        runtime: 'shell',
        actor_mode: 'interactive',
        parent_session_id: null,
        delegated_from_session_id: null,
        started_at: '2026-01-01T00:00:00.000Z',
        updated_at: 'not-a-date',
        ended_at: null,
        workspace_root: '/workspace',
        metadata: {}
      }
    ]
  });

  assert.equal(released.length, 1);
  assert.equal(released[0].claim.release_reason, 'stale-recovery');
});

test('StaleJanitor keeps a claimed slot when the owning session has fresh activity', () => {
  const now = new Date('2026-01-01T00:00:05.000Z');
  const registry = {
    schema_version: '0.1.0',
    generated_at: now.toISOString(),
    workspace: {
      workspace_id: 'wk_test',
      workspace_root: '/workspace',
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
          claimed_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
          heartbeat_at: '2026-01-01T00:00:00.000Z',
          stale_after_ms: 1000,
          release_reason: null
        },
        delegations: []
      }
    ]
  };

  const released = new StaleJanitor().releaseStaleClaims(registry, {
    now,
    sessions: [
      {
        schema_version: '0.1.0',
        session_id: 'owner',
        runtime: 'shell',
        actor_mode: 'interactive',
        parent_session_id: null,
        delegated_from_session_id: null,
        started_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:04.500Z',
        ended_at: null,
        workspace_root: '/workspace',
        metadata: {}
      }
    ]
  });

  assert.equal(released.length, 0);
  assert.equal(registry.resources[0].status, 'claimed');
});

test('StaleJanitor also honors fresh delegated child activity when evaluating staleness', () => {
  const now = new Date('2026-01-01T00:00:05.000Z');
  const registry = {
    schema_version: '0.1.0',
    generated_at: now.toISOString(),
    workspace: {
      workspace_id: 'wk_test',
      workspace_root: '/workspace',
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
          claimed_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
          heartbeat_at: '2026-01-01T00:00:00.000Z',
          stale_after_ms: 1000,
          release_reason: null
        },
        delegations: [
          {
            child_session_id: 'child',
            granted_by_session_id: 'owner',
            granted_at: '2026-01-01T00:00:01.000Z',
            scope: 'write'
          }
        ]
      }
    ]
  };

  const released = new StaleJanitor().releaseStaleClaims(registry, {
    now,
    sessions: [
      {
        schema_version: '0.1.0',
        session_id: 'child',
        runtime: 'shell',
        actor_mode: 'delegated',
        parent_session_id: 'owner',
        delegated_from_session_id: 'owner',
        started_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:04.500Z',
        ended_at: null,
        workspace_root: '/workspace',
        metadata: {}
      }
    ]
  });

  assert.equal(released.length, 0);
  assert.equal(registry.resources[0].status, 'claimed');
});

test('MutationGate succeeds and always cleans up its lock directory', async () => {
  const root = await makeTempDir();
  const lockDir = path.join(root, 'lock');
  const gate = new MutationGate(lockDir);

  const result = await gate.run(async () => 'ok');
  assert.equal(result, 'ok');
  assert.equal(await pathExists(lockDir), false);
});

test('MutationGate waits for a busy lock to clear before acquiring it', async () => {
  const root = await makeTempDir();
  const lockDir = path.join(root, 'lock');
  await mkdir(lockDir);

  setTimeout(() => {
    rmSync(lockDir, { recursive: true, force: true });
  }, 50);

  const gate = new MutationGate(lockDir);
  const result = await gate.run(async () => 'waited');
  assert.equal(result, 'waited');
  assert.equal(await pathExists(lockDir), false);
});

test('MutationGate recovers stale lock directories once the timeout window is hit', async () => {
  const root = await makeTempDir();
  const lockDir = path.join(root, 'lock');
  await mkdir(lockDir);
  const staleTime = new Date(Date.now() - 60_000);
  await utimes(lockDir, staleTime, staleTime);

  const gate = new MutationGate(lockDir);
  const originalNow = Date.now;
  let calls = 0;
  Date.now = () => {
    calls += 1;
    return originalNow() + calls * 6_000;
  };

  try {
    const result = await gate.run(async () => 'recovered');
    assert.equal(result, 'recovered');
  } finally {
    Date.now = originalNow;
  }

  assert.equal(await pathExists(lockDir), false);
});

test('MutationGate treats disappearing locks as recovered during stale cleanup', async () => {
  const root = await makeTempDir();
  const lockDir = path.join(root, 'lock');
  await mkdir(lockDir);

  const gate = new MutationGate(lockDir);
  const originalNow = Date.now;
  let calls = 0;
  Date.now = () => {
    calls += 1;
    if (calls === 2) {
      rmSync(lockDir, { recursive: true, force: true });
    }
    return originalNow() + calls * 6_000;
  };

  try {
    const result = await gate.run(async () => 'recovered-after-race');
    assert.equal(result, 'recovered-after-race');
  } finally {
    Date.now = originalNow;
  }

  assert.equal(await pathExists(lockDir), false);
});

test('MutationGate times out when the lock still exists after a recovery attempt', async () => {
  const root = await makeTempDir();
  const lockDir = path.join(root, 'lock');
  await mkdir(lockDir);

  const gate = new MutationGate(lockDir);
  gate.recoverStaleLock = async () => true;

  const originalNow = Date.now;
  let calls = 0;
  Date.now = () => {
    calls += 1;
    return originalNow() + calls * 6_000;
  };

  try {
    await assert.rejects(() => gate.run(async () => 'never'), /Timed out waiting for registry lock/);
  } finally {
    Date.now = originalNow;
  }

  assert.equal(await pathExists(lockDir), true);
  rmSync(lockDir, { recursive: true, force: true });
});

test('MutationGate rethrows non-EEXIST acquisition errors', async () => {
  const root = await makeTempDir();
  const lockDir = path.join(root, 'missing-parent', 'lock');
  const gate = new MutationGate(lockDir);

  await assert.rejects(() => gate.run(async () => 'never'), /ENOENT/);
});

test('DockoService supports delegated child startup and inheriting parent delegations across owned resources', async () => {
  const root = await makeWorkspace('docko-core-service-delegation-');
  const service = new DockoService(root);
  await service.init();

  const parent = await service.sessionStart({ sessionId: 'leader', runtime: 'shell', workspaceRoot: root });
  const child = await service.sessionStart({
    sessionId: 'child',
    runtime: 'shell',
    workspaceRoot: root,
    actorMode: 'delegated',
    parentSessionId: parent.session_id,
    delegatedFromSessionId: parent.session_id
  });
  await service.sessionStart({ sessionId: 'other', runtime: 'shell', workspaceRoot: root });

  await service.claim({ sessionId: 'leader', resourceType: 'slot', resourceId: 'app-alpha' });
  await service.ensureResource({ resourceType: 'shared-env', resourceId: 'staging', path: 'shared/staging' });
  await service.claim({ sessionId: 'leader', resourceType: 'shared-env', resourceId: 'staging' });
  await service.claim({ sessionId: 'other', resourceType: 'slot', resourceId: 'app-beta' });

  await service.inheritDelegationsFromParent(parent.session_id, child.session_id);

  const status = await service.status();
  const appAlpha = status.resources.find((resource) => resource.resource_id === 'app-alpha');
  const staging = status.resources.find((resource) => resource.resource_id === 'staging');
  const appBeta = status.resources.find((resource) => resource.resource_id === 'app-beta');

  assert.equal(child.parent_session_id, 'leader');
  assert.equal(child.delegated_from_session_id, 'leader');
  assert.equal(appAlpha.delegations[0].child_session_id, 'child');
  assert.equal(appAlpha.delegations[0].scope, 'write');
  assert.equal(staging.delegations[0].child_session_id, 'child');
  assert.equal(appBeta.delegations.length, 0);
});

test('DockoService keeps logging best-effort on success and error paths', async () => {
  const root = await makeWorkspace('docko-core-service-logging-');
  const service = new DockoService(root);
  service.logScribe.append = async () => {
    throw new Error('log write failed');
  };

  const session = await service.sessionStart({ sessionId: 'leader', runtime: 'shell', workspaceRoot: root });
  assert.equal(session.session_id, 'leader');

  await assert.rejects(() => service.sessionCurrent('missing'), (error) => {
    assert.equal(error.code, 'SESSION_NOT_FOUND');
    return true;
  });
});

test('DockoService ends delegated child sessions when the parent session ends', async () => {
  const root = await makeWorkspace('docko-core-service-session-end-');
  const service = new DockoService(root);
  await service.init();

  await service.sessionStart({ sessionId: 'leader', runtime: 'shell', workspaceRoot: root });
  await service.sessionStart({
    sessionId: 'child',
    runtime: 'shell',
    workspaceRoot: root,
    actorMode: 'delegated',
    parentSessionId: 'leader',
    delegatedFromSessionId: 'leader'
  });
  await service.sessionStart({ sessionId: 'peer', runtime: 'shell', workspaceRoot: root });

  await service.sessionEnd('leader');

  const endedChild = await service.sessionSherpa.get('child');
  const peer = await service.sessionSherpa.get('peer');
  assert.ok(endedChild.ended_at);
  assert.equal(peer.ended_at, null);
});
