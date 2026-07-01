import { rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

for (const target of ['packages/core/dist', 'packages/cli/dist', 'packages/adapters/claude-code/dist']) {
  rmSync(join(ROOT, target), { recursive: true, force: true });
}

for (const filter of ['@docko/core', '@docko/adapter-claude-code', '@docko/cli']) {
  const result =
    process.platform === 'win32'
      ? spawnSync('cmd.exe', ['/d', '/s', '/c', `pnpm --filter ${filter} build`], {
          cwd: ROOT,
          stdio: 'inherit'
        })
      : spawnSync('pnpm', ['--filter', filter, 'build'], {
          cwd: ROOT,
          stdio: 'inherit'
        });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}
