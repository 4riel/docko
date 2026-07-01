#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { access, appendFile, cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  DockoError,
  DockoService,
  assertSafeId,
  buildSessionStartMetadata,
  toErrorPayload,
  type AuthorizationResult,
  type ClaimOptions,
  type DelegateOptions,
  type EnsureApplicationOptions,
  type EnsureResourceOptions,
  type HeartbeatOptions,
  type RegistryResource,
  type ReleaseOptions,
  type SessionManifest,
  type SessionStartOptions,
  type StatusResult,
  type WorkspaceApplication
} from '@docko/core';
import {
  DEFAULT_CLAUDE_PLUGIN_DESTINATION,
  buildClaudeCodeSettingsFragment,
  installClaudeCodeAdapter,
  readClaudeCodeSnippet
} from '@docko/adapter-claude-code';

type OptionValue = string | boolean | string[];
type OptionMap = Record<string, OptionValue>;
type HandlerResult = unknown;
type Handler = () => Promise<HandlerResult>;
type InitMode = 'auto' | 'workspace' | 'repo';
type IntegrationTarget = 'claude' | 'codex';
const REPO_MARKERS = ['.git', 'package.json', 'pnpm-workspace.yaml', 'pyproject.toml', 'Cargo.toml', 'go.mod'];

interface ParsedArgs {
  command: string[];
  options: OptionMap;
}

interface CliContext {
  command: string[];
  options: OptionMap;
  root: string;
  service: DockoService;
  sessionEnv: string | null;
}

interface InitIntegrationConfig {
  enabled: boolean;
  inject: boolean;
  filePath: string | null;
}

interface InitCloneJob {
  sourcePath: string;
  slotId: string;
}

interface InitPromptConfig {
  claude: InitIntegrationConfig;
  codex: InitIntegrationConfig;
  cloneJobs: InitCloneJob[];
}

interface PromptSession {
  askText(label: string, defaultValue?: string | null): Promise<string>;
  askYesNo(label: string, defaultValue: boolean): Promise<boolean>;
  close(): void;
}

interface RootCheckResult {
  root: string;
  exists: boolean;
  parentExists: boolean;
  isDirectory: boolean;
  isEmpty: boolean;
  looksLikeRepo: boolean;
  looksLikeWorkspace: boolean;
  message: string;
}

interface CloneSourceDetails {
  sourcePath: string;
  entryCount: number;
  looksLikeRepo: boolean;
}

interface ApplicationSummary {
  application_id: string;
  name: string;
  description?: string | null;
  keywords?: string[];
  source_path?: string | null;
}

interface SlotResourceSummary {
  resource_type: string;
  resource_id: string;
  status: string;
  path?: string | null;
  application_id?: string | null;
  slot_name?: string | null;
}

interface BriefSlotCounts {
  total: number;
  free: number;
  claimed: number;
}

function parseArgs(argv: string[]): ParsedArgs {
  const command: string[] = [];
  const options: OptionMap = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      command.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      options[key] = true;
      continue;
    }

    const current = options[key];
    if (current) {
      const values = Array.isArray(current) ? current : [String(current)];
      values.push(next);
      options[key] = values;
    } else {
      options[key] = next;
    }
    index += 1;
  }

  return { command, options };
}

function option(options: OptionMap, key: string): string | null {
  const value = options[key];
  if (Array.isArray(value)) {
    return value.at(-1) ?? null;
  }

  return typeof value === 'string' ? value : null;
}

function optionList(options: OptionMap, key: string): string[] {
  const value = options[key];
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string');
  }

  return typeof value === 'string' ? [value] : [];
}

function qualifySlotResourceId(applicationId: string | null | undefined, slotName: string): string {
  return applicationId ? `${applicationId}.${slotName}` : slotName;
}

function parseQualifiedSlotId(rawValue: string): { applicationId: string; slotName: string } | null {
  if (rawValue.includes(path.sep) || rawValue.includes('/') || rawValue.includes('\\')) {
    return null;
  }

  const separatorIndex = rawValue.indexOf('.');
  if (separatorIndex <= 0 || separatorIndex === rawValue.length - 1) {
    return null;
  }

  return {
    applicationId: rawValue.slice(0, separatorIndex),
    slotName: rawValue.slice(separatorIndex + 1)
  };
}

function resolveManagedSlotPath(root: string, slotName: string, applicationId?: string | null): string {
  return applicationId
    ? path.join(root, 'slots', applicationId, slotName)
    : path.join(root, 'slots', slotName);
}

function buildDefaultApplicationName(applicationId: string): string {
  return applicationId
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ') || applicationId;
}

async function readJsonStdin(): Promise<Record<string, unknown>> {
  if (process.stdin.isTTY) {
    return {};
  }

  return new Promise((resolve) => {
    let settled = false;
    let raw = '';

    const finish = (): void => {
      if (settled) {
        return;
      }

      settled = true;
      try {
        resolve(raw.trim() ? (JSON.parse(raw) as Record<string, unknown>) : {});
      } catch {
        resolve({});
      }
    };

    const timer = setTimeout(finish, 25);
    timer.unref();

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      raw += chunk;
    });
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
    process.stdin.resume();
  });
}

function printJson(payload: unknown, pretty = true): void {
  process.stdout.write(`${JSON.stringify(payload, null, pretty ? 2 : 0)}\n`);
}

function printText(text: string): void {
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
}

function getVersion(): string {
  const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
  return pkg.version;
}

function printHelp(): void {
  const help = `docko — runtime-agnostic workspace docking for AI coding agents

Usage: docko <command> [options]

Commands:
  init                              Initialize workspace and discover slots
  app ensure                        Register an application and optionally seed its slot set
  slot acquire                      Claim a free slot or clone one when all are busy
  slot duplicate                    Duplicate a repo or slot into a managed slot
  status                            Show resource status
  logs                              Show recent debug log entries
  claim                             Claim a resource for a session
  heartbeat                         Update claim heartbeat timestamp
  release                           Release a claimed resource
  delegate                          Grant resource authority to a child session
  render                            Re-render the registry mirror
  resource ensure                   Register or update a resource
  session start                     Start a new session
  session end                       End a session and release its claims
  session current                   Show or resolve the current session
  session list                      List active sessions
  adapter claude-code install       Install Claude Code adapter assets
  adapter claude-code settings      Print Claude Code settings fragment
  adapter claude-code session-start Start a Claude Code session (hook)
  adapter claude-code session-end   End a Claude Code session (hook)
  adapter claude-code pre-tool-use  Authorize a file write (hook)
  adapter claude-code subagent-start  Start a delegated subagent (hook)

Global options:
  --root <path>       Workspace root (default: DOCKO_ROOT env or cwd)
  --session <id>      Session ID (default: DOCKO_SESSION_ID env or auto-resolve)
  --brief             Return an agent-friendly compact payload for supported commands
  --help              Show this help message

Log options:
  --days <n>          Number of recent days to show (max retained: 3)
  --limit <n>         Maximum number of log entries to return

Init options:
  --mode <mode>       Scaffold mode: auto | workspace | repo (default: auto)
  --slot <id>         Create a starter slot directory. Repeatable.
  --slot-stale-after-ms <n>  Set the default stale timeout for slot claims in this workspace
  --claude            Install Claude Code adapter assets during init
  --codex             Prepare Codex onboarding during init
  --json              Force JSON output for init, even in interactive mode
  --inject-claude     Inject docko guidance into CLAUDE.md
  --inject-codex      Inject docko guidance into AGENTS.md
  --claude-file <p>   Target CLAUDE.md path for injected guidance
  --agents-file <p>   Target AGENTS.md path for injected guidance
  --existing          Guided init for an already-existing set of clones or slots
  --clone-source <p>  Duplicate an existing repo or clone into a managed slot
  --clone-slot <id>   Target slot id for --clone-source (default: first starter slot)
  --prompt            Force the interactive onboarding flow, even outside a normal TTY
  --force             Overwrite managed Claude files when used with --claude

Application options:
  --application <id>  Application id for slot acquire or slot duplicate
  --name <text>       Human-friendly application name for app ensure
  --description <t>   Application description for app ensure
  --keyword <value>   Application keyword. Repeatable.
  --source <path>     Source repo or clone to seed application slots
  --slots <n>         Number of generated application slots
  --slot-base <id>    Base slot name when generating application slots (default: main)

Slot acquire options:
  --clone-when-busy   Duplicate and claim a fresh managed slot when none are free
  --clone-from <p>    Source slot or path for the busy-slot clone fallback
  --clone-slot <id>   Preferred slot id for the busy-slot clone fallback
`;
  process.stdout.write(help);
}

function workspaceRoot(options: OptionMap): string {
  return option(options, 'root') ?? process.env.DOCKO_ROOT ?? process.cwd();
}

function hasRegistryAt(dir: string): boolean {
  return existsSync(path.join(dir, 'docko', 'registry.json'));
}

// Walk up from a starting directory until a docko/registry.json is found, like git locating .git.
// Returns the nearest ancestor (inclusive) that owns a registry, or null when none exists.
function findWorkspaceRoot(startDir: string): string | null {
  let dir = path.resolve(startDir);
  while (true) {
    if (hasRegistryAt(dir)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

// True when `candidate` is the workspace's slots/ directory or any path beneath it.
function isPathInsideSlots(workspaceRootPath: string, candidate: string): boolean {
  const slotsDir = path.resolve(workspaceRootPath, 'slots');
  const relative = path.relative(slotsDir, path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

// Resolve the workspace root a command should operate on. The starting point is still
// --root / DOCKO_ROOT / cwd, but when that points below a real workspace we resolve UP to the
// owning root so docko never fragments its state into a slot. `init` is exempt because it
// legitimately scaffolds a fresh workspace at the given location.
function resolveWorkspaceRoot(command: string[], options: OptionMap): string {
  const startDir = path.resolve(workspaceRoot(options));
  if (command[0] === 'init') {
    return startDir;
  }

  if (hasRegistryAt(startDir)) {
    return startDir;
  }

  const ancestorRoot = findWorkspaceRoot(startDir);
  if (!ancestorRoot) {
    return startDir;
  }

  // An explicit --root pointing inside a managed slot is a mistake: fail loud instead of
  // silently leaking a registry into the slot. An implicit cwd inside a slot is resolved up.
  if (option(options, 'root') !== null && isPathInsideSlots(ancestorRoot, startDir)) {
    throw new DockoError(
      `--root points inside a managed slot (${toDisplayPath(startDir)}). Run docko against the workspace root instead (${toDisplayPath(ancestorRoot)}).`,
      'ROOT_INSIDE_SLOT',
      1,
      { provided_root: startDir, workspace_root: ancestorRoot }
    );
  }

  return ancestorRoot;
}

function requiredOption(options: OptionMap, key: string): string {
  const value = option(options, key);
  if (!value) {
    throw new DockoError(`Missing required option --${key}.`, 'USAGE_ERROR', 1, { option: key });
  }

  return value;
}

function parsePositiveInt(raw: string | null, label: string): number | undefined {
  if (raw === null) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new DockoError(`--${label} must be a positive integer.`, 'USAGE_ERROR', 1, { option: label, value: raw });
  }
  return value;
}

function parseEnum<T extends string>(raw: string, allowed: readonly T[], label: string): T {
  if (!allowed.includes(raw as T)) {
  throw new DockoError(
      `--${label} must be one of: ${allowed.join(', ')}`,
      'USAGE_ERROR',
      1,
      { option: label, value: raw, allowed: [...allowed] }
    );
  }
  return raw as T;
}

function extractHookFilePath(payload: Record<string, unknown>): string | null {
  if (typeof payload.file_path === 'string') {
    return payload.file_path;
  }

  if (payload.tool_input && typeof payload.tool_input === 'object') {
    const filePath = (payload.tool_input as Record<string, unknown>).file_path;
    if (typeof filePath === 'string') {
      return filePath;
    }
  }

  return null;
}

const INJECTION_MARKERS: Record<IntegrationTarget, { start: string; end: string }> = {
  claude: {
    start: '<!-- docko:begin:claude -->',
    end: '<!-- docko:end:claude -->'
  },
  codex: {
    start: '<!-- docko:begin:codex -->',
    end: '<!-- docko:end:codex -->'
  }
};

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function normalizeRelativePath(targetPath: string): string {
  return targetPath.split(path.sep).join('/');
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

async function ensureDirectory(targetPath: string, created: string[], root: string): Promise<void> {
  if (!(await pathExists(targetPath))) {
    await mkdir(targetPath, { recursive: true });
    created.push(normalizeRelativePath(path.relative(root, targetPath)));
    return;
  }

  await mkdir(targetPath, { recursive: true });
}

async function listDirectories(targetPath: string): Promise<string[]> {
  try {
    const entries = await readdir(targetPath, { withFileTypes: true });
    const names: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        names.push(entry.name);
      } else if (entry.isSymbolicLink()) {
        try {
          const resolved = await stat(path.join(targetPath, entry.name));
          if (resolved.isDirectory()) {
            names.push(entry.name);
          }
        } catch {
          // Broken link — skip.
        }
      }
    }
    return names.sort();
  } catch {
    return [];
  }
}

async function isDirectory(targetPath: string): Promise<boolean> {
  try {
    return (await stat(targetPath)).isDirectory();
  } catch {
    return false;
  }
}

async function detectInstructionFile(root: string, filename: string): Promise<string | null> {
  const preferredDirectories =
    filename === 'CLAUDE.md'
      ? ['', '.claude', 'docs']
      : filename === 'AGENTS.md'
        ? ['', 'docs', '.claude']
        : [''];
  const candidates = preferredDirectories.map((directory) =>
    directory ? path.join(root, directory, filename) : path.join(root, filename)
  );

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

function toDisplayPath(targetPath: string): string {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedCwd = path.resolve(process.cwd());
  if (path.parse(resolvedTarget).root === path.parse(resolvedCwd).root) {
    const relativeToCwd = path.relative(resolvedCwd, resolvedTarget);
    if (!relativeToCwd) {
      return '.';
    }
    return normalizeRelativePath(relativeToCwd);
  }

  return targetPath;
}

function toWorkspaceDisplayPath(root: string, targetPath: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(targetPath);

  if (path.parse(resolvedRoot).root === path.parse(resolvedTarget).root) {
    const relativeToRoot = path.relative(resolvedRoot, resolvedTarget);
    if (relativeToRoot && !relativeToRoot.startsWith('..') && !path.isAbsolute(relativeToRoot)) {
      return normalizeRelativePath(relativeToRoot);
    }
  }

  return toDisplayPath(targetPath);
}

function buildPathExamples(targetPaths: string[]): string[] {
  return uniqueStrings(targetPaths.map((targetPath) => toDisplayPath(targetPath)));
}

function buildInstructionExamples(root: string, filename: string): string[] {
  if (filename === 'CLAUDE.md') {
    return buildPathExamples([
      path.join(root, 'CLAUDE.md'),
      path.join(root, '.claude', 'CLAUDE.md'),
      path.resolve(process.cwd(), 'CLAUDE.md')
    ]);
  }

  if (filename === 'AGENTS.md') {
    const workspaceExamples = [
      toDisplayPath(path.join(root, 'AGENTS.md')),
      toDisplayPath(path.join(root, 'docs', 'AGENTS.md'))
    ];
    const prefersRootRelativeExamples = workspaceExamples.some((example) => example.startsWith('../'));

    if (prefersRootRelativeExamples) {
      return ['AGENTS.md', 'docs/AGENTS.md'];
    }

    return uniqueStrings([
      ...workspaceExamples,
      'AGENTS.md'
    ]);
  }

  return buildPathExamples([path.join(root, filename), path.resolve(process.cwd(), filename)]);
}

function buildCloneSourceExamples(root: string): string[] {
  return buildPathExamples([
    process.cwd(),
    path.join(path.dirname(process.cwd()), 'my-app'),
    path.join(path.dirname(root), 'my-app')
  ]);
}

function buildExistingCloneExamples(root: string): string[] {
  return buildPathExamples([
    path.join(path.dirname(process.cwd()), 'my-app-clone-1'),
    path.join(path.dirname(root), 'my-app-clone-1'),
    path.join(path.dirname(root), 'my-app-clone-2')
  ]);
}

async function inspectCloneSource(sourcePath: string): Promise<CloneSourceDetails> {
  const entries = await readdir(sourcePath);
  return {
    sourcePath,
    entryCount: entries.length,
    looksLikeRepo: await looksLikeRepoDirectory(sourcePath)
  };
}

async function looksLikeRepoDirectory(targetPath: string): Promise<boolean> {
  return (await Promise.all(REPO_MARKERS.map((marker) => pathExists(path.join(targetPath, marker))))).some(Boolean);
}

async function validateCloneSourceDirectory(sourcePath: string): Promise<string | null> {
  const entries = await readdir(sourcePath);
  if (entries.length === 0) {
    return `I found ${toDisplayPath(sourcePath)}, but it does not contain any files or folders yet. Point me at an existing repo or clone.`;
  }

  return null;
}

async function resolveDirectoryInput(root: string, rawPath: string): Promise<string | null> {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return null;
  }

  const candidates = path.isAbsolute(trimmed)
    ? [path.resolve(trimmed)]
    : [path.resolve(process.cwd(), trimmed), resolveWorkspacePath(root, trimmed)];

  for (const candidate of [...new Set(candidates)]) {
    if (await isDirectory(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function resolveCloneSourceInput(root: string, rawPath: string, flagName = '--clone-source'): Promise<string> {
  const resolved = await resolveDirectoryInput(root, rawPath);
  if (!resolved) {
    throw new DockoError(`${flagName} must point to an existing non-empty folder.`, 'SOURCE_NOT_FOUND', 1, {
      source: rawPath
    });
  }

  const validationError = await validateCloneSourceDirectory(resolved);
  if (validationError) {
    throw new DockoError(validationError, 'SOURCE_EMPTY', 1, {
      source: rawPath,
      resolved_source: resolved
    });
  }

  return resolved;
}

function sanitizeSlotId(input: string): string {
  const sanitized = input
    .trim()
    .replace(/[^\w.-]+/g, '_')
    .replace(/^\.+/, '')
    .replace(/_+/g, '_')
    .replace(/-+/g, '-')
    .replace(/\.\.+/g, '.')
    .replace(/^[^A-Za-z0-9_]+/, '');

  return sanitized || 'slot';
}

function allocateSlotId(base: string, used: Set<string>): string {
  const normalizedBase = sanitizeSlotId(base);
  let candidate = normalizedBase;
  let counter = 2;

  while (used.has(candidate)) {
    candidate = `${normalizedBase}_${counter}`;
    counter += 1;
  }

  assertSafeId(candidate, 'slot');
  used.add(candidate);
  return candidate;
}

function buildCloneSlotIds(base: string, count: number, used: Set<string>): string[] {
  const normalizedBase = sanitizeSlotId(base);
  if (count <= 1) {
    return [allocateSlotId(normalizedBase, used)];
  }

  return Array.from({ length: count }, (_, index) => allocateSlotId(`${normalizedBase}_${index + 1}`, used));
}

function parsePositivePromptCount(rawValue: string, label: string): number {
  const value = Number(rawValue.trim());
  if (!Number.isInteger(value) || value <= 0) {
    throw new DockoError(`${label} must be a whole number greater than 0.`, 'USAGE_ERROR', 1, {
      value: rawValue
    });
  }

  return value;
}

async function promptExistingDirectory(
  session: PromptSession,
  root: string,
  label: string,
  defaultValue: string | null,
  examples: string[],
  allowBlank = true
): Promise<string | null> {
  let currentDefault = defaultValue;

  while (true) {
    process.stderr.write(`Examples: ${examples.join(', ')}\n`);
    const answer = await promptText(session, label, currentDefault);
    if (!answer.trim()) {
      return allowBlank ? null : currentDefault;
    }

    const resolved = await resolveDirectoryInput(root, answer);
    if (resolved) {
      const validationError = await validateCloneSourceDirectory(resolved);
      if (validationError) {
        process.stderr.write(`${validationError}\n`);
        currentDefault = answer;
        continue;
      }
      return resolved;
    }

    process.stderr.write(`I couldn't find a folder at ${answer}. Please try again.\n`);
    currentDefault = answer;
  }
}

function renderCloneSourceDetails(details: CloneSourceDetails): string {
  const displaySource = toDisplayPath(details.sourcePath);
  if (details.looksLikeRepo) {
    return `Using source repository: ${displaySource}\nI found ${details.entryCount} item${details.entryCount === 1 ? '' : 's'} there and it looks like a repo root.\n`;
  }

  return `Using source folder: ${displaySource}\nI found ${details.entryCount} item${details.entryCount === 1 ? '' : 's'} there, but it does not look like a repo root yet.\n`;
}

async function promptConfirmedCloneSource(
  session: PromptSession,
  root: string,
  defaultValue: string | null,
  examples: string[]
): Promise<string | null> {
  let currentDefault = defaultValue;

  while (true) {
    const sourcePath = await promptExistingDirectory(
      session,
      root,
      'Where is the primary repository with your source code? Leave blank to skip',
      currentDefault,
      examples
    );

    if (!sourcePath) {
      return null;
    }

    const details = await inspectCloneSource(sourcePath);
    process.stderr.write(renderCloneSourceDetails(details));
    const confirmed = await promptYesNo(session, 'Use this folder as the source repository?', true);
    if (confirmed) {
      return sourcePath;
    }

    process.stderr.write('Okay, let’s try a different source path.\n');
    currentDefault = toDisplayPath(sourcePath);
  }
}

async function promptExistingDirectoryList(
  session: PromptSession,
  root: string,
  label: string,
  examples: string[]
): Promise<string[]> {
  let currentDefault = '';

  while (true) {
    process.stderr.write(`Examples: ${examples.join(', ')}\n`);
    const answer = await promptText(session, label, currentDefault);
    if (!answer.trim()) {
      return [];
    }

    const rawParts = answer
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);

    const resolvedPaths: string[] = [];
    const missingPaths: string[] = [];
    const emptyPaths: string[] = [];

    for (const part of rawParts) {
      const resolved = await resolveDirectoryInput(root, part);
      if (resolved) {
        if ((await validateCloneSourceDirectory(resolved)) === null) {
          resolvedPaths.push(resolved);
        } else {
          emptyPaths.push(part);
        }
      } else {
        missingPaths.push(part);
      }
    }

    if (missingPaths.length === 0 && emptyPaths.length === 0) {
      return [...new Set(resolvedPaths)];
    }

    if (missingPaths.length > 0) {
      process.stderr.write(
        `I couldn't find these clone folders: ${missingPaths.join(', ')}. Please use full paths or paths relative to the current terminal folder.\n`
      );
    }
    if (emptyPaths.length > 0) {
      process.stderr.write(
        `These clone folders are empty and cannot seed managed slots yet: ${emptyPaths.join(', ')}.\n`
      );
    }
    currentDefault = answer;
  }
}

async function inspectRoot(root: string): Promise<RootCheckResult> {
  const resolvedRoot = path.resolve(root);
  const rootExists = await pathExists(resolvedRoot);
  const parentPath = path.dirname(resolvedRoot);
  const parentExists = await pathExists(parentPath);
  const rootIsDirectory = rootExists ? await isDirectory(resolvedRoot) : true;
  const rootIsEmpty = rootExists && rootIsDirectory ? await isDirectoryEmpty(resolvedRoot) : false;
  const looksLikeRepo = rootExists ? await looksLikeRepoDirectory(resolvedRoot) : false;
  const looksLikeWorkspace = rootExists && rootIsDirectory ? await pathExists(path.join(resolvedRoot, 'docko')) : false;

  let message = '';
  if (!parentExists) {
    message = `Root check: parent folder does not exist yet for ${resolvedRoot}.`;
  } else if (!rootExists) {
    message = `Root check: ${resolvedRoot} does not exist yet. docko will create it.`;
  } else if (!rootIsDirectory) {
    message = `Root check: ${resolvedRoot} exists but is not a directory.`;
  } else if (looksLikeWorkspace) {
    message = `Root check: found an existing docko workspace at ${resolvedRoot}.`;
  } else if (looksLikeRepo) {
    message = `Root check: ${resolvedRoot} looks like a repo root. docko will use repo mode defaults.`;
  } else if (rootIsEmpty) {
    message = `Root check: ${resolvedRoot} exists and is empty. docko will scaffold a fresh workspace.`;
  } else {
    message = `Root check: ${resolvedRoot} exists and is non-empty. docko will add workspace files beside the current contents.`;
  }

  return {
    root: resolvedRoot,
    exists: rootExists,
    parentExists,
    isDirectory: rootIsDirectory,
    isEmpty: rootIsEmpty,
    looksLikeRepo,
    looksLikeWorkspace,
    message
  };
}

async function isDirectoryEmpty(targetPath: string): Promise<boolean> {
  const entries = await readdir(targetPath);
  return entries.length === 0;
}

function resolveWorkspacePath(root: string, rawPath: string): string {
  return path.isAbsolute(rawPath) ? path.resolve(rawPath) : path.resolve(root, rawPath);
}

function promptEnabled(options: OptionMap): boolean {
  return Boolean(options.prompt) || process.stdin.isTTY;
}

function colorize(text: string, code: string): string {
  if (!process.stderr.isTTY) {
    return text;
  }

  return `\u001b[${code}m${text}\u001b[0m`;
}

function bold(text: string): string {
  return colorize(text, '1');
}

function cyan(text: string): string {
  return colorize(text, '36');
}

function green(text: string): string {
  return colorize(text, '32');
}

function dim(text: string): string {
  return colorize(text, '2');
}

function renderInitIntro(root: string): string {
  const displayRoot = toDisplayPath(root);
  const logo = [
    '=============================================',
    '||   ____   ___   ____ _  __  ___          ||',
    '||  |  _ \\ / _ \\ / ___| |/ / / _ \\         ||',
    "||  | | | | | | | |   | ' / | | | |        ||",
    '||  | |_| | |_| | |___| . \\ | |_| |        ||',
    '||  |____/ \\___/ \\____|_|\\_\\\\___/         ||',
    '============================================='
  ];
  const lines = [
    green(logo.join('\n')),
    '',
    `${bold('docko init')}`,
    `${green('Workspace-first onboarding for Claude, Codex, and persistent clone slots.')}`,
    '',
    'How it works:',
    '  1. docko creates one stable workspace root.',
    '  2. Your writable repos live in managed slots under `slots/`.',
    '  3. Claude hooks and AGENTS.md guidance can teach runtimes to claim slots before writing.',
    '  4. The registry tracks ownership so agent work stays boring and inspectable.',
    '',
    `Workspace root: ${displayRoot}`,
    dim('Press Enter to accept the default shown in brackets.')
  ];

  return `${lines.join('\n')}\n\n`;
}

async function promptText(
  session: PromptSession,
  label: string,
  defaultValue: string | null = null
): Promise<string> {
  return session.askText(label, defaultValue);
}

async function promptYesNo(
  session: PromptSession,
  label: string,
  defaultValue: boolean
): Promise<boolean> {
  return session.askYesNo(label, defaultValue);
}

function createTTYPromptSession(rl: Pick<ReturnType<typeof createInterface>, 'question' | 'close'>): PromptSession {
  return {
    async askText(label: string, defaultValue: string | null = null): Promise<string> {
      const suffix = defaultValue !== null && defaultValue !== '' ? ` [${defaultValue}]` : '';
      const answer = (await rl.question(`${label}${suffix}: `)).trim();
      return answer || defaultValue || '';
    },
    async askYesNo(label: string, defaultValue: boolean): Promise<boolean> {
      const suffix = defaultValue ? ' [Y/n]' : ' [y/N]';
      const answer = await rl.question(`${label}${suffix}: `);
      return parseYesNoAnswer(answer, defaultValue);
    },
    close(): void {
      rl.close();
    }
  };
}

async function readPromptAnswers(): Promise<string[]> {
  return new Promise((resolve) => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      raw += chunk;
    });
    process.stdin.on('end', () => {
      resolve(raw.split(/\r?\n/));
    });
    process.stdin.on('error', () => {
      resolve([]);
    });
    process.stdin.resume();
  });
}

function parseYesNoAnswer(answer: string, defaultValue: boolean): boolean {
  const normalized = answer.trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }

  if (['y', 'yes'].includes(normalized)) {
    return true;
  }

  if (['n', 'no'].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

async function createPromptSession(): Promise<PromptSession> {
  if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    return createTTYPromptSession(rl);
  }

  const answers = await readPromptAnswers();
  let cursor = 0;

  return {
    async askText(label: string, defaultValue: string | null = null): Promise<string> {
      const suffix = defaultValue !== null && defaultValue !== '' ? ` [${defaultValue}]` : '';
      process.stderr.write(`${label}${suffix}: `);
      const answer = (answers[cursor] ?? '').trim();
      cursor += 1;
      process.stderr.write('\n');
      return answer || defaultValue || '';
    },
    async askYesNo(label: string, defaultValue: boolean): Promise<boolean> {
      const suffix = defaultValue ? ' [Y/n]' : ' [y/N]';
      process.stderr.write(`${label}${suffix}: `);
      const answer = answers[cursor] ?? '';
      cursor += 1;
      process.stderr.write('\n');
      return parseYesNoAnswer(answer, defaultValue);
    },
    close(): void {
      // No-op for buffered prompt answers.
    }
  };
}

async function collectInitPromptConfig(
  context: CliContext,
  rootCheck: RootCheckResult,
  sessionOverride: PromptSession | null = null
): Promise<InitPromptConfig> {
  const defaultClaudeEnabled = Boolean(context.options.claude || context.options['inject-claude']);
  const defaultCodexEnabled = Boolean(context.options.codex || context.options['inject-codex']);
  const defaultClaudeFile = option(context.options, 'claude-file') ?? 'CLAUDE.md';
  const defaultAgentsFile = option(context.options, 'agents-file') ?? 'AGENTS.md';
  const defaultCloneSource = option(context.options, 'clone-source');
  const defaultCloneSlot = option(context.options, 'clone-slot') ?? optionList(context.options, 'slot')[0] ?? 'main';

  if (!promptEnabled(context.options)) {
    const cloneJobs =
      defaultCloneSource
        ? [
            {
              sourcePath: await resolveCloneSourceInput(context.root, defaultCloneSource),
              slotId: defaultCloneSlot
            }
          ]
        : [];

    return {
      claude: {
        enabled: defaultClaudeEnabled,
        inject: Boolean(context.options['inject-claude']),
        filePath: defaultClaudeEnabled ? resolveWorkspacePath(context.root, defaultClaudeFile) : null
      },
      codex: {
        enabled: defaultCodexEnabled,
        inject: Boolean(context.options['inject-codex']),
        filePath: defaultCodexEnabled ? resolveWorkspacePath(context.root, defaultAgentsFile) : null
      },
      cloneJobs
    };
  }

  process.stderr.write(renderInitIntro(context.root));
  process.stderr.write(`${formatInitRootCheckMessage(rootCheck)}\n`);

  if (!rootCheck.parentExists) {
    process.stderr.write(
      `Please check the root path you typed and try again.\nExample: ${toDisplayPath(path.join(path.dirname(rootCheck.root), 'docko-workspace'))}\n`
    );
    throw new DockoError(
      'The parent directory for --root does not exist. Check the path you typed.',
      'ROOT_PARENT_NOT_FOUND',
      1,
      { root: rootCheck.root }
    );
  }

  if (!rootCheck.isDirectory) {
    throw new DockoError('The --root path must point to a directory.', 'ROOT_NOT_DIRECTORY', 1, {
      root: rootCheck.root
    });
  }

  const session = sessionOverride ?? (await createPromptSession());

  try {
    if (!rootCheck.exists) {
      const proceed = await promptYesNo(session, 'Use this root path?', true);
      if (!proceed) {
        throw new DockoError('Cancelled because the root path was not confirmed.', 'INIT_CANCELLED', 1, {
          root: rootCheck.root
        });
      }
      process.stderr.write('\n');
    }

    const claudeEnabled = await promptYesNo(session, 'Set up Claude Code integration?', defaultClaudeEnabled);
    const codexEnabled = await promptYesNo(session, 'Set up Codex / AGENTS.md guidance?', defaultCodexEnabled);

    let claudeFilePath: string | null = null;
    let injectClaude = Boolean(context.options['inject-claude']);
    if (claudeEnabled) {
      const detectedClaudeFile =
        option(context.options, 'claude-file') !== null
          ? resolveWorkspacePath(context.root, option(context.options, 'claude-file')!)
          : await detectInstructionFile(context.root, 'CLAUDE.md');

      if (detectedClaudeFile) {
        process.stderr.write(`Found CLAUDE.md at ${toDisplayPath(detectedClaudeFile)}.\n`);
        claudeFilePath = detectedClaudeFile;
      } else {
        const claudeExamples = buildInstructionExamples(context.root, 'CLAUDE.md');
        process.stderr.write(
          `I couldn't find CLAUDE.md automatically.\nExamples: ${claudeExamples.join(', ')}\n`
        );
        const rawClaudeFile = await promptText(session, 'Where should I read or write CLAUDE.md?', defaultClaudeFile);
        claudeFilePath = resolveWorkspacePath(context.root, rawClaudeFile);
      }
      injectClaude = await promptYesNo(session, 'Can I inject the docko Claude instructions there?', injectClaude || true);
    }

    let agentsFilePath: string | null = null;
    let injectCodex = Boolean(context.options['inject-codex']);
    if (codexEnabled) {
      const detectedAgentsFile =
        option(context.options, 'agents-file') !== null
          ? resolveWorkspacePath(context.root, option(context.options, 'agents-file')!)
          : await detectInstructionFile(context.root, 'AGENTS.md');

      if (detectedAgentsFile) {
        process.stderr.write(`Found AGENTS.md at ${toDisplayPath(detectedAgentsFile)}.\n`);
        agentsFilePath = detectedAgentsFile;
      } else {
        const agentsExamples = buildInstructionExamples(context.root, 'AGENTS.md');
        process.stderr.write(
          `I couldn't find AGENTS.md automatically.\nExamples: ${agentsExamples.join(', ')}\n`
        );
        const rawAgentsFile = await promptText(session, 'Where should I read or write AGENTS.md?', defaultAgentsFile);
        agentsFilePath = resolveWorkspacePath(context.root, rawAgentsFile);
      }
      injectCodex = await promptYesNo(session, 'Can I inject the docko Codex instructions there?', injectCodex || true);
    }

  const cloneJobs: InitCloneJob[] = [];
  const usedSlotIds = new Set(optionList(context.options, 'slot').map((slotId) => sanitizeSlotId(slotId)));
  const cloneSourceExamples = buildCloneSourceExamples(context.root);
  const existingCloneExamples = buildExistingCloneExamples(context.root);
  const existingMode = Boolean(context.options.existing);

  process.stderr.write('\nClone setup:\n');
    if (existingMode) {
      process.stderr.write(
        'You said this workspace already has clones or slots. List the folders you want docko to import as managed slots.\n'
      );
      const existingClonePaths = await promptExistingDirectoryList(
        session,
        context.root,
        'List the existing clone folders, comma-separated',
        existingCloneExamples
      );

      for (const existingClonePath of existingClonePaths) {
        cloneJobs.push({
          sourcePath: existingClonePath,
          slotId: allocateSlotId(path.basename(existingClonePath), usedSlotIds)
        });
      }
    } else {
      process.stderr.write(
        'Point me at the primary repository first. I will show relative paths when they make sense here, and absolute paths when they do not.\n'
      );
      process.stderr.write('Then I can create fresh managed clones under `slots/`.\n');

      const originalRepository = await promptConfirmedCloneSource(session, context.root, defaultCloneSource ?? '', cloneSourceExamples);

      if (originalRepository) {
        let cloneCount = 1;
        while (true) {
          const rawCloneCount = await promptText(session, 'How many managed clones should I create from that primary repo?', '1');
          try {
            cloneCount = parsePositivePromptCount(rawCloneCount, 'Managed clone count');
            break;
          } catch (error: unknown) {
            if (!(error instanceof DockoError)) {
              throw error;
            }
            process.stderr.write(`${error.message}\n`);
          }
        }

        const generatedSlots = buildCloneSlotIds(buildCloneSlotBase(originalRepository), cloneCount, usedSlotIds);
        for (const slotId of generatedSlots) {
          cloneJobs.push({
            sourcePath: originalRepository,
            slotId
          });
        }
      }
    }

    process.stderr.write('\n');

    return {
      claude: {
        enabled: claudeEnabled,
        inject: injectClaude,
        filePath: claudeFilePath
      },
      codex: {
        enabled: codexEnabled,
        inject: injectCodex,
        filePath: agentsFilePath
      },
      cloneJobs
    };
  } finally {
    session.close();
  }
}

async function resolveInitMode(root: string, requestedMode: InitMode): Promise<Exclude<InitMode, 'auto'>> {
  if (requestedMode !== 'auto') {
    return requestedMode;
  }

  for (const marker of REPO_MARKERS) {
    if (await pathExists(path.join(root, marker))) {
      return 'repo';
    }
  }

  return 'workspace';
}

async function scaffoldWorkspace(
  root: string,
  mode: Exclude<InitMode, 'auto'>,
  requestedSlots: string[],
  reservedSlots: string[] = []
): Promise<{ created: string[]; slots: string[] }> {
  void mode;
  const created: string[] = [];
  const baseDirectories = ['slots'];

  for (const relativePath of baseDirectories) {
    await ensureDirectory(path.join(root, relativePath), created, root);
  }

  const uniqueSlots = [...new Set(requestedSlots)];
  for (const slotId of uniqueSlots) {
    assertSafeId(slotId, 'slot');
  }

  const slotsRoot = path.join(root, 'slots');
  const existingSlots = await listDirectories(slotsRoot);
  const starterSlots = uniqueSlots.length > 0 ? uniqueSlots : existingSlots.length > 0 ? existingSlots : ['main'];
  const reserved = new Set(reservedSlots);

  for (const slotId of uniqueSlots.length > 0 ? uniqueSlots : existingSlots.length > 0 ? [] : ['main']) {
    if (reserved.has(slotId)) {
      continue;
    }
    await ensureDirectory(path.join(slotsRoot, slotId), created, root);
  }

  return { created, slots: starterSlots };
}

async function copyDirectoryContents(sourcePath: string, targetPath: string): Promise<void> {
  await mkdir(targetPath, { recursive: true });
  const entries = await readdir(sourcePath, { withFileTypes: true });
  for (const entry of entries) {
    await cp(path.join(sourcePath, entry.name), path.join(targetPath, entry.name), {
      recursive: true,
      force: false,
      errorOnExist: true
    });
  }
}

async function resolveDuplicateSource(
  root: string,
  rawSource: string,
  applicationId: string | null = null
): Promise<{ source_path: string; source_kind: 'slot' | 'path' }> {
  const slotCandidates: string[] = [];
  if (!rawSource.includes(path.sep) && !rawSource.includes('/') && !rawSource.includes('\\')) {
    if (applicationId) {
      slotCandidates.push(resolveManagedSlotPath(root, rawSource, applicationId));
    }

    const qualified = parseQualifiedSlotId(rawSource);
    if (qualified) {
      slotCandidates.push(resolveManagedSlotPath(root, qualified.slotName, qualified.applicationId));
    }

    slotCandidates.push(path.join(root, 'slots', rawSource));
  }

  for (const slotCandidate of [...new Set(slotCandidates)]) {
    if (await isDirectory(slotCandidate)) {
      return { source_path: slotCandidate, source_kind: 'slot' };
    }
  }

  const workspaceResolved = resolveWorkspacePath(root, rawSource);
  if (await isDirectory(workspaceResolved)) {
    return { source_path: workspaceResolved, source_kind: 'path' };
  }

  const cwdResolved = path.resolve(process.cwd(), rawSource);
  if (cwdResolved !== workspaceResolved && (await isDirectory(cwdResolved))) {
    return { source_path: cwdResolved, source_kind: 'path' };
  }

  throw new DockoError('Source clone or slot directory not found.', 'SOURCE_NOT_FOUND', 1, { source: rawSource });
}

async function duplicateSlotDirectory(
  root: string,
  rawSource: string,
  targetSlotName: string,
  applicationId: string | null = null
): Promise<Record<string, unknown>> {
  assertSafeId(targetSlotName, 'slot');
  if (applicationId) {
    assertSafeId(applicationId, 'application');
  }

  const { source_path: sourcePath, source_kind: sourceKind } = await resolveDuplicateSource(root, rawSource, applicationId);
  const targetPath = resolveManagedSlotPath(root, targetSlotName, applicationId);
  const validationError = await validateCloneSourceDirectory(sourcePath);

  if (validationError) {
    throw new DockoError(
      sourceKind === 'slot' ? 'Source slot directory is empty.' : 'Source clone directory is empty.',
      'SOURCE_EMPTY',
      1,
      { source: sourcePath, source_kind: sourceKind }
    );
  }

  if (path.resolve(sourcePath) === path.resolve(targetPath)) {
    throw new DockoError('Source and target slot paths must be different.', 'USAGE_ERROR', 1, {
      source: sourcePath,
      target: targetPath
    });
  }

  if (await pathExists(targetPath)) {
    if (!(await isDirectory(targetPath))) {
      throw new DockoError('Target slot path already exists and is not a directory.', 'TARGET_EXISTS', 2, {
        target: targetPath
      });
    }

    if (!(await isDirectoryEmpty(targetPath))) {
      throw new DockoError('Target slot already exists and is not empty.', 'TARGET_EXISTS', 2, {
        target: targetPath,
        slot_id: qualifySlotResourceId(applicationId, targetSlotName)
      });
    }
  }

  await mkdir(path.dirname(targetPath), { recursive: true });
  await copyDirectoryContents(sourcePath, targetPath);

  return {
    source_kind: sourceKind,
    source_path: sourcePath,
    application_id: applicationId,
    slot_name: targetSlotName,
    slot_id: qualifySlotResourceId(applicationId, targetSlotName),
    slot_path: targetPath
  };
}

function sortSlotResources<T extends { resource_id: string; application_id?: string | null; slot_name?: string | null }>(resources: T[]): T[] {
  return [...resources].sort((left, right) => left.resource_id.localeCompare(right.resource_id));
}

function listManagedSlots(status: { resources: SlotResourceSummary[] }) {
  return sortSlotResources(
    status.resources.filter((resource) => resource.resource_type === 'slot' && typeof resource.path === 'string')
  );
}

function filterSlotsByApplication(slotResources: SlotResourceSummary[], applicationId: string | null): SlotResourceSummary[] {
  if (!applicationId) {
    return slotResources;
  }

  return slotResources.filter((resource) => resource.application_id === applicationId);
}

function countSlots(resources: RegistryResource[]): BriefSlotCounts {
  const slots = resources.filter((resource) => resource.resource_type === 'slot');
  const free = slots.filter((resource) => resource.status === 'free').length;
  return {
    total: slots.length,
    free,
    claimed: slots.length - free
  };
}

function compactResource(resource: RegistryResource): Record<string, unknown> {
  return {
    type: resource.resource_type,
    id: resource.resource_id,
    status: resource.status,
    path: resource.path ?? null,
    application_id: resource.application_id ?? null,
    slot_name: resource.slot_name ?? null,
    owner_session_id: resource.claim?.owner_session_id ?? null,
    branch: resource.claim?.branch ?? null,
    task: resource.claim?.task ?? null,
    updated_at: resource.claim?.updated_at ?? null,
    delegation_count: resource.delegations?.length ?? 0
  };
}

function compactStatus(status: StatusResult): Record<string, unknown> {
  const resources = status.resources ?? [];
  const applicationSummaries = (status.applications ?? []).map((application: WorkspaceApplication) => {
    const applicationResources = resources.filter((resource) => resource.application_id === application.application_id);
    return {
      application_id: application.application_id,
      name: application.name,
      keywords: application.keywords ?? [],
      slots: countSlots(applicationResources)
    };
  });

  return {
    schema_version: status.schema_version,
    workspace: {
      workspace_id: status.workspace.workspace_id,
      workspace_root: status.workspace.workspace_root,
      name: status.workspace.name
    },
    slots: countSlots(resources),
    applications: applicationSummaries,
    resources: resources.map(compactResource),
    janitor_released: status.janitor.released_claims.length,
    released_claims: status.janitor.released_claims.map(compactResource)
  };
}

function compactSlotAcquire(result: Record<string, unknown>): Record<string, unknown> {
  const clone = result.clone && typeof result.clone === 'object'
    ? (result.clone as Record<string, unknown>)
    : null;

  return {
    ok: result.ok,
    action: result.action,
    session_id: result.session_id,
    slot_id: result.slot_id,
    application_id: result.application_id,
    slot_name: result.slot_name,
    slot_path: result.slot_path,
    availability: result.availability,
    clone: clone
      ? {
          slot_id: clone.slot_id,
          slot_name: clone.slot_name,
          slot_path: clone.slot_path,
          size_mb: clone.size_mb
        }
      : null
  };
}

function compactSession(session: SessionManifest): Record<string, unknown> {
  return {
    session_id: session.session_id,
    runtime: session.runtime,
    actor_mode: session.actor_mode,
    parent_session_id: session.parent_session_id,
    delegated_from_session_id: session.delegated_from_session_id,
    started_at: session.started_at,
    updated_at: session.updated_at
  };
}

function compactSessionList(result: { active_sessions: SessionManifest[] }): Record<string, unknown> {
  return {
    active_session_count: result.active_sessions.length,
    active_sessions: result.active_sessions.map(compactSession)
  };
}

function normalizeApplicationMatchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function scoreApplicationMatch(application: ApplicationSummary, matchText: string): number {
  if (!matchText) {
    return 0;
  }

  const terms = [
    application.application_id,
    application.name,
    ...(application.keywords ?? [])
  ]
    .map((entry) => normalizeApplicationMatchText(entry))
    .filter(Boolean);

  return terms.reduce((score, term) => {
    if (!term) {
      return score;
    }

    const exact = new RegExp(`(^|\\s)${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'i');
    if (exact.test(matchText)) {
      return score + 3;
    }

    if (matchText.includes(term)) {
      return score + 1;
    }

    return score;
  }, 0);
}

function resolveSelectedApplication(
  applications: ApplicationSummary[],
  explicitApplicationId: string | null,
  matchContext: Array<string | null | undefined>
): ApplicationSummary | null {
  if (explicitApplicationId) {
    const explicit = applications.find((application) => application.application_id === explicitApplicationId);
    if (!explicit) {
      throw new DockoError('Application not found.', 'APPLICATION_NOT_FOUND', 1, {
        application_id: explicitApplicationId
      });
    }
    return explicit;
  }

  const matchText = normalizeApplicationMatchText(matchContext.filter(Boolean).join(' '));
  if (!matchText) {
    return null;
  }

  const scored = applications
    .map((application) => ({
      application,
      score: scoreApplicationMatch(application, matchText)
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.application.application_id.localeCompare(right.application.application_id));

  if (scored.length === 0) {
    return null;
  }

  if (scored.length > 1 && scored[0].score === scored[1].score) {
    throw new DockoError(
      'Task text matches more than one configured application. Pass --application explicitly.',
      'AMBIGUOUS_APPLICATION',
      1,
      {
        applications: scored.filter((entry) => entry.score === scored[0].score).map((entry) => entry.application.application_id)
      }
    );
  }

  return scored[0].application;
}

function chooseDefaultCloneSource(slotResources: SlotResourceSummary[]): string {
  const mainSlot = slotResources.find((resource) => (resource.slot_name ?? resource.resource_id) === 'main');
  if (mainSlot) {
    return mainSlot.resource_id;
  }

  const numberedMain = slotResources.find((resource) => (resource.slot_name ?? resource.resource_id) === 'main_1');
  if (numberedMain) {
    return numberedMain.resource_id;
  }

  const firstSlot = slotResources[0];
  if (!firstSlot) {
    throw new DockoError('No managed slots exist yet, so docko has nothing it can duplicate.', 'NO_MANAGED_SLOTS', 1);
  }

  return firstSlot.resource_id;
}

function buildCloneSlotBase(source: string): string {
  const normalized = source.trim();
  if (!normalized) {
    return 'slot';
  }

  const qualified = parseQualifiedSlotId(normalized);
  if (qualified) {
    return sanitizeSlotId(qualified.slotName);
  }

  if (!normalized.includes(path.sep) && !normalized.includes('/') && !normalized.includes('\\')) {
    return sanitizeSlotId(normalized);
  }

  return sanitizeSlotId(path.basename(path.resolve(normalized)));
}

async function directorySizeBytes(targetPath: string): Promise<number> {
  const stats = await stat(targetPath);
  if (!stats.isDirectory()) {
    return stats.size;
  }

  let total = 0;
  const entries = await readdir(targetPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      total += await directorySizeBytes(entryPath);
      continue;
    }
    if (entry.isSymbolicLink()) {
      try {
        const resolved = await stat(entryPath);
        if (resolved.isDirectory()) {
          total += await directorySizeBytes(entryPath);
          continue;
        }
        total += resolved.size;
      } catch {
        // Broken link — skip.
      }
      continue;
    }

    total += (await stat(entryPath)).size;
  }

  return total;
}

function sizeInMegabytes(sizeBytes: number): number {
  return Number((sizeBytes / (1024 * 1024)).toFixed(2));
}

const DEFAULT_SCHEDULER_KEY = '_default';

function schedulerKeyForApplication(applicationId: string | null | undefined): string {
  return applicationId ?? DEFAULT_SCHEDULER_KEY;
}

// Order the free slots so acquisition starts at the slot AFTER the last one claimed for this
// application, wrapping around the full ring. The just-released slot ends up last, giving an
// incidental cooldown without relying on timestamps (which are unreliable across hosts).
function rotateFreeSlotsByCursor<T extends { resource_id: string; status: string }>(
  orderedSlots: T[],
  freeSlots: T[],
  lastSlotId: string | null
): T[] {
  if (!lastSlotId || freeSlots.length <= 1) {
    return freeSlots;
  }

  const cursorIndex = orderedSlots.findIndex((slot) => slot.resource_id === lastSlotId);
  if (cursorIndex < 0) {
    return freeSlots;
  }

  const rotated: T[] = [];
  for (let offset = 1; offset <= orderedSlots.length; offset += 1) {
    const slot = orderedSlots[(cursorIndex + offset) % orderedSlots.length];
    if (slot.status === 'free') {
      rotated.push(slot);
    }
  }
  return rotated;
}

function buildSlotClaimOptions(
  context: CliContext,
  sessionId: string,
  slotId: string,
  schedulerKey: string
): ClaimOptions {
  return {
    sessionId,
    resourceType: 'slot',
    resourceId: slotId,
    branch: option(context.options, 'branch'),
    task: option(context.options, 'task'),
    runtime: option(context.options, 'runtime') ?? process.env.DOCKO_RUNTIME ?? null,
    staleAfterMs: parsePositiveInt(option(context.options, 'stale-after-ms'), 'stale-after-ms'),
    advanceSchedulerKey: schedulerKey
  };
}

async function confirmBusySlotClone(
  context: CliContext,
  slotCount: number,
  preferredCloneSource: string | null
): Promise<boolean> {
  if (!promptEnabled(context.options) || Boolean(context.options['clone-when-busy'])) {
    return Boolean(context.options['clone-when-busy']);
  }

  const session = await createPromptSession();
  try {
    process.stderr.write(`All ${slotCount} managed slot${slotCount === 1 ? ' is' : 's are'} currently claimed.\n`);
    if (preferredCloneSource) {
      process.stderr.write(`docko will duplicate ${preferredCloneSource} if you continue.\n`);
    }
    return promptYesNo(session, 'Create and claim a fresh managed clone now?', true);
  } finally {
    session.close();
  }
}

async function acquireSlot(context: CliContext): Promise<Record<string, unknown>> {
  const sessionId = await context.service.resolveSessionId(option(context.options, 'session'), context.sessionEnv);
  const explicitApplicationId = option(context.options, 'application');
  const preferredCloneSource = option(context.options, 'clone-from');
  const preferredCloneSlot = option(context.options, 'clone-slot');
  let approvedCloneFallback: boolean | null = Boolean(context.options['clone-when-busy']) ? true : null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const status = await context.service.status('slot');
    const selectedApplication = resolveSelectedApplication(
      (status.applications ?? []) as ApplicationSummary[],
      explicitApplicationId,
      [option(context.options, 'task'), option(context.options, 'branch'), preferredCloneSource]
    );
    const slotResources = filterSlotsByApplication(
      listManagedSlots(status as { resources: SlotResourceSummary[] }),
      selectedApplication?.application_id ?? null
    );

    if (slotResources.length === 0) {
      throw new DockoError(
        selectedApplication
          ? 'No managed slots exist yet for the selected application.'
          : 'No managed slots exist yet, so docko has nothing it can claim or duplicate.',
        'NO_MANAGED_SLOTS',
        1,
        {
          workspace_root: context.root,
          application_id: selectedApplication?.application_id ?? null
        }
      );
    }

    const schedulerKey = schedulerKeyForApplication(selectedApplication?.application_id ?? null);
    const freeSlots = slotResources.filter((resource) => resource.status === 'free');
    if (freeSlots.length > 0) {
      const lastSlotId = status.workspace?.config?.scheduler?.last_slot_id?.[schedulerKey] ?? null;
      const orderedFreeSlots = rotateFreeSlotsByCursor(slotResources, freeSlots, lastSlotId);
      for (const freeSlot of orderedFreeSlots) {
        try {
          const claim = await context.service.claim(buildSlotClaimOptions(context, sessionId, freeSlot.resource_id, schedulerKey));
          return {
            ok: true,
            action: 'claimed-existing-slot',
            session_id: sessionId,
            slot_id: freeSlot.resource_id,
            application_id: freeSlot.application_id ?? null,
            slot_name: freeSlot.slot_name ?? freeSlot.resource_id,
            slot_path:
              typeof freeSlot.path === 'string'
                ? path.join(context.root, freeSlot.path)
                : resolveManagedSlotPath(
                    context.root,
                    freeSlot.slot_name ?? freeSlot.resource_id,
                    freeSlot.application_id ?? null
                  ),
            availability: {
              total_slots: slotResources.length,
              free_slots_before: freeSlots.length,
              claimed_slots_before: slotResources.length - freeSlots.length
            },
            clone: null,
            claim
          };
        } catch (error: unknown) {
          if (
            error instanceof DockoError &&
            (error.code === 'RESOURCE_ALREADY_CLAIMED' || error.code === 'RESOURCE_OWNED_BY_OTHER_SESSION')
          ) {
            continue;
          }

          throw error;
        }
      }

      continue;
    }

    if (approvedCloneFallback === null) {
      approvedCloneFallback = await confirmBusySlotClone(
        context,
        slotResources.length,
        preferredCloneSource ?? chooseDefaultCloneSource(slotResources)
      );
    }

    if (!approvedCloneFallback) {
      throw new DockoError(
        'All managed slots are currently claimed. Re-run with `docko slot acquire --clone-when-busy` or wait for a slot to be released.',
        'NO_FREE_SLOT',
        2,
        {
          slot_count: slotResources.length,
          busy_slot_count: slotResources.length
        }
      );
    }

    const cloneSource = preferredCloneSource ?? chooseDefaultCloneSource(slotResources);
    const usedSlotIds = new Set(slotResources.map((resource) => resource.slot_name ?? resource.resource_id));
    const targetSlotName = allocateSlotId(preferredCloneSlot ?? buildCloneSlotBase(cloneSource), usedSlotIds);

    try {
      const duplicated = await duplicateSlotDirectory(
        context.root,
        cloneSource,
        targetSlotName,
        selectedApplication?.application_id ?? null
      );
      await context.service.init();
      const claim = await context.service.claim(
        buildSlotClaimOptions(context, sessionId, String(duplicated.slot_id), schedulerKey)
      );
      const slotSizeBytes = await directorySizeBytes(String(duplicated.slot_path));

      return {
        ok: true,
        action: 'cloned-and-claimed',
        session_id: sessionId,
        slot_id: duplicated.slot_id,
        application_id: duplicated.application_id ?? null,
        slot_name: duplicated.slot_name,
        slot_path: duplicated.slot_path,
        availability: {
          total_slots: slotResources.length,
          free_slots_before: 0,
          claimed_slots_before: slotResources.length
        },
        clone: {
          ...duplicated,
          size_bytes: slotSizeBytes,
          size_mb: sizeInMegabytes(slotSizeBytes)
        },
        claim
      };
    } catch (error: unknown) {
      if (error instanceof DockoError && error.code === 'TARGET_EXISTS') {
        continue;
      }

      throw error;
    }
  }

  throw new DockoError(
    'docko could not acquire a slot after retrying concurrent workspace changes.',
    'SLOT_ACQUIRE_RETRY_EXHAUSTED',
    2
  );
}

async function ensureApplication(context: CliContext): Promise<Record<string, unknown>> {
  await context.service.init();
  const applicationOptions = await buildEnsureApplicationOptions(context);
  const application = await context.service.ensureApplication(applicationOptions);
  const explicitSlots = [...new Set(optionList(context.options, 'slot'))];
  const requestedSlotCount = parsePositiveInt(option(context.options, 'slots'), 'slots');
  const slotBase = option(context.options, 'slot-base') ?? 'main';
  const applicationRoot = path.join(context.root, 'slots', application.application_id);
  const existingSlotNames = await listDirectories(applicationRoot);
  const usedSlotNames = new Set(existingSlotNames);
  const createdDirectories: string[] = [];

  let targetSlotNames: string[] = [];
  if (explicitSlots.length > 0) {
    targetSlotNames = explicitSlots.map((slotName) => allocateSlotId(slotName, usedSlotNames));
  } else if (requestedSlotCount !== undefined) {
    targetSlotNames = buildCloneSlotIds(slotBase, requestedSlotCount, usedSlotNames);
  } else if (application.source_path) {
    targetSlotNames = [allocateSlotId(slotBase, usedSlotNames)];
  }

  await ensureDirectory(applicationRoot, createdDirectories, context.root);
  const duplicatedSlots: Record<string, unknown>[] = [];

  for (const slotName of targetSlotNames) {
    if (application.source_path) {
      duplicatedSlots.push(
        await duplicateSlotDirectory(context.root, application.source_path, slotName, application.application_id)
      );
      continue;
    }

    await ensureDirectory(resolveManagedSlotPath(context.root, slotName, application.application_id), createdDirectories, context.root);
  }

  const registry = await context.service.init();
  const applicationSlots = listManagedSlots(registry as { resources: SlotResourceSummary[] })
    .filter((resource) => resource.application_id === application.application_id)
    .map((resource) => resource.resource_id);

  return {
    ok: true,
    application: {
      ...application,
      source_path: application.source_path ? toDisplayPath(application.source_path) : null
    },
    created_directories: createdDirectories,
    duplicated_slots: duplicatedSlots.map((slot) => formatInitDuplicateResult(slot)),
    discovered_slots: applicationSlots
  };
}

function formatInitPath(targetPath: string | null): string | null {
  return targetPath === null ? null : toDisplayPath(targetPath);
}

function formatInitPathList(targetPaths: string[]): string[] {
  return targetPaths.map((targetPath) => toDisplayPath(targetPath));
}

function formatInitRootCheckMessage(rootCheck: RootCheckResult): string {
  return rootCheck.message.split(rootCheck.root).join(toDisplayPath(rootCheck.root));
}

function formatInitDuplicateResult(result: Record<string, unknown>): Record<string, unknown> {
  return {
    ...result,
    source_path: typeof result.source_path === 'string' ? toDisplayPath(result.source_path) : result.source_path,
    slot_path: typeof result.slot_path === 'string' ? toDisplayPath(result.slot_path) : result.slot_path
  };
}

async function injectManagedInstructions(
  targetPath: string,
  snippet: string,
  integration: IntegrationTarget
): Promise<{ file: string; injected: boolean }> {
  const markers = INJECTION_MARKERS[integration];
  let existing = '';

  try {
    existing = await readFile(targetPath, 'utf8');
  } catch (error: unknown) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
      throw error;
    }
  }

  if (existing.includes(markers.start) || existing.includes(snippet.trim())) {
    return { file: targetPath, injected: false };
  }

  await mkdir(path.dirname(targetPath), { recursive: true });
  const block = `${markers.start}\n${snippet.trim()}\n${markers.end}\n`;

  if (!existing.trim()) {
    await writeFile(targetPath, block, 'utf8');
  } else {
    const separator = existing.endsWith('\n') ? '\n' : '\n\n';
    await appendFile(targetPath, `${separator}${block}`, 'utf8');
  }

  return { file: targetPath, injected: true };
}

async function initializeWorkspace(context: CliContext): Promise<Record<string, unknown>> {
  const rootCheck = await inspectRoot(context.root);
  const promptConfig = promptEnabled(context.options) ? await collectInitPromptConfig(context, rootCheck) : null;

  if (!rootCheck.parentExists) {
    throw new DockoError(
      'The parent directory for --root does not exist. Check the path you typed.',
      'ROOT_PARENT_NOT_FOUND',
      1,
      { root: rootCheck.root }
    );
  }
  if (!rootCheck.isDirectory) {
    throw new DockoError(
      'The --root path exists but is not a directory.',
      'ROOT_NOT_DIRECTORY',
      1,
      { root: rootCheck.root }
    );
  }

  const requestedMode = parseEnum(option(context.options, 'mode') ?? 'auto', ['auto', 'workspace', 'repo'] as const, 'mode');
  const mode = await resolveInitMode(context.root, requestedMode);
  const slotStaleAfterMs = parsePositiveInt(option(context.options, 'slot-stale-after-ms'), 'slot-stale-after-ms');
  const effectivePromptConfig = promptConfig ?? (await collectInitPromptConfig(context, rootCheck));
  const slotRequests = [...optionList(context.options, 'slot')];
  for (const cloneJob of effectivePromptConfig.cloneJobs) {
    slotRequests.push(cloneJob.slotId);
  }

  const scaffold = await scaffoldWorkspace(
    context.root,
    mode,
    slotRequests,
    effectivePromptConfig.cloneJobs.map((cloneJob) => cloneJob.slotId)
  );

  const duplicatedSlots: Record<string, unknown>[] = [];
  for (const cloneJob of effectivePromptConfig.cloneJobs) {
    duplicatedSlots.push(await duplicateSlotDirectory(context.root, cloneJob.sourcePath, cloneJob.slotId));
  }

  const registry = await context.service.init({
    slotStaleAfterMs
  });
  const discoveredSlots = registry.resources
    .filter((resource) => resource.resource_type === 'slot')
    .map((resource) => resource.resource_id);

  const claudeInstall = effectivePromptConfig.claude.enabled
    ? await installClaudeCodeAdapter({
        workspaceRoot: context.root,
        destination: option(context.options, 'dest') ?? DEFAULT_CLAUDE_PLUGIN_DESTINATION,
        force: Boolean(context.options.force),
        writeSettingsLocal: true
      })
    : null;

  const injectedFiles: Array<{ file: string; injected: boolean; target: IntegrationTarget }> = [];
  if (effectivePromptConfig.claude.enabled && effectivePromptConfig.claude.inject && effectivePromptConfig.claude.filePath) {
    injectedFiles.push({
      ...(await injectManagedInstructions(
        effectivePromptConfig.claude.filePath,
        await readClaudeCodeSnippet('claude'),
        'claude'
      )),
      target: 'claude'
    });
  }

  if (effectivePromptConfig.codex.enabled && effectivePromptConfig.codex.inject && effectivePromptConfig.codex.filePath) {
    injectedFiles.push({
      ...(await injectManagedInstructions(
        effectivePromptConfig.codex.filePath,
        await readClaudeCodeSnippet('agents'),
        'codex'
      )),
      target: 'codex'
    });
  }

  const displayDuplicatedSlots = duplicatedSlots.map((result) => formatInitDuplicateResult(result));
  const claudeSnippetPath = claudeInstall
    ? toWorkspaceDisplayPath(context.root, path.join(context.root, '.claude', 'snippets', 'CLAUDE.docko.md'))
    : null;
  const codexSnippetPath = claudeInstall
    ? toWorkspaceDisplayPath(context.root, path.join(context.root, '.claude', 'snippets', 'AGENTS.docko.md'))
    : null;
  const claudeGuidePath = effectivePromptConfig.claude.filePath
    ? toWorkspaceDisplayPath(context.root, effectivePromptConfig.claude.filePath)
    : null;
  const codexGuidePath = effectivePromptConfig.codex.filePath
    ? toWorkspaceDisplayPath(context.root, effectivePromptConfig.codex.filePath)
    : null;

  const claudeNextStep = !effectivePromptConfig.claude.enabled
    ? 'Add `--claude` later if you want shell-neutral Claude Code hooks and snippets.'
    : effectivePromptConfig.claude.inject && claudeGuidePath
      ? `Open Claude from the workspace root after reviewing ${claudeGuidePath} and the generated hook assets.`
      : `Merge ${claudeSnippetPath!} into ${claudeGuidePath!} before opening Claude from the workspace root.`;

  const codexNextStep = !effectivePromptConfig.codex.enabled
    ? 'Add `--codex` if you want AGENTS.md guidance for Codex.'
    : effectivePromptConfig.codex.inject && codexGuidePath
      ? `Open Codex from the workspace root after reviewing ${codexGuidePath}.`
      : codexSnippetPath
        ? `Merge ${codexSnippetPath} into ${codexGuidePath!} before opening Codex from the workspace root.`
        : `Add docko guidance to ${codexGuidePath!} before opening Codex from the workspace root.`;
  const absoluteRoot = path.resolve(context.root);

  return {
    ok: true,
    mode,
    workspace_root: toDisplayPath(context.root),
    workspace_root_absolute: absoluteRoot,
    applications: registry.applications,
    root_check: {
      root: toDisplayPath(rootCheck.root),
      absolute_root: absoluteRoot,
      exists: rootCheck.exists,
      parent_exists: rootCheck.parentExists,
      looks_like_repo: rootCheck.looksLikeRepo,
      looks_like_workspace: rootCheck.looksLikeWorkspace,
      message: formatInitRootCheckMessage(rootCheck)
    },
    created_directories: scaffold.created,
    starter_slots: scaffold.slots,
    discovered_slots: discoveredSlots,
    duplicated_slot: displayDuplicatedSlots[0] ?? null,
    duplicated_slots: displayDuplicatedSlots,
    claude: claudeInstall
      ? {
          plugin_root: toDisplayPath(claudeInstall.plugin_root),
          settings_file: formatInitPath(claudeInstall.settings_file),
          written_files: formatInitPathList(claudeInstall.written_files),
          skipped_files: formatInitPathList(claudeInstall.skipped_files)
        }
      : null,
    codex: effectivePromptConfig.codex.enabled
      ? {
          agents_file: formatInitPath(effectivePromptConfig.codex.filePath)
        }
      : null,
    injected_files: injectedFiles.map((entry) => ({
      ...entry,
      file: toDisplayPath(entry.file)
    })),
    next_steps: [
      'Run `docko status --root .` to inspect the starter workspace state.',
      claudeNextStep,
      codexNextStep,
      'Use `docko slot duplicate --from <path-or-slot> --to <slot-id>` when you want another warm slot clone.'
    ],
    workspace_config: registry.workspace.config ?? null
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function renderInitSummary(result: Record<string, unknown>): string {
  const lines = [bold('docko is ready.'), ''];
  const workspaceRoot = stringValue(result.workspace_root);
  const mode = stringValue(result.mode);
  const starterSlots = stringList(result.starter_slots);
  const nextSteps = stringList(result.next_steps);
  const duplicatedSlots = Array.isArray(result.duplicated_slots)
    ? result.duplicated_slots.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    : [];
  const claude = result.claude && typeof result.claude === 'object' ? (result.claude as Record<string, unknown>) : null;
  const codex = result.codex && typeof result.codex === 'object' ? (result.codex as Record<string, unknown>) : null;
  const injectedFiles = Array.isArray(result.injected_files)
    ? result.injected_files.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    : [];

  if (workspaceRoot) {
    lines.push(`Workspace: ${workspaceRoot}`);
  }
  if (mode) {
    lines.push(`Mode: ${mode}`);
  }
  if (starterSlots.length > 0) {
    lines.push(`Managed slots: ${starterSlots.join(', ')}`);
  }

  if (duplicatedSlots.length > 0) {
    const cloneGroups = new Map<string, string[]>();
    for (const duplicatedSlot of duplicatedSlots) {
      const sourcePath = stringValue(duplicatedSlot.source_path) ?? 'source';
      const slotId = stringValue(duplicatedSlot.slot_id);
      if (!slotId) {
        continue;
      }
      const existing = cloneGroups.get(sourcePath) ?? [];
      existing.push(slotId);
      cloneGroups.set(sourcePath, existing);
    }

    for (const [sourcePath, slotIds] of cloneGroups.entries()) {
      lines.push(`Cloned from ${sourcePath}: ${slotIds.join(', ')}`);
    }
  }

  if (claude) {
    const injected = injectedFiles.some((entry) => entry.target === 'claude' && entry.injected === true);
    const guidePath = injectedFiles.find((entry) => entry.target === 'claude' && typeof entry.file === 'string')?.file;
    lines.push(
      injected && typeof guidePath === 'string'
        ? `Claude: installed and guidance injected into ${guidePath}`
        : 'Claude: installed'
    );
  }

  if (codex) {
    const injected = injectedFiles.some((entry) => entry.target === 'codex' && entry.injected === true);
    const guidePath =
      injectedFiles.find((entry) => entry.target === 'codex' && typeof entry.file === 'string')?.file ??
      stringValue(codex.agents_file);
    lines.push(
      injected && typeof guidePath === 'string'
        ? `Codex: guidance ready in ${guidePath}`
        : 'Codex: configured'
    );
  }

  if (nextSteps.length > 0) {
    lines.push('', 'Next:');
    for (const [index, step] of nextSteps.entries()) {
      lines.push(`  ${index + 1}. ${step}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function shouldRenderInteractiveInit(context: CliContext, key: string): boolean {
  return key === 'init' && promptEnabled(context.options) && !context.options.json;
}

function shouldRenderBrief(context: CliContext, key: string): boolean {
  return Boolean(context.options.brief) && ['status', 'slot acquire', 'session list'].includes(key);
}

function renderBriefPayload(key: string, result: unknown): unknown {
  if (key === 'status') {
    return compactStatus(result as StatusResult);
  }

  if (key === 'slot acquire') {
    return compactSlotAcquire(result as Record<string, unknown>);
  }

  if (key === 'session list') {
    return compactSessionList(result as { active_sessions: SessionManifest[] });
  }

  return result;
}

function renderInteractiveError(error: unknown): string {
  const nestedPayload =
    error && typeof error === 'object' && 'error' in error && error.error && typeof error.error === 'object'
      ? (error.error as Record<string, unknown>)
      : null;
  const payload = nestedPayload ?? toErrorPayload(error).error;
  const code = typeof payload.code === 'string' ? payload.code : 'ERROR';
  const message = typeof payload.message === 'string' ? payload.message : 'docko init failed.';
  return `Init failed [${code}]: ${message}\n`;
}

async function createContext(argv: string[]): Promise<CliContext> {
  const { command, options } = parseArgs(argv);
  const root = resolveWorkspaceRoot(command, options);

  return {
    command,
    options,
    root,
    service: new DockoService(root),
    sessionEnv: process.env.DOCKO_SESSION_ID ?? null
  };
}

function buildClaimOptions(context: CliContext, sessionId: string): ClaimOptions {
  return {
    sessionId,
    resourceType: requiredOption(context.options, 'resource'),
    resourceId: requiredOption(context.options, 'id'),
    branch: option(context.options, 'branch'),
    task: option(context.options, 'task'),
    runtime: option(context.options, 'runtime') ?? process.env.DOCKO_RUNTIME ?? null,
    staleAfterMs: parsePositiveInt(option(context.options, 'stale-after-ms'), 'stale-after-ms')
  };
}

function buildHeartbeatOptions(context: CliContext, sessionId: string): HeartbeatOptions {
  return {
    sessionId,
    resourceType: requiredOption(context.options, 'resource'),
    resourceId: requiredOption(context.options, 'id')
  };
}

function buildReleaseOptions(context: CliContext, sessionId: string): ReleaseOptions {
  return {
    sessionId,
    resourceType: requiredOption(context.options, 'resource'),
    resourceId: requiredOption(context.options, 'id'),
    reason: option(context.options, 'reason') ?? undefined,
    force: Boolean(context.options.force)
  };
}

function buildDelegateOptions(context: CliContext, sessionId: string): DelegateOptions {
  return {
    sessionId,
    childSessionId: requiredOption(context.options, 'child-session'),
    resourceType: requiredOption(context.options, 'resource'),
    resourceId: requiredOption(context.options, 'id'),
    scope: parseEnum(option(context.options, 'scope') ?? 'write', ['read', 'write'] as const, 'scope')
  };
}

function buildEnsureResourceOptions(context: CliContext): EnsureResourceOptions {
  return {
    resourceType: requiredOption(context.options, 'resource'),
    resourceId: requiredOption(context.options, 'id'),
    path: option(context.options, 'path')
  };
}

async function buildEnsureApplicationOptions(context: CliContext): Promise<EnsureApplicationOptions> {
  const applicationId = requiredOption(context.options, 'id');
  const source = option(context.options, 'source');

  return {
    applicationId,
    name: option(context.options, 'name') ?? buildDefaultApplicationName(applicationId),
    description: option(context.options, 'description') ?? null,
    keywords: [...new Set(optionList(context.options, 'keyword').map((keyword) => keyword.trim()).filter(Boolean))],
    sourcePath: source ? await resolveCloneSourceInput(context.root, source, '--source') : null
  };
}

function serializeAuthorization(authorization: AuthorizationResult): Record<string, unknown> {
  return {
    allow: authorization.allowed,
    reason: authorization.reason,
    session_id: authorization.session_id,
    resource_id: authorization.resource_id,
    owner_session_id: authorization.owner_session_id
  };
}

async function buildHandlers(context: CliContext): Promise<Map<string, Handler>> {
  return new Map<string, Handler>([
    ['init', async () => initializeWorkspace(context)],
    ['app ensure', async () => ensureApplication(context)],
    ['slot acquire', async () => acquireSlot(context)],
    [
      'slot duplicate',
      async () => {
        const source = requiredOption(context.options, 'from');
        const target = requiredOption(context.options, 'to');
        const duplicated = await duplicateSlotDirectory(
          context.root,
          source,
          target,
          option(context.options, 'application')
        );
        await context.service.init();
        return {
          ok: true,
          ...duplicated
        };
      }
    ],
    [
      'status',
      async () => {
        const status = await context.service.status(
          option(context.options, 'resource') ?? undefined,
          option(context.options, 'id') ?? undefined
        );
        const applicationId = option(context.options, 'application');
        if (!applicationId) {
          return status;
        }

        return {
          ...status,
          resources: status.resources.filter((resource) => resource.application_id === applicationId)
        };
      }
    ],
    [
      'logs',
      async () =>
        context.service.logs({
          days: parsePositiveInt(option(context.options, 'days'), 'days'),
          limit: parsePositiveInt(option(context.options, 'limit'), 'limit')
        })
    ],
    ['resource ensure', async () => context.service.ensureResource(buildEnsureResourceOptions(context))],
    [
      'claim',
      async () => {
        const sessionId = await context.service.resolveSessionId(option(context.options, 'session'), context.sessionEnv);
        return context.service.claim(buildClaimOptions(context, sessionId));
      }
    ],
    [
      'heartbeat',
      async () => {
        const sessionId = await context.service.resolveSessionId(option(context.options, 'session'), context.sessionEnv);
        return context.service.heartbeat(buildHeartbeatOptions(context, sessionId));
      }
    ],
    [
      'release',
      async () => {
        const sessionId = await context.service.resolveSessionId(option(context.options, 'session'), context.sessionEnv);
        return context.service.release(buildReleaseOptions(context, sessionId));
      }
    ],
    [
      'delegate',
      async () => {
        const sessionId = await context.service.resolveSessionId(option(context.options, 'session'), context.sessionEnv);
        return context.service.delegate(buildDelegateOptions(context, sessionId));
      }
    ],
    [
      'render',
      async () => {
        await context.service.render();
        return { ok: true };
      }
    ],
    [
      'session start',
      async () => {
        const payload = await readJsonStdin();
        const sessionOptions: SessionStartOptions = {
          sessionId: option(context.options, 'session') ?? (typeof payload.session_id === 'string' ? payload.session_id : undefined),
          runtime: option(context.options, 'runtime') ?? process.env.DOCKO_RUNTIME ?? 'portable',
          actorMode: parseEnum(option(context.options, 'actor-mode') ?? 'interactive', ['interactive', 'delegated', 'automation'] as const, 'actor-mode'),
          parentSessionId:
            option(context.options, 'parent-session') ?? (typeof payload.parent_session_id === 'string' ? payload.parent_session_id : null),
          delegatedFromSessionId:
            option(context.options, 'delegated-from-session') ??
            (typeof payload.delegated_from_session_id === 'string' ? payload.delegated_from_session_id : null),
          workspaceRoot: context.root,
          metadata: buildSessionStartMetadata()
        };

        const session = await context.service.sessionStart(sessionOptions);
        return {
          session_id: session.session_id,
          runtime: session.runtime,
          additionalContext: `Your docko session ID is ${session.session_id}. Claim a slot before writing.`,
          env: {
            DOCKO_SESSION_ID: session.session_id,
            DOCKO_RUNTIME: session.runtime
          }
        };
      }
    ],
    [
      'session end',
      async () => {
        const payload = await readJsonStdin();
        const sessionId =
          option(context.options, 'session') ??
          (typeof payload.session_id === 'string' ? payload.session_id : null) ??
          context.sessionEnv;

        if (!sessionId) {
          return { ok: true, released: false };
        }

        await context.service.sessionEnd(sessionId);
        return { ok: true, released: true, session_id: sessionId };
      }
    ],
    [
      'session current',
      async () => {
        const sessionId = await context.service.resolveSessionId(option(context.options, 'session'), context.sessionEnv);
        const session = await context.service.sessionCurrent(sessionId);
        if (context.options['id-only']) {
          process.stdout.write(session.session_id);
          return null;
        }

        return session;
      }
    ],
    ['session list', async () => context.service.sessionList()],
    [
      'adapter claude-code install',
      async () =>
        installClaudeCodeAdapter({
          workspaceRoot: context.root,
          destination: option(context.options, 'dest') ?? DEFAULT_CLAUDE_PLUGIN_DESTINATION,
          force: Boolean(context.options.force),
          writeSettingsLocal: Boolean(context.options['write-settings-local'])
        })
    ],
    ['adapter claude-code settings', async () => buildClaudeCodeSettingsFragment()],
    [
      'adapter claude-code session-start',
      async () => {
        process.env.DOCKO_RUNTIME = 'claude-code';
        const payload = await readJsonStdin();
        const session = await context.service.sessionStart({
          sessionId: option(context.options, 'session') ?? (typeof payload.session_id === 'string' ? payload.session_id : undefined),
          runtime: 'claude-code',
          actorMode: 'interactive',
          workspaceRoot: context.root,
          metadata: {
            ...buildSessionStartMetadata(),
            hook_event: 'SessionStart'
          }
        });

        return {
          additionalContext: `Your docko session ID is ${session.session_id}. Use it for claims and delegated teammates.`,
          env: {
            DOCKO_SESSION_ID: session.session_id,
            DOCKO_RUNTIME: 'claude-code'
          }
        };
      }
    ],
    [
      'adapter claude-code session-end',
      async () => {
        const payload = await readJsonStdin();
        const sessionId =
          option(context.options, 'session') ??
          (typeof payload.session_id === 'string' ? payload.session_id : null) ??
          context.sessionEnv;

        if (sessionId) {
          await context.service.sessionEnd(sessionId);
        }

        return { ok: true };
      }
    ],
    [
      'adapter claude-code pre-tool-use',
      async () => {
        const payload = await readJsonStdin();
        const sessionId = await context.service.resolveSessionId(option(context.options, 'session'), context.sessionEnv);
        const filePath = extractHookFilePath(payload);
        if (!filePath) {
          return { allow: true, reason: 'no-file-path' };
        }

        const authorization = await context.service.authorizeFileWrite(sessionId, filePath);
        return serializeAuthorization(authorization);
      }
    ],
    [
      'adapter claude-code subagent-start',
      async () => {
        const payload = await readJsonStdin();
        const parentSessionId =
          option(context.options, 'session') ??
          (typeof payload.parent_session_id === 'string' ? payload.parent_session_id : null) ??
          context.sessionEnv;

        if (!parentSessionId) {
    throw new DockoError('Missing parent session for Claude subagent.', 'USAGE_ERROR', 1);
        }

        const childSession = await context.service.sessionStart({
          runtime: 'claude-code',
          actorMode: 'delegated',
          parentSessionId,
          delegatedFromSessionId: parentSessionId,
          workspaceRoot: context.root,
          metadata: {
            ...buildSessionStartMetadata(),
            hook_event: 'SubagentStart'
          }
        });
        await context.service.inheritDelegationsFromParent(parentSessionId, childSession.session_id);

        return {
          additionalContext: `You are a delegated teammate. Parent session: ${parentSessionId}. Your session: ${childSession.session_id}.`,
          env: {
            DOCKO_SESSION_ID: childSession.session_id,
            DOCKO_PARENT_SESSION_ID: parentSessionId,
            DOCKO_RUNTIME: 'claude-code'
          }
        };
      }
    ]
  ]);
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  let context: CliContext | undefined;
  let key = '';

  try {
    context = await createContext(argv);
    key = context.command.slice(0, 3).join(' ');

    if (context.options.version) {
      process.stdout.write(`${getVersion()}\n`);
      return;
    }

    if (context.options.help || context.command[0] === 'help') {
      printHelp();
      return;
    }

    if (!key) {
      printHelp();
      process.exitCode = 1;
      return;
    }

    const handlers = await buildHandlers(context);
    const handler = handlers.get(key);
    if (!handler) {
    throw new DockoError(`Unknown command: ${context.command.join(' ')}`, 'USAGE_ERROR', 1);
    }

    const result = await handler();
    if (result !== null && result !== undefined) {
      if (shouldRenderInteractiveInit(context, key)) {
        printText(renderInitSummary(result as Record<string, unknown>));
      } else if (shouldRenderBrief(context, key)) {
        printJson(renderBriefPayload(key, result), false);
      } else {
        printJson(result);
      }
    }
  } catch (error: unknown) {
    if (context && shouldRenderInteractiveInit(context, key)) {
      process.stderr.write(renderInteractiveError(error));
    } else {
      const brief = context ? shouldRenderBrief(context, key) : false;
      const payload = toErrorPayload(error);
      process.stderr.write(`${JSON.stringify(payload, null, brief ? 0 : 2)}\n`);
    }
    const exitCode = error instanceof DockoError ? error.exitCode : 1;
    process.exit(exitCode);
  }
}

export const __test__ = {
  main,
  printHelp,
  printText,
  option,
  optionList,
  qualifySlotResourceId,
  parseQualifiedSlotId,
  resolveManagedSlotPath,
  workspaceRoot,
  resolveWorkspaceRoot,
  findWorkspaceRoot,
  isPathInsideSlots,
  hasRegistryAt,
  schedulerKeyForApplication,
  rotateFreeSlotsByCursor,
  requiredOption,
  parsePositiveInt,
  parseEnum,
  extractHookFilePath,
  INJECTION_MARKERS,
  pathExists,
  ensureDirectory,
  listDirectories,
  isDirectory,
  detectInstructionFile,
  toDisplayPath,
  buildPathExamples,
  buildInstructionExamples,
  buildCloneSourceExamples,
  buildExistingCloneExamples,
  validateCloneSourceDirectory,
  resolveDirectoryInput,
  resolveCloneSourceInput,
  sanitizeSlotId,
  allocateSlotId,
  buildCloneSlotIds,
  parsePositivePromptCount,
  parseYesNoAnswer,
  inspectRoot,
  isDirectoryEmpty,
  resolveWorkspacePath,
  promptEnabled,
  colorize,
  bold,
  cyan,
  green,
  dim,
  renderInitIntro,
  createTTYPromptSession,
  createPromptSession,
  readPromptAnswers,
  promptExistingDirectory,
  promptExistingDirectoryList,
  collectInitPromptConfig,
  formatInitPath,
  formatInitPathList,
  formatInitRootCheckMessage,
  formatInitDuplicateResult,
  inspectCloneSource,
  renderCloneSourceDetails,
  promptConfirmedCloneSource,
  injectManagedInstructions,
  renderInitSummary,
  shouldRenderInteractiveInit,
  shouldRenderBrief,
  renderBriefPayload,
  renderInteractiveError,
  resolveInitMode,
  scaffoldWorkspace,
  resolveDuplicateSource,
  duplicateSlotDirectory,
  sortSlotResources,
  listManagedSlots,
  filterSlotsByApplication,
  countSlots,
  compactResource,
  compactStatus,
  compactSlotAcquire,
  compactSession,
  compactSessionList,
  resolveSelectedApplication,
  chooseDefaultCloneSource,
  buildCloneSlotBase,
  directorySizeBytes,
  sizeInMegabytes,
  buildEnsureApplicationOptions,
  buildSlotClaimOptions,
  confirmBusySlotClone,
  ensureApplication,
  acquireSlot,
  serializeAuthorization
};

const isDirectExecution = Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  void main();
}
