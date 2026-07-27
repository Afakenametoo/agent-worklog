import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listClaudeFiles, parseClaudeFile } from "./claude.js";

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("Claude parser", () => {
  it("keeps text blocks but excludes thinking, tool use, tool results and sidechains", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "report-claude-"));
    temporary.push(dir);
    const file = path.join(dir, "conversation.jsonl");
    const base = {
      sessionId: "claude-1",
      cwd: "D:\\code\\beta",
      isSidechain: false
    };
    const rows = [
      { type: "ai-title", aiTitle: "缓存优化", sessionId: "claude-1" },
      {
        ...base,
        type: "user",
        timestamp: "2026-07-26T02:00:00.000Z",
        message: { role: "user", content: "增加缓存" }
      },
      {
        ...base,
        type: "assistant",
        timestamp: "2026-07-26T02:01:00.000Z",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "秘密推理" },
            { type: "tool_use", name: "Bash", input: { command: "secret" } },
            { type: "text", text: "缓存和回归测试已完成。" }
          ]
        }
      },
      {
        ...base,
        type: "user",
        timestamp: "2026-07-26T02:02:00.000Z",
        message: { role: "user", content: [{ type: "tool_result", content: "secret output" }] }
      },
      {
        ...base,
        isSidechain: true,
        type: "assistant",
        timestamp: "2026-07-26T02:03:00.000Z",
        message: { role: "assistant", content: [{ type: "text", text: "子链重复" }] }
      }
    ];
    await fs.writeFile(file, rows.map(JSON.stringify).join("\n"));
    const result = await parseClaudeFile(file, "claude-windows");
    expect(result[0]?.title).toBe("缓存优化");
    expect(result[0]?.events.map((event) => event.text)).toEqual([
      "增加缓存",
      "缓存和回归测试已完成。"
    ]);
  });

  it("excludes nested subagent logs from discovery", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "report-claude-files-"));
    temporary.push(root);
    await fs.mkdir(path.join(root, "projects", "demo", "subagents"), { recursive: true });
    await fs.writeFile(path.join(root, "projects", "demo", "main.jsonl"), "{}");
    await fs.writeFile(path.join(root, "projects", "demo", "subagents", "agent.jsonl"), "{}");
    expect(await listClaudeFiles(root)).toEqual([path.join(root, "projects", "demo", "main.jsonl")]);
  });
});
