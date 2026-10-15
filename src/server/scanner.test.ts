import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionDay } from "../shared/types.js";

const mocks = vi.hoisted(() => ({
  scanCodex: vi.fn(),
  scanClaude: vi.fn(),
  scanOpenCode: vi.fn(),
  config: {
    timezone: "Asia/Shanghai",
    codexHome: "C:\\codex",
    claudeHome: "C:\\claude",
    opencodeDataDir: "C:\\opencode",
    enableWslClaude: false,
    excludedProjects: [] as string[]
  }
}));

vi.mock("./config.js", () => ({ config: mocks.config }));
vi.mock("./sources/codex.js", () => ({
  scanCodex: mocks.scanCodex,
  listCodexFiles: vi.fn(async () => []),
  codexRootExists: vi.fn(async () => true)
}));
vi.mock("./sources/claude.js", () => ({
  scanClaude: mocks.scanClaude,
  discoverWslClaudeRoots: vi.fn(async () => []),
  listClaudeFiles: vi.fn(async () => []),
  pathExists: vi.fn(async () => true)
}));
vi.mock("./sources/opencode.js", () => ({
  scanOpenCode: mocks.scanOpenCode,
  getOpenCodeHealth: vi.fn(async () => ({
    id: "opencode-windows",
    source: "opencode-windows",
    root: "C:\\opencode",
    enabled: true,
    exists: true,
    fileCount: 0,
    lastModified: null
  }))
}));

import { clearScanCache, scanSessions } from "./scanner.js";

const session: SessionDay = {
  source: "codex",
  sessionId: "session-1",
  title: "缓存测试",
  project: "report",
  date: "2026-08-06",
  sourcePath: "C:\\codex\\session.jsonl",
  events: [],
  contentHash: "hash"
};

beforeEach(() => {
  clearScanCache();
  mocks.scanCodex.mockReset().mockResolvedValue([session]);
  mocks.scanClaude.mockReset().mockResolvedValue([]);
  mocks.scanOpenCode.mockReset().mockResolvedValue([]);
});

describe("session scan cache", () => {
  it("合并相同日期的并发扫描并复用短时缓存", async () => {
    const [first, second] = await Promise.all([
      scanSessions("2026-08-06", "2026-08-06"),
      scanSessions("2026-08-06", "2026-08-06")
    ]);
    const third = await scanSessions("2026-08-06", "2026-08-06");

    expect(first).toEqual([session]);
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(mocks.scanCodex).toHaveBeenCalledTimes(1);
    expect(mocks.scanClaude).toHaveBeenCalledTimes(1);
    expect(mocks.scanOpenCode).toHaveBeenCalledTimes(1);
  });

  it("设置变化后使用新的缓存键", async () => {
    await scanSessions("2026-08-06", "2026-08-06");
    mocks.config.excludedProjects = ["ignored"];
    await scanSessions("2026-08-06", "2026-08-06");

    expect(mocks.scanCodex).toHaveBeenCalledTimes(2);
    mocks.config.excludedProjects = [];
  });
});
