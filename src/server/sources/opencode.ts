import fs from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import type {
  NormalizedEvent,
  SessionDay,
  SourceHealth
} from "../../shared/types.js";
import { config } from "../config.js";
import {
  basenameProject,
  localDate,
  normalizeText,
  redactSensitive,
  sha256
} from "../util.js";

type JsonObject = Record<string, unknown>;

interface OpenCodeRow {
  session_id: string;
  directory: string;
  title: string;
  message_id: string;
  message_data: string;
  part_id: string;
  part_time_created: number;
  part_data: string;
}

const requiredColumns = {
  session: ["id", "parent_id", "directory", "title"],
  message: ["id", "session_id", "time_created", "data"],
  part: ["id", "message_id", "session_id", "time_created", "data"]
} as const;

function object(value: unknown): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("JSON 记录不是对象");
  }
  return value as JsonObject;
}

function parseData(value: string): JsonObject {
  return object(JSON.parse(value));
}

function timestampIso(value: number): string {
  if (!Number.isFinite(value)) throw new Error("part.time_created 不是有效数字");
  const milliseconds = value < 100_000_000_000 ? value * 1000 : value;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) throw new Error("part.time_created 无法转换为时间");
  return date.toISOString();
}

function tableColumns(database: Database.Database, table: string): Set<string> {
  const rows = database.prepare(`PRAGMA table_info("${table}")`).all() as Array<{
    name: string;
  }>;
  return new Set(rows.map((row) => row.name));
}

function validateDatabase(database: Database.Database): void {
  for (const [table, columns] of Object.entries(requiredColumns)) {
    const actual = tableColumns(database, table);
    if (!actual.size) throw new Error(`缺少 ${table} 表`);
    const missing = columns.filter((column) => !actual.has(column));
    if (missing.length) throw new Error(`${table} 表缺少字段：${missing.join(", ")}`);
  }
  for (const table of ["message", "part"]) {
    try {
      const result = database
        .prepare(`SELECT COUNT(*) AS count FROM "${table}" WHERE json_valid(data) = 0`)
        .get() as { count: number };
      if (result.count > 0) throw new Error(`${table}.data 存在损坏 JSON`);
    } catch (error) {
      if (error instanceof Error && error.message.includes("损坏 JSON")) throw error;
      const rows = database.prepare(`SELECT data FROM "${table}"`).all() as Array<{
        data: string;
      }>;
      for (const row of rows) parseData(row.data);
    }
  }
}

function mergeSessionDays(sessions: SessionDay[]): SessionDay[] {
  const merged = new Map<string, SessionDay>();
  for (const session of sessions) {
    const key = `${session.sessionId}|${session.date}`;
    const current = merged.get(key);
    if (!current) {
      merged.set(key, session);
      continue;
    }
    const events = [...current.events, ...session.events];
    const unique = [...new Map(events.map((event) => [event.id, event])).values()].sort((a, b) =>
      `${a.timestamp}|${a.id}`.localeCompare(`${b.timestamp}|${b.id}`)
    );
    merged.set(key, {
      ...current,
      events: unique,
      contentHash: sha256(unique.map((event) => `${event.role}:${event.text}`).join("\n"))
    });
  }
  return [...merged.values()];
}

export async function listOpenCodeDatabases(
  root = config.opencodeDataDir
): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        /^opencode.*\.db$/i.test(entry.name)
    )
    .map((entry) => path.join(root, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true }));
}

export function parseOpenCodeDatabase(filePath: string): SessionDay[] {
  let database: Database.Database | null = null;
  try {
    database = new Database(filePath, { readonly: true, fileMustExist: true });
    validateDatabase(database);
    const rows = database
      .prepare(`
        SELECT
          s.id AS session_id,
          s.directory AS directory,
          s.title AS title,
          m.id AS message_id,
          m.data AS message_data,
          p.id AS part_id,
          p.time_created AS part_time_created,
          p.data AS part_data
        FROM session s
        JOIN message m ON m.session_id = s.id
        JOIN part p ON p.message_id = m.id AND p.session_id = s.id
        WHERE s.parent_id IS NULL OR s.parent_id = ''
        ORDER BY s.id, m.time_created, m.id, p.time_created, p.id
      `)
      .all() as OpenCodeRow[];

    const byMessage = new Map<
      string,
      {
        sessionId: string;
        directory: string;
        title: string;
        messageId: string;
        role: "user" | "assistant";
        parts: Array<{ id: string; timestamp: string; text: string }>;
      }
    >();

    for (const row of rows) {
      const message = parseData(row.message_data);
      const part = parseData(row.part_data);
      if (message.role !== "user" && message.role !== "assistant") continue;
      if (message.synthetic === true || message.synthetic === 1) continue;
      if (part.type !== "text" || part.synthetic === true || part.synthetic === 1) continue;
      const text = normalizeText(typeof part.text === "string" ? part.text : "");
      if (!text) continue;
      const messageKey = `${row.session_id}|${row.message_id}`;
      const current = byMessage.get(messageKey) ?? {
        sessionId: row.session_id,
        directory: row.directory,
        title: row.title,
        messageId: row.message_id,
        role: message.role,
        parts: []
      };
      current.parts.push({
        id: row.part_id,
        timestamp: timestampIso(Number(row.part_time_created)),
        text
      });
      byMessage.set(messageKey, current);
    }

    const groups = new Map<
      string,
      {
        sessionId: string;
        directory: string;
        title: string;
        date: string;
        events: NormalizedEvent[];
      }
    >();
    for (const message of byMessage.values()) {
      message.parts.forEach((part, index) => {
        const date = localDate(part.timestamp, config.timezone);
        const phase =
          message.role === "user"
            ? "prompt"
            : index === message.parts.length - 1
              ? "final"
              : "commentary";
        const event: NormalizedEvent = {
          id: sha256(`${message.sessionId}|${message.messageId}|${part.id}`),
          timestamp: part.timestamp,
          localDate: date,
          role: message.role,
          phase,
          text: part.text
        };
        const groupKey = `${message.sessionId}|${date}`;
        const group = groups.get(groupKey) ?? {
          sessionId: message.sessionId,
          directory: message.directory,
          title: message.title,
          date,
          events: []
        };
        group.events.push(event);
        groups.set(groupKey, group);
      });
    }

    return [...groups.values()].map((group) => {
      const events = group.events.sort((a, b) =>
        `${a.timestamp}|${a.id}`.localeCompare(`${b.timestamp}|${b.id}`)
      );
      return {
        source: "opencode-windows",
        sessionId: group.sessionId,
        title: redactSensitive(group.title || basenameProject(group.directory)),
        project: basenameProject(group.directory),
        date: group.date,
        sourcePath: filePath,
        events,
        contentHash: sha256(events.map((event) => `${event.role}:${event.text}`).join("\n"))
      } satisfies SessionDay;
    });
  } finally {
    database?.close();
  }
}

export async function scanOpenCode(
  from: string,
  to: string,
  root = config.opencodeDataDir
): Promise<SessionDay[]> {
  const databases = await listOpenCodeDatabases(root);
  const parsed = await Promise.all(
    databases.map(async (file) => {
      try {
        return parseOpenCodeDatabase(file);
      } catch {
        return [];
      }
    })
  );
  return mergeSessionDays(parsed.flat()).filter(
    (session) => session.date >= from && session.date <= to
  );
}

export async function getOpenCodeHealth(
  root = config.opencodeDataDir
): Promise<SourceHealth> {
  const exists = await fs
    .access(root)
    .then(() => true)
    .catch(() => false);
  if (!exists) {
    return {
      id: "opencode-windows",
      source: "opencode-windows",
      root,
      enabled: true,
      exists: false,
      fileCount: 0,
      lastModified: null,
      message: "未发现 OpenCode 数据目录"
    };
  }

  const databases = await listOpenCodeDatabases(root);
  const errors: string[] = [];
  let lastModified: string | null = null;
  for (const file of databases) {
    try {
      const stat = await fs.stat(file);
      const stamp = stat.mtime.toISOString();
      if (!lastModified || stamp > lastModified) lastModified = stamp;
      const database = new Database(file, { readonly: true, fileMustExist: true });
      try {
        validateDatabase(database);
      } finally {
        database.close();
      }
    } catch {
      errors.push(path.basename(file));
    }
  }
  return {
    id: "opencode-windows",
    source: "opencode-windows",
    root,
    enabled: true,
    exists: true,
    fileCount: databases.length,
    lastModified,
    message: errors.length ? `读取异常：${errors.join("、")}` : undefined
  };
}
