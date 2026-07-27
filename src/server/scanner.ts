import fs from "node:fs/promises";
import path from "node:path";
import type { SessionDay, SourceHealth } from "../shared/types.js";
import { config } from "./config.js";
import { scanClaude, discoverWslClaudeRoots, listClaudeFiles, pathExists } from "./sources/claude.js";
import { scanCodex, listCodexFiles, codexRootExists } from "./sources/codex.js";
import { getOpenCodeHealth, scanOpenCode } from "./sources/opencode.js";
import { redactSensitive, sha256 } from "./util.js";

function isExcluded(session: SessionDay): boolean {
  const haystack = `${session.project}\n${session.title}\n${session.sourcePath}`.toLowerCase();
  return config.excludedProjects.some((pattern) => haystack.includes(pattern.toLowerCase()));
}

export async function scanSessions(from: string, to: string): Promise<SessionDay[]> {
  const [codex, claude, opencode] = await Promise.all([
    scanCodex(from, to),
    scanClaude(from, to),
    scanOpenCode(from, to)
  ]);
  const deduped = new Map<string, SessionDay>();
  for (const session of [...codex, ...claude, ...opencode]) {
    if (isExcluded(session)) continue;
    const safeSession = { ...session, title: redactSensitive(session.title) };
    const key = `${session.source}|${session.sessionId}|${session.date}`;
    const current = deduped.get(key);
    if (!current) {
      deduped.set(key, safeSession);
      continue;
    }
    const events = [...current.events, ...safeSession.events];
    const unique = [...new Map(events.map((event) => [event.id, event])).values()].sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp)
    );
    deduped.set(key, {
      ...current,
      events: unique,
      contentHash: sha256(unique.map((event) => `${event.role}:${event.text}`).join("\n"))
    });
  }
  return [...deduped.values()].sort((a, b) =>
    `${a.date}|${a.project}|${a.sessionId}`.localeCompare(`${b.date}|${b.project}|${b.sessionId}`)
  );
}

async function rootHealth(
  id: string,
  source: SourceHealth["source"],
  root: string,
  enabled: boolean,
  files: () => Promise<string[]>
): Promise<SourceHealth> {
  const exists = enabled && (source === "codex" ? await codexRootExists(root) : await pathExists(root));
  if (!exists) {
    return { id, source, root, enabled, exists: false, fileCount: 0, lastModified: null };
  }
  const paths = await files();
  let lastModified: string | null = null;
  for (const file of paths) {
    try {
      const stat = await fs.stat(file);
      const stamp = stat.mtime.toISOString();
      if (!lastModified || stamp > lastModified) lastModified = stamp;
    } catch {
      // 文件可能在扫描期间被会话归档移动。
    }
  }
  return { id, source, root, enabled, exists, fileCount: paths.length, lastModified };
}

export async function getSourceHealth(): Promise<SourceHealth[]> {
  const wsl = await discoverWslClaudeRoots();
  return Promise.all([
    rootHealth("codex-windows", "codex", config.codexHome, true, () =>
      listCodexFiles(config.codexHome)
    ),
    rootHealth("claude-windows", "claude-windows", config.claudeHome, true, () =>
      listClaudeFiles(config.claudeHome)
    ),
    getOpenCodeHealth(),
    ...wsl.map(({ distro, root }) =>
      rootHealth(`claude-wsl-${distro}`, "claude-wsl", root, config.enableWslClaude, () =>
        listClaudeFiles(root)
      )
    )
  ]);
}

export function sourceSummary(sessions: SessionDay[]): {
  sessions: number;
  events: number;
  projects: string[];
  bySource: Record<string, number>;
} {
  const bySource: Record<string, number> = {};
  for (const session of sessions) bySource[session.source] = (bySource[session.source] ?? 0) + 1;
  return {
    sessions: sessions.length,
    events: sessions.reduce((sum, session) => sum + session.events.length, 0),
    projects: [...new Set(sessions.map((session) => session.project))].sort(),
    bySource
  };
}
