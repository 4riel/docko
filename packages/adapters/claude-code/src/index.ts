import { chmod, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
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

interface ClaudeHookCommand {
  matcher: string;
  command: string;
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
  skipped_files: string[];
}

export interface ClaudeCodeSettingsFragment {
  hooks: Record<string, Array<{ matcher: string; hooks: Array<{ type: 'command'; command: string; timeout: number }> }>>;
}

export type ClaudeCodeSnippetName = 'claude' | 'agents';

interface ManagedWriteResult {
  written: string[];
  skipped: string[];
}

interface GeneratedFilesResult {
  written: string[];
  skipped: string[];
}

const DEFAULT_PLUGIN_DESTINATION = path.join('.claude-plugin', 'docko');
const HOOK_SCRIPT_NAME = 'docko-claude-hook.mjs';
const HOOK_SCRIPT_COMMAND_PATH = `.claude-plugin/docko/scripts/${HOOK_SCRIPT_NAME}`;

/**
 * Returns the recommended Claude Code hook fragment for the target platform.
 * The fragment points to a checked-in Node launcher so hooks work without shell wrappers.
 */
export function buildClaudeCodeSettingsFragment(platform: TargetPlatform = process.platform): ClaudeCodeSettingsFragment {
  return {
    hooks: {
      SessionStart: [toHookEntry(buildHookCommand('SessionStart', platform))],
      SessionEnd: [toHookEntry(buildHookCommand('SessionEnd', platform))],
      PreToolUse: [toHookEntry(buildHookCommand('PreToolUse', platform))],
      SubagentStart: [toHookEntry(buildHookCommand('SubagentStart', platform))]
    }
  };
}

/**
 * Installs the repo-local Claude Code adapter assets into a workspace and writes
 * platform-appropriate hook/settings JSON for the current machine.
 */
export async function installClaudeCodeAdapter(options: ClaudeCodeInstallOptions): Promise<ClaudeCodeInstallResult> {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const pluginRoot = path.resolve(workspaceRoot, options.destination ?? DEFAULT_PLUGIN_DESTINATION);
  const packageRoot = resolvePackageRoot();
  const templatesRoot = path.join(packageRoot, 'templates');
  const force = Boolean(options.force);
  const platform = process.platform;
  const version = await readPackageVersion(packageRoot);

  const pluginResult = await copyManagedTree({
    sourceRoot: path.join(templatesRoot, 'plugin'),
    destinationRoot: pluginRoot,
    force
  });

  const projectResult = await copyManagedTree({
    sourceRoot: path.join(templatesRoot, 'project'),
    destinationRoot: workspaceRoot,
    force
  });

  const generatedResult = await writeGeneratedFiles({
    workspaceRoot,
    pluginRoot,
    force,
    platform,
    version
  });

  let settingsFile: string | null = null;
  const writtenFiles = [...pluginResult.written, ...projectResult.written, ...generatedResult.written];
  const skippedFiles = [...pluginResult.skipped, ...projectResult.skipped, ...generatedResult.skipped];

  if (options.writeSettingsLocal) {
    settingsFile = path.join(workspaceRoot, '.claude', 'settings.local.json');
    const wroteSettings = await mergeSettingsLocal(settingsFile, buildClaudeCodeSettingsFragment(platform));
    writtenFiles.push(wroteSettings);
  }

  return {
    workspace_root: workspaceRoot,
    plugin_root: pluginRoot,
    settings_fragment: buildClaudeCodeSettingsFragment(platform),
    settings_file: settingsFile,
    written_files: writtenFiles.sort(),
    skipped_files: skippedFiles.sort()
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

function toHookEntry(hook: ClaudeHookCommand): { matcher: string; hooks: Array<{ type: 'command'; command: string; timeout: number }> } {
  return {
    matcher: hook.matcher,
    hooks: [{ type: 'command', command: hook.command, timeout: 10 }]
  };
}

function buildHookCommand(hookName: ClaudeHookName, platform: TargetPlatform): ClaudeHookCommand {
  void platform;
  const matcher = hookName === 'PreToolUse' ? 'Edit|Write' : '*';
  const subcommand = hookSubcommand(hookName);

  return {
    matcher,
    command: `node "${HOOK_SCRIPT_COMMAND_PATH}" ${subcommand}`
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

function buildHooksManifest(platform: TargetPlatform): { description: string; hooks: ClaudeCodeSettingsFragment['hooks'] } {
  return {
    description: 'docko Claude Code hooks for slot claims, teammate inheritance, and session cleanup',
    hooks: buildClaudeCodeSettingsFragment(platform).hooks
  };
}

async function writeGeneratedFiles(args: {
  workspaceRoot: string;
  pluginRoot: string;
  force: boolean;
  platform: TargetPlatform;
  version: string;
}): Promise<GeneratedFilesResult> {
  const written: string[] = [];
  const skipped: string[] = [];
  const generatedFiles = [
    {
      path: path.join(args.pluginRoot, 'plugin.json'),
      content: `${JSON.stringify(buildPluginManifest(args.version), null, 2)}\n`
    },
    {
      path: path.join(args.pluginRoot, 'hooks', 'hooks.json'),
      content: `${JSON.stringify(buildHooksManifest(args.platform), null, 2)}\n`
    },
    {
      path: path.join(args.workspaceRoot, '.claude', 'settings.docko.json'),
      content: `${JSON.stringify(buildClaudeCodeSettingsFragment(args.platform), null, 2)}\n`
    }
  ];

  for (const file of generatedFiles) {
    const result = await writeManagedFile(file.path, file.content, args.force);
    if (result === 'written') {
      written.push(file.path);
    } else {
      skipped.push(file.path);
    }
  }

  return { written, skipped };
}

async function copyManagedTree(args: {
  sourceRoot: string;
  destinationRoot: string;
  force: boolean;
}): Promise<ManagedWriteResult> {
  const entries = await collectFiles(args.sourceRoot);
  const written: string[] = [];
  const skipped: string[] = [];

  for (const sourcePath of entries) {
    const relativePath = path.relative(args.sourceRoot, sourcePath);
    const destinationPath = path.join(args.destinationRoot, relativePath);
    const sourceContent = await readFile(sourcePath, 'utf8');
    const writeResult = await writeManagedFile(destinationPath, sourceContent, args.force);
    if (writeResult === 'written') {
      written.push(destinationPath);
      if (destinationPath.endsWith('.mjs') && process.platform !== 'win32') {
        await chmod(destinationPath, 0o755);
      }
    } else {
      skipped.push(destinationPath);
    }
  }

  return { written, skipped };
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

async function writeManagedFile(filePath: string, content: string, force: boolean): Promise<'written' | 'skipped'> {
  await mkdir(path.dirname(filePath), { recursive: true });

  try {
    const existing = await readFile(filePath, 'utf8');
    if (existing === content) {
      return 'written';
    }

    if (!force) {
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

async function mergeSettingsLocal(settingsPath: string, fragment: ClaudeCodeSettingsFragment): Promise<string> {
  await mkdir(path.dirname(settingsPath), { recursive: true });

  let baseDocument: Record<string, unknown> = {};
  try {
    const existing = await readFile(settingsPath, 'utf8');
    baseDocument = JSON.parse(existing) as Record<string, unknown>;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      baseDocument = {};
    } else if (error instanceof SyntaxError) {
      throw new DockoError('Existing Claude settings.local.json is not valid JSON.', 'CLAUDE_SETTINGS_INVALID', 2, {
        path: settingsPath
      });
    } else {
      throw error;
    }
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

function mergeHookEntries(
  existing: unknown[],
  additions: Array<{ matcher: string; hooks: Array<{ type: 'command'; command: string; timeout: number }> }>
): unknown[] {
  const merged = [...existing];
  const seen = new Set(existing.map((entry) => JSON.stringify(entry)));

  for (const entry of additions) {
    const key = JSON.stringify(entry);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(entry);
  }

  return merged;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const DEFAULT_CLAUDE_PLUGIN_DESTINATION = DEFAULT_PLUGIN_DESTINATION;
