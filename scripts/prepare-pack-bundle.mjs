import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const packageMap = {
  '@docko/core': 'packages/core',
  '@docko/cli': 'packages/cli',
  '@docko/adapter-claude-code': 'packages/adapters/claude-code'
};

const restore = process.argv.includes('--restore');
const distPaths = Object.values(packageMap).map((pkgPath) => join(ROOT, pkgPath, 'dist'));

function removePath(targetPath) {
  rmSync(targetPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

if (!restore && distPaths.some((distPath) => !existsSync(distPath))) {
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const result = spawnSync(command, ['build'], {
    cwd: ROOT,
    stdio: 'inherit'
  });

  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

const scopedRoot = join(ROOT, 'node_modules', '@docko');

if (restore) {
  removePath(scopedRoot);
} else {
  mkdirSync(scopedRoot, { recursive: true });

  for (const [packageName, packagePath] of Object.entries(packageMap)) {
    const packageDir = join(ROOT, packagePath);
    const targetDir = join(scopedRoot, packageName.split('/')[1]);

    removePath(targetDir);
    mkdirSync(targetDir, { recursive: true });
    cpSync(join(packageDir, 'package.json'), join(targetDir, 'package.json'));
    cpSync(join(packageDir, 'dist'), join(targetDir, 'dist'), { recursive: true });

    if (existsSync(join(packageDir, 'bin'))) {
      cpSync(join(packageDir, 'bin'), join(targetDir, 'bin'), { recursive: true });
    }

    if (existsSync(join(packageDir, 'templates'))) {
      cpSync(join(packageDir, 'templates'), join(targetDir, 'templates'), { recursive: true });
    }
  }
}
