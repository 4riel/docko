import path from 'node:path';
import { DockoError } from './errors.js';
import type {
  AuthorizationReason,
  AuthorizationResult,
  RegistryDocument,
  RegistryResource,
  SessionManifest
} from './types.js';

export const AUTHORIZATION_REASONS = [
  'path-not-managed',
  'owner',
  'delegated',
  'slot-not-claimed',
  'claim-expired',
  'unrelated-session'
] as const satisfies readonly AuthorizationReason[];

// A claim released by the janitor is the only release the authorizer reports as expired:
// a manual release is a deliberate act, not a lapse.
const STALE_RELEASE_REASON = 'stale-recovery';

export interface AuthorizeFileWriteOptions {
  // Active session manifests, when the caller already loaded them. Without this map the
  // authorizer cannot tell whether the owner is still alive and reports null.
  sessions?: ReadonlyMap<string, SessionManifest>;
}

function toAbsolutePath(workspaceRoot: string, targetPath: string): string {
  return path.normalize(path.isAbsolute(targetPath) ? targetPath : path.resolve(workspaceRoot, targetPath));
}

function matchesManagedPath(workspaceRoot: string, resource: RegistryResource, filePath: string): boolean {
  if (resource.resource_type !== 'slot' || !resource.path) {
    return false;
  }

  const normalizedResourcePath = toAbsolutePath(workspaceRoot, resource.path);
  const normalizedFilePath = toAbsolutePath(workspaceRoot, filePath);
  return (
    normalizedFilePath === normalizedResourcePath ||
    normalizedFilePath.startsWith(`${normalizedResourcePath}${path.sep}`)
  );
}

export class LockBouncer {
  /**
   * Centralizes ownership and write-authorization decisions.
   * The logic stays deliberately small so the allowed and denied cases remain obvious.
   */
  constructor(private readonly workspaceRoot: string) {}

  requireOwner(resource: RegistryResource, sessionId: string, force = false): void {
    const ownerSessionId = resource.claim?.owner_session_id ?? null;

    if (!ownerSessionId) {
      throw new DockoError('Resource is not claimed.', 'RESOURCE_NOT_CLAIMED', 1, {
        resource_type: resource.resource_type,
        resource_id: resource.resource_id
      });
    }

    if (force || ownerSessionId === sessionId) {
      return;
    }

    throw new DockoError('Resource is owned by another session.', 'RESOURCE_OWNED_BY_OTHER_SESSION', 2, {
      resource_type: resource.resource_type,
      resource_id: resource.resource_id,
      owner_session_id: ownerSessionId
    });
  }

  requireClaimable(resource: RegistryResource): void {
    if (resource.status === 'free') {
      return;
    }

    throw new DockoError('Resource is already claimed.', 'RESOURCE_ALREADY_CLAIMED', 2, {
      resource_type: resource.resource_type,
      resource_id: resource.resource_id,
      owner_session_id: resource.claim?.owner_session_id ?? null
    });
  }

  /**
   * True for any path under the workspace's slots/ tree, whether or not a registry resource
   * exists for it yet. Callers use it to decide that a path needs the locked (discovering)
   * authorization path rather than an unlocked registry snapshot.
   */
  isInsideSlotsTree(filePath: string): boolean {
    const slotsDir = path.resolve(this.workspaceRoot, 'slots');
    const absolute = toAbsolutePath(this.workspaceRoot, filePath);
    return absolute === slotsDir || absolute.startsWith(`${slotsDir}${path.sep}`);
  }

  findManagedSlot(registry: RegistryDocument, filePath: string): RegistryResource | null {
    return registry.resources.find((resource) => matchesManagedPath(this.workspaceRoot, resource, filePath)) ?? null;
  }

  authorizeFileWrite(
    registry: RegistryDocument,
    sessionId: string,
    filePath: string,
    options: AuthorizeFileWriteOptions = {}
  ): AuthorizationResult {
    const slotResource = this.findManagedSlot(registry, filePath);

    if (!slotResource) {
      return this.buildResult(true, 'path-not-managed', sessionId, null, null, options);
    }

    if (slotResource.status === 'free') {
      const lastClaim = slotResource.last_claim ?? null;
      if (lastClaim && lastClaim.reason === STALE_RELEASE_REASON && lastClaim.owner_session_id === sessionId) {
        return this.buildResult(false, 'claim-expired', sessionId, slotResource, null, options);
      }

      return this.buildResult(false, 'slot-not-claimed', sessionId, slotResource, null, options);
    }

    if (slotResource.claim?.owner_session_id === sessionId) {
      return this.buildResult(true, 'owner', sessionId, slotResource, sessionId, options);
    }

    const delegated = (slotResource.delegations ?? []).some(
      (delegation) => delegation.child_session_id === sessionId && delegation.scope === 'write'
    );
    if (delegated) {
      return this.buildResult(
        true,
        'delegated',
        sessionId,
        slotResource,
        slotResource.claim?.owner_session_id ?? null,
        options
      );
    }

    return this.buildResult(
      false,
      'unrelated-session',
      sessionId,
      slotResource,
      slotResource.claim?.owner_session_id ?? null,
      options
    );
  }

  private buildResult(
    allowed: boolean,
    reason: AuthorizationReason,
    sessionId: string,
    resource: RegistryResource | null,
    ownerSessionId: string | null,
    options: AuthorizeFileWriteOptions
  ): AuthorizationResult {
    const claim = resource?.claim ?? null;
    const lastClaim = resource?.last_claim ?? null;
    const knownOwnerSessionId = ownerSessionId ?? lastClaim?.owner_session_id ?? null;

    return {
      allowed,
      reason,
      session_id: sessionId,
      resource_id: resource?.resource_id ?? null,
      owner_session_id: ownerSessionId,
      owner_task: claim?.task ?? lastClaim?.task ?? null,
      owner_branch: claim?.branch ?? lastClaim?.branch ?? null,
      owner_session_active: this.isSessionActive(knownOwnerSessionId, options.sessions),
      expired_at: reason === 'claim-expired' ? (lastClaim?.released_at ?? null) : null,
      claim_stale_after_ms: claim?.stale_after_ms ?? lastClaim?.stale_after_ms ?? null,
      previous_owner_session_id: ownerSessionId ? null : (lastClaim?.owner_session_id ?? null),
      application_id: resource?.application_id ?? null,
      slot_path: resource?.path ?? null
    };
  }

  private isSessionActive(
    sessionId: string | null,
    sessions: ReadonlyMap<string, SessionManifest> | undefined
  ): boolean | null {
    if (!sessionId || !sessions) {
      return null;
    }

    const session = sessions.get(sessionId);
    return Boolean(session && !session.ended_at);
  }
}
