import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming
} from "openai/resources/chat/completions";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";
import {
  DailyContentSchema,
  SessionSummarySchema,
  WeeklyContentSchema,
  type AiProvider,
  type DailyContent,
  type DailyReportRecord,
  type SessionDay,
  type SessionSummary,
  type WeeklyContent
} from "../shared/types.js";
import { config } from "./config.js";
import { getCachedSummary, saveCachedSummary } from "./db.js";
import { redactSensitive, sha256 } from "./util.js";

export class MissingApiKeyError extends Error {
  constructor(provider: AiProvider) {
    super(
      provider === "openai"
        ? "未配置 OPENAI_API_KEY，请在 .env.local 中配置后重启服务。"
        : "未配置 ANTHROPIC_API_KEY，请在 .env.local 中配置后重启服务。"
    );
    this.name = "MissingApiKeyError";
  }
}

export function modelFor(provider: AiProvider): string {
  return provider === "openai" ? config.openaiModel : config.anthropicModel;
}

function extractOpenAiParsed<T>(response: unknown): T {
  const top = response as { output?: Array<{ type?: string; content?: Array<Record<string, unknown>> }> };
  for (const item of top.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type === "refusal") {
        throw new Error(`模型拒绝生成报告：${String(content.refusal ?? "未知原因")}`);
      }
      if (content.parsed !== undefined) return content.parsed as T;
    }
  }
  throw new Error("OpenAI 未返回可解析的结构化结果。");
}

function extractJsonValue(text: string): unknown {
  const trimmed = text.trim().replace(/^\uFEFF/, "");
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    // 兼容端点有时会在 JSON 前后附加说明文字，下面提取首个完整对象或数组。
  }

  const start = candidate.search(/[\[{]/);
  if (start < 0) throw new Error("模型返回内容中没有 JSON 对象。");
  const opening = candidate[start];
  const closing = opening === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < candidate.length; index += 1) {
    const character = candidate[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === opening) depth += 1;
    if (character === closing) depth -= 1;
    if (depth === 0) return JSON.parse(candidate.slice(start, index + 1));
  }
  throw new Error("模型返回了不完整的 JSON。");
}

function extractAnthropicText(response: unknown): string {
  const message = response as { content?: Array<{ type?: string; text?: string }> };
  const text = (message.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
  if (!text) throw new Error("Anthropic 兼容端点未返回文本内容。");
  return text;
}

type DeepSeekMessage = ChatCompletion["choices"][number]["message"] & {
  reasoning_content?: unknown;
};

function isDeepSeekAnthropicEndpoint(baseUrl: string): boolean {
  if (!baseUrl) return false;
  try {
    return new URL(baseUrl).hostname.toLowerCase() === "api.deepseek.com";
  } catch {
    return false;
  }
}

function deepSeekOpenAiBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = url.pathname.replace(/\/anthropic\/?$/i, "") || "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function deepSeekBlockTypes(message: DeepSeekMessage | undefined): string[] {
  if (!message) return [];
  const types = new Set<string>();
  if (typeof message.content === "string") types.add("text");
  if (Array.isArray(message.content)) {
    for (const block of message.content as Array<{ type?: unknown }>) {
      types.add(typeof block.type === "string" ? block.type : "content");
    }
  }
  if (message.reasoning_content !== undefined && message.reasoning_content !== null)
    types.add("reasoning");
  if (message.tool_calls?.length) types.add("tool_calls");
  if (message.refusal !== undefined && message.refusal !== null) types.add("refusal");
  return [...types].sort();
}

function logDeepSeekResponse(response: ChatCompletion, attempt: number): void {
  const choice = response.choices[0];
  console.info(
    `[ai.deepseek.response] ${JSON.stringify({
      attempt,
      stop_reason: choice?.finish_reason ?? null,
      block_types: deepSeekBlockTypes(choice?.message as DeepSeekMessage | undefined)
    })}`
  );
}

function extractDeepSeekText(response: ChatCompletion): string {
  const message = response.choices[0]?.message as DeepSeekMessage | undefined;
  if (message?.refusal) throw new Error("DeepSeek 拒绝生成报告。");
  const content = message?.content;
  const text =
    typeof content === "string"
      ? content.trim()
      : Array.isArray(content)
        ? (content as Array<{ type?: string; text?: string }>)
            .filter((block) => block.type === "text" && typeof block.text === "string")
            .map((block) => block.text)
            .join("\n")
            .trim()
        : "";
  if (!text) throw new Error("DeepSeek 兼容端点未返回文本内容。");
  return text;
}

async function callDeepSeekStructured<T extends z.ZodType>(
  model: string,
  schema: T,
  system: string,
  prompt: string,
  attempt: number
): Promise<z.infer<T>> {
  const client = new OpenAI({
    apiKey: config.anthropicApiKey || config.anthropicAuthToken,
    baseURL: deepSeekOpenAiBaseUrl(config.anthropicBaseUrl),
    maxRetries: 0,
    timeout: config.aiRequestTimeoutMs
  });
  const params: ChatCompletionCreateParamsNonStreaming & {
    thinking: { type: "disabled" };
  } = {
    model,
    max_tokens: 8192,
    stream: false,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt }
    ],
    response_format: { type: "json_object" },
    thinking: { type: "disabled" }
  };
  const response = await client.chat.completions.create(params);
  logDeepSeekResponse(response, attempt);
  return parseSchemaValue(schema, extractJsonValue(extractDeepSeekText(response)));
}

function parseSchemaValue<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const candidates: unknown[] = [value];
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const wrapperKeys = [
      "data",
      "result",
      "output",
      "summary",
      "sessionSummary",
      "session_summary",
      "dailyReport",
      "daily_report",
      "weeklyReport",
      "weekly_report"
    ];
    for (const key of wrapperKeys) {
      if (record[key] !== undefined) candidates.push(record[key]);
    }
    const values = Object.values(record);
    if (values.length === 1) candidates.push(values[0]);
  }

  let lastError: z.ZodError | undefined;
  for (const candidate of candidates) {
    const parsed = schema.safeParse(candidate);
    if (parsed.success) return parsed.data;
    lastError = parsed.error;
  }

  const keys =
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.keys(value as Record<string, unknown>).join(", ") || "(空对象)"
      : typeof value;
  throw new Error(
    `模型输出字段不符合要求；顶层字段：${keys}。校验错误：${JSON.stringify(lastError?.issues ?? [])}`
  );
}

function isRetryableAiError(error: unknown): boolean {
  const candidate = error as { status?: unknown; code?: unknown; name?: unknown; message?: unknown };
  const status = typeof candidate?.status === "number" ? candidate.status : null;
  if (status !== null) return status === 408 || status === 409 || status === 429 || status >= 500;
  const code = String(candidate?.code ?? "").toUpperCase();
  if (["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN"].includes(code)) return true;
  const message = String(candidate?.message ?? error ?? "").toLowerCase();
  return [
    "timeout",
    "timed out",
    "rate limit",
    "未返回文本内容",
    "不完整的 json",
    "没有 json 对象",
    "字段不符合要求",
    "可解析的结构化结果"
  ].some((fragment) => message.includes(fragment));
}

async function callStructured<T extends z.ZodType>(
  provider: AiProvider,
  model: string,
  schema: T,
  schemaName: string,
  system: string,
  prompt: string
): Promise<z.infer<T>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      if (provider === "openai") {
        if (!config.openaiApiKey) throw new MissingApiKeyError(provider);
        const client = new OpenAI({
          apiKey: config.openaiApiKey,
          maxRetries: 0,
          timeout: config.aiRequestTimeoutMs
        });
        const response = await client.responses.parse({
          model,
          store: false,
          input: [
            { role: "system", content: system },
            { role: "user", content: prompt }
          ],
          text: { format: zodTextFormat(schema, schemaName) }
        });
        return schema.parse(extractOpenAiParsed<z.infer<T>>(response));
      }

      if (!config.anthropicApiKey && !config.anthropicAuthToken)
        throw new MissingApiKeyError(provider);
      const outputFormat = zodOutputFormat(schema);
      const compatiblePrompt = config.anthropicBaseUrl
        ? [
            prompt,
            "严格按照下面的 JSON Schema 输出。所有 required 字段都必须存在；没有内容的数组输出 []。",
            JSON.stringify(outputFormat.schema)
          ].join("\n\n")
        : prompt;
      if (isDeepSeekAnthropicEndpoint(config.anthropicBaseUrl)) {
        return await callDeepSeekStructured(
          model,
          schema,
          system,
          compatiblePrompt,
          attempt + 1
        );
      }
      const client = new Anthropic({
        apiKey: config.anthropicApiKey || null,
        authToken: config.anthropicAuthToken || null,
        baseURL: config.anthropicBaseUrl || undefined,
        maxRetries: 0,
        timeout: config.aiRequestTimeoutMs
      });
      const params: Anthropic.MessageCreateParamsNonStreaming = {
        model,
        max_tokens: 8192,
        system,
        messages: [{ role: "user", content: compatiblePrompt }],
        output_config: { format: outputFormat }
      };

      if (config.anthropicBaseUrl) {
        const response = await client.messages.create(params);
        return parseSchemaValue(schema, extractJsonValue(extractAnthropicText(response)));
      }

      const response = await client.messages.parse(params);
      if (!response.parsed_output) throw new Error("Anthropic 未返回可解析的结构化结果。");
      return schema.parse(response.parsed_output);
    } catch (error) {
      if (error instanceof MissingApiKeyError) throw error;
      lastError = error;
      if (attempt >= 2 || !isRetryableAiError(error)) break;
      await new Promise((resolve) => setTimeout(resolve, 750 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("模型调用失败。");
}

const evidenceRules = [
  "你是一名严谨的中文研发工作记录整理员。",
  "只能使用输入中明确出现的事实，不得补造完成结果、数值、问题、原因或计划。",
  "把尝试、讨论、计划与已完成工作严格区分。",
  "项目名称优先使用输入提供的项目字段。",
  "表述应适合正式研发日报/周报：简洁、具体，优先包含动作、对象和可验证结果。",
  "无法确认的内容放入 uncertainties，不要写成完成事项。",
  "不要输出 API Key、Token、Cookie、密码、私钥或完整本机路径。",
  "最终只输出一个 JSON 对象，不要使用 Markdown 代码块，也不要添加解释文字。"
].join("\n");

function sessionTranscript(session: SessionDay): string {
  const rows = session.events.map(
    (event) =>
      `[${event.timestamp}] ${event.role === "user" ? "用户任务" : event.phase === "final" ? "助手结果" : "过程更新"}：\n${event.text}`
  );
  return redactSensitive(
    [
      `来源：${session.source}`,
      `项目：${session.project}`,
      `会话：${session.title}`,
      `日期：${session.date}`,
      ...rows
    ].join("\n\n")
  );
}

export async function summarizeSessionDay(
  session: SessionDay,
  provider: AiProvider,
  model = modelFor(provider)
): Promise<SessionSummary> {
  const cacheKey = sha256(`session-v1|${provider}|${model}|${session.contentHash}`);
  const cached = getCachedSummary(cacheKey);
  if (cached) return cached;
  const transcript = sessionTranscript(session).slice(0, 60_000);
  const summary = await callStructured(
    provider,
    model,
    SessionSummarySchema,
    "session_summary",
    evidenceRules,
    `请从下面单个会话在单日内的记录中提取研发工作事实。若没有相应事实，返回空数组。\n\n${transcript}`
  );
  saveCachedSummary({
    cacheKey,
    source: session.source,
    date: session.date,
    summary,
    provider,
    model
  });
  return summary;
}

export async function generateDailyContent(
  date: string,
  sessions: SessionDay[],
  provider: AiProvider,
  model = modelFor(provider),
  onProgress?: (done: number, total: number) => void
): Promise<DailyContent> {
  const summaries: SessionSummary[] = [];
  for (let index = 0; index < sessions.length; index += 1) {
    const session = sessions[index];
    if (!session) continue;
    summaries.push(await summarizeSessionDay(session, provider, model));
    onProgress?.(index + 1, sessions.length);
  }
  const sourceRefs = sessions.map((session) => ({
    source: session.source,
    sessionId: session.sessionId,
    title: session.title,
    project: session.project,
    date: session.date,
    eventCount: session.events.length,
    contentHash: session.contentHash
  }));
  if (summaries.length === 0) {
    return { workItems: [], problems: [], nextSteps: [], uncertainties: [], sourceRefs };
  }
  const synthesized = await callStructured(
    provider,
    model,
    DailyContentSchema.omit({ sourceRefs: true }),
    "daily_report",
    evidenceRules,
    [
      `请将以下会话摘要合成为 ${date} 日报。`,
      "相同项目和事项应去重合并；问题必须有输入中明确对应的处理办法，否则放入待确认事项。",
      JSON.stringify(summaries, null, 2)
    ].join("\n\n")
  );
  return DailyContentSchema.parse({ ...synthesized, sourceRefs });
}

export async function generateWeeklyContent(
  isoWeek: string,
  dateRange: string,
  dailies: DailyReportRecord[],
  provider: AiProvider,
  model = modelFor(provider)
): Promise<WeeklyContent> {
  const dailyPayload = dailies.map((daily) => ({
    date: daily.date,
    workItems: daily.content.workItems,
    problems: daily.content.problems,
    nextSteps: daily.content.nextSteps,
    uncertainties: daily.content.uncertainties
  }));
  return callStructured(
    provider,
    model,
    WeeklyContentSchema,
    "weekly_report",
    evidenceRules,
    [
      `请将 ${isoWeek} 已确认日报合并为正式研发周报。`,
      `起止日期必须写为：${dateRange}`,
      `编写人必须写为：${config.author}`,
      "同一事项跨日推进时合并为一条，保留最完整、最接近最终结果的表述。",
      "nextWeekPlans 只能来自日报 nextSteps；needHelp 没有明确事项时写“暂无需要协助的事项。”。",
      JSON.stringify(dailyPayload, null, 2)
    ].join("\n\n")
  );
}
