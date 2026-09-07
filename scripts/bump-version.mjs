#!/usr/bin/env node
// Bump every workspace package.json to the same version, in lockstep. docko publishes a single
// bundled `docko-workspace` package, so all member versions must move together.
//
// Usage: node scripts/bump-version.mjs <version>
//   e.g. node scripts/bump-version.mjs 0.1.0-alpha.15

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MANIFESTS = [
  'package.json',
  'packages/core/package.json',
  'packages/cli/package.json',
  'packages/adapters/claude-code/package.json',
  'packages/adapters/claude-code/plugin/.claude-plugin/plugin.json'
];

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const version = process.argv[2];
if (!version || !SEMVER.test(version)) {
  console.error(`Usage: node scripts/bump-version.mjs <version>\nGot: ${version ?? '(nothing)'}`);
  process.exit(1);
}

// The hook launcher carries its own version header so an installed copy can be compared against
// the shipped one (`docko adapter claude-code doctor`).
const LAUNCHER = 'packages/adapters/claude-code/plugin/scripts/docko-claude-hook.mjs';

for (const relative of MANIFESTS) {
  const file = path.join(repoRoot, relative);
  const source = readFileSync(file, 'utf8');
  const next = source.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`);
  if (next === source) {
    console.error(`No version field updated in ${relative}`);
    process.exit(1);
  }
  writeFileSync(file, next);
  console.log(`bumped ${relative} -> ${version}`);
}

const launcherFile = path.join(repoRoot, LAUNCHER);
const launcherSource = readFileSync(launcherFile, 'utf8');
const nextLauncher = launcherSource.replace(
  /^\/\/ docko-launcher-version:.*$/m,
  `// docko-launcher-version: ${version}`
);
if (nextLauncher === launcherSource) {
  console.error(`No docko-launcher-version header updated in ${LAUNCHER}`);
  process.exit(1);
}
writeFileSync(launcherFile, nextLauncher);
console.log(`bumped ${LAUNCHER} -> ${version}`);

console.log('\nNext: pnpm install (refresh lockfile), commit, open a PR, then run the Release workflow.');
