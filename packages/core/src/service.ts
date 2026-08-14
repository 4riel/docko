import os from 'node:os';
import path from 'node:path';
import { DockoError, assertSafeId, toErrorPayload } from './errors.js';
import { listDirectories } from './fs-utils.js';
import { LogScribe } from './log-scribe.js';
import { RegistryScribe } from './registry-scribe.js';
import { SessionSherpa } from './session-sherpa.js';
import { LockBouncer } from './lock-bouncer.js';
import { StaleJanitor } from './stale-janitor.js';
import { MutationGate } from './mutation-gate.js';
import { ResourceCatalog } from './resource-catalog.js';
import type { DockoPaths } from './paths.js';
import type {
  AuthorizationResult,
  ClaimOptions,
  DockoLogEntry,
  DockoLogQuery,
  DockoLogResult,
  DelegateOptions,
  EnsureApplicationOptions,
  EnsureResourceOptions,
  HeartbeatOptions,
  InitOptions,
  RegistryDocument,
  RegistryResource,
  ReleaseOptions,
  SessionManifest,
  SessionPruneOptions,
  SessionPruneResult,
  SessionStartOptions,
  StatusResult
} from './types.js';

interface JanitorPassOptions {
  // Overrides the workspace session stale window for a single janitor pass.
  sessionStaleAfterMs?: number;
}

export class DockoService {
  /**
   * Coordinates the protocol without owning every detail.
   * Session files, registry IO, stale cleanup, and authorization stay in narrower services.
   */
  private readonly registryScribe: RegistryScribe;
  private readonly sessionSherpa: SessionSherpa;
  private readonly lockBouncer: LockBouncer;
  private readonly staleJanitor = new StaleJanitor();
  private readonly mutationGate: MutationGate;
  private readonly resourceCatalog: ResourceCatalog;
  private readonly logScribe: LogScribe;

  constructor(workspaceRoot: string) {
    this.registryScribe = new RegistryScribe(workspaceRoot);
    this.sessionSherpa = new SessionSherpa(workspaceRoot);
    this.lockBouncer = new LockBouncer(workspaceRoot);
    this.mutationGate = new MutationGate(this.registryScribe.getPaths().lockDir);
    this.resourceCatalog = new ResourceCatalog(this.registryScribe);
    this.logScribe = new LogScribe(workspaceRoot);
  }

  getPaths(): DockoPaths {
    return this.registryScribe.getPaths();
  }

  async init(options: InitOptions = {}): Promise<RegistryDocument> {
    return this.withLoggedOperation(
      'init',
      async () => {
        const registry = await this.registryScribe.init();
        this.applyInitOptions(registry, options);
        await this.registryScribe.discoverSlotResources(registry);
        await this.registryScribe.writeRegistry(registry);
        return registry;
      },
      (registry) => ({
        resource_count: registry.resources.length
      })
    );
  }

  async sessionStart(options: SessionStartOptions): Promise<SessionManifest> {
    return this.withLoggedOperation(
      'session.start',
      async () => {
        await this.init();
        if (options.parentSessionId) {
          await this.requireActiveSession(options.parentSessionId);
        }
        return this.sessionSherpa.start(options);
      },
      (session) => ({
        session_id: session.session_id,
        runtime: session.runtime,
        actor_mode: session.actor_mode,
        parent_session_id: session.parent_session_id,
        delegated_from_session_id: session.delegated_from_session_id
      }),
      {
        session_id: options.sessionId ?? null,
        details: {
          runtime: options.runtime,
          actor_mode: options.actorMode ?? 'interactive',
          parent_session_id: options.parentSessionId ?? null,
          delegated_from_session_id: options.delegatedFromSessionId ?? null
        }
      }
    );
  }

  async sessionEnd(sessionId: string): Promise<void> {
    await this.withLoggedOperation(
      'session.end',
      async () => {
        let releasedClaims = 0;
        await this.mutateRegistry(async (registry) => {
          releasedClaims = this.releaseOwnedClaims(registry, sessionId);
          await this.sessionSherpa.end(sessionId);
          await this.endDelegatedChildren(sessionId);
        });
        return releasedClaims;
      },
      (releasedClaims) => ({
        released_claims: releasedClaims
      }),
      {
        session_id: sessionId
      }
    );
  }

  async resolveSessionId(explicitSessionId?: string | null, envSessionId?: string | null): Promise<string> {
    const resolution = await this.sessionSherpa.resolve(explicitSessionId, envSessionId);
    if (resolution.sessionId) {
      return resolution.sessionId;
    }

    if (resolution.source === 'ambiguous') {
      throw new DockoError(
        'Multiple active sessions found. Retry with an explicit --session value.',
        'AMBIGUOUS_SESSION',
        3,
        {
          active_sessions: resolution.activeSessions.map((session) => ({
            session_id: session.session_id,
            runtime: session.runtime,
            actor_mode: session.actor_mode,
            parent_session_id: session.parent_session_id,
            delegated_from_session_id: session.delegated_from_session_id,
            started_at: session.started_at,
            updated_at: session.updated_at
          })),
          next_steps: [
            'Retry the command with --session <id>.',
            'Use `docko session list --brief` to inspect active sessions.',
            'Do not end sessions unless you are intentionally cleaning up workspace state.'
          ],
          resolution: {
            explicit_session_id: explicitSessionId ?? null,
            env_session_id: envSessionId ?? null
          }
        }
      );
    }

    throw new DockoError('No active session found.', 'NO_ACTIVE_SESSION', 4);
  }

  async sessionCurrent(sessionId: string): Promise<SessionManifest> {
    return this.withLoggedOperation(
      'session.current',
      () => this.sessionSherpa.touch(sessionId),
      (session) => ({
        runtime: session.runtime,
        actor_mode: session.actor_mode
      }),
      {
        session_id: sessionId
      }
    );
  }

  async sessionList(): Promise<{ active_sessions: SessionManifest[] }> {
    return this.withLoggedOperation(
      'session.list',
      async () => ({
        active_sessions: await this.sessionSherpa.activeSessions()
      }),
      (result) => ({
        active_session_count: result.active_sessions.length
      })
    );
  }

  /**
   * Ends sessions that have gone quiet, on demand.
   * The janitor already does this on every registry mutation; this command exists so an
   * operator can clear a backlog immediately or preview it with dryRun.
   */
  async sessionPrune(options: SessionPruneOptions = {}): Promise<SessionPruneResult> {
    return this.withLoggedOperation(
      'session.prune',
      async () => {
        if (options.dryRun) {
          return this.previewStaleSessions(options.maxAgeMs);
        }

        return this.mutateRegistry(
          async (registry, _releasedStaleClaims, endedStaleSessions) =>
            this.buildSessionPruneResult(
              endedStaleSessions,
              options.maxAgeMs ?? this.staleJanitor.defaultSessionStaleAfter(registry),
              false
            ),
          { sessionStaleAfterMs: options.maxAgeMs }
        );
      },
      (result) => ({
        dry_run: result.dry_run,
        max_age_ms: result.max_age_ms,
        pruned_session_count: result.pruned_session_count
      }),
      {
        details: {
          max_age_ms: options.maxAgeMs ?? null,
          dry_run: options.dryRun ?? false
        }
      }
    );
  }

  async status(resourceType?: string, resourceId?: string): Promise<StatusResult> {
    return this.withLoggedOperation(
      'status',
      () =>
        this.mutateRegistry(async (registry, releasedStaleClaims, endedStaleSessions) => {
          return {
            ...this.registryScribe.buildStatus(registry, resourceType, resourceId),
            janitor: {
              released_claims: releasedStaleClaims,
              ended_sessions: endedStaleSessions
            }
          };
        }),
      (result) => ({
        resource_count: result.resources.length,
        janitor_released_claims: result.janitor.released_claims.length,
        janitor_ended_sessions: result.janitor.ended_sessions.length,
        filter_resource_type: resourceType ?? null,
        filter_resource_id: resourceId ?? null
      }),
      {
        resource_type: resourceType ?? null,
        resource_id: resourceId ?? null
      }
    );
  }

  async ensureResource(options: EnsureResourceOptions): Promise<RegistryResource> {
    return this.withLoggedOperation(
      'resource.ensure',
      () =>
        this.mutateRegistry(async (registry) => {
          const resource = await this.ensureKnownResource(
            registry,
            options.resourceType,
            options.resourceId,
            options.path
          );
          return resource;
        }),
      (resource) => ({
        status: resource.status,
        path: resource.path ?? null
      }),
      {
        resource_type: options.resourceType,
        resource_id: options.resourceId,
        details: {
          path: options.path ?? null
        }
      }
    );
  }

  async ensureApplication(options: EnsureApplicationOptions) {
    return this.withLoggedOperation(
      'application.ensure',
      () =>
        this.mutateRegistry(async (registry) => {
          assertSafeId(options.applicationId, 'application_id');
          const conflictingLegacySlot = registry.resources.find(
            (resource) =>
              resource.resource_type === 'slot' &&
              resource.resource_id === options.applicationId &&
              !resource.application_id
          );
          if (conflictingLegacySlot) {
            const applicationSlotDir = path.join(this.registryScribe.getPaths().slotsDir, options.applicationId);
            const nestedSlotIds = await listDirectories(applicationSlotDir);

            if (conflictingLegacySlot.status === 'claimed' || nestedSlotIds.length === 0) {
              throw new DockoError(
                'Cannot register an application that collides with an existing flat slot id.',
                'APPLICATION_SLOT_CONFLICT',
                2,
                {
                  application_id: options.applicationId,
                  slot_id: conflictingLegacySlot.resource_id
                }
              );
            }
          }

          const application = this.registryScribe.upsertApplication(registry, {
            application_id: options.applicationId,
            name: options.name ?? options.applicationId,
            description: options.description ?? null,
            keywords: options.keywords ?? [],
            source_path: options.sourcePath ?? null
          });
          await this.registryScribe.discoverSlotResources(registry);
          return application;
        }),
      (application) => ({
        name: application.name,
        keyword_count: application.keywords?.length ?? 0,
        source_path: application.source_path ?? null
      }),
      {
        resource_id: options.applicationId,
        details: {
          name: options.name ?? options.applicationId,
          description: options.description ?? null,
          keywords: options.keywords ?? [],
          source_path: options.sourcePath ?? null
        }
      }
    );
  }

  async claim(options: ClaimOptions): Promise<RegistryResource> {
    return this.withLoggedOperation(
      'claim',
      async () => {
        const session = await this.requireActiveSession(options.sessionId);
        await this.touchSessionActivity(options.sessionId);
        return this.mutateRegistry(async (registry) => {
          const resource = await this.ensureKnownResource(registry, options.resourceType, options.resourceId);
          this.lockBouncer.requireClaimable(resource);
          this.applyClaim(
            resource,
            options,
            options.staleAfterMs ?? this.resourceCatalog.defaultStaleAfter(registry, options.resourceType),
            options.runtime ?? session.runtime ?? null
          );
          if (options.advanceSchedulerKey != null) {
            this.advanceSchedulerCursor(registry, options.advanceSchedulerKey, resource.resource_id);
          }
          return resource;
        });
      },
      (resource) => ({
        status: resource.status,
        runtime: resource.claim?.runtime ?? null,
        branch: resource.claim?.branch ?? null,
        task: resource.claim?.task ?? null,
        stale_after_ms: resource.claim?.stale_after_ms ?? null
      }),
      {
        session_id: options.sessionId,
        resource_type: options.resourceType,
        resource_id: options.resourceId,
        details: {
          runtime: options.runtime ?? null,
          branch: options.branch ?? null,
          task: options.task ?? null,
          stale_after_ms: options.staleAfterMs ?? null
        }
      }
    );
  }

  async heartbeat(options: HeartbeatOptions): Promise<RegistryResource> {
    return this.withLoggedOperation(
      'heartbeat',
      async () => {
        await this.requireActiveSession(options.sessionId);
        await this.touchSessionActivity(options.sessionId);
        return this.mutateRegistry(async (registry) => {
          const resource = this.mustGetResource(registry, options.resourceType, options.resourceId);
          this.lockBouncer.requireOwner(resource, options.sessionId);
          this.touchClaim(resource);
          return resource;
        });
      },
      (resource) => ({
        heartbeat_at: resource.claim?.heartbeat_at ?? null
      }),
      {
        session_id: options.sessionId,
        resource_type: options.resourceType,
        resource_id: options.resourceId
      }
    );
  }

  async release(options: ReleaseOptions): Promise<RegistryResource> {
    return this.withLoggedOperation(
      'release',
      async () => {
        await this.requireActiveSession(options.sessionId);
        await this.touchSessionActivity(options.sessionId);
        return this.mutateRegistry(async (registry) => {
          const resource = this.mustGetResource(registry, options.resourceType, options.resourceId);
          this.lockBouncer.requireOwner(resource, options.sessionId, options.force ?? false);
          const released = this.snapshotResource(resource);
          this.clearClaim(resource);

          if (released.claim) {
            released.claim.release_reason = options.reason ?? (options.force ? 'force-release' : 'manual');
          }
          return released;
        });
      },
      (resource) => ({
        release_reason: resource.claim?.release_reason ?? null,
        previous_owner_session_id: resource.claim?.owner_session_id ?? null
      }),
      {
        session_id: options.sessionId,
        resource_type: options.resourceType,
        resource_id: options.resourceId,
        details: {
          force: options.force ?? false,
          reason: options.reason ?? null
        }
      }
    );
  }

  async delegate(options: DelegateOptions): Promise<RegistryResource> {
    return this.withLoggedOperation(
      'delegate',
      async () => {
        await this.requireActiveSession(options.sessionId);
        await this.touchSessionActivity(options.sessionId);
        return this.mutateRegistry(async (registry) => {
          const resource = this.mustGetResource(registry, options.resourceType, options.resourceId);
          this.lockBouncer.requireOwner(resource, options.sessionId);
          await this.requireActiveSession(options.childSessionId);
          this.grantDelegation(resource, options.sessionId, options.childSessionId, options.scope ?? 'write');
          return resource;
        });
      },
      (resource) => ({
        delegation_count: resource.delegations?.length ?? 0,
        child_session_id: options.childSessionId,
        scope: options.scope ?? 'write'
      }),
      {
        session_id: options.sessionId,
        resource_type: options.resourceType,
        resource_id: options.resourceId,
        details: {
          child_session_id: options.childSessionId,
          scope: options.scope ?? 'write'
        }
      }
    );
  }

  async render(): Promise<void> {
    await this.withLoggedOperation('render', () => this.mutateRegistry(async () => undefined));
  }

  async authorizeFileWrite(sessionId: string, relativeFilePath: string): Promise<AuthorizationResult> {
    return this.withLoggedOperation(
      'authorize-file-write',
      async () => {
        await this.requireActiveSession(sessionId);
        await this.touchSessionActivity(sessionId);
        return this.mutateRegistry(async (registry) => {
          return this.lockBouncer.authorizeFileWrite(registry, sessionId, relativeFilePath);
        });
      },
      (authorization) => ({
        allowed: authorization.allowed,
        reason: authorization.reason,
        owner_session_id: authorization.owner_session_id
      }),
      {
        session_id: sessionId,
        resource_id: null,
        details: {
          file_path: relativeFilePath
        }
      }
    );
  }

  async inheritDelegationsFromParent(parentSessionId: string, childSessionId: string): Promise<void> {
    await this.withLoggedOperation(
      'delegate.inherit',
      async () => {
        let delegatedResources = 0;
        await this.mutateRegistry(async (registry) => {
          for (const resource of registry.resources) {
            if (resource.claim?.owner_session_id !== parentSessionId) {
              continue;
            }
            this.grantDelegation(resource, parentSessionId, childSessionId, 'write');
            delegatedResources += 1;
          }
        });
        return delegatedResources;
      },
      (delegatedResources) => ({
        child_session_id: childSessionId,
        delegated_resource_count: delegatedResources
      }),
      {
        session_id: parentSessionId,
        details: {
          child_session_id: childSessionId
        }
      }
    );
  }

  async logs(query: DockoLogQuery = {}): Promise<DockoLogResult> {
    return this.logScribe.list(query);
  }

  private async withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    return this.mutationGate.run(operation);
  }

  private async loadRegistryForMutation(options: JanitorPassOptions = {}): Promise<{
    registry: RegistryDocument;
    releasedStaleClaims: RegistryResource[];
    endedStaleSessions: SessionManifest[];
  }> {
    const registry = await this.registryScribe.ensureRegistry();
    await this.registryScribe.discoverSlotResources(registry);
    const sessions = await this.sessionSherpa.listByFiles();
    const now = new Date();
    // Stale cleanup happens on the shared mutation path so reads and writes converge on one view.
    const staleResources = this.staleJanitor.releaseStaleClaims(registry, { now, sessions });
    await Promise.all(staleResources.map((resource) => this.recordStaleRecovery(resource)));
    // Sessions are swept after claims so a just-recovered claim no longer protects its abandoning session.
    const endedStaleSessions = await this.endStaleSessions(registry, sessions, now, options.sessionStaleAfterMs);
    return {
      registry,
      releasedStaleClaims: staleResources,
      endedStaleSessions
    };
  }

  private async mutateRegistry<T>(
    operation: (
      registry: RegistryDocument,
      releasedStaleClaims: RegistryResource[],
      endedStaleSessions: SessionManifest[]
    ) => Promise<T>,
    options: JanitorPassOptions = {}
  ): Promise<T> {
    return this.withMutationLock(async () => {
      const { registry, releasedStaleClaims, endedStaleSessions } = await this.loadRegistryForMutation(options);
      const result = await operation(registry, releasedStaleClaims, endedStaleSessions);
      await this.registryScribe.writeRegistry(registry);
      return result;
    });
  }

  private async endStaleSessions(
    registry: RegistryDocument,
    sessions: SessionManifest[],
    now: Date,
    staleAfterMs?: number
  ): Promise<SessionManifest[]> {
    const sessionStaleAfterMs = staleAfterMs ?? this.staleJanitor.defaultSessionStaleAfter(registry);
    const staleSessions = this.staleJanitor.collectStaleSessions(registry, {
      now,
      sessions,
      staleAfterMs: sessionStaleAfterMs
    });

    const endedSessions: SessionManifest[] = [];
    for (const session of staleSessions) {
      const lastActivityAt = session.updated_at;
      const endedSession = await this.sessionSherpa.end(session.session_id);
      if (!endedSession) {
        continue;
      }

      // Keep the in-memory manifest list aligned with disk for the rest of this pass.
      session.ended_at = endedSession.ended_at;
      session.updated_at = endedSession.updated_at;
      endedSessions.push(endedSession);
      await this.recordStaleSessionRecovery(endedSession, sessionStaleAfterMs, lastActivityAt);
    }

    return endedSessions;
  }

  private buildSessionPruneResult(sessions: SessionManifest[], maxAgeMs: number, dryRun: boolean): SessionPruneResult {
    return {
      dry_run: dryRun,
      max_age_ms: maxAgeMs,
      pruned_session_count: sessions.length,
      pruned_sessions: sessions
    };
  }

  private async previewStaleSessions(maxAgeMs?: number): Promise<SessionPruneResult> {
    return this.withMutationLock(async () => {
      const registry = await this.registryScribe.ensureRegistry();
      const sessions = await this.sessionSherpa.listByFiles();
      const now = new Date();
      // Preview against a copy: claims the janitor would recover must not protect their owners here,
      // and a dry run may not touch the registry on disk.
      const preview = structuredClone(registry);
      this.staleJanitor.releaseStaleClaims(preview, { now, sessions });
      const staleAfterMs = maxAgeMs ?? this.staleJanitor.defaultSessionStaleAfter(preview);
      const candidates = this.staleJanitor.collectStaleSessions(preview, {
        now,
        sessions,
        staleAfterMs
      });

      return this.buildSessionPruneResult(candidates, staleAfterMs, true);
    });
  }

  private async requireActiveSession(sessionId: string): Promise<SessionManifest> {
    const session = await this.sessionSherpa.get(sessionId);
    if (!session || session.ended_at) {
      throw new DockoError('Session not found or already ended.', 'SESSION_NOT_FOUND', 4, { session_id: sessionId });
    }

    return session;
  }

  private mustGetResource(registry: RegistryDocument, resourceType: string, resourceId: string): RegistryResource {
    assertSafeId(resourceType, 'resource_type');
    assertSafeId(resourceId, 'resource_id');
    const resource = this.registryScribe.getResource(registry, resourceType, resourceId);
    if (!resource) {
      throw new DockoError('Resource not found.', 'RESOURCE_NOT_FOUND', 1, {
        resource_type: resourceType,
        resource_id: resourceId
      });
    }

    return resource;
  }

  private async ensureKnownResource(
    registry: RegistryDocument,
    resourceType: string,
    resourceId: string,
    resourcePath?: string | null
  ): Promise<RegistryResource> {
    assertSafeId(resourceType, 'resource_type');
    assertSafeId(resourceId, 'resource_id');
    return this.resourceCatalog.ensure(registry, {
      resourceType,
      resourceId,
      path: resourcePath
    });
  }

  private async touchSessionActivity(sessionId: string): Promise<void> {
    await this.sessionSherpa.touch(sessionId);
  }

  private applyInitOptions(registry: RegistryDocument, options: InitOptions): void {
    if (options.slotStaleAfterMs !== undefined) {
      ((registry.workspace.config ??= {}).janitor ??= {}).slot_stale_after_ms = options.slotStaleAfterMs;
    }

    if (options.sessionStaleAfterMs !== undefined) {
      ((registry.workspace.config ??= {}).janitor ??= {}).session_stale_after_ms = options.sessionStaleAfterMs;
    }
  }

  private advanceSchedulerCursor(registry: RegistryDocument, key: string, slotId: string): void {
    (((registry.workspace.config ??= {}).scheduler ??= {}).last_slot_id ??= {})[key] = slotId;
  }

  private applyClaim(
    resource: RegistryResource,
    options: ClaimOptions,
    staleAfterMs: number,
    resolvedRuntime: string | null = null
  ): void {
    const now = new Date().toISOString();
    resource.status = 'claimed';
    resource.claim = {
      owner_session_id: options.sessionId,
      runtime: resolvedRuntime,
      branch: options.branch ?? null,
      task: options.task ?? null,
      claimed_at: now,
      updated_at: now,
      heartbeat_at: now,
      stale_after_ms: staleAfterMs,
      release_reason: null
    };
    resource.delegations = [];
  }

  private touchClaim(resource: RegistryResource): void {
    const now = new Date().toISOString();
    resource.claim!.updated_at = now;
    resource.claim!.heartbeat_at = now;
  }

  private snapshotResource(resource: RegistryResource): RegistryResource {
    return {
      ...resource,
      claim: resource.claim ? { ...resource.claim } : null,
      delegations: [...(resource.delegations ?? [])]
    };
  }

  private clearClaim(resource: RegistryResource): void {
    resource.status = 'free';
    resource.claim = null;
    resource.delegations = [];
  }

  private grantDelegation(
    resource: RegistryResource,
    parentSessionId: string,
    childSessionId: string,
    scope: 'read' | 'write'
  ): void {
    const existing = (resource.delegations ?? []).find((delegation) => delegation.child_session_id === childSessionId);

    if (existing) {
      existing.scope = scope;
      existing.granted_at = new Date().toISOString();
      return;
    }

    (resource.delegations ??= []).push({
      child_session_id: childSessionId,
      granted_by_session_id: parentSessionId,
      granted_at: new Date().toISOString(),
      scope
    });
  }

  private releaseOwnedClaims(registry: RegistryDocument, sessionId: string): number {
    let released = 0;
    for (const resource of registry.resources) {
      if (resource.claim?.owner_session_id !== sessionId) {
        continue;
      }

      this.clearClaim(resource);
      released += 1;
    }

    return released;
  }

  private async endDelegatedChildren(parentSessionId: string): Promise<void> {
    const sessions = await this.sessionSherpa.listByFiles();
    for (const session of sessions) {
      if (session.ended_at) continue;
      if (session.parent_session_id === parentSessionId || session.delegated_from_session_id === parentSessionId) {
        await this.sessionSherpa.end(session.session_id);
      }
    }
  }

  private async withLoggedOperation<T>(
    operation: string,
    action: () => Promise<T>,
    summarize?: (result: T) => Record<string, unknown> | undefined,
    context: Partial<DockoLogEntry> = {}
  ): Promise<T> {
    try {
      const result = await action();
      await this.recordLog({
        operation,
        outcome: 'ok',
        session_id: context.session_id ?? null,
        resource_type: context.resource_type ?? null,
        resource_id: context.resource_id ?? null,
        details: summarize ? summarize(result) : context.details
      });
      return result;
    } catch (error: unknown) {
      const errorPayload = toErrorPayload(error).error;
      await this.recordLog({
        operation,
        outcome: 'error',
        session_id: context.session_id ?? null,
        resource_type: context.resource_type ?? null,
        resource_id: context.resource_id ?? null,
        details: {
          ...(context.details ?? {}),
          error: errorPayload
        }
      });
      throw error;
    }
  }

  private async recordStaleRecovery(resource: RegistryResource): Promise<void> {
    await this.recordLog({
      operation: 'stale-recovery',
      outcome: 'ok',
      session_id: resource.claim?.owner_session_id ?? null,
      resource_type: resource.resource_type,
      resource_id: resource.resource_id,
      details: {
        release_reason: resource.claim?.release_reason ?? null,
        stale_after_ms: resource.claim?.stale_after_ms ?? null,
        branch: resource.claim?.branch ?? null,
        task: resource.claim?.task ?? null
      }
    });
  }

  private async recordStaleSessionRecovery(
    session: SessionManifest,
    staleAfterMs: number,
    lastActivityAt: string
  ): Promise<void> {
    await this.recordLog({
      operation: 'stale-session-recovery',
      outcome: 'ok',
      session_id: session.session_id,
      resource_type: null,
      resource_id: null,
      details: {
        release_reason: 'stale-session-recovery',
        stale_after_ms: staleAfterMs,
        runtime: session.runtime,
        actor_mode: session.actor_mode,
        started_at: session.started_at,
        last_activity_at: lastActivityAt,
        ended_at: session.ended_at
      }
    });
  }

  private async recordLog(entry: Omit<DockoLogEntry, 'timestamp'> & { timestamp?: string | null }): Promise<void> {
    try {
      await this.logScribe.append(entry);
    } catch {
      // Debug logging must stay best-effort and never block normal protocol operations.
    }
  }
}

export function buildSessionStartMetadata(): Record<string, unknown> {
  return {
    pid: process.pid,
    hostname: os.hostname()
  };
}
