import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWeeklyDocx, inspectWeeklyDocx } from "./word.js";

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("weekly Word export", () => {
  it("writes a valid DOCX into a three-digit ISO week folder", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "report-word-"));
    temporary.push(root);
    const output = await createWeeklyDocx(
      "2026-W29",
      {
        projectName: "日报周报生成系统",
        dateRange: "2026年7月13日 - 2026年7月19日",
        author: "测试用户",
        workItems: ["完成多来源会话解析", "完成日报编辑与确认流程"],
        problems: [{ problem: "日志结构不同", solution: "采用来源适配器统一规范化" }],
        nextWeekPlans: ["补充真实 API 联调"],
        needHelp: "暂无需要协助的事项。"
      },
      root
    );
    expect(output).toBe(path.join(root, "2026-029", "测试用户0713-0719.docx"));
    expect(await inspectWeeklyDocx(output)).toMatchObject({ exists: true, extensionValid: true });
  });
});
