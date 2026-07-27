import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";
import type {
  AiProvider,
  DailyContent,
  DailyReportRecord,
  DailyStatus,
  JobRecord,
  SessionSummary,
  WeeklyContent,
  WeeklyReportRecord,
  WeeklyStatus
} from "../shared/types.js";

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

export const db = new Database(config.databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS summary_cache (
  cache_key TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  local_date TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  local_date TEXT NOT NULL,
  revision INTEGER NOT NULL,
  status TEXT NOT NULL,
  content_json TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  generated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  manually_edited INTEGER NOT NULL DEFAULT 0,
  UNIQUE(local_date, revision)
);

CREATE TABLE IF NOT EXISTS weekly_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iso_week TEXT NOT NULL,
  revision INTEGER NOT NULL,
  status TEXT NOT NULL,
  content_json TEXT NOT NULL,
  daily_dates_json TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  output_path TEXT,
  generated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(iso_week, revision)
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  progress INTEGER NOT NULL,
  message TEXT NOT NULL,
  result_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);

function parseDaily(row: Record<string, unknown>): DailyReportRecord {
  return {
    id: Number(row.id),
    date: String(row.local_date),
    revision: Number(row.revision),
    status: row.status as DailyStatus,
    content: JSON.parse(String(row.content_json)) as DailyContent,
    provider: (row.provider as AiProvider | null) ?? null,
    model: (row.model as string | null) ?? null,
    generatedAt: String(row.generated_at),
    updatedAt: String(row.updated_at),
    manuallyEdited: Boolean(row.manually_edited)
  };
}

function parseWeekly(row: Record<string, unknown>): WeeklyReportRecord {
  return {
    id: Number(row.id),
    isoWeek: String(row.iso_week),
    revision: Number(row.revision),
    status: row.status as WeeklyStatus,
    content: JSON.parse(String(row.content_json)) as WeeklyContent,
    dailyDates: JSON.parse(String(row.daily_dates_json)) as string[],
    provider: (row.provider as AiProvider | null) ?? null,
    model: (row.model as string | null) ?? null,
    outputPath: (row.output_path as string | null) ?? null,
    generatedAt: String(row.generated_at),
    updatedAt: String(row.updated_at)
  };
}

export function getLatestDaily(date: string): DailyReportRecord | null {
  const row = db
    .prepare("SELECT * FROM daily_reports WHERE local_date = ? ORDER BY revision DESC LIMIT 1")
    .get(date) as Record<string, unknown> | undefined;
  return row ? parseDaily(row) : null;
}

export function listLatestDailies(from: string, to: string): DailyReportRecord[] {
  const rows = db
    .prepare(`
      SELECT d.* FROM daily_reports d
      JOIN (
        SELECT local_date, MAX(revision) AS revision
        FROM daily_reports
        WHERE local_date BETWEEN ? AND ?
        GROUP BY local_date
      ) latest ON latest.local_date = d.local_date AND latest.revision = d.revision
      ORDER BY d.local_date
    `)
    .all(from, to) as Record<string, unknown>[];
  return rows.map(parseDaily);
}

export function saveDaily(input: {
  date: string;
  status: DailyStatus;
  content: DailyContent;
  provider: AiProvider | null;
  model: string | null;
  manuallyEdited: boolean;
}): DailyReportRecord {
  const current = getLatestDaily(input.date);
  const revision = (current?.revision ?? 0) + 1;
  const now = new Date().toISOString();
  const result = db
    .prepare(`
      INSERT INTO daily_reports
      (local_date, revision, status, content_json, provider, model, generated_at, updated_at, manually_edited)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      input.date,
      revision,
      input.status,
      JSON.stringify(input.content),
      input.provider,
      input.model,
      now,
      now,
      input.manuallyEdited ? 1 : 0
    );
  return parseDaily(
    db.prepare("SELECT * FROM daily_reports WHERE id = ?").get(result.lastInsertRowid) as Record<
      string,
      unknown
    >
  );
}

export function getCachedSummary(cacheKey: string): SessionSummary | null {
  const row = db
    .prepare("SELECT summary_json FROM summary_cache WHERE cache_key = ?")
    .get(cacheKey) as { summary_json: string } | undefined;
  return row ? (JSON.parse(row.summary_json) as SessionSummary) : null;
}

export function saveCachedSummary(input: {
  cacheKey: string;
  source: string;
  date: string;
  summary: SessionSummary;
  provider: AiProvider;
  model: string;
}): void {
  db.prepare(`
    INSERT OR REPLACE INTO summary_cache
    (cache_key, source, local_date, summary_json, provider, model, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.cacheKey,
    input.source,
    input.date,
    JSON.stringify(input.summary),
    input.provider,
    input.model,
    new Date().toISOString()
  );
}

export function getLatestWeekly(isoWeek: string): WeeklyReportRecord | null {
  const row = db
    .prepare("SELECT * FROM weekly_reports WHERE iso_week = ? ORDER BY revision DESC LIMIT 1")
    .get(isoWeek) as Record<string, unknown> | undefined;
  return row ? parseWeekly(row) : null;
}

export function saveWeekly(input: {
  isoWeek: string;
  status: WeeklyStatus;
  content: WeeklyContent;
  dailyDates: string[];
  provider: AiProvider | null;
  model: string | null;
  outputPath?: string | null;
}): WeeklyReportRecord {
  const current = getLatestWeekly(input.isoWeek);
  const revision = (current?.revision ?? 0) + 1;
  const now = new Date().toISOString();
  const result = db
    .prepare(`
      INSERT INTO weekly_reports
      (iso_week, revision, status, content_json, daily_dates_json, provider, model, output_path, generated_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      input.isoWeek,
      revision,
      input.status,
      JSON.stringify(input.content),
      JSON.stringify(input.dailyDates),
      input.provider,
      input.model,
      input.outputPath ?? null,
      now,
      now
    );
  return parseWeekly(
    db.prepare("SELECT * FROM weekly_reports WHERE id = ?").get(result.lastInsertRowid) as Record<
      string,
      unknown
    >
  );
}

export function upsertJob(job: JobRecord): void {
  db.prepare(`
    INSERT INTO jobs
    (id, kind, status, progress, message, result_json, error, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status=excluded.status,
      progress=excluded.progress,
      message=excluded.message,
      result_json=excluded.result_json,
      error=excluded.error,
      updated_at=excluded.updated_at
  `).run(
    job.id,
    job.kind,
    job.status,
    job.progress,
    job.message,
    job.result === undefined ? null : JSON.stringify(job.result),
    job.error ?? null,
    job.createdAt,
    job.updatedAt
  );
}

export function getJob(id: string): JobRecord | null {
  const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    kind: row.kind as JobRecord["kind"],
    status: row.status as JobRecord["status"],
    progress: Number(row.progress),
    message: String(row.message),
    result: row.result_json ? JSON.parse(String(row.result_json)) : undefined,
    error: (row.error as string | null) ?? undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function getStoredSettings(): Record<string, unknown> {
  const rows = db.prepare("SELECT key, value_json FROM app_settings").all() as Array<{
    key: string;
    value_json: string;
  }>;
  return Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.value_json)]));
}

export function saveStoredSettings(values: Record<string, unknown>): void {
  const statement = db.prepare(`
    INSERT INTO app_settings (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at
  `);
  const now = new Date().toISOString();
  const transaction = db.transaction(() => {
    for (const [key, value] of Object.entries(values)) {
      statement.run(key, JSON.stringify(value), now);
    }
  });
  transaction();
}
