import { readdir, rename, stat } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { DockoError, assertSafeId } from './errors.js';
import { atomicWriteJson, ensureDir, pathExists, readJsonFile, safeUnlink } from './fs-utils.js';
import { getPaths, type DockoPaths } from './paths.js';
import { SCHEMA_VERSION } from './constants.js';
import type { SessionManifest, SessionStartOptions } from './types.js';

export interface SessionResolution {
  sessionId: string | null;
  source: 'explicit' | 'env' | 'single-active' | 'none' | 'ambiguous';
  activeSessions: SessionManifest[];
  envSessionMatched: boolean;
}

export class SessionSherpa {
  /**
   * Manages on-disk session manifests.
   * This is the local authority for active session identity and session lookup.
   * Ended manifests are moved under sessions/ended/ so the hot path only enumerates live work.
   */
  private readonly paths: DockoPaths;

  constructor(workspaceRoot: string) {
    this.paths = getPaths(workspaceRoot);
  }

  private sessionPath(sessionId: string): string {
    assertSafeId(sessionId, 'session_id');
    return path.join(this.paths.sessionsDir, `${sessionId}.json`);
  }

  private endedSessionPath(sessionId: string): string {
    assertSafeId(sessionId, 'session_id');
    return path.join(this.paths.sessionsEndedDir, `${sessionId}.json`);
  }

  async start(options: SessionStartOptions): Promise<SessionManifest> {
    await ensureDir(this.paths.sessionsDir);
    const sessionId = options.sessionId ?? `ses_${crypto.randomUUID().replaceAll('-', '')}`;
    const existing = await this.get(sessionId);
    if (existing && !existing.ended_at) {
      throw new DockoError('Session ID is already active.', 'SESSION_ID_CONFLICT', 2, {
        session_id: sessionId
      });
    }

    const now = new Date().toISOString();
    const session: SessionManifest = {
      schema_version: SCHEMA_VERSION,
      session_id: sessionId,
      runtime: options.runtime,
      actor_mode: options.actorMode ?? 'interactive',
      parent_session_id: options.parentSessionId ?? null,
      delegated_from_session_id: options.delegatedFromSessionId ?? null,
      started_at: now,
      updated_at: now,
      ended_at: null,
      workspace_root: path.resolve(options.workspaceRoot ?? '.'),
      metadata: options.metadata ?? {}
    };
    await safeUnlink(this.endedSessionPath(sessionId));
    await atomicWriteJson(this.sessionPath(session.session_id), session);
    return session;
  }

  async get(sessionId: string): Promise<SessionManifest | null> {
    if (await pathExists(this.sessionPath(sessionId))) {
      return readJsonFile<SessionManifest>(this.sessionPath(sessionId));
    }

    if (await pathExists(this.endedSessionPath(sessionId))) {
      return readJsonFile<SessionManifest>(this.endedSessionPath(sessionId));
    }

    return null;
  }

  async touch(sessionId: string): Promise<SessionManifest> {
    const session = await this.get(sessionId);
    if (!session) {
      throw new DockoError('Session not found.', 'SESSION_NOT_FOUND', 4, { session_id: sessionId });
    }

    session.updated_at = new Date().toISOString();
    const target = session.ended_at ? this.endedSessionPath(sessionId) : this.sessionPath(sessionId);
    await atomicWriteJson(target, session);
    return session;
  }

  async end(sessionId: string): Promise<SessionManifest | null> {
    const session = await this.get(sessionId);
    if (!session) {
      return null;
    }

    session.ended_at = new Date().toISOString();
    session.updated_at = session.ended_at;
    await ensureDir(this.paths.sessionsEndedDir);
    await atomicWriteJson(this.endedSessionPath(sessionId), session);
    await safeUnlink(this.sessionPath(sessionId));
    return session;
  }

  /**
   * Reads every manifest still sitting in the hot directory.
   * Legacy workspaces may keep ended manifests here until relocateEndedManifests moves them.
   */
  async listByFiles(): Promise<SessionManifest[]> {
    return this.readManifests(this.paths.sessionsDir);
  }

  async listActive(): Promise<SessionManifest[]> {
    const sessions = await this.listByFiles();
    return sessions.filter((session) => !session.ended_at);
  }

  async activeSessions(): Promise<SessionManifest[]> {
    return this.listActive();
  }

  /**
   * Lazily migrates workspaces created before ended manifests were relocated.
   * Returns the number of manifests moved out of the hot directory.
   */
  async relocateEndedManifests(limit = Number.POSITIVE_INFINITY): Promise<number> {
    const sessions = await this.listByFiles();
    let moved = 0;

    for (const session of sessions) {
      if (!session.ended_at || moved >= limit) {
        continue;
      }

      try {
        await ensureDir(this.paths.sessionsEndedDir);
        await rename(this.sessionPath(session.session_id), this.endedSessionPath(session.session_id));
        moved += 1;
      } catch {
        // Another process may have moved it already; the next pass retries.
      }
    }

    return moved;
  }

  /**
   * Deletes ended manifests whose file is older than the retention window.
   * Capped per call so one command never turns into a long directory sweep.
   */
  async deleteEndedOlderThan(retentionMs: number, limit = Number.POSITIVE_INFINITY): Promise<number> {
    const expired = await this.listEndedOlderThan(retentionMs, limit);
    for (const filePath of expired) {
      await safeUnlink(filePath);
    }

    return expired.length;
  }

  async countEndedOlderThan(retentionMs: number): Promise<number> {
    return (await this.listEndedOlderThan(retentionMs)).length;
  }

  private async listEndedOlderThan(retentionMs: number, limit = Number.POSITIVE_INFINITY): Promise<string[]> {
    let names: string[];
    try {
      names = await readdir(this.paths.sessionsEndedDir);
    } catch {
      return [];
    }

    const cutoff = Date.now() - retentionMs;
    const expired: string[] = [];

    for (const name of names) {
      if (expired.length >= limit) {
        break;
      }

      if (!name.endsWith('.json')) {
        continue;
      }

      const filePath = path.join(this.paths.sessionsEndedDir, name);
      try {
        const info = await stat(filePath);
        if (info.mtimeMs <= cutoff) {
          expired.push(filePath);
        }
      } catch {
        // Best effort: a manifest removed by another process is already reclaimed.
      }
    }

    return expired;
  }

  async resolve(explicitSessionId?: string | null, envSessionId?: string | null): Promise<SessionResolution> {
    const activeSessions = await this.listActive();

    if (explicitSessionId) {
      return {
        sessionId: explicitSessionId,
        source: 'explicit',
        activeSessions,
        envSessionMatched: false
      };
    }

    // An env id from a runtime that never started a docko session must not shadow a usable
    // single-active resolution, so it only wins when it names an active session.
    const envSessionMatched = Boolean(
      envSessionId && activeSessions.some((session) => session.session_id === envSessionId)
    );
    if (envSessionId && envSessionMatched) {
      return {
        sessionId: envSessionId,
        source: 'env',
        activeSessions,
        envSessionMatched
      };
    }

    if (activeSessions.length === 1) {
      return {
        sessionId: activeSessions[0].session_id,
        source: 'single-active',
        activeSessions,
        envSessionMatched
      };
    }

    return {
      sessionId: null,
      source: activeSessions.length === 0 ? 'none' : 'ambiguous',
      activeSessions,
      envSessionMatched
    };
  }

  async cleanupEnded(sessionId: string): Promise<void> {
    await safeUnlink(this.sessionPath(sessionId));
    await safeUnlink(this.endedSessionPath(sessionId));
  }

  private async readManifests(dirPath: string): Promise<SessionManifest[]> {
    await ensureDir(dirPath);
    const entries = await readdir(dirPath);
    const sessionFiles = entries.filter((entry) => entry.endsWith('.json')).sort();
    const manifests = await Promise.all(
      sessionFiles.map(async (entry) => {
        try {
          return await readJsonFile<SessionManifest>(path.join(dirPath, entry));
        } catch {
          // A manifest removed or half-written by a concurrent process must not fail the pass.
          return null;
        }
      })
    );

    return manifests.filter((manifest): manifest is SessionManifest => manifest !== null);
  }
}
