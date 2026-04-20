import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const STAGE_DIR = join(ROOT, '.publish', 'npm');
const packageMap = {
  '@docko/core': 'packages/core',
  '@docko/cli': 'packages/cli',
  '@docko/adapter-claude-code': 'packages/adapters/claude-code',
};

const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const version = rootPkg.version;
const distPaths = Object.values(packageMap).map((pkgPath) => join(ROOT, pkgPath, 'dist'));

function runPnpmBuild() {
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const result = spawnSync(command, ['build'], {
    cwd: ROOT,
    stdio: 'inherit',
  });

  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

function ensureDir(targetPath) {
  mkdirSync(targetPath, { recursive: true });
}

function copyFile(relativePath) {
  const source = join(ROOT, relativePath);
  const target = join(STAGE_DIR, relativePath);
  ensureDir(dirname(target));
  cpSync(source, target);
}

function resolveWorkspaceDeps(pkg) {
  for (const depField of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const deps = pkg[depField];
    if (!deps) {
      continue;
    }

    for (const [name, value] of Object.entries(deps)) {
      if (typeof value === 'string' && value.startsWith('workspace:') && name.startsWith('@docko/')) {
        deps[name] = version;
      }
    }
  }

  return pkg;
}

function writeJson(relativePath, pkg) {
  const target = join(STAGE_DIR, relativePath);
  ensureDir(dirname(target));
  writeFileSync(target, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
}

function copyPackage(packageName, packagePath) {
  const sourceDir = join(ROOT, packagePath);
  const stagePackageDir = join(STAGE_DIR, packagePath);
  const stagedNodeModuleDir = join(STAGE_DIR, 'node_modules', packageName);
  const pkg = resolveWorkspaceDeps(JSON.parse(readFileSync(join(sourceDir, 'package.json'), 'utf8')));

  ensureDir(stagePackageDir);
  ensureDir(stagedNodeModuleDir);

  writeJson(join(packagePath, 'package.json'), pkg);
  writeJson(join('node_modules', packageName, 'package.json'), pkg);

  cpSync(join(sourceDir, 'dist'), join(stagePackageDir, 'dist'), { recursive: true });
  cpSync(join(sourceDir, 'dist'), join(stagedNodeModuleDir, 'dist'), { recursive: true });

  if (existsSync(join(sourceDir, 'bin'))) {
    cpSync(join(sourceDir, 'bin'), join(stagePackageDir, 'bin'), { recursive: true });
    cpSync(join(sourceDir, 'bin'), join(stagedNodeModuleDir, 'bin'), { recursive: true });
  }

  if (existsSync(join(sourceDir, 'templates'))) {
    cpSync(join(sourceDir, 'templates'), join(stagePackageDir, 'templates'), { recursive: true });
    cpSync(join(sourceDir, 'templates'), join(stagedNodeModuleDir, 'templates'), { recursive: true });
  }
}

if (distPaths.some((distPath) => !existsSync(distPath))) {
  runPnpmBuild();
}

rmSync(STAGE_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
ensureDir(STAGE_DIR);

const publishPkg = resolveWorkspaceDeps(structuredClone(rootPkg));
delete publishPkg.devDependencies;
delete publishPkg.scripts;
delete publishPkg.packageManager;

copyFile('LICENSE');
copyFile('README.md');
copyFile(join('bin', 'docko.js'));
writeJson('package.json', publishPkg);

for (const [packageName, packagePath] of Object.entries(packageMap)) {
  copyPackage(packageName, packagePath);
}
