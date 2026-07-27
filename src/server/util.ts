import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { formatInTimeZone } from "date-fns-tz";
import {
  endOfISOWeek,
  format,
  getISOWeek,
  getISOWeekYear,
  parseISO,
  startOfISOWeek
} from "date-fns";

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function localDate(timestamp: string, timezone: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) throw new Error(`无效时间戳: ${timestamp}`);
  return formatInTimeZone(date, timezone, "yyyy-MM-dd");
}

export function todayInTimezone(timezone: string): string {
  return formatInTimeZone(new Date(), timezone, "yyyy-MM-dd");
}

export function isoWeekId(dateText: string): string {
  const date = parseISO(`${dateText}T12:00:00`);
  return `${getISOWeekYear(date)}-W${String(getISOWeek(date)).padStart(2, "0")}`;
}

export function isoWeekRange(isoWeek: string): {
  start: string;
  end: string;
  dates: string[];
  folderName: string;
  displayRange: string;
  fileRange: string;
} {
  const match = /^(\d{4})-W(\d{2})$/.exec(isoWeek);
  if (!match) throw new Error(`无效 ISO 周: ${isoWeek}`);
  const year = Number(match[1]);
  const week = Number(match[2]);
  const jan4 = new Date(year, 0, 4, 12);
  const weekOneStart = startOfISOWeek(jan4);
  const candidate = new Date(weekOneStart);
  candidate.setDate(candidate.getDate() + (week - 1) * 7);
  const start = startOfISOWeek(candidate);
  const end = endOfISOWeek(candidate);
  const dates = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return format(day, "yyyy-MM-dd");
  });
  return {
    start: format(start, "yyyy-MM-dd"),
    end: format(end, "yyyy-MM-dd"),
    dates,
    folderName: `${year}-${String(week).padStart(3, "0")}`,
    displayRange: `${format(start, "yyyy年M月d日")} - ${format(end, "yyyy年M月d日")}`,
    fileRange: `${format(start, "MMdd")}-${format(end, "MMdd")}`
  };
}

export async function readJsonLines(filePath: string): Promise<unknown[]> {
  const content = await fs.readFile(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const rows: unknown[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      // 活跃 JSONL 的最后一行可能仍在写入；忽略损坏行，不影响其他记录。
    }
  }
  return rows;
}

export async function walkFiles(
  root: string,
  predicate: (filePath: string) => boolean
): Promise<string[]> {
  const found: string[] = [];
  async function visit(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const filePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(filePath);
      } else if (entry.isFile() && predicate(filePath)) {
        found.push(filePath);
      }
    }
  }
  await visit(root);
  return found;
}

export function redactSensitive(text: string): string {
  const rules: Array<[RegExp, string]> = [
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "<REDACTED:PRIVATE_KEY>"],
    [/\bsk-[A-Za-z0-9_-]{16,}\b/g, "<REDACTED:OPENAI_KEY>"],
    [/\bsk-ant-[A-Za-z0-9_-]{16,}\b/g, "<REDACTED:ANTHROPIC_KEY>"],
    [/\bAKIA[0-9A-Z]{16}\b/g, "<REDACTED:AWS_KEY>"],
    [/(authorization\s*[:=]\s*bearer\s+)[^\s"',;]+/gi, "$1<REDACTED:TOKEN>"],
    [/(cookie\s*[:=]\s*)[^\r\n]+/gi, "$1<REDACTED:COOKIE>"],
    [/\b(password|passwd|pwd|token|secret|api[_-]?key)\s*[:=]\s*["']?[^"'\s,;]+/gi, "$1=<REDACTED>"],
    [/(密码|口令|令牌|密钥)\s*[:：=]?\s*["']?[^"'\s,;，。]+/g, "$1=<REDACTED>"]
  ];
  return rules.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), text);
}

export function basenameProject(value: string): string {
  if (!value) return "未命名项目";
  const normalized = value.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).filter(Boolean).at(-1) || "未命名项目";
}

export function normalizeText(value: string): string {
  return value.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").trim();
}

export async function ensureDirectory(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}
