import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openAiParse: vi.fn(),
  openAiChatCreate: vi.fn(),
  openAiConstructor: vi.fn(),
  anthropicParse: vi.fn(),
  anthropicCreate: vi.fn(),
  anthropicConstructor: vi.fn(),
  config: {
    openaiApiKey: "test-openai-key",
    anthropicApiKey: "",
    anthropicAuthToken: "test-anthropic-token",
    anthropicBaseUrl: "https://anthropic-compatible.example",
    openaiModel: "gpt-test",
    anthropicModel: "claude-test",
    aiRequestTimeoutMs: 90_000,
    author: "测试用户"
  }
}));

vi.mock("openai", () => ({
  default: class {
    constructor(options: unknown) {
      mocks.openAiConstructor(options);
    }
    responses = { parse: mocks.openAiParse };
    chat = { completions: { create: mocks.openAiChatCreate } };
  }
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    constructor(options: unknown) {
      mocks.anthropicConstructor(options);
    }
    messages = { parse: mocks.anthropicParse, create: mocks.anthropicCreate };
  }
}));

vi.mock("./config.js", () => ({
  config: mocks.config
}));

vi.mock("./db.js", () => ({
  getCachedSummary: vi.fn(() => null),
  saveCachedSummary: vi.fn()
}));

import { generateWeeklyContent } from "./ai.js";

const weekly = {
  projectName: "日报周报系统",
  dateRange: "2026年7月13日 - 2026年7月19日",
  author: "测试用户",
  workItems: ["完成适配器"],
  problems: [],
  nextWeekPlans: ["补充联调"],
  needHelp: "暂无需要协助的事项。"
};

beforeEach(() => {
  mocks.openAiParse.mockReset();
  mocks.openAiChatCreate.mockReset();
  mocks.openAiConstructor.mockReset();
  mocks.anthropicParse.mockReset();
  mocks.anthropicCreate.mockReset();
  mocks.anthropicConstructor.mockReset();
  mocks.config.anthropicBaseUrl = "https://anthropic-compatible.example";
});

describe("structured AI providers", () => {
  it("parses OpenAI structured output without storing requests", async () => {
    mocks.openAiParse.mockResolvedValue({
      output: [{ type: "message", content: [{ type: "output_text", parsed: weekly }] }]
    });
    await expect(
      generateWeeklyContent("2026-W29", weekly.dateRange, [], "openai", "gpt-test")
    ).resolves.toEqual(weekly);
    expect(mocks.openAiParse).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-test", store: false })
    );
    expect(mocks.anthropicParse).not.toHaveBeenCalled();
  });

  it("parses fenced JSON returned by an Anthropic-compatible endpoint", async () => {
    mocks.anthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: `\`\`\`json\n${JSON.stringify(weekly)}\n\`\`\`` }]
    });
    await expect(
      generateWeeklyContent("2026-W29", weekly.dateRange, [], "anthropic", "claude-test")
    ).resolves.toEqual(weekly);
    expect(mocks.anthropicCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-test", max_tokens: 8192 })
    );
    expect(mocks.anthropicConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: null,
        authToken: "test-anthropic-token",
        baseURL: "https://anthropic-compatible.example",
        maxRetries: 0,
        timeout: 90_000
      })
    );
    expect(mocks.anthropicParse).not.toHaveBeenCalled();
    expect(mocks.openAiParse).not.toHaveBeenCalled();
  });

  it("unwraps a named object returned by a compatible endpoint", async () => {
    mocks.anthropicCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({ weekly_report: weekly })
        }
      ]
    });
    await expect(
      generateWeeklyContent("2026-W29", weekly.dateRange, [], "anthropic", "claude-test")
    ).resolves.toEqual(weekly);
  });

  it("uses DeepSeek Chat Completions JSON mode without logging content or secrets", async () => {
    mocks.config.anthropicBaseUrl = "https://api.deepseek.com/anthropic";
    mocks.openAiChatCreate.mockResolvedValue({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify(weekly),
            reasoning_content: "private chain of thought"
          }
        }
      ]
    });
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await expect(
      generateWeeklyContent("2026-W29", weekly.dateRange, [], "anthropic", "deepseek-v4-flash")
    ).resolves.toEqual(weekly);

    expect(mocks.openAiConstructor).toHaveBeenCalledWith({
      apiKey: "test-anthropic-token",
      baseURL: "https://api.deepseek.com",
      maxRetries: 0,
      timeout: 90_000
    });
    expect(mocks.openAiChatCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "deepseek-v4-flash",
        stream: false,
        response_format: { type: "json_object" },
        thinking: { type: "disabled" }
      })
    );
    expect(mocks.anthropicConstructor).not.toHaveBeenCalled();
    const logged = log.mock.calls.flat().join(" ");
    expect(logged).toContain('"stop_reason":"stop"');
    expect(logged).toContain('"block_types":["reasoning","text"]');
    expect(logged).not.toContain("private chain of thought");
    expect(logged).not.toContain("test-anthropic-token");
    expect(logged).not.toContain(weekly.projectName);
    log.mockRestore();
  });

  it("retries the selected provider twice and never crosses providers", async () => {
    mocks.openAiParse
      .mockRejectedValueOnce(new Error("rate limited"))
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({
        output: [{ type: "message", content: [{ type: "output_text", parsed: weekly }] }]
      });
    await expect(
      generateWeeklyContent("2026-W29", weekly.dateRange, [], "openai", "gpt-test")
    ).resolves.toEqual(weekly);
    expect(mocks.openAiParse).toHaveBeenCalledTimes(3);
    expect(mocks.anthropicParse).not.toHaveBeenCalled();
  });

  it("does not retry non-retryable authentication errors", async () => {
    mocks.openAiParse.mockRejectedValue(
      Object.assign(new Error("invalid api key"), { status: 401 })
    );
    await expect(
      generateWeeklyContent("2026-W29", weekly.dateRange, [], "openai", "gpt-test")
    ).rejects.toThrow("invalid api key");
    expect(mocks.openAiParse).toHaveBeenCalledTimes(1);
  });
});
