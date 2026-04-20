import { appendFile, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_LOG_LIMIT, LOG_RETENTION_DAYS } from './constants.js';
import { ensureDir, isEnoent } from './fs-utils.js';
import { getPaths, type DockoPaths } from './paths.js';
import type { DockoLogEntry, DockoLogQuery, DockoLogResult } from './types.js';

const LOG_FILE_PATTERN = /^\d{4}-\d{2}-\d{2}\.jsonl$/;

function formatLogDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function clampPositiveInteger(value: number | undefined, fallback: number): number {
  if (!value || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.floor(value);
}

export class LogScribe {
  private readonly paths: DockoPaths;

  constructor(workspaceRoot: string) {
    this.paths = getPaths(workspaceRoot);
  }

  async append(
    entry: Omit<DockoLogEntry, 'timestamp'> & { timestamp?: string | null },
    now = new Date()
  ): Promise<DockoLogEntry> {
    await ensureDir(this.paths.logsDir);
    await this.pruneExpired(now);

    const timestamp = entry.timestamp ?? now.toISOString();
    const logEntry: DockoLogEntry = {
      timestamp,
      operation: entry.operation,
      outcome: entry.outcome,
      session_id: entry.session_id ?? null,
      resource_type: entry.resource_type ?? null,
      resource_id: entry.resource_id ?? null,
      details: entry.details
    };

    await appendFile(this.logFilePath(new Date(timestamp)), `${JSON.stringify(logEntry)}\n`, 'utf8');
    return logEntry;
  }

  async list(query: DockoLogQuery = {}, now = new Date()): Promise<DockoLogResult> {
    await ensureDir(this.paths.logsDir);
    const days = Math.min(clampPositiveInteger(query.days, LOG_RETENTION_DAYS), LOG_RETENTION_DAYS);
    const limit = clampPositiveInteger(query.limit, DEFAULT_LOG_LIMIT);
    const keepDays = new Set(Array.from({ length: days }, (_, index) => formatLogDay(addUtcDays(now, -index))));
    const entries = await this.readEntries(keepDays);

    entries.sort((left, right) => right.timestamp.localeCompare(left.timestamp));

    return {
      retention_days: LOG_RETENTION_DAYS,
      days,
      entries: entries.slice(0, limit)
    };
  }

  private async readEntries(keepDays: Set<string>): Promise<DockoLogEntry[]> {
    let names: string[];
    try {
      names = await readdir(this.paths.logsDir);
    } catch (error: unknown) {
      if (isEnoent(error)) {
        return [];
      }
      throw error;
    }

    const logFiles = names
      .filter((name) => LOG_FILE_PATTERN.test(name) && keepDays.has(name.slice(0, 10)))
      .sort();

    const entries: DockoLogEntry[] = [];
    for (const name of logFiles) {
      const raw = await readFile(path.join(this.paths.logsDir, name), 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        if (!line.trim()) {
          continue;
        }

        try {
          entries.push(JSON.parse(line) as DockoLogEntry);
        } catch {
          // Keep log reading best-effort so one malformed line does not hide the rest.
        }
      }
    }

    return entries;
  }

  private async pruneExpired(now = new Date()): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.paths.logsDir);
    } catch (error: unknown) {
      if (isEnoent(error)) {
        return;
      }
      throw error;
    }

    const keepDays = new Set(
      Array.from({ length: LOG_RETENTION_DAYS }, (_, index) => formatLogDay(addUtcDays(now, -index)))
    );

    await Promise.all(
      names
        .filter((name) => LOG_FILE_PATTERN.test(name) && !keepDays.has(name.slice(0, 10)))
        .map((name) => rm(path.join(this.paths.logsDir, name), { force: true }))
    );
  }

  private logFilePath(date: Date): string {
    return path.join(this.paths.logsDir, `${formatLogDay(date)}.jsonl`);
  }
}
