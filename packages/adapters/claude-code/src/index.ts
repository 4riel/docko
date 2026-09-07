import { chmod, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DockoError } from '@docko/core';

export const CLAUDE_CODE_ADAPTER_INTENT = {
  runtime: 'claude-code',
  hookEvents: ['SessionStart', 'SessionEnd', 'PreToolUse', 'SubagentStart'],
  firstClassUseCase: 'Agent Teams'
} as const;

type ClaudeHookName = 'SessionStart' | 'SessionEnd' | 'PreToolUse' | 'SubagentStart';
type ClaudeHookSubcommand = 'session-start' | 'session-end' | 'pre-tool-use' | 'subagent-start';
type TargetPlatform = NodeJS.Platform;
type ManagedWritePolicy = 'preserve' | 'launcher';
type ManagedWriteOutcome = 'written' | 'unchanged' | 'skipped';

interface ClaudeHookCommand {
  matcher?: string;
  command: string;
}

export interface ClaudeCodeSettingsFragmentOptions {
  platform?: TargetPlatform;
  /** Plugin destination relative to the project root (matches `--dest`). */
  destination?: string;
  /** When known, the launcher path is emitted absolute so any cwd and shell resolves it. */
  workspaceRoot?: string;
}

export interface ClaudeCodeInstallOptions {
  workspaceRoot: string;
  destination?: string;
  force?: boolean;
  writeSettingsLocal?: boolean;
}

export interface ClaudeCodeInstallResult {
  workspace_root: string;
  plugin_root: string;
  settings_fragment: ClaudeCodeSettingsFragment;
  settings_file: string | null;
  written_files: string[];
  unchanged_files: string[];
  skipped_files: string[];
  launcher_version: string;
}

export interface ClaudeCodeHookEntry {
  matcher?: string;
  hooks: Array<{ type: 'command'; command: string; timeout: number }>;
}

export interface ClaudeCodeSettingsFragment {
  hooks: Record<string, ClaudeCodeHookEntry[]>;
}

export interface ClaudeCodeDoctorOptions {
  workspaceRoot: string;
  destination?: string;
  fix?: boolean;
  sessionEnv?: Record<string, string | undefined>;
}

export interface ClaudeCodeDoctorIssue {
  code: string;
  message: string;
  fixable: boolean;
  settings_file?: string;
  event?: string;
  command?: string;
}

export interface ClaudeCodeDoctorResult {
  workspace_root: string;
  plugin_root: string;
  shipped_launcher_version: string;
  launcher: {
    path: string;
    exists: boolean;
    version: string | null;
    up_to_date: boolean;
  };
  settings_files: Array<{
    path: string;
    exists: boolean;
    docko_hook_entries: number;
    stale_entries: number;
    removed_entries: number;
  }>;
  docko_binary: {
    docko_bin_env: string | null;
    resolved_path: string | null;
    on_path: boolean;
    fallback: string;
  };
  session: {
    docko_session_id: string | null;
    claude_code_session_id: string | null;
    resolved_session_id: string | null;
  };
  issues: ClaudeCodeDoctorIssue[];
  fixed: string[];
  ok: boolean;
}

export type ClaudeCodeSnippetName = 'claude' | 'agents';

interface ManagedWriteResult {
  written: string[];
  unchanged: string[];
  skipped: string[];
}

const DEFAULT_PLUGIN_DESTINATION = path.join('.claude-plugin', 'docko');
const HOOK_SCRIPT_NAME = 'docko-claude-hook.mjs';
const NPX_FALLBACK_COMMAND = 'npx --yes --package docko-workspace@alpha docko';

// SessionStart pays for a possible `npx` cold start; the rest only run docko itself. These must
// stay identical to plugin/hooks/hooks.json — tests assert parity between the two install paths.
const HOOK_TIMEOUTS: Record<ClaudeHookName, number> = {
  SessionStart: 60,
  SessionEnd: 15,
  PreToolUse: 30,
  SubagentStart: 30
};

/**
 * Returns the recommended Claude Code hook fragment for the target platform.
 * The fragment points to a checked-in Node launcher so hooks work without shell wrappers.
 */
export function buildClaudeCodeSettingsFragment(
  options: TargetPlatform | ClaudeCodeSettingsFragmentOptions = {}
): ClaudeCodeSettingsFragment {
  const normalized: ClaudeCodeSettingsFragmentOptions = typeof options === 'string' ? { platform: options } : options;
  const launcherPath = resolveLauncherCommandPath(
    normalized.destination ?? DEFAULT_PLUGIN_DESTINATION,
    normalized.workspaceRoot
  );

  return {
    hooks: {
      SessionStart: [toHookEntry('SessionStart', buildHookCommand('SessionStart', launcherPath))],
      SessionEnd: [toHookEntry('SessionEnd', buildHookCommand('SessionEnd', launcherPath))],
      PreToolUse: [toHookEntry('PreToolUse', buildHookCommand('PreToolUse', launcherPath))],
      SubagentStart: [toHookEntry('SubagentStart', buildHookCommand('SubagentStart', launcherPath))]
    }
  };
}

/**
 * Installs the repo-local Claude Code adapter assets into a workspace and writes
 * platform-appropriate hook/settings JSON for the current machine.
 */
export async function installClaudeCodeAdapter(options: ClaudeCodeInstallOptions): Promise<ClaudeCodeInstallResult> {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const relativeDestination = options.destination ?? DEFAULT_PLUGIN_DESTINATION;
  const pluginRoot = path.resolve(workspaceRoot, relativeDestination);
  const packageRoot = resolvePackageRoot();
  const templatesRoot = path.join(packageRoot, 'templates');
  // The distributable Claude Code plugin bundle is the canonical source for hook
  // scripts, commands, and skills. The repo-local install remaps its layout into
  // the target project (.claude-plugin/docko + .claude/*).
  const pluginBundleRoot = path.join(packageRoot, 'plugin');
  const force = Boolean(options.force);
  const version = await readPackageVersion(packageRoot);
  const settingsFragment = buildClaudeCodeSettingsFragment({ destination: relativeDestination, workspaceRoot });

  const pluginResult = await copyManagedTree({
    sourceRoot: path.join(pluginBundleRoot, 'scripts'),
    destinationRoot: path.join(pluginRoot, 'scripts'),
    force,
    // A stale launcher silently degrades every hook, so it refreshes on version drift
    // even without --force. A same-version local edit is still preserved.
    policy: 'launcher'
  });

  const commandsResult = await copyManagedTree({
    sourceRoot: path.join(pluginBundleRoot, 'commands'),
    destinationRoot: path.join(workspaceRoot, '.claude', 'commands'),
    force,
    policy: 'preserve'
  });

  const skillsResult = await copyManagedTree({
    sourceRoot: path.join(pluginBundleRoot, 'skills'),
    destinationRoot: path.join(workspaceRoot, '.claude', 'skills'),
    force,
    policy: 'preserve'
  });

  const projectResult = await copyManagedTree({
    sourceRoot: path.join(templatesRoot, 'project'),
    destinationRoot: workspaceRoot,
    force,
    policy: 'preserve'
  });

  const generatedResult = await writeGeneratedFiles({
    workspaceRoot,
    pluginRoot,
    force,
    settingsFragment,
    version
  });

  let settingsFile: string | null = null;
  const writtenFiles = [
    ...pluginResult.written,
    ...commandsResult.written,
    ...skillsResult.written,
    ...projectResult.written,
    ...generatedResult.written
  ];
  const unchangedFiles = [
    ...pluginResult.unchanged,
    ...commandsResult.unchanged,
    ...skillsResult.unchanged,
    ...projectResult.unchanged,
    ...generatedResult.unchanged
  ];
  const skippedFiles = [
    ...pluginResult.skipped,
    ...commandsResult.skipped,
    ...skillsResult.skipped,
    ...projectResult.skipped,
    ...generatedResult.skipped
  ];

  if (options.writeSettingsLocal) {
    settingsFile = path.join(workspaceRoot, '.claude', 'settings.local.json');
    const wroteSettings = await mergeSettingsLocal(settingsFile, settingsFragment);
    writtenFiles.push(wroteSettings);
  }

  return {
    workspace_root: workspaceRoot,
    plugin_root: pluginRoot,
    settings_fragment: settingsFragment,
    settings_file: settingsFile,
    written_files: writtenFiles.sort(),
    unchanged_files: unchangedFiles.sort(),
    skipped_files: skippedFiles.sort(),
    launcher_version: await readShippedLauncherVersion(pluginBundleRoot, version)
  };
}

/**
 * Reports the health of a repo-local Claude Code install: launcher version drift, duplicate or
 * dangling hook registrations, docko binary resolution, and the session id the runtime exports.
 * `fix` removes hook entries that point at launchers which do not exist or are out of date.
 */
export async function doctorClaudeCodeAdapter(options: ClaudeCodeDoctorOptions): Promise<ClaudeCodeDoctorResult> {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const relativeDestination = options.destination ?? DEFAULT_PLUGIN_DESTINATION;
  const pluginRoot = path.resolve(workspaceRoot, relativeDestination);
  const packageRoot = resolvePackageRoot();
  const pluginBundleRoot = path.join(packageRoot, 'plugin');
  const version = await readPackageVersion(packageRoot);
  const shippedVersion = await readShippedLauncherVersion(pluginBundleRoot, version);
  const env = options.sessionEnv ?? process.env;
  const issues: ClaudeCodeDoctorIssue[] = [];
  const fixed: string[] = [];

  const launcherPath = path.join(pluginRoot, 'scripts', HOOK_SCRIPT_NAME);
  const launcherContent = await readFileOrNull(launcherPath);
  const launcherVersion = launcherContent === null ? null : readLauncherVersion(launcherContent);
  const launcherUpToDate = launcherContent !== null && launcherVersion === shippedVersion;

  if (launcherContent === null) {
    issues.push({
      code: 'LAUNCHER_MISSING',
      message: `No hook launcher at ${launcherPath}. Run: docko adapter claude-code install --root "${workspaceRoot}"`,
      fixable: false
    });
  } else if (!launcherUpToDate) {
    issues.push({
      code: 'LAUNCHER_OUTDATED',
      message: `Hook launcher is version ${launcherVersion ?? 'unknown'} but docko ships ${shippedVersion}. Run: docko adapter claude-code install --root "${workspaceRoot}"`,
      fixable: false
    });
  }

  const settingsFiles: ClaudeCodeDoctorResult['settings_files'] = [];
  for (const settingsName of ['settings.json', 'settings.local.json']) {
    const settingsPath = path.join(workspaceRoot, '.claude', settingsName);
    const raw = await readFileOrNull(settingsPath);
    if (raw === null) {
      settingsFiles.push({
        path: settingsPath,
        exists: false,
        docko_hook_entries: 0,
        stale_entries: 0,
        removed_entries: 0
      });
      continue;
    }

    let document: Record<string, unknown>;
    try {
      document = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      issues.push({
        code: 'SETTINGS_INVALID',
        message: `${settingsPath} is not valid JSON; docko cannot inspect its hooks.`,
        fixable: false,
        settings_file: settingsPath
      });
      settingsFiles.push({
        path: settingsPath,
        exists: true,
        docko_hook_entries: 0,
        stale_entries: 0,
        removed_entries: 0
      });
      continue;
    }

    const inspection = await inspectSettingsHooks({
      document,
      workspaceRoot,
      settingsPath,
      shippedVersion,
      fix: Boolean(options.fix)
    });
    issues.push(...inspection.issues);
    settingsFiles.push({
      path: settingsPath,
      exists: true,
      docko_hook_entries: inspection.dockoEntries,
      stale_entries: inspection.staleEntries,
      removed_entries: inspection.removedEntries
    });

    if (inspection.removedEntries > 0) {
      await writeFile(settingsPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
      fixed.push(
        `${settingsPath}: removed ${inspection.removedEntries} stale docko hook entr${inspection.removedEntries === 1 ? 'y' : 'ies'}`
      );
    }
  }

  const dockoBinEnv = env.DOCKO_BIN ?? null;
  const resolvedPath = dockoBinEnv ? null : await resolveDockoOnPath(env.PATH ?? env.Path ?? '');
  if (!dockoBinEnv && !resolvedPath) {
    issues.push({
      code: 'DOCKO_BINARY_NOT_RESOLVED',
      message: `docko is not on PATH and DOCKO_BIN is unset; hooks fall back to \`${NPX_FALLBACK_COMMAND}\`, which is slow on a cold cache.`,
      fixable: false
    });
  }

  const dockoSessionId = env.DOCKO_SESSION_ID ?? null;
  const claudeSessionId = env.CLAUDE_CODE_SESSION_ID ?? null;
  if (!dockoSessionId && !claudeSessionId) {
    issues.push({
      code: 'SESSION_ID_NOT_EXPORTED',
      message:
        'Neither DOCKO_SESSION_ID nor CLAUDE_CODE_SESSION_ID is set in this shell, so docko commands must resolve the session themselves. Start a new Claude session so the SessionStart hook can export it.',
      fixable: false
    });
  }

  return {
    workspace_root: workspaceRoot,
    plugin_root: pluginRoot,
    shipped_launcher_version: shippedVersion,
    launcher: {
      path: launcherPath,
      exists: launcherContent !== null,
      version: launcherVersion,
      up_to_date: launcherUpToDate
    },
    settings_files: settingsFiles,
    docko_binary: {
      docko_bin_env: dockoBinEnv,
      resolved_path: resolvedPath,
      on_path: Boolean(resolvedPath),
      fallback: NPX_FALLBACK_COMMAND
    },
    session: {
      docko_session_id: dockoSessionId,
      claude_code_session_id: claudeSessionId,
      resolved_session_id: dockoSessionId ?? claudeSessionId
    },
    issues,
    fixed,
    ok: issues.length === 0
  };
}

export async function readClaudeCodeSnippet(name: ClaudeCodeSnippetName): Promise<string> {
  const packageRoot = resolvePackageRoot();
  const snippetFile =
    name === 'claude'
      ? path.join(packageRoot, 'templates', 'project', '.claude', 'snippets', 'CLAUDE.docko.md')
      : path.join(packageRoot, 'templates', 'project', '.claude', 'snippets', 'AGENTS.docko.md');

  return readFile(snippetFile, 'utf8');
}

function resolvePackageRoot(): string {
  const compiledDir = fileURLToPath(new URL('.', import.meta.url));
  return path.resolve(compiledDir, '..');
}

// Read the adapter package version so the generated plugin manifest always tracks the installed
// docko version instead of a hardcoded literal that silently drifts between releases.
async function readPackageVersion(packageRoot: string): Promise<string> {
  const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8')) as { version?: string };
  if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
    throw new DockoError('Adapter package.json is missing a version.', 'ADAPTER_VERSION_MISSING', 2, {
      package_root: packageRoot
    });
  }

  return manifest.version;
}

export function readLauncherVersion(content: string): string | null {
  const match = content.match(/^\/\/ docko-launcher-version:\s*(\S+)\s*$/m);
  return match ? match[1] : null;
}

async function readShippedLauncherVersion(pluginBundleRoot: string, fallbackVersion: string): Promise<string> {
  const shipped = await readFileOrNull(path.join(pluginBundleRoot, 'scripts', HOOK_SCRIPT_NAME));
  return (shipped === null ? null : readLauncherVersion(shipped)) ?? fallbackVersion;
}

async function readFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'EISDIR')) {
      return null;
    }
    throw error;
  }
}

// The plugin manifest is generated (not copied) so its version is stamped from the live package
// version on every install. Keep the field order stable for idempotent writes.
function buildPluginManifest(version: string): Record<string, unknown> {
  return {
    name: 'docko',
    version,
    description: 'Repo-local Claude Code integration bundle for docko workspace orchestration',
    author: {
      name: '4riel'
    }
  };
}

function toHookEntry(hookName: ClaudeHookName, hook: ClaudeHookCommand): ClaudeCodeHookEntry {
  return {
    // Only tool events take a matcher. SessionStart matches a session source, and
    // SessionEnd/SubagentStart take none at all, so "*" would be meaningless there.
    ...(hook.matcher === undefined ? {} : { matcher: hook.matcher }),
    hooks: [{ type: 'command', command: hook.command, timeout: HOOK_TIMEOUTS[hookName] }]
  };
}

function toPosixPath(targetPath: string): string {
  return targetPath.split(path.win32.sep).join('/');
}

// A cwd-relative launcher path only resolves when the hook happens to run from the project root,
// and slot workflows are entirely about other directories. Anchor it: absolute when the install
// knows the workspace root, otherwise Claude Code's $CLAUDE_PROJECT_DIR.
function resolveLauncherCommandPath(destination: string, workspaceRoot?: string): string {
  const relativeLauncher = path.join(destination, 'scripts', HOOK_SCRIPT_NAME);
  if (workspaceRoot) {
    return path.resolve(workspaceRoot, relativeLauncher);
  }

  return `$CLAUDE_PROJECT_DIR/${toPosixPath(relativeLauncher)}`;
}

function buildHookCommand(hookName: ClaudeHookName, launcherPath: string): ClaudeHookCommand {
  return {
    matcher: hookName === 'PreToolUse' ? 'Edit|Write' : undefined,
    command: `node "${launcherPath}" ${hookSubcommand(hookName)}`
  };
}

function hookSubcommand(hookName: ClaudeHookName): ClaudeHookSubcommand {
  if (hookName === 'SessionStart') {
    return 'session-start';
  }

  if (hookName === 'SessionEnd') {
    return 'session-end';
  }

  if (hookName === 'PreToolUse') {
    return 'pre-tool-use';
  }

  return 'subagent-start';
}

function buildHooksManifest(settingsFragment: ClaudeCodeSettingsFragment): {
  description: string;
  hooks: ClaudeCodeSettingsFragment['hooks'];
} {
  return {
    description: 'docko Claude Code hooks for slot claims, teammate inheritance, and session cleanup',
    hooks: settingsFragment.hooks
  };
}

async function writeGeneratedFiles(args: {
  workspaceRoot: string;
  pluginRoot: string;
  force: boolean;
  settingsFragment: ClaudeCodeSettingsFragment;
  version: string;
}): Promise<ManagedWriteResult> {
  const written: string[] = [];
  const unchanged: string[] = [];
  const skipped: string[] = [];
  const generatedFiles = [
    {
      path: path.join(args.pluginRoot, 'plugin.json'),
      content: `${JSON.stringify(buildPluginManifest(args.version), null, 2)}\n`
    },
    {
      path: path.join(args.pluginRoot, 'hooks', 'hooks.json'),
      content: `${JSON.stringify(buildHooksManifest(args.settingsFragment), null, 2)}\n`
    },
    {
      path: path.join(args.workspaceRoot, '.claude', 'settings.docko.json'),
      content: `${JSON.stringify(args.settingsFragment, null, 2)}\n`
    }
  ];

  for (const file of generatedFiles) {
    const result = await writeManagedFile(file.path, file.content, { force: args.force, policy: 'preserve' });
    collectManagedWrite(result, file.path, { written, unchanged, skipped });
  }

  return { written, unchanged, skipped };
}

function collectManagedWrite(
  outcome: ManagedWriteOutcome,
  filePath: string,
  buckets: { written: string[]; unchanged: string[]; skipped: string[] }
): void {
  if (outcome === 'written') {
    buckets.written.push(filePath);
    return;
  }

  if (outcome === 'unchanged') {
    buckets.unchanged.push(filePath);
    return;
  }

  buckets.skipped.push(filePath);
}

async function copyManagedTree(args: {
  sourceRoot: string;
  destinationRoot: string;
  force: boolean;
  policy: ManagedWritePolicy;
}): Promise<ManagedWriteResult> {
  const entries = await collectFiles(args.sourceRoot);
  const written: string[] = [];
  const unchanged: string[] = [];
  const skipped: string[] = [];

  for (const sourcePath of entries) {
    const relativePath = path.relative(args.sourceRoot, sourcePath);
    const destinationPath = path.join(args.destinationRoot, relativePath);
    const sourceContent = await readFile(sourcePath, 'utf8');
    const writeResult = await writeManagedFile(destinationPath, sourceContent, {
      force: args.force,
      policy: args.policy
    });
    collectManagedWrite(writeResult, destinationPath, { written, unchanged, skipped });
    if (writeResult === 'written' && destinationPath.endsWith('.mjs') && process.platform !== 'win32') {
      await chmod(destinationPath, 0o755);
    }
  }

  return { written, unchanged, skipped };
}

async function collectFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(absolutePath)));
      continue;
    }

    files.push(absolutePath);
  }

  return files.sort();
}

async function writeManagedFile(
  filePath: string,
  content: string,
  options: { force: boolean; policy: ManagedWritePolicy }
): Promise<ManagedWriteOutcome> {
  await mkdir(path.dirname(filePath), { recursive: true });

  try {
    const existing = await readFile(filePath, 'utf8');
    if (existing === content) {
      return 'unchanged';
    }

    if (!options.force && !shouldRefreshManagedFile(existing, content, options.policy)) {
      return 'skipped';
    }
  } catch (error: unknown) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
      throw error;
    }
  }

  await writeFile(filePath, content, 'utf8');
  return 'written';
}

// docko owns the launcher: when the shipped version differs from the installed one the file is
// machine state that must track the release, not a user asset worth preserving.
function shouldRefreshManagedFile(existing: string, content: string, policy: ManagedWritePolicy): boolean {
  if (policy !== 'launcher') {
    return false;
  }

  const shippedVersion = readLauncherVersion(content);
  if (!shippedVersion) {
    return false;
  }

  return readLauncherVersion(existing) !== shippedVersion;
}

async function inspectSettingsHooks(args: {
  document: Record<string, unknown>;
  workspaceRoot: string;
  settingsPath: string;
  shippedVersion: string;
  fix: boolean;
}): Promise<{ issues: ClaudeCodeDoctorIssue[]; dockoEntries: number; staleEntries: number; removedEntries: number }> {
  const issues: ClaudeCodeDoctorIssue[] = [];
  let dockoEntries = 0;
  let staleEntries = 0;
  let removedEntries = 0;

  const hooks = isRecord(args.document.hooks) ? args.document.hooks : null;
  if (!hooks) {
    return { issues, dockoEntries, staleEntries, removedEntries };
  }

  for (const [eventName, rawEntries] of Object.entries(hooks)) {
    if (!Array.isArray(rawEntries)) {
      continue;
    }

    const kept: unknown[] = [];
    let eventDockoEntries = 0;

    for (const entry of rawEntries) {
      const command = readEntryCommand(entry);
      if (!command || !command.includes(HOOK_SCRIPT_NAME)) {
        kept.push(entry);
        continue;
      }

      dockoEntries += 1;
      eventDockoEntries += 1;
      const state = await inspectLauncherCommand(command, args.workspaceRoot, args.shippedVersion);
      if (state === 'healthy' || state === 'plugin-managed') {
        kept.push(entry);
        continue;
      }

      staleEntries += 1;
      issues.push({
        code: state === 'missing' ? 'HOOK_LAUNCHER_MISSING' : 'HOOK_LAUNCHER_OUTDATED',
        message:
          state === 'missing'
            ? `${args.settingsPath} registers ${eventName} against a launcher that does not exist: ${command}`
            : `${args.settingsPath} registers ${eventName} against an outdated launcher: ${command}`,
        fixable: true,
        settings_file: args.settingsPath,
        event: eventName,
        command
      });

      if (args.fix) {
        removedEntries += 1;
        continue;
      }

      kept.push(entry);
    }

    if (eventDockoEntries > 1) {
      issues.push({
        code: 'DUPLICATE_HOOK_REGISTRATION',
        message: `${args.settingsPath} registers docko ${eventName} ${eventDockoEntries} times; Claude Code will run the hook once per entry.`,
        fixable: true,
        settings_file: args.settingsPath,
        event: eventName
      });
    }

    if (args.fix && kept.length !== rawEntries.length) {
      hooks[eventName] = kept;
    }
  }

  return { issues, dockoEntries, staleEntries, removedEntries };
}

function readEntryCommand(entry: unknown): string | null {
  if (!isRecord(entry) || !Array.isArray(entry.hooks)) {
    return null;
  }

  for (const hook of entry.hooks) {
    if (isRecord(hook) && typeof hook.command === 'string') {
      return hook.command;
    }
  }

  return null;
}

async function inspectLauncherCommand(
  command: string,
  workspaceRoot: string,
  shippedVersion: string
): Promise<'healthy' | 'outdated' | 'missing' | 'plugin-managed'> {
  // ${CLAUDE_PLUGIN_ROOT} entries belong to the installed plugin, whose files docko does not own.
  if (command.includes('CLAUDE_PLUGIN_ROOT')) {
    return 'plugin-managed';
  }

  const launcherPath = extractLauncherPath(command, workspaceRoot);
  if (!launcherPath) {
    return 'plugin-managed';
  }

  const content = await readFileOrNull(launcherPath);
  if (content === null) {
    return 'missing';
  }

  return readLauncherVersion(content) === shippedVersion ? 'healthy' : 'outdated';
}

function extractLauncherPath(command: string, workspaceRoot: string): string | null {
  const match = command.match(/"([^"]*docko-claude-hook\.mjs)"|(\S*docko-claude-hook\.mjs)/);
  const raw = match?.[1] ?? match?.[2] ?? null;
  if (!raw) {
    return null;
  }

  const expanded = raw.replace(/\$\{?CLAUDE_PROJECT_DIR\}?/g, workspaceRoot);
  return path.resolve(workspaceRoot, expanded);
}

async function resolveDockoOnPath(rawPath: string): Promise<string | null> {
  const candidates = process.platform === 'win32' ? ['docko.cmd', 'docko.exe', 'docko'] : ['docko'];

  for (const directory of rawPath.split(path.delimiter).filter(Boolean)) {
    for (const candidate of candidates) {
      const fullPath = path.join(directory, candidate);
      if (await isExistingFile(fullPath)) {
        return fullPath;
      }
    }
  }

  return null;
}

async function isExistingFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function mergeSettingsLocal(settingsPath: string, fragment: ClaudeCodeSettingsFragment): Promise<string> {
  await mkdir(path.dirname(settingsPath), { recursive: true });

  let baseDocument: Record<string, unknown> = {};
  try {
    const existing = await readFile(settingsPath, 'utf8');
    baseDocument = JSON.parse(existing) as Record<string, unknown>;
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      throw new DockoError('Existing Claude settings.local.json is not valid JSON.', 'CLAUDE_SETTINGS_INVALID', 2, {
        path: settingsPath
      });
    }
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
      throw error;
    }
    // No settings file yet: keep the empty baseDocument initialized above.
  }

  const currentHooks = isRecord(baseDocument.hooks) ? baseDocument.hooks : {};
  const mergedHooks: Record<string, unknown> = { ...currentHooks };

  for (const [eventName, hookEntries] of Object.entries(fragment.hooks)) {
    const existingEntries = Array.isArray(currentHooks[eventName]) ? (currentHooks[eventName] as unknown[]) : [];
    mergedHooks[eventName] = mergeHookEntries(existingEntries, hookEntries);
  }

  const nextDocument = {
    ...baseDocument,
    hooks: mergedHooks
  };

  await writeFile(settingsPath, `${JSON.stringify(nextDocument, null, 2)}\n`, 'utf8');
  return settingsPath;
}

function mergeHookEntries(existing: unknown[], additions: ClaudeCodeHookEntry[]): unknown[] {
  // Replace any previous docko registration for this event instead of appending a second one:
  // duplicate entries make Claude Code run the launcher twice per event.
  const merged = existing.filter((entry) => {
    const command = readEntryCommand(entry);
    return !command || !command.includes(HOOK_SCRIPT_NAME);
  });

  for (const entry of additions) {
    merged.push(entry);
  }

  return merged;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const DEFAULT_CLAUDE_PLUGIN_DESTINATION = DEFAULT_PLUGIN_DESTINATION;
