import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw) as T;
}

export function isEnoent(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  const tempDir = await mkdtemp(path.join(dir, '.docko-tmp-'));
  const tempFile = path.join(tempDir, path.basename(filePath));
  try {
    await writeFile(tempFile, content, 'utf8');
    await rename(tempFile, filePath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function atomicWriteJson(filePath: string, payload: unknown): Promise<void> {
  await atomicWrite(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

export async function atomicWriteText(filePath: string, content: string): Promise<void> {
  await atomicWrite(filePath, content);
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
