import path from 'node:path';
import { DockoError } from './errors.js';
import type { AuthorizationResult, RegistryDocument, RegistryResource } from './types.js';

function buildAuthorizationResult(
  allowed: boolean,
  reason: string,
  sessionId: string,
  resource: RegistryResource | null,
  ownerSessionId: string | null
): AuthorizationResult {
  return {
    allowed,
    reason,
    session_id: sessionId,
    resource_id: resource?.resource_id ?? null,
    owner_session_id: ownerSessionId
  };
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

  authorizeFileWrite(registry: RegistryDocument, sessionId: string, filePath: string): AuthorizationResult {
    const slotResource = registry.resources.find((resource) =>
      matchesManagedPath(this.workspaceRoot, resource, filePath)
    );

    if (!slotResource) {
      return buildAuthorizationResult(true, 'path-not-managed', sessionId, null, null);
    }

    if (slotResource.status === 'free') {
      return buildAuthorizationResult(false, 'slot-not-claimed', sessionId, slotResource, null);
    }

    if (slotResource.claim?.owner_session_id === sessionId) {
      return buildAuthorizationResult(true, 'owner-session', sessionId, slotResource, sessionId);
    }

    const delegated = (slotResource.delegations ?? []).some(
      (delegation) => delegation.child_session_id === sessionId && delegation.scope === 'write'
    );
    if (delegated) {
      return buildAuthorizationResult(
        true,
        'delegated-child',
        sessionId,
        slotResource,
        slotResource.claim?.owner_session_id ?? null
      );
    }

    return buildAuthorizationResult(
      false,
      'unrelated-session',
      sessionId,
      slotResource,
      slotResource.claim?.owner_session_id ?? null
    );
  }
}
