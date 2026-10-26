import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractWorkBuddyUserQuery,
  listWorkBuddyFiles,
  parseWorkBuddyFile,
  scanWorkBuddy
} from "./workbuddy.js";

describe("WorkBuddy Windows parser", () => {
  it("只提取真实问答并排除系统上下文与工具记录", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "report-workbuddy-"));
    const projectDir = path.join(root, "projects", "d-code-demo");
    const file = path.join(projectDir, "session-1.jsonl");
    await fs.mkdir(projectDir, { recursive: true });
    const rows = [
      {
        type: "session-meta",
        id: "meta-1",
        sessionId: "session-1",
        timestamp: Date.parse("2026-10-15T01:00:00.000Z")
      },
      {
        type: "message",
        id: "user-1",
        sessionId: "session-1",
        cwd: "D:\\code\\demo",
        role: "user",
        timestamp: Date.parse("2026-10-15T01:01:00.000Z"),
        content: [
          {
            type: "input_text",
            text: "<system-reminder>不要纳入日报</system-reminder>\n<user_query>实现 WorkBuddy 数据源</user_query>"
          }
        ]
      },
      { type: "ai-title", aiTitle: "接入 WorkBuddy", sessionId: "session-1" },
      {
        type: "reasoning",
        content: [{ type: "reasoning_text", text: "内部推理" }]
      },
      {
        type: "message",
        id: "assistant-1",
        sessionId: "session-1",
        cwd: "D:\\code\\demo",
        role: "assistant",
        status: "completed",
        timestamp: Date.parse("2026-10-15T01:02:00.000Z"),
        content: [{ type: "output_text", text: "正在检查存储格式。" }]
      },
      {
        type: "function_call_result",
        output: "不应进入日报"
      },
      {
        type: "message",
        id: "assistant-2",
        sessionId: "session-1",
        cwd: "D:\\code\\demo",
        role: "assistant",
        status: "completed",
        timestamp: Date.parse("2026-10-15T01:03:00.000Z"),
        content: [{ type: "output_text", text: "WorkBuddy 数据源已接入。" }]
      }
    ];
    await fs.writeFile(file, rows.map((row) => JSON.stringify(row)).join("\n"), "utf8");

    const result = await parseWorkBuddyFile(file);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      source: "workbuddy-windows",
      sessionId: "session-1",
      title: "接入 WorkBuddy",
      project: "demo",
      date: "2026-10-15"
    });
    expect(result[0]?.events.map(({ role, phase, text }) => ({ role, phase, text }))).toEqual([
      { role: "user", phase: "prompt", text: "实现 WorkBuddy 数据源" },
      { role: "assistant", phase: "commentary", text: "正在检查存储格式。" },
      { role: "assistant", phase: "final", text: "WorkBuddy 数据源已接入。" }
    ]);
  });

  it("保留没有 user_query 包装的普通提问", () => {
    expect(
      extractWorkBuddyUserQuery([{ type: "input_text", text: "直接输入的问题" }])
    ).toBe("直接输入的问题");
  });

  it("忽略 subagents 并按日期扫描", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "report-workbuddy-files-"));
    const projectDir = path.join(root, "projects", "demo");
    const subagentDir = path.join(projectDir, "session-1", "subagents");
    await fs.mkdir(subagentDir, { recursive: true });
    const main = path.join(projectDir, "session-1.jsonl");
    await fs.writeFile(
      main,
      JSON.stringify({
        type: "message",
        id: "user-1",
        sessionId: "session-1",
        cwd: "D:\\code\\demo",
        role: "user",
        timestamp: Date.parse("2026-10-15T01:00:00.000Z"),
        content: [{ type: "input_text", text: "<user_query>主会话</user_query>" }]
      }),
      "utf8"
    );
    await fs.writeFile(path.join(subagentDir, "agent-1.jsonl"), "{}", "utf8");

    expect(await listWorkBuddyFiles(root)).toEqual([main]);
    expect(await scanWorkBuddy("2026-10-15", "2026-10-15", root)).toHaveLength(1);
    expect(await scanWorkBuddy("2026-10-16", "2026-10-16", root)).toEqual([]);
  });
});
