#!/usr/bin/env node
// docko Claude Code hook launcher.
//
// Responsibilities:
// 1. No-op outside docko workspaces so the plugin can stay enabled globally.
// 2. Invoke the docko CLI (`docko adapter claude-code <subcommand>`), falling back to
//    `npx docko-workspace@alpha` when the global binary is not on PATH.
// 3. Translate the CLI's JSON output into the Claude Code hook output protocol
//    (hookSpecificOutput / permissionDecision). The CLI JSON contract stays
//    runtime-agnostic; this launcher owns the Claude-specific shape.
//
// Hooks are an operational control, not a security boundary: on launcher or CLI
// failure we warn on stderr and exit 0 so the user's session keeps working.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const HOOK_EVENTS = {
  'session-start': 'SessionStart',
  'session-end': 'SessionEnd',
  'pre-tool-use': 'PreToolUse',
  'subagent-start': 'SubagentStart'
};

const subcommand = process.argv[2];
if (!Object.hasOwn(HOOK_EVENTS, subcommand ?? '')) {
  process.stderr.write(`docko hook: unknown subcommand "${subcommand ?? ''}".\n`);
  process.exit(1);
}

const rawPayload = await readStdin();
const payload = parseJson(rawPayload);

const dockoRoot = path.resolve(
  process.env.DOCKO_ROOT ||
    process.env.CLAUDE_PROJECT_DIR ||
    (typeof payload.cwd === 'string' && payload.cwd) ||
    process.cwd()
);

if (!existsSync(path.join(dockoRoot, 'docko', 'registry.json'))) {
  // Not a docko workspace: stay silent so the hook is invisible in other projects.
  process.exit(0);
}

const claudeSessionId = typeof payload.session_id === 'string' ? payload.session_id : null;
const extraArgs = [];
// SessionStart creates the docko session with Claude's own session_id, so later hooks
// can address it explicitly instead of relying on single-active-session resolution.
if ((subcommand === 'pre-tool-use' || subcommand === 'subagent-start') && claudeSessionId) {
  extraArgs.push('--session', claudeSessionId);
}

let result = await runDocko(subcommand, extraArgs, rawPayload, dockoRoot);
if (result.code !== 0 && extraArgs.length > 0 && subcommand === 'pre-tool-use') {
  // The Claude session id may not map to a docko session (e.g. manually started
  // sessions). Retry with the CLI's own resolution before failing open.
  result = await runDocko(subcommand, [], rawPayload, dockoRoot);
}

if (result.code !== 0) {
  const detail = result.stderr.trim() || result.error || `exit code ${result.code}`;
  process.stderr.write(`docko hook (${subcommand}) failed open: ${detail}\n`);
  process.exit(0);
}

emitHookOutput(subcommand, parseJson(result.stdout));
process.exit(0);

function emitHookOutput(hookSubcommand, cliOutput) {
  const hookEventName = HOOK_EVENTS[hookSubcommand];

  if (hookSubcommand === 'session-end') {
    return;
  }

  if (hookSubcommand === 'pre-tool-use') {
    if (cliOutput.allow === false) {
      const reason = typeof cliOutput.reason === 'string' ? cliOutput.reason : 'not authorized';
      const owner = typeof cliOutput.owner_session_id === 'string' ? ` (owner: ${cliOutput.owner_session_id})` : '';
      writeJson({
        hookSpecificOutput: {
          hookEventName,
          permissionDecision: 'deny',
          permissionDecisionReason: `docko blocked this write: ${reason}${owner}. Claim the slot first (/dock-status, /dock-claim).`
        }
      });
    }
    // On allow, emit nothing: docko only vetoes unauthorized slot writes, it does not
    // grant permission past the user's normal permission flow.
    return;
  }

  // session-start / subagent-start inject context.
  if (typeof cliOutput.additionalContext === 'string' && cliOutput.additionalContext.length > 0) {
    writeJson({
      hookSpecificOutput: {
        hookEventName,
        additionalContext: cliOutput.additionalContext
      }
    });
  }
}

function runDocko(hookSubcommand, args, stdinPayload, root) {
  const commands = [];
  if (process.env.DOCKO_BIN) {
    commands.push({ bin: process.env.DOCKO_BIN, prefix: [] });
  } else {
    commands.push({ bin: 'docko', prefix: [] });
    commands.push({ bin: 'npx', prefix: ['--yes', '--package', 'docko-workspace@alpha', 'docko'] });
  }

  return tryCommands(commands, ['adapter', 'claude-code', hookSubcommand, ...args], stdinPayload, root);
}

async function tryCommands(commands, args, stdinPayload, root) {
  let last = { code: 1, stdout: '', stderr: '', error: 'no docko command available' };

  for (const command of commands) {
    last = await execute(command.bin, [...command.prefix, ...args], stdinPayload, root);
    if (!last.notFound) {
      return last;
    }
  }

  return last;
}

function execute(bin, args, stdinPayload, root) {
  return new Promise((resolve) => {
    // Windows needs a shell to resolve .cmd shims (docko, npx) and to allow multi-token
    // DOCKO_BIN values like `node "C:\path\docko.js"`. The bin is passed through raw
    // (quote it yourself if its path has spaces); generated args are quoted here.
    // On POSIX we spawn directly with argv, so DOCKO_BIN must be a single executable.
    const useShell = process.platform === 'win32';
    const child = useShell
      ? spawn(`${bin} ${args.map(quoteForShell).join(' ')}`, {
          env: { ...process.env, DOCKO_ROOT: root },
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: true
        })
      : spawn(bin, args, {
          env: { ...process.env, DOCKO_ROOT: root },
          stdio: ['pipe', 'pipe', 'pipe']
        });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', (error) => {
      resolve({ code: 1, stdout, stderr, error: error.message, notFound: error.code === 'ENOENT' });
    });

    child.on('close', (code) => {
      // With shell:true a missing binary surfaces as a shell error instead of ENOENT.
      const notFound = useShell && code !== 0 && /not recognized|command not found|no encuentra/i.test(stderr);
      resolve({ code: code ?? 1, stdout, stderr, notFound });
    });

    child.stdin.on('error', () => {});
    child.stdin.end(stdinPayload);
  });
}

function quoteForShell(value) {
  return /[\s^&|<>()%!]/.test(value) ? `"${value}"` : value;
}

function readStdin() {
  if (process.stdin.isTTY) {
    return Promise.resolve('');
  }

  return new Promise((resolve) => {
    let settled = false;
    let raw = '';
    const finish = () => {
      if (!settled) {
        settled = true;
        resolve(raw);
      }
    };

    const timer = setTimeout(finish, 1000);
    timer.unref();

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      raw += chunk;
    });
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
    process.stdin.resume();
  });
}

function parseJson(raw) {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
