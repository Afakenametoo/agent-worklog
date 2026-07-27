import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { config } from "./config.js";
import { writeDailyMarkdown } from "./markdown.js";
import type { DailyReportRecord } from "../shared/types.js";

const originalDailyOutputDir = config.dailyOutputDir;
let temporaryRoot = "";

afterEach(async () => {
  config.dailyOutputDir = originalDailyOutputDir;
  if (temporaryRoot) await fs.rm(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = "";
});

describe("writeDailyMarkdown", () => {
  it("将日报写入用户配置目录下的年份文件夹", async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-worklog-daily-"));
    config.dailyOutputDir = temporaryRoot;
    const report: DailyReportRecord = {
      id: 1,
      date: "2026-07-21",
      revision: 1,
      status: "draft",
      content: {
        workItems: ["完成日报目录配置"],
        problems: [],
        nextSteps: [],
        uncertainties: [],
        sourceRefs: []
      },
      provider: null,
      model: null,
      generatedAt: "2026-07-21T12:00:00.000Z",
      updatedAt: "2026-07-21T12:00:00.000Z",
      manuallyEdited: false
    };

    const outputPath = await writeDailyMarkdown(report);

    expect(outputPath).toBe(path.join(temporaryRoot, "2026", "2026-07-21.md"));
    await expect(fs.readFile(outputPath, "utf8")).resolves.toContain("# 2026-07-21 日报");
  });
});
