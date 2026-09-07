import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { mkdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
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

// Filesystem timestamps carry sub-millisecond precision that Date.now() does not, so a reference
// a hair ahead of "now" is really "just now". Anything further ahead is clock skew.
const CLOCK_SKEW_TOLERANCE_MS = 1000;

/** Maps a timestamp onto the age scale: at most now, and 0 for a value that is plainly skewed. */
function normalizeReference(candidate: number, now: number): number {
  if (candidate <= now) {
    return candidate;
  }

  return candidate - now <= CLOCK_SKEW_TOLERANCE_MS ? now : 0;
}

const LOCK_TIMEOUT_MS = 10_000;
const LOCK_STALE_MS = 30_000;
// A held lock re-stamps itself well inside the stale window, so a slow but living holder is never
// mistaken for an abandoned one.
const LOCK_REFRESH_MS = 10_000;
const LOCK_POLL_MIN_MS = 10;
const LOCK_POLL_MAX_MS = 100;
const OWNER_FILE = 'owner.json';
const OWNER_TEMP_FILE = 'owner.json.tmp';

export interface MutationLockOwner {
  pid: number;
  hostname: string;
  acquired_at: string;
}

export interface MutationGateOptions {
  // All three are injectable so a test can exercise the timing without waiting out the defaults.
  timeoutMs?: number;
  staleMs?: number;
  refreshMs?: number;
}

interface AcquiredLock {
  owner: MutationLockOwner;
  // Whether our owner stamp actually reached disk. Without it there is nothing to compare
  // against on release, and deleting the directory could rob whoever holds the lock now.
  ownerWritten: boolean;
  // Set once another process has been observed holding the stamp: we then own nothing.
  lost: boolean;
  // The stamps we published, newest first. A refresh in flight means the file can already hold
  // the newer one while `owner` still names the older, so an ownership check accepts either.
  stamps: string[];
  refreshing: boolean;
  refreshTimer: NodeJS.Timeout | null;
}

export class MutationGate {
  /**
   * Serializes registry mutations with a simple filesystem lock directory.
   * This keeps concurrent local CLI calls predictable without introducing a daemon.
   */
  private readonly timeoutMs: number;
  private readonly staleMs: number;
  private readonly refreshMs: number;
  private activeLock: AcquiredLock | null = null;

  constructor(
    private readonly lockDir: string,
    options: MutationGateOptions = {}
  ) {
    this.timeoutMs = options.timeoutMs ?? LOCK_TIMEOUT_MS;
    this.staleMs = options.staleMs ?? LOCK_STALE_MS;
    this.refreshMs = options.refreshMs ?? LOCK_REFRESH_MS;
  }

  private get ownerPath(): string {
    return path.join(this.lockDir, OWNER_FILE);
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const lock = await this.acquire();
    this.activeLock = lock;
    this.startRefresh(lock);

    try {
      return await operation();
    } finally {
      this.stopRefresh(lock);
      this.activeLock = null;
      await this.releaseIfOwned(lock);
    }
  }

  /**
   * Throws when the lock stamp on disk is no longer ours. Callers run this immediately before
   * persisting, so a lock broken under a long operation fails loudly and retriably instead of
   * writing over whoever holds it now.
   */
  async assertStillHeld(): Promise<void> {
    const lock = this.activeLock;
    if (!lock) {
      return;
    }

    if (lock.lost || !(await this.ownsLock(lock))) {
      lock.lost = true;
      throw new DockoError('Lost the registry lock before writing.', 'REGISTRY_LOCK_LOST', 2, {
        lock_dir: this.lockDir,
        owner: await this.readOwner(),
        next_steps: ['Retry the command; the registry was not modified.']
      });
    }
  }

  private startRefresh(lock: AcquiredLock): void {
    if (!lock.ownerWritten) {
      return;
    }

    // Unref'd: keeping the lock fresh must never be the reason a CLI process stays alive.
    const timer = setInterval(() => {
      void this.refreshOwner(lock);
    }, this.refreshMs);
    timer.unref();
    lock.refreshTimer = timer;
  }

  private stopRefresh(lock: AcquiredLock): void {
    if (lock.refreshTimer) {
      clearInterval(lock.refreshTimer);
      lock.refreshTimer = null;
    }
  }

  private async refreshOwner(lock: AcquiredLock): Promise<void> {
    // A slow disk can make a refresh outlast its interval; two in flight would race over the
    // stamp and each read the other's as a stranger's.
    if (lock.refreshing) {
      return;
    }

    lock.refreshing = true;
    try {
      if (lock.lost || !(await this.ownsLock(lock))) {
        // Someone already broke the lock. Re-stamping now would steal it back mid-write.
        lock.lost = true;
        this.stopRefresh(lock);
        return;
      }

      const next: MutationLockOwner = { ...lock.owner, acquired_at: new Date().toISOString() };
      if (await this.writeOwnerStamp(lock, next)) {
        lock.owner = next;
      }
    } finally {
      lock.refreshing = false;
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
    const deadline = startedAt + this.timeoutMs;
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

        // Windows reports a directory whose deletion is still pending as EPERM/EACCES rather than
        // EEXIST. That is the lock-breaking window, not a real failure, so keep waiting.
        if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'EACCES') {
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

    // The lock is the directory itself; the owner stamp is metadata, so a failed stamp still
    // leaves us holding a usable lock.
    const lock: AcquiredLock = {
      owner,
      ownerWritten: false,
      lost: false,
      stamps: [],
      refreshing: false,
      refreshTimer: null
    };
    lock.ownerWritten = await this.writeOwnerStamp(lock, owner);
    return lock;
  }

  /**
   * Publishes an owner stamp. It is written to a sibling temp file and renamed so a concurrent
   * reader never sees a half-written stamp, and the lock directory's mtime moves with it because
   * that mtime is the staleness reference whenever the stamp cannot be read.
   */
  private async writeOwnerStamp(lock: AcquiredLock, owner: MutationLockOwner): Promise<boolean> {
    // Recorded before the write, so a concurrent ownership check that reads the new stamp first
    // still recognizes it as ours. Two entries are enough: the live one and the one it replaced.
    lock.stamps = [owner.acquired_at, ...lock.stamps].slice(0, 2);

    const tempPath = path.join(this.lockDir, OWNER_TEMP_FILE);
    try {
      await writeFile(
        tempPath,
        `${JSON.stringify(owner, null, 2)}
`,
        'utf8'
      );
      await rename(tempPath, this.ownerPath);
    } catch {
      await safeUnlink(tempPath);
      return false;
    }

    try {
      const stamped = new Date(owner.acquired_at);
      await utimes(this.lockDir, stamped, stamped);
    } catch {
      // mtime is only the fallback reference; the stamp itself already reached disk.
    }

    return true;
  }

  /** True when the owner stamp on disk is still the one we just wrote. */
  private async ownsLock(lock: AcquiredLock): Promise<boolean> {
    const current = await this.readOwner();
    if (!current) {
      // Nothing to compare against. When our own stamp never reached disk the atomic mkdir is
      // still the real lock; when it did, a missing stamp means someone broke the lock.
      return !lock.ownerWritten;
    }

    return current.pid === lock.owner.pid && lock.stamps.includes(current.acquired_at);
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
      if (current.pid !== lock.owner.pid || !lock.stamps.includes(current.acquired_at)) {
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
    const now = Date.now();
    const candidates: number[] = [];

    const owner = await this.readOwner();
    if (owner) {
      const parsed = new Date(owner.acquired_at).getTime();
      candidates.push(Number.isNaN(parsed) ? 0 : parsed);
    }

    try {
      candidates.push((await stat(this.lockDir)).mtimeMs);
    } catch {
      // Lock dir may already be gone — treat as recovered.
      return true;
    }

    // Clock skew must never wedge the workspace: a stamp dated well into the future counts as the
    // oldest possible time rather than postponing recovery forever. The oldest of the available
    // references then decides staleness.
    const referenceMs = Math.min(...candidates.map((candidate) => normalizeReference(candidate, now)));

    if (now - referenceMs <= this.staleMs) {
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
