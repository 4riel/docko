import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { STALE_LOCK_DIR_PREFIX } from './constants.js';
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

interface AcquiredLock {
  owner: MutationLockOwner;
  // Whether our owner stamp actually reached disk. Without it there is nothing to compare
  // against on release, and deleting the directory could rob whoever holds the lock now.
  ownerWritten: boolean;
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
    const lock = await this.acquire();

    try {
      return await operation();
    } finally {
      await this.releaseIfOwned(lock);
    }
  }

  /**
   * Takes the lock, or throws REGISTRY_LOCK_TIMEOUT.
   * mkdir is atomic, but a concurrent staleness breaker can remove the directory between our
   * mkdir and our owner stamp, so the stamp is read back: only the process whose stamp survived
   * actually holds the lock. Everyone else keeps waiting.
   */
  private async acquire(): Promise<AcquiredLock> {
    const startedAt = Date.now();
    const deadline = startedAt + LOCK_TIMEOUT_MS;
    let backoff = LOCK_POLL_MIN_MS;

    while (true) {
      let created = false;
      try {
        await mkdir(this.lockDir);
        created = true;
      } catch (error: unknown) {
        const code = errorCode(error);
        if (code === 'ENOENT') {
          throw await this.describeMissingWorkspace(error);
        }

        if (code !== 'EEXIST') {
          throw error;
        }
      }

      if (created) {
        const lock = await this.writeOwner();
        if (await this.ownsLock(lock)) {
          return lock;
        }
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
      if (!created && (await this.recoverStaleLock())) {
        continue;
      }

      await sleep(backoff + Math.random() * LOCK_POLL_MIN_MS);
      backoff = Math.min(backoff * 2, LOCK_POLL_MAX_MS);
    }
  }

  private async writeOwner(): Promise<AcquiredLock> {
    const owner: MutationLockOwner = {
      pid: process.pid,
      hostname: os.hostname(),
      acquired_at: new Date().toISOString()
    };

    try {
      await writeFile(
        this.ownerPath,
        `${JSON.stringify(owner, null, 2)}
`,
        'utf8'
      );
      return { owner, ownerWritten: true };
    } catch {
      // The lock is the directory itself; owner metadata is diagnostic only.
      return { owner, ownerWritten: false };
    }
  }

  /** True when the owner stamp on disk is still the one we just wrote. */
  private async ownsLock(lock: AcquiredLock): Promise<boolean> {
    const current = await this.readOwner();
    if (!current) {
      // Nothing to compare against. When our own stamp never reached disk the atomic mkdir is
      // still the real lock; when it did, a missing stamp means someone broke the lock.
      return !lock.ownerWritten;
    }

    return current.pid === lock.owner.pid && current.acquired_at === lock.owner.acquired_at;
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
  private async releaseIfOwned(lock: AcquiredLock): Promise<void> {
    const current = await this.readOwner();
    if (current) {
      if (current.pid !== lock.owner.pid || current.acquired_at !== lock.owner.acquired_at) {
        return;
      }
    } else if (lock.ownerWritten) {
      // Our stamp is gone, so this directory belongs to whoever broke the lock, not to us.
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

    // Rename before deleting. The rename is atomic, so exactly one waiter can win it; the losers
    // never delete a lock directory a third process has already re-created and stamped.
    const quarantined = path.join(
      path.dirname(this.lockDir),
      `${STALE_LOCK_DIR_PREFIX}${crypto.randomBytes(6).toString('hex')}`
    );
    try {
      await rename(this.lockDir, quarantined);
    } catch {
      // Someone else broke it first, or it is already gone. Their mkdir wins the next pass.
      return false;
    }

    await rm(quarantined, { recursive: true, force: true });
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
