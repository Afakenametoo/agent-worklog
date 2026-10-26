import fs from "node:fs/promises";
import path from "node:path";
import type { NormalizedEvent, SessionDay } from "../../shared/types.js";
import { config } from "../config.js";
import {
  basenameProject,
  localDate,
  normalizeText,
  readJsonLines,
  sha256,
  walkFiles
} from "../util.js";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function timestampIso(value: unknown): string {
  const numeric = typeof value === "number" ? value : Number(value);
  const date = Number.isFinite(numeric) ? new Date(numeric) : new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function messageText(content: unknown, blockType: "input_text" | "output_text"): string {
  if (!Array.isArray(content)) return "";
  return normalizeText(
    content
      .map((item) => {
        const block = object(item);
        return block?.type === blockType && typeof block.text === "string" ? block.text : "";
      })
      .filter(Boolean)
      .join("\n")
  );
}

export function extractWorkBuddyUserQuery(content: unknown): string {
  const text = messageText(content, "input_text");
  if (!text) return "";
  const queries = [...text.matchAll(/<user_query>([\s\S]*?)<\/user_query>/gi)]
    .map((match) => normalizeText(match[1] ?? ""))
    .filter(Boolean);
  return queries.length ? normalizeText(queries.join("\n")) : text;
}

export async function listWorkBuddyFiles(root = config.workbuddyHome): Promise<string[]> {
  return walkFiles(path.join(root, "projects"), (file) => {
    const normalized = file.replace(/\\/g, "/").toLowerCase();
    return normalized.endsWith(".jsonl") && !normalized.includes("/subagents/");
  });
}

export async function parseWorkBuddyFile(filePath: string): Promise<SessionDay[]> {
  const rows = await readJsonLines(filePath);
  let sessionId = path.basename(filePath, ".jsonl");
  let cwd = "";
  let title = "";
  const messages: Array<{
    id: string;
    timestamp: string;
    role: "user" | "assistant";
    text: string;
  }> = [];

  for (const row of rows) {
    const top = object(row);
    if (!top) continue;
    if (typeof top.sessionId === "string") sessionId = top.sessionId;
    if (typeof top.cwd === "string") cwd = top.cwd;
    if (top.type === "ai-title" && typeof top.aiTitle === "string") title = top.aiTitle;
    if (top.type !== "message" || (top.role !== "user" && top.role !== "assistant")) continue;

    const timestamp = timestampIso(top.timestamp);
    if (!timestamp) continue;
    const role = top.role;
    const text =
      role === "user"
        ? extractWorkBuddyUserQuery(top.content)
        : messageText(top.content, "output_text");
    if (!text) continue;
    messages.push({
      id:
        typeof top.id === "string"
          ? top.id
          : sha256(`${sessionId}|${timestamp}|${role}|${text}`),
      timestamp,
      role,
      text
    });
  }

  messages.sort((a, b) => `${a.timestamp}|${a.id}`.localeCompare(`${b.timestamp}|${b.id}`));
  const byDate = new Map<string, NormalizedEvent[]>();
  messages.forEach((message, index) => {
    const date = localDate(message.timestamp, config.timezone);
    const nextMessage = messages[index + 1];
    const phase =
      message.role === "user"
        ? "prompt"
        : nextMessage?.role === "assistant"
          ? "commentary"
          : "final";
    const event: NormalizedEvent = {
      id: sha256(`${sessionId}|${message.id}`),
      timestamp: message.timestamp,
      localDate: date,
      role: message.role,
      phase,
      text: message.text
    };
    const events = byDate.get(date) ?? [];
    events.push(event);
    byDate.set(date, events);
  });

  return [...byDate.entries()].map(([date, events]) => ({
    source: "workbuddy-windows",
    sessionId,
    title: title || basenameProject(cwd) || "WorkBuddy 会话",
    project: basenameProject(cwd),
    date,
    sourcePath: filePath,
    events,
    contentHash: sha256(events.map((event) => `${event.role}:${event.text}`).join("\n"))
  } satisfies SessionDay));
}

export async function scanWorkBuddy(
  from: string,
  to: string,
  root = config.workbuddyHome
): Promise<SessionDay[]> {
  const files = await listWorkBuddyFiles(root);
  const parsed = await Promise.all(
    files.map((file) => parseWorkBuddyFile(file).catch(() => []))
  );
  return parsed.flat().filter((session) => session.date >= from && session.date <= to);
}

export async function workBuddyRootExists(root = config.workbuddyHome): Promise<boolean> {
  return fs
    .access(root)
    .then(() => true)
    .catch(() => false);
}
