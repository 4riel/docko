import path from 'node:path';
import { DOCKO_DIR, MUTATION_LOCK_DIR } from './constants.js';

export interface DockoPaths {
  workspaceRoot: string;
  dockoDir: string;
  registryPath: string;
  mirrorPath: string;
  sessionsDir: string;
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
    logsDir: path.join(dockoDir, 'logs'),
    lockDir: path.join(dockoDir, MUTATION_LOCK_DIR),
    slotsDir: path.join(normalizedWorkspaceRoot, 'slots')
  };
}
