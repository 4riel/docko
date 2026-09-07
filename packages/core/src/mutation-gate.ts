import os from 'node:os';
import path from 'node:path';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { DockoError } from './errors.js';
import { pathExists, readJsonFile, safeUnlink } from './fs-utils.js';

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function errorCode(error: unknown): string | null {
  if (error instanceof Error && 'code' in error) {
    return (error as NodeJS.ErrnoException).code ?? null;
  }

  return null;
}

const LOCK_TIMEOUT_MS = 10_000;
const LOCK_STALE_MS = 30_000;
const LOCK_POLL_MIN_MS = 10;
const LOCK_POLL_MAX_MS = 100;
const OWNER_FILE = 'owner.json';

export interface MutationLockOwner {
  pid: number;
  hostname: string;
  acquired_at: string;
}

export class MutationGate {
  /**
   * Serializes registry mutations with a simple filesystem lock directory.
   * This keeps concurrent local CLI calls predictable without introducing a daemon.
   */
  constructor(private readonly lockDir: string) {}

  private get ownerPath(): string {
    return path.join(this.lockDir, OWNER_FILE);
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    const deadline = startedAt + LOCK_TIMEOUT_MS;
    let backoff = LOCK_POLL_MIN_MS;

    while (true) {
      try {
        await mkdir(this.lockDir);
        break;
      } catch (error: unknown) {
        const code = errorCode(error);
        if (code === 'ENOENT') {
          throw await this.describeMissingWorkspace(error);
        }

        if (code !== 'EEXIST') {
          throw error;
        }

        if (Date.now() >= deadline) {
          throw new DockoError('Timed out waiting for registry lock.', 'REGISTRY_LOCK_TIMEOUT', 2, {
            lock_dir: this.lockDir,
            waited_ms: Date.now() - startedAt,
            owner: await this.readOwner(),
            next_steps: [
              'Retry the command; another docko process may still be finishing.',
              `Delete ${this.lockDir} only when no docko process is running.`
            ]
          });
        }

        // Recovery may run more than once: a lock abandoned by a killed process stays abandoned.
        if (await this.recoverStaleLock()) {
          continue;
        }

        await sleep(backoff + Math.random() * LOCK_POLL_MIN_MS);
        backoff = Math.min(backoff * 2, LOCK_POLL_MAX_MS);
      }
    }

    const owner = await this.writeOwner();

    try {
      return await operation();
    } finally {
      await this.releaseIfOwned(owner);
    }
  }

  private async writeOwner(): Promise<MutationLockOwner> {
    const owner: MutationLockOwner = {
      pid: process.pid,
      hostname: os.hostname(),
      acquired_at: new Date().toISOString()
    };

    try {
      await writeFile(this.ownerPath, `${JSON.stringify(owner, null, 2)}\n`, 'utf8');
    } catch {
      // The lock is the directory itself; owner metadata is diagnostic only.
    }

    return owner;
  }

  private async readOwner(): Promise<MutationLockOwner | null> {
    try {
      return await readJsonFile<MutationLockOwner>(this.ownerPath);
    } catch {
      return null;
    }
  }

  /**
   * Only removes the lock directory when this process still owns it, so a waiter that already
   * broke a stale lock is never robbed of the lock it just acquired.
   */
  private async releaseIfOwned(owner: MutationLockOwner): Promise<void> {
    const current = await this.readOwner();
    if (current && (current.pid !== owner.pid || current.acquired_at !== owner.acquired_at)) {
      return;
    }

    await safeUnlink(this.ownerPath);
    await rm(this.lockDir, { recursive: true, force: true });
  }

  private async recoverStaleLock(): Promise<boolean> {
    let referenceMs: number;
    const owner = await this.readOwner();
    if (owner) {
      const parsed = new Date(owner.acquired_at).getTime();
      referenceMs = Number.isNaN(parsed) ? 0 : parsed;
    } else {
      try {
        referenceMs = (await stat(this.lockDir)).mtimeMs;
      } catch {
        // Lock dir may already be gone — treat as recovered.
        return true;
      }
    }

    if (Date.now() - referenceMs <= LOCK_STALE_MS) {
      return false;
    }

    await rm(this.lockDir, { recursive: true, force: true });
    return true;
  }

  private async describeMissingWorkspace(error: unknown): Promise<unknown> {
    const dockoDir = path.dirname(this.lockDir);
    if (await pathExists(dockoDir)) {
      return error;
    }

    const workspaceRoot = path.dirname(dockoDir);
    return new DockoError(
      `No docko workspace at ${workspaceRoot}. Run: docko init --root "${workspaceRoot}"`,
      'WORKSPACE_NOT_INITIALIZED',
      1,
      { workspace_root: workspaceRoot, docko_dir: dockoDir }
    );
  }
}
