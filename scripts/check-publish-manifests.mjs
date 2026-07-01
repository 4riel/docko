import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const baseDir = process.argv[2] ? resolve(ROOT, process.argv[2]) : ROOT;
const packageJsonPaths = [
  join(baseDir, 'package.json'),
  join(baseDir, 'packages', 'core', 'package.json'),
  join(baseDir, 'packages', 'cli', 'package.json'),
  join(baseDir, 'packages', 'adapters', 'claude-code', 'package.json')
];

const manifests = packageJsonPaths.map((filePath) => {
  if (!existsSync(filePath)) {
    throw new Error(`Missing package manifest: ${filePath}`);
  }

  return {
    filePath,
    pkg: JSON.parse(readFileSync(filePath, 'utf8'))
  };
});

const rootVersion = manifests[0].pkg.version;
const errors = [];

for (const { filePath, pkg } of manifests) {
  for (const depField of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const deps = pkg[depField];
    if (!deps) {
      continue;
    }

    for (const [name, value] of Object.entries(deps)) {
      if (typeof value !== 'string') {
        continue;
      }

      if (value.startsWith('workspace:')) {
        errors.push(`${filePath}: ${depField}.${name} must not use workspace protocol in publishable manifests.`);
      }

      if (name.startsWith('@docko/') && value !== rootVersion) {
        errors.push(`${filePath}: ${depField}.${name} must match root version ${rootVersion}, found ${value}.`);
      }
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(error);
  }
  process.exit(1);
}
