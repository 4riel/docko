import { mkdir, rm, stat } from 'node:fs/promises';
import { DockoError } from './errors.js';

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isEexist(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'EEXIST';
}

const LOCK_TIMEOUT_MS = 5_000;
const LOCK_STALE_MS = 30_000;

export class MutationGate {
  /**
   * Serializes registry mutations with a simple filesystem lock directory.
   * This keeps concurrent local CLI calls predictable without introducing a daemon.
   */
  constructor(private readonly lockDir: string) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    let recoveryAttempted = false;

    while (true) {
      try {
        await mkdir(this.lockDir);
        break;
      } catch (error: unknown) {
        if (!isEexist(error)) {
          throw error;
        }

        if (Date.now() >= deadline) {
          if (recoveryAttempted) {
            throw new DockoError('Timed out waiting for registry lock.', 'REGISTRY_LOCK_TIMEOUT', 2);
          }
          recoveryAttempted = true;
          const recovered = await this.recoverStaleLock();
          if (!recovered) {
            throw new DockoError('Timed out waiting for registry lock.', 'REGISTRY_LOCK_TIMEOUT', 2);
          }
          continue;
        }

        await sleep(15 + Math.random() * 20);
      }
    }

    try {
      return await operation();
    } finally {
      await rm(this.lockDir, { recursive: true, force: true });
    }
  }

  private async recoverStaleLock(): Promise<boolean> {
    try {
      const lockStat = await stat(this.lockDir);
      if (Date.now() - lockStat.mtimeMs > LOCK_STALE_MS) {
        await rm(this.lockDir, { recursive: true, force: true });
        return true;
      }
    } catch {
      // Lock dir may already be gone — treat as recovered.
      return true;
    }
    return false;
  }
}
