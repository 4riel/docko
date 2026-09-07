import crypto from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DockoError } from './errors.js';
import { TEMP_ARTIFACT_MAX_AGE_MS, TEMP_DIR_PREFIX } from './constants.js';

// Windows fails a rename while an antivirus scanner or a concurrent reader still holds the
// destination handle. The condition is transient, so retry before giving up.
const TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY']);
const RENAME_ATTEMPTS = 6;
const RENAME_BACKOFF_MIN_MS = 20;
const RENAME_BACKOFF_MAX_MS = 300;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function errorCode(error: unknown): string | null {
  if (error instanceof Error && 'code' in error) {
    return (error as NodeJS.ErrnoException).code ?? null;
  }

  return null;
}

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw) as T;
}

export function isEnoent(error: unknown): boolean {
  return errorCode(error) === 'ENOENT';
}

/**
 * Retries a write step that failed for a transient reason.
 * Exported so the retry policy itself can be exercised without staging real filesystem races.
 */
export async function retryTransientWrite<T>(action: () => Promise<T>, filePath: string): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await action();
    } catch (error: unknown) {
      const code = errorCode(error);
      if (!code || !TRANSIENT_RENAME_CODES.has(code)) {
        throw error;
      }

      if (attempt >= RENAME_ATTEMPTS) {
        throw new DockoError(
          `Failed to replace ${filePath} after ${attempt} attempts (${code}). Another process or a file scanner may be holding it open.`,
          'ATOMIC_WRITE_FAILED',
          2,
          { file_path: filePath, attempts: attempt, cause_code: code }
        );
      }

      const backoff = Math.min(RENAME_BACKOFF_MIN_MS * 2 ** (attempt - 1), RENAME_BACKOFF_MAX_MS);
      await sleep(backoff + Math.random() * RENAME_BACKOFF_MIN_MS);
    }
  }
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  // Sibling temp file: half the syscalls of a temp directory, and a killed process leaks one
  // stray file the sweeper can reclaim instead of a directory.
  const tempFile = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(tempFile, content, 'utf8');
    await retryTransientWrite(() => rename(tempFile, filePath), filePath);
  } catch (error: unknown) {
    await safeUnlink(tempFile);
    throw error;
  }
}

export async function atomicWriteJson(filePath: string, payload: unknown): Promise<void> {
  await atomicWrite(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

export async function atomicWriteText(filePath: string, content: string): Promise<void> {
  await atomicWrite(filePath, content);
}

/**
 * Removes write artifacts left behind by processes that were killed mid-write.
 * Best effort: never throws, and never touches artifacts younger than the age cutoff so a
 * concurrent writer's temp file is left alone.
 */
export async function sweepStaleTempArtifacts(
  dirPath: string,
  olderThanMs: number = TEMP_ARTIFACT_MAX_AGE_MS
): Promise<number> {
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return 0;
  }

  const cutoff = Date.now() - olderThanMs;
  let removed = 0;

  for (const entry of entries) {
    const isTempDir = entry.isDirectory() && entry.name.startsWith(TEMP_DIR_PREFIX);
    const isTempFile = entry.isFile() && entry.name.endsWith('.tmp');
    if (!isTempDir && !isTempFile) {
      continue;
    }

    const target = path.join(dirPath, entry.name);
    try {
      const info = await stat(target);
      if (info.mtimeMs > cutoff) {
        continue;
      }
      await rm(target, { recursive: true, force: true });
      removed += 1;
    } catch {
      // Another process may have reclaimed it first.
    }
  }

  return removed;
}

export async function listDirectories(dirPath: string): Promise<string[]> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const names: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        names.push(entry.name);
      } else if (entry.isSymbolicLink()) {
        try {
          const resolved = await stat(path.join(dirPath, entry.name));
          if (resolved.isDirectory()) {
            names.push(entry.name);
          }
        } catch {
          // Broken link — skip.
        }
      }
    }
    return names.sort();
  } catch (error: unknown) {
    if (isEnoent(error)) {
      return [];
    }
    throw error;
  }
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function safeUnlink(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    // Ignore missing files during cleanup.
  }
}
