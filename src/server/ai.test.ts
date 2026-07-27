import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openAiParse: vi.fn(),
  anthropicParse: vi.fn(),
  anthropicCreate: vi.fn(),
  anthropicConstructor: vi.fn()
}));

vi.mock("openai", () => ({
  default: class {
    responses = { parse: mocks.openAiParse };
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
  config: {
    openaiApiKey: "test-openai-key",
    anthropicApiKey: "",
    anthropicAuthToken: "test-anthropic-token",
    anthropicBaseUrl: "https://anthropic-compatible.example",
    openaiModel: "gpt-test",
    anthropicModel: "claude-test",
    author: "测试用户"
  }
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
  mocks.anthropicParse.mockReset();
  mocks.anthropicCreate.mockReset();
  mocks.anthropicConstructor.mockReset();
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
        maxRetries: 0
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
});
