import { readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testsDir = path.join(repoRoot, 'tests');
const testFiles = readdirSync(testsDir)
  .filter((entry) => entry.endsWith('.test.mjs'))
  .map((entry) => path.join('tests', entry))
  .sort();

for (const testFile of testFiles) {
  let result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), testFile], {
    cwd: repoRoot,
    stdio: 'inherit'
  });

  if ((result.status ?? 1) !== 0) {
    process.stderr.write(`Retrying ${testFile} after a failed test-process run.\n`);
    result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), testFile], {
      cwd: repoRoot,
      stdio: 'inherit'
    });
  }

  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}
