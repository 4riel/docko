import path from 'node:path';
import { DOCKO_DIR, ENDED_SESSIONS_DIR, MUTATION_LOCK_DIR, SLOTS_DIR } from './constants.js';

// The subset of node:path a containment check needs. Injectable so win32 semantics stay testable
// from a POSIX runner and vice versa.
export type PathModule = Pick<typeof path, 'relative' | 'resolve' | 'isAbsolute' | 'sep'>;

/**
 * True when `candidate` is `parent` itself or any path beneath it.
 * `path.relative` applies the platform's own comparison rules, so Windows stays case-insensitive
 * about drive letters and segment case while POSIX stays case-sensitive. Comparing normalized
 * strings with `===`/`startsWith` does not, which lets `C:/…/SLOTS/x` slip past a slots check.
 */
export function isPathInside(parent: string, candidate: string, pathModule: PathModule = path): boolean {
  const relative = pathModule.relative(pathModule.resolve(parent), pathModule.resolve(candidate));
  if (relative === '') {
    return true;
  }

  // `..foo` is a child; `..` and `../foo` are not. Testing the separator keeps them apart.
  return relative !== '..' && !relative.startsWith(`..${pathModule.sep}`) && !pathModule.isAbsolute(relative);
}

export interface DockoPaths {
  workspaceRoot: string;
  dockoDir: string;
  registryPath: string;
  mirrorPath: string;
  sessionsDir: string;
  sessionsEndedDir: string;
  logsDir: string;
  lockDir: string;
  slotsDir: string;
}

export function getPaths(workspaceRoot: string): DockoPaths {
  const normalizedWorkspaceRoot = path.resolve(workspaceRoot);
  const dockoDir = path.join(normalizedWorkspaceRoot, DOCKO_DIR);

  return {
    workspaceRoot: normalizedWorkspaceRoot,
    dockoDir,
    registryPath: path.join(dockoDir, 'registry.json'),
    mirrorPath: path.join(dockoDir, 'registry.md'),
    sessionsDir: path.join(dockoDir, 'sessions'),
    sessionsEndedDir: path.join(dockoDir, 'sessions', ENDED_SESSIONS_DIR),
    logsDir: path.join(dockoDir, 'logs'),
    lockDir: path.join(dockoDir, MUTATION_LOCK_DIR),
    slotsDir: path.join(normalizedWorkspaceRoot, SLOTS_DIR)
  };
}
