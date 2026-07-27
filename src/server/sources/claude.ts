import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { NormalizedEvent, SessionDay, SourceRef } from "../../shared/types.js";
import { config } from "../config.js";
import {
  basenameProject,
  localDate,
  normalizeText,
  readJsonLines,
  sha256,
  walkFiles
} from "../util.js";

const execFileAsync = promisify(execFile);
type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function userText(message: JsonObject): string {
  if (typeof message.content === "string") return normalizeText(message.content);
  if (!Array.isArray(message.content)) return "";
  return normalizeText(
    message.content
      .map((item) => {
        const block = object(item);
        return block?.type === "text" && typeof block.text === "string" ? block.text : "";
      })
      .filter(Boolean)
      .join("\n")
  );
}

function assistantText(message: JsonObject): string {
  if (!Array.isArray(message.content)) return "";
  return normalizeText(
    message.content
      .map((item) => {
        const block = object(item);
        return block?.type === "text" && typeof block.text === "string" ? block.text : "";
      })
      .filter(Boolean)
      .join("\n")
  );
}

export async function listClaudeFiles(root: string): Promise<string[]> {
  return walkFiles(path.join(root, "projects"), (file) => {
    const normalized = file.replace(/\\/g, "/").toLowerCase();
    return normalized.endsWith(".jsonl") && !normalized.includes("/subagents/");
  });
}

export async function parseClaudeFile(
  filePath: string,
  source: Extract<SourceRef["source"], "claude-windows" | "claude-wsl">
): Promise<SessionDay[]> {
  const rows = await readJsonLines(filePath);
  let sessionId = path.basename(filePath, ".jsonl");
  let cwd = "";
  let title = "";
  const byDate = new Map<string, NormalizedEvent[]>();

  for (const row of rows) {
    const top = object(row);
    if (!top) continue;
    if (typeof top.sessionId === "string") sessionId = top.sessionId;
    if (typeof top.cwd === "string") cwd = top.cwd;
    if (top.type === "ai-title" && typeof top.aiTitle === "string") title = top.aiTitle;
    if ((top.type !== "user" && top.type !== "assistant") || top.isSidechain === true) continue;
    const timestamp = typeof top.timestamp === "string" ? top.timestamp : "";
    const message = object(top.message);
    if (!timestamp || !message) continue;
    const text = top.type === "user" ? userText(message) : assistantText(message);
    if (!text) continue;
    const date = localDate(timestamp, config.timezone);
    const role = top.type;
    const phase = role === "user" ? "prompt" : "final";
    const id = sha256(`${sessionId}|${timestamp}|${role}|${text}`);
    const events = byDate.get(date) ?? [];
    events.push({ id, timestamp, localDate: date, role, phase, text });
    byDate.set(date, events);
  }

  return [...byDate.entries()].map(([date, events]) => {
    const unique = [...new Map(events.map((event) => [event.id, event])).values()].sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp)
    );
    return {
      source,
      sessionId,
      title: title || basenameProject(cwd) || "Claude 会话",
      project: basenameProject(cwd),
      date,
      sourcePath: filePath,
      events: unique,
      contentHash: sha256(unique.map((event) => `${event.role}:${event.text}`).join("\n"))
    } satisfies SessionDay;
  });
}

function decodeWslOutput(value: string | Buffer): string {
  if (typeof value === "string") return value;
  const utf8 = value.toString("utf8");
  return utf8.includes("\u0000") ? value.toString("utf16le") : utf8;
}

export async function discoverWslClaudeRoots(): Promise<
  Array<{ distro: string; root: string }>
> {
  if (process.platform !== "win32" || !config.enableWslClaude) return [];
  try {
    const { stdout } = await execFileAsync("wsl.exe", ["-l", "-q"], {
      encoding: "buffer",
      timeout: 7000,
      windowsHide: true,
      maxBuffer: 1024 * 1024
    });
    const distros = decodeWslOutput(stdout)
      .replace(/\u0000/g, "")
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter((value) => value && !value.toLowerCase().includes("docker-desktop"));
    const roots: Array<{ distro: string; root: string }> = [];
    for (const distro of distros) {
      try {
        const homeResult = await execFileAsync(
          "wsl.exe",
          ["-d", distro, "--", "sh", "-lc", 'printf "%s" "$HOME"'],
          { encoding: "utf8", timeout: 7000, windowsHide: true }
        );
        const home = String(homeResult.stdout).trim();
        if (!home.startsWith("/")) continue;
        const root = `\\\\wsl.localhost\\${distro}${home.replace(/\//g, "\\")}\\.claude`;
        roots.push({ distro, root });
      } catch {
        // 单个发行版不可用时不影响 Windows 数据源。
      }
    }
    return roots;
  } catch {
    return [];
  }
}

export async function scanClaudeRoot(
  root: string,
  source: Extract<SourceRef["source"], "claude-windows" | "claude-wsl">,
  from: string,
  to: string
): Promise<SessionDay[]> {
  const files = await listClaudeFiles(root);
  const parsed = await Promise.all(files.map((file) => parseClaudeFile(file, source).catch(() => [])));
  return parsed.flat().filter((session) => session.date >= from && session.date <= to);
}

export async function scanClaude(from: string, to: string): Promise<SessionDay[]> {
  const roots = await discoverWslClaudeRoots();
  const groups = await Promise.all([
    scanClaudeRoot(config.claudeHome, "claude-windows", from, to),
    ...roots.map(({ root }) => scanClaudeRoot(root, "claude-wsl", from, to))
  ]);
  return groups.flat();
}

export async function pathExists(root: string): Promise<boolean> {
  return fs
    .access(root)
    .then(() => true)
    .catch(() => false);
}
