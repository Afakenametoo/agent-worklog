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

function messageText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return normalizeText(
    content
      .map((item) => {
        const block = object(item);
        if (!block || !["input_text", "output_text"].includes(String(block.type))) return "";
        return typeof block.text === "string" ? block.text : "";
      })
      .filter(Boolean)
      .join("\n")
  );
}

export function isInjectedCodexContext(text: string): boolean {
  const trimmed = text.trim();
  return [
    "<recommended_plugins>",
    "<environment_context>",
    "# AGENTS.md instructions",
    "<app-context>",
    "<permissions instructions>",
    "<collaboration_mode>",
    "<skills_instructions>"
  ].some((prefix) => trimmed.startsWith(prefix));
}

async function loadTitleIndex(root: string): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  const indexPath = path.join(root, "session_index.jsonl");
  for (const row of await readJsonLines(indexPath).catch(() => [])) {
    const entry = object(row);
    if (typeof entry?.id === "string" && typeof entry.thread_name === "string") {
      index.set(entry.id, entry.thread_name);
    }
  }
  return index;
}

export async function listCodexFiles(root = config.codexHome): Promise<string[]> {
  const active = await walkFiles(path.join(root, "sessions"), (file) =>
    file.toLowerCase().endsWith(".jsonl")
  );
  const archived = await walkFiles(path.join(root, "archived_sessions"), (file) =>
    file.toLowerCase().endsWith(".jsonl")
  );
  return [...active, ...archived];
}

export async function parseCodexFile(
  filePath: string,
  titleIndex: Map<string, string> = new Map()
): Promise<SessionDay[]> {
  const rows = await readJsonLines(filePath);
  let sessionId = path.basename(filePath, ".jsonl");
  let cwd = "";

  for (const row of rows) {
    const top = object(row);
    const payload = object(top?.payload);
    if (top?.type === "session_meta" && payload) {
      sessionId = String(payload.id || payload.session_id || sessionId);
      cwd = typeof payload.cwd === "string" ? payload.cwd : cwd;
      break;
    }
  }

  const byDate = new Map<string, NormalizedEvent[]>();
  for (const row of rows) {
    const top = object(row);
    const payload = object(top?.payload);
    if (top?.type !== "response_item" || !payload || payload.type !== "message") continue;
    const role = payload.role;
    if (role !== "user" && role !== "assistant") continue;
    const timestamp = typeof top.timestamp === "string" ? top.timestamp : "";
    if (!timestamp) continue;
    const text = messageText(payload.content);
    if (!text || (role === "user" && isInjectedCodexContext(text))) continue;
    const phase =
      role === "user"
        ? "prompt"
        : payload.phase === "final_answer"
          ? "final"
          : "commentary";
    const date = localDate(timestamp, config.timezone);
    const id = sha256(`${sessionId}|${timestamp}|${role}|${phase}|${text}`);
    const event: NormalizedEvent = {
      id,
      timestamp,
      localDate: date,
      role,
      phase,
      text
    };
    const events = byDate.get(date) ?? [];
    events.push(event);
    byDate.set(date, events);
  }

  return [...byDate.entries()].map(([date, events]) => {
    const unique = [...new Map(events.map((event) => [event.id, event])).values()].sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp)
    );
    const contentHash = sha256(unique.map((event) => `${event.role}:${event.text}`).join("\n"));
    return {
      source: "codex",
      sessionId,
      title: titleIndex.get(sessionId) || basenameProject(cwd) || "Codex 会话",
      project: basenameProject(cwd),
      date,
      sourcePath: filePath,
      events: unique,
      contentHash
    } satisfies SessionDay;
  });
}

export async function scanCodex(
  from: string,
  to: string,
  root = config.codexHome
): Promise<SessionDay[]> {
  const [files, titleIndex] = await Promise.all([listCodexFiles(root), loadTitleIndex(root)]);
  const parsed = await Promise.all(
    files.map((file) => parseCodexFile(file, titleIndex).catch(() => []))
  );
  return parsed.flat().filter((session) => session.date >= from && session.date <= to);
}

export async function codexRootExists(root = config.codexHome): Promise<boolean> {
  return fs
    .access(root)
    .then(() => true)
    .catch(() => false);
}
