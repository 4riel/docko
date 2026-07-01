import { readdir } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { DockoError, assertSafeId } from './errors.js';
import { atomicWriteJson, ensureDir, pathExists, readJsonFile, safeUnlink } from './fs-utils.js';
import { getPaths, type DockoPaths } from './paths.js';
import { SCHEMA_VERSION } from './constants.js';
import type { SessionManifest, SessionStartOptions } from './types.js';

export class SessionSherpa {
  /**
   * Manages on-disk session manifests.
   * This is the local authority for active session identity and session lookup.
   */
  private readonly paths: DockoPaths;

  constructor(workspaceRoot: string) {
    this.paths = getPaths(workspaceRoot);
  }

  private sessionPath(sessionId: string): string {
    assertSafeId(sessionId, 'session_id');
    return path.join(this.paths.sessionsDir, `${sessionId}.json`);
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
    await atomicWriteJson(this.sessionPath(session.session_id), session);
    return session;
  }

  async get(sessionId: string): Promise<SessionManifest | null> {
    if (!(await pathExists(this.sessionPath(sessionId)))) {
      return null;
    }
    return readJsonFile<SessionManifest>(this.sessionPath(sessionId));
  }

  async touch(sessionId: string): Promise<SessionManifest> {
    const session = await this.get(sessionId);
    if (!session) {
      throw new DockoError('Session not found.', 'SESSION_NOT_FOUND', 4, { session_id: sessionId });
    }

    session.updated_at = new Date().toISOString();
    await atomicWriteJson(this.sessionPath(sessionId), session);
    return session;
  }

  async end(sessionId: string): Promise<SessionManifest | null> {
    const session = await this.get(sessionId);
    if (!session) {
      return null;
    }

    session.ended_at = new Date().toISOString();
    session.updated_at = session.ended_at;
    await atomicWriteJson(this.sessionPath(sessionId), session);
    return session;
  }

  async listByFiles(): Promise<SessionManifest[]> {
    await ensureDir(this.paths.sessionsDir);
    const entries = await readdir(this.paths.sessionsDir);
    const sessionFiles = entries.filter((entry) => entry.endsWith('.json')).sort();
    return Promise.all(
      sessionFiles.map((entry) => readJsonFile<SessionManifest>(path.join(this.paths.sessionsDir, entry)))
    );
  }

  async activeSessions(): Promise<SessionManifest[]> {
    const sessions = await this.listByFiles();
    return sessions.filter((session) => !session.ended_at);
  }

  async resolve(
    explicitSessionId?: string | null,
    envSessionId?: string | null
  ): Promise<{
    sessionId: string | null;
    source: 'explicit' | 'env' | 'single-active' | 'none' | 'ambiguous';
    activeSessions: SessionManifest[];
  }> {
    const activeSessions = await this.activeSessions();

    if (explicitSessionId) {
      return {
        sessionId: explicitSessionId,
        source: 'explicit',
        activeSessions
      };
    }

    if (envSessionId) {
      return {
        sessionId: envSessionId,
        source: 'env',
        activeSessions
      };
    }

    if (activeSessions.length === 1) {
      return {
        sessionId: activeSessions[0].session_id,
        source: 'single-active',
        activeSessions
      };
    }

    return {
      sessionId: null,
      source: activeSessions.length === 0 ? 'none' : 'ambiguous',
      activeSessions
    };
  }

  async cleanupEnded(sessionId: string): Promise<void> {
    await safeUnlink(this.sessionPath(sessionId));
  }
}
