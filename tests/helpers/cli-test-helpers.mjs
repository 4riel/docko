import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, realpath } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const cliPath = path.join(repoRoot, 'packages', 'cli', 'dist', 'index.js');
const corePath = path.join(repoRoot, 'packages', 'core', 'dist', 'index.js');
const adapterPath = path.join(repoRoot, 'packages', 'adapters', 'claude-code', 'dist', 'index.js');
export const cliBinPath = path.join(repoRoot, 'packages', 'cli', 'bin', 'docko.js');
export const cliExecutablePath =
  process.platform === 'win32'
    ? path.join(repoRoot, 'node_modules', '.bin', 'docko.cmd')
    : path.join(repoRoot, 'node_modules', '.bin', 'docko');

let directCliLock = Promise.resolve();
let buildArtifactsLock = Promise.resolve();
let artifactsVerified = false;
const cliImportHref = pathToFileURL(cliPath).href;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForBuiltArtifacts(timeoutMs = 2000) {
  const startedAt = Date.now();
  while (buildArtifactsMissing() && Date.now() - startedAt < timeoutMs) {
    await delay(50);
  }
}

function isTransientCliImportFailure(result) {
  return (
    result.code !== 0 &&
    result.stderr.includes('ERR_MODULE_NOT_FOUND') &&
    (result.stderr.includes(cliPath) || result.stderr.includes(cliImportHref))
  );
}

function isEmptyCliResult(result) {
  return result.code === 0 && result.stdout === '' && result.stderr === '';
}

function buildArtifactsMissing() {
  return !existsSync(cliPath) || !existsSync(corePath) || !existsSync(adapterPath);
}

export async function ensureBuiltArtifacts() {
  if (artifactsVerified) {
    return;
  }
  if (!buildArtifactsMissing()) {
    artifactsVerified = true;
    return;
  }

  const previous = buildArtifactsLock;
  let releaseLock;
  buildArtifactsLock = new Promise((resolve) => {
    releaseLock = resolve;
  });
  await previous;

  try {
    await waitForBuiltArtifacts();
    if (!buildArtifactsMissing()) {
      artifactsVerified = true;
      return;
    }
    throw new Error('Docko test artifacts are missing. Run `pnpm build` before running this test process.');
  } finally {
    releaseLock();
  }
}

export async function makeRoot(prefix = 'docko-workspace-') {
  const tmpBase = await realpath(os.tmpdir());
  return mkdtemp(path.join(tmpBase, prefix));
}

export async function makeWorkspace(prefix = 'docko-workspace-') {
  const root = await makeRoot(prefix);
  await mkdir(path.join(root, 'slots'), { recursive: true });
  await mkdir(path.join(root, 'slots', 'app-alpha'));
  await mkdir(path.join(root, 'slots', 'app-beta'));
  return root;
}

export async function runProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: {
        ...process.env,
        ...options.env
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      resolve({
        code: code ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      });
    });

    if (options.input) {
      child.stdin.write(options.input);
    }

    if (options.inputDelayMs) {
      setTimeout(() => child.stdin.end(), options.inputDelayMs);
    } else {
      child.stdin.end();
    }
  });
}

function buildCliBootstrap(entryPath, args, stdinIsTTY) {
  return [
    `Object.defineProperty(process.stdin, 'isTTY', { value: ${stdinIsTTY ? 'true' : 'false'}, configurable: true });`,
    `process.argv = ${JSON.stringify([process.execPath, entryPath, ...args])};`,
    `await import(${JSON.stringify(pathToFileURL(entryPath).href)});`
  ].join('\n');
}

export async function runCli(args, options = {}) {
  return runCliDirect(args, options);
}

export async function runCliDirect(args, options = {}) {
  await ensureBuiltArtifacts();
  const previous = directCliLock;
  let releaseLock;
  directCliLock = new Promise((resolve) => {
    releaseLock = resolve;
  });
  await previous;

  try {
    const module = await import(pathToFileURL(cliPath).href);
    const originalArgv = process.argv;
    const originalCwd = process.cwd();
    const originalExit = process.exit;
    const originalExitCode = process.exitCode;
    const originalStdoutWrite = process.stdout.write.bind(process.stdout);
    const originalStderrWrite = process.stderr.write.bind(process.stderr);
    const originalStdinIsTTY = process.stdin.isTTY;
    const originalSetEncoding = process.stdin.setEncoding.bind(process.stdin);
    const originalOn = process.stdin.on.bind(process.stdin);
    const originalResume = process.stdin.resume.bind(process.stdin);
    const originalEnv = new Map(Object.entries(process.env));

    let stdout = '';
    let stderr = '';
    let exitCode = 0;
    const handlers = new Map();
    const stdinIsTTY = Boolean(options.stdinIsTTY);
    const input = options.input ?? '';
    const inputDelayMs = options.inputDelayMs ?? 0;

    try {
      if (options.cwd) {
        process.chdir(options.cwd);
      }

      if (options.env) {
        for (const [key, value] of Object.entries(options.env)) {
          if (value === undefined || value === null) {
            delete process.env[key];
          } else {
            process.env[key] = String(value);
          }
        }
      }

      process.argv = [process.execPath, cliPath, ...args];
      process.exitCode = undefined;
      process.stdout.write = ((chunk, encoding, callback) => {
        stdout += chunk instanceof Uint8Array ? Buffer.from(chunk).toString('utf8') : String(chunk);
        if (typeof encoding === 'function') {
          encoding();
        }
        if (typeof callback === 'function') {
          callback();
        }
        return true;
      });
      process.stderr.write = ((chunk, encoding, callback) => {
        stderr += chunk instanceof Uint8Array ? Buffer.from(chunk).toString('utf8') : String(chunk);
        if (typeof encoding === 'function') {
          encoding();
        }
        if (typeof callback === 'function') {
          callback();
        }
        return true;
      });
      Object.defineProperty(process.stdin, 'isTTY', { value: stdinIsTTY, configurable: true });
      process.stdin.setEncoding = () => process.stdin;
      process.stdin.on = (event, handler) => {
        handlers.set(event, handler);
        return process.stdin;
      };
      process.stdin.resume = () => {
        if (!stdinIsTTY) {
          setTimeout(() => {
            if (input) {
              handlers.get('data')?.(input);
            }
            handlers.get('end')?.();
          }, inputDelayMs);
        }
        return process.stdin;
      };
      process.exit = (code = 0) => {
        exitCode = Number(code);
        throw new Error(`__docko_test_exit__:${exitCode}`);
      };

      try {
        await module.main(args);
        exitCode = process.exitCode ?? 0;
      } catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith('__docko_test_exit__:')) {
          throw error;
        }
      }
    } finally {
      process.argv = originalArgv;
      process.exit = originalExit;
      process.exitCode = originalExitCode;
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
      process.stdin.setEncoding = originalSetEncoding;
      process.stdin.on = originalOn;
      process.stdin.resume = originalResume;
      Object.defineProperty(process.stdin, 'isTTY', { value: originalStdinIsTTY, configurable: true });
      process.chdir(originalCwd);

      for (const key of Object.keys(process.env)) {
        if (!originalEnv.has(key)) {
          delete process.env[key];
        }
      }
      for (const [key, value] of originalEnv.entries()) {
        process.env[key] = value;
      }
    }

    return {
      code: exitCode,
      stdout: stdout.trim(),
      stderr: stderr.trim()
    };
  } finally {
    releaseLock();
  }
}

export async function runCliDirectModule(args, options = {}) {
  return runCliDirect(args, options);
}

export async function runCliBin(args, options = {}) {
  await ensureBuiltArtifacts();
  return runProcess(process.execPath, [cliBinPath, ...args], options);
}

export async function runCliModule(args, options = {}) {
  await ensureBuiltArtifacts();
  const bootstrap = buildCliBootstrap(cliPath, args, Boolean(options.stdinIsTTY));
  let result = await runProcess(process.execPath, ['--input-type=module', '-e', bootstrap], options);
  for (let attempt = 0; attempt < 2 && (isTransientCliImportFailure(result) || isEmptyCliResult(result)); attempt += 1) {
    await delay(50);
    result = await runProcess(process.execPath, ['--input-type=module', '-e', bootstrap], options);
  }
  return result;
}

export async function runShellCommand(command, options = {}) {
  const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
  const shellArgs =
    process.platform === 'win32'
      ? ['-NoProfile', '-Command', command]
      : ['-lc', command];

  return runProcess(shell, shellArgs, options);
}

export function parseStdout(result) {
  return result.stdout ? JSON.parse(result.stdout) : null;
}
