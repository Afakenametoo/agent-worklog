import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isInjectedCodexContext, parseCodexFile } from "./codex.js";

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("Codex parser", () => {
  it("keeps user-visible messages and excludes developer, reasoning and tool outputs", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "report-codex-"));
    temporary.push(dir);
    const file = path.join(dir, "rollout.jsonl");
    const rows = [
      {
        timestamp: "2026-07-26T01:00:00.000Z",
        type: "session_meta",
        payload: { id: "session-1", cwd: "D:\\code\\alpha" }
      },
      {
        timestamp: "2026-07-26T01:01:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "developer",
          content: [{ type: "input_text", text: "系统规则" }]
        }
      },
      {
        timestamp: "2026-07-26T01:02:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "<environment_context>noise</environment_context>" }]
        }
      },
      {
        timestamp: "2026-07-26T01:03:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "实现登录接口" }]
        }
      },
      {
        timestamp: "2026-07-26T01:04:00.000Z",
        type: "response_item",
        payload: {
          type: "reasoning",
          summary: [{ text: "隐藏推理" }]
        }
      },
      {
        timestamp: "2026-07-26T01:05:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          phase: "final_answer",
          content: [{ type: "output_text", text: "登录接口与测试已完成。" }]
        }
      },
      "{\"timestamp\":"
    ];
    await fs.writeFile(file, rows.map((row) => (typeof row === "string" ? row : JSON.stringify(row))).join("\n"));
    const result = await parseCodexFile(file, new Map([["session-1", "登录接口任务"]]));
    expect(result).toHaveLength(1);
    expect(result[0]?.project).toBe("alpha");
    expect(result[0]?.title).toBe("登录接口任务");
    expect(result[0]?.events.map((event) => event.text)).toEqual([
      "实现登录接口",
      "登录接口与测试已完成。"
    ]);
  });

  it("recognizes injected context records", () => {
    expect(isInjectedCodexContext("<recommended_plugins>...</recommended_plugins>")).toBe(true);
    expect(isInjectedCodexContext("修复这个问题")).toBe(false);
  });
});
