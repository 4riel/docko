#!/usr/bin/env node

import { spawn } from 'node:child_process';

const subcommand = process.argv[2];
if (!subcommand) {
  process.stderr.write('Missing Claude hook subcommand.\n');
  process.exit(1);
}

const dockoBin = process.env.DOCKO_BIN || 'docko';
const dockoRoot = process.env.DOCKO_ROOT || process.env.CLAUDE_PROJECT_DIR || process.cwd();

const child = spawn(dockoBin, ['adapter', 'claude-code', subcommand], {
  env: {
    ...process.env,
    DOCKO_ROOT: dockoRoot
  },
  stdio: 'inherit',
  // Use a shell only on Windows, where resolving `docko`/`node` on PATH and .cmd shims needs
  // cmd.exe. On POSIX, shell: true re-parses the args and breaks quoted DOCKO_BIN values.
  shell: process.platform === 'win32'
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

child.on('error', (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
