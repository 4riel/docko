import type { RegistryDocument, RegistryResource, ResourceClaim, SessionManifest } from './types.js';

function claimReferenceTime(claim: ResourceClaim): string {
  return claim.heartbeat_at ?? claim.updated_at ?? claim.claimed_at;
}

function sessionReferenceTime(
  resource: RegistryResource,
  sessionsById: ReadonlyMap<string, SessionManifest>
): string | null {
  const relevantSessionIds = new Set<string>();
  if (resource.claim?.owner_session_id) {
    relevantSessionIds.add(resource.claim.owner_session_id);
  }

  for (const delegation of resource.delegations ?? []) {
    relevantSessionIds.add(delegation.child_session_id);
  }

  let latestTimestamp: string | null = null;
  let latestMs = -Infinity;

  for (const sessionId of relevantSessionIds) {
    const session = sessionsById.get(sessionId);
    if (!session || session.ended_at) {
      continue;
    }

    const parsed = new Date(session.updated_at).getTime();
    if (Number.isNaN(parsed)) {
      return session.updated_at;
    }

    if (parsed > latestMs) {
      latestMs = parsed;
      latestTimestamp = session.updated_at;
    }
  }

  return latestTimestamp;
}

function isStale(
  resource: RegistryResource,
  claim: ResourceClaim,
  nowMs: number,
  sessionsById: ReadonlyMap<string, SessionManifest>
): boolean {
  const referenceTime = sessionReferenceTime(resource, sessionsById) ?? claimReferenceTime(claim);
  const parsed = new Date(referenceTime).getTime();
  if (Number.isNaN(parsed)) {
    return true;
  }

  return nowMs - parsed > claim.stale_after_ms;
}

export class StaleJanitor {
  /**
   * Applies stale-claim recovery in memory before the registry is written back.
   * This keeps stale handling cheap and tied to normal CLI activity.
   */
  releaseStaleClaims(
    registry: RegistryDocument,
    options: {
      now?: Date;
      sessions?: SessionManifest[];
    } = {}
  ): RegistryResource[] {
    const staleResources: RegistryResource[] = [];
    const now = options.now ?? new Date();
    const nowMs = now.getTime();
    const sessionsById = new Map((options.sessions ?? []).map((session) => [session.session_id, session]));

    for (const resource of registry.resources) {
      if (resource.status !== 'claimed' || !resource.claim) {
        continue;
      }

      if (!isStale(resource, resource.claim, nowMs, sessionsById)) {
        continue;
      }

      resource.claim.release_reason = 'stale-recovery';
      resource.claim.updated_at = now.toISOString();
      resource.claim.heartbeat_at = now.toISOString();
      staleResources.push({
        ...resource,
        claim: { ...resource.claim },
        delegations: [...(resource.delegations ?? [])]
      });
      resource.status = 'free';
      resource.claim = null;
      resource.delegations = [];
    }

    return staleResources;
  }
}
