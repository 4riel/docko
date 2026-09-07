#!/usr/bin/env node
// docko-launcher-version: 0.1.0-alpha.16
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
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
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
  // An unknown session id is answered, not rejected, by the CLI, so a non-zero exit here is a
  // real failure. Retry with the CLI's own resolution once before failing open.
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
      writeJson({
        hookSpecificOutput: {
          hookEventName,
          permissionDecision: 'deny',
          permissionDecisionReason: buildDenyReason(cliOutput)
        }
      });
    }
    // On allow, emit nothing: docko only vetoes unauthorized slot writes, it does not
    // grant permission past the user's normal permission flow.
    return;
  }

  // session-start / subagent-start inject context and export the session id for later
  // Bash tool calls, so agents never have to invent one.
  exportSessionEnv(cliOutput.env);

  if (typeof cliOutput.additionalContext === 'string' && cliOutput.additionalContext.length > 0) {
    writeJson({
      hookSpecificOutput: {
        hookEventName,
        additionalContext: cliOutput.additionalContext
      }
    });
  }
}

// Claude Code exports every KEY=value line a SessionStart hook appends to $CLAUDE_ENV_FILE into
// the environment of the session's later tool calls. That is how DOCKO_SESSION_ID reaches an
// agent's own `docko` commands. Never throw: a failure here must not break the session.
function exportSessionEnv(env) {
  const envFile = process.env.CLAUDE_ENV_FILE;
  if (!envFile || !env || typeof env !== 'object') {
    return;
  }

  const lines = [];
  for (const [key, value] of Object.entries({ ...env, DOCKO_ROOT: dockoRoot })) {
    // Only well-formed names and single-line values: a hostile value must not be able to
    // inject additional variables into the session environment.
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || typeof value !== 'string' || /[\r\n]/.test(value)) {
      continue;
    }
    lines.push(`${key}=${value}`);
  }

  if (lines.length === 0) {
    return;
  }

  try {
    // Another hook may have left the file without a trailing newline; appending straight onto it
    // would fuse its last variable and our first one into a single unusable line.
    appendFileSync(envFile, `${envFileNeedsNewline(envFile) ? '\n' : ''}${lines.join('\n')}\n`, 'utf8');
  } catch (error) {
    process.stderr.write(`docko hook: could not write CLAUDE_ENV_FILE: ${error.message}\n`);
  }
}

function envFileNeedsNewline(envFile) {
  try {
    const existing = readFileSync(envFile, 'utf8');
    return existing.length > 0 && !existing.endsWith('\n');
  } catch {
    // Missing or unreadable: appendFileSync creates it, and there is nothing to run into.
    return false;
  }
}

// Stale windows are configurable down to a couple of seconds, and rounding those to "0m" told a
// blocked agent nothing. Seconds below a minute, minutes below an hour, hours above.
function formatDuration(milliseconds) {
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.round(minutes / 6) / 10;
  return `${hours}h`;
}

function quoteArgument(value) {
  return /\s/.test(value) ? `"${value}"` : value;
}

// Every deny names the slot, the reason, and one command that fixes it. The blocked agent has
// no other way to learn which session owns the slot or what to run next.
function buildDenyReason(cliOutput) {
  const rawSlotId = typeof cliOutput.resource_id === 'string' ? cliOutput.resource_id : null;
  const slotId = rawSlotId ?? 'this slot';
  const slotArg = quoteArgument(slotId);
  const sessionId = typeof cliOutput.session_id === 'string' ? cliOutput.session_id : null;
  const ownerSessionId = typeof cliOutput.owner_session_id === 'string' ? cliOutput.owner_session_id : null;
  const root = typeof cliOutput.workspace_root === 'string' ? cliOutput.workspace_root : dockoRoot;
  const rootArg = `--root ${quoteArgument(root)}`;
  const sessionArg = sessionId ? ` --session ${quoteArgument(sessionId)}` : '';
  const reason = typeof cliOutput.reason === 'string' ? cliOutput.reason : 'not-authorized';
  // A session docko never registered owns nothing, so every reason below is really "your
  // SessionStart hook did not run". Say so once, at the end, instead of per branch.
  const unknownSession =
    cliOutput.session_known === false && sessionId
      ? ` Note: session ${sessionId} is not registered with docko; the SessionStart hook did not run — start it with: docko session start ${rootArg} --session ${quoteArgument(sessionId)} --runtime claude-code`
      : '';

  // A slot directory whose name is not a valid docko id can never be claimed, so telling the
  // agent to claim it would loop forever. The only way out is renaming the directory.
  if (typeof cliOutput.invalid_slot_dir === 'string') {
    return (
      `docko blocked this write: ${cliOutput.invalid_slot_dir} is inside the managed slots tree but its directory name is not a valid docko id ` +
      `(letters, digits, underscore, dash, dot; no spaces and no ".."), so it can never be claimed. ` +
      `Rename the directory to a valid id, then run: docko status ${rootArg} --brief${unknownSession}`
    );
  }

  if (reason === 'claim-expired') {
    const expiredAt = typeof cliOutput.expired_at === 'string' ? ` at ${cliOutput.expired_at}` : '';
    const quiet =
      typeof cliOutput.claim_stale_after_ms === 'number'
        ? ` (no heartbeat for ${formatDuration(cliOutput.claim_stale_after_ms)})`
        : ' (no heartbeat before the stale window closed)';
    const branch = typeof cliOutput.owner_branch === 'string' ? cliOutput.owner_branch : '<branch>';
    const task = typeof cliOutput.owner_task === 'string' ? cliOutput.owner_task : '<task>';
    return (
      `docko blocked this write: your claim on ${slotId} expired${expiredAt}${quiet}. ` +
      `Re-claim it: docko claim ${rootArg}${sessionArg} --resource slot --id ${slotArg} --branch ${quoteArgument(branch)} --task "${task}"${unknownSession}`
    );
  }

  if (reason === 'slot-not-claimed') {
    const application =
      typeof cliOutput.application_id === 'string' ? ` --application ${quoteArgument(cliOutput.application_id)}` : '';
    const previousOwner =
      typeof cliOutput.previous_owner_session_id === 'string'
        ? ` It was last held by session ${cliOutput.previous_owner_session_id}.`
        : '';
    return (
      `docko blocked this write: ${slotId} is not claimed.${previousOwner} ` +
      `Claim it first: docko slot acquire ${rootArg}${sessionArg}${application} --prefer ${slotArg} --branch <branch> --task "<task>" --brief${unknownSession}`
    );
  }

  if (reason === 'unrelated-session') {
    const owner = ownerSessionId ? `session ${ownerSessionId}` : 'another session';
    const task = typeof cliOutput.owner_task === 'string' ? `task "${cliOutput.owner_task}", ` : '';
    const branch = typeof cliOutput.owner_branch === 'string' ? `branch ${cliOutput.owner_branch}, ` : '';
    const liveness =
      cliOutput.owner_session_active === true
        ? 'still active'
        : cliOutput.owner_session_active === false
          ? 'no longer active'
          : 'liveness unknown';
    return (
      `docko blocked this write: the slot ${slotId} is claimed by ${owner} (${task}${branch}${liveness}). ` +
      `Ask that session to release or delegate it, or run: docko release ${rootArg}${sessionArg} --resource slot --id ${slotArg} --force${unknownSession}`
    );
  }

  const owner = ownerSessionId ? ` (owner: ${ownerSessionId})` : '';
  return (
    `docko blocked this write: ${reason}${owner} on ${slotId}. ` +
    `Check ownership with: docko status ${rootArg} --brief --claimed${unknownSession}`
  );
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
