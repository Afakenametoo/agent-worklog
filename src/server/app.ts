import path from "node:path";
import fs from "node:fs";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import {
  AiProviderSchema,
  DailyContentSchema,
  WeeklyContentSchema,
  type AiProvider
} from "../shared/types.js";
import { applyPublicSettings, config, publicSettings } from "./config.js";
import {
  getJob,
  getLatestDaily,
  getLatestWeekly,
  getStoredSettings,
  listLatestDailies,
  saveStoredSettings
} from "./db.js";
import { createJob, subscribeJob } from "./jobs.js";
import {
  confirmDaily,
  editDaily,
  editWeekly,
  exportWeekly,
  generateDaily,
  generateWeekly
} from "./report-service.js";
import { getSourceHealth, scanSessions, sourceSummary } from "./scanner.js";
import { isoWeekRange, todayInTimezone } from "./util.js";

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const IsoWeekSchema = z.string().regex(/^\d{4}-W\d{2}$/);

function allowedOrigin(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return (
      ["127.0.0.1", "localhost"].includes(url.hostname) &&
      ["http:", "https:"].includes(url.protocol)
    );
  } catch {
    return false;
  }
}

function providerFrom(value: unknown): AiProvider {
  return AiProviderSchema.parse(value ?? config.defaultProvider);
}

export async function buildApp() {
  applyPublicSettings(getStoredSettings());
  const app = Fastify({ logger: true, bodyLimit: 2 * 1024 * 1024 });

  app.addHook("onRequest", async (request, reply) => {
    if (!allowedOrigin(request)) {
      return reply.code(403).send({ error: "禁止来自非本机页面的请求。" });
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    const normalized = error instanceof Error ? error : new Error(String(error));
    const statusCode =
      error instanceof z.ZodError
        ? 400
        : typeof (error as { statusCode?: unknown })?.statusCode === "number"
          ? Number((error as { statusCode: number }).statusCode)
          : 500;
    reply.code(statusCode).send({
      error:
        error instanceof z.ZodError
          ? error.issues.map((issue) => issue.message).join("；")
          : normalized.message
    });
  });

  app.get("/api/health", async () => ({
    ok: true,
    now: new Date().toISOString(),
    timezone: config.timezone,
    today: todayInTimezone(config.timezone)
  }));

  app.get("/api/settings", async () => publicSettings());
  app.patch("/api/settings", async (request) => {
    const values = z
      .object({
        timezone: z.string().min(1).optional(),
        author: z.string().min(1).optional(),
        weeklyReportRoot: z.string().min(1).optional(),
        weeklyTemplatePath: z.string().optional(),
        defaultProvider: AiProviderSchema.optional(),
        openaiModel: z.string().min(1).optional(),
        anthropicModel: z.string().min(1).optional(),
        codexHome: z.string().min(1).optional(),
        claudeHome: z.string().min(1).optional(),
        enableWslClaude: z.boolean().optional(),
        excludedProjects: z.array(z.string()).optional()
      })
      .parse(request.body);
    saveStoredSettings(values);
    applyPublicSettings(values);
    return publicSettings();
  });
  app.get("/api/sources", async () => getSourceHealth());

  app.post("/api/scan", async (request) => {
    const body = z
      .object({ from: DateSchema, to: DateSchema })
      .parse(request.body ?? {
        from: todayInTimezone(config.timezone),
        to: todayInTimezone(config.timezone)
      });
    return createJob("scan", async (update) => {
      update(10, "正在读取 Codex 与 Claude 会话索引");
      const sessions = await scanSessions(body.from, body.to);
      update(90, "正在整理扫描结果");
      return { from: body.from, to: body.to, ...sourceSummary(sessions) };
    });
  });

  app.get("/api/dashboard", async (request) => {
    const query = z.object({ date: DateSchema.optional() }).parse(request.query);
    const date = query.date ?? todayInTimezone(config.timezone);
    const [sessions, sources] = await Promise.all([scanSessions(date, date), getSourceHealth()]);
    return {
      date,
      sourceSummary: sourceSummary(sessions),
      sessions: sessions.map((session) => ({
        source: session.source,
        sessionId: session.sessionId,
        title: session.title,
        project: session.project,
        eventCount: session.events.length,
        contentHash: session.contentHash
      })),
      sources,
      daily: getLatestDaily(date)
    };
  });

  app.get("/api/daily/:date", async (request, reply) => {
    const { date } = z.object({ date: DateSchema }).parse(request.params);
    const report = getLatestDaily(date);
    if (!report) return reply.code(404).send({ error: "该日期尚无日报。" });
    return report;
  });

  app.post("/api/daily/:date", async (request) => {
    const { date } = z.object({ date: DateSchema }).parse(request.params);
    const body = z.object({ provider: AiProviderSchema.optional() }).parse(request.body ?? {});
    const provider = providerFrom(body.provider);
    return createJob("daily", async (update) => {
      update(5, "正在扫描当日有效会话");
      const report = await generateDaily(date, provider, (done, total) => {
        const progress = 10 + (done / Math.max(total, 1)) * 75;
        update(progress, `正在总结会话 ${done}/${total}`);
      });
      update(95, "正在写入 Markdown 日报");
      return report;
    });
  });

  app.patch("/api/daily/:date", async (request) => {
    const { date } = z.object({ date: DateSchema }).parse(request.params);
    const content = DailyContentSchema.parse(request.body);
    return editDaily(date, content);
  });

  app.post("/api/daily/:date/confirm", async (request) => {
    const { date } = z.object({ date: DateSchema }).parse(request.params);
    return confirmDaily(date);
  });

  app.get("/api/weekly/:isoWeek", async (request, reply) => {
    const { isoWeek } = z.object({ isoWeek: IsoWeekSchema }).parse(request.params);
    const range = isoWeekRange(isoWeek);
    const report = getLatestWeekly(isoWeek);
    const dailies = listLatestDailies(range.start, range.end);
    if (!report && !dailies.length) return reply.code(404).send({ error: "该周尚无日报或周报。" });
    return { report, range, dailies };
  });

  app.post("/api/weekly/:isoWeek", async (request) => {
    const { isoWeek } = z.object({ isoWeek: IsoWeekSchema }).parse(request.params);
    const body = z.object({ provider: AiProviderSchema.optional() }).parse(request.body ?? {});
    const provider = providerFrom(body.provider);
    return createJob("weekly", async (update) => {
      update(10, "正在核对已确认日报");
      const report = await generateWeekly(isoWeek, provider);
      update(95, "正在保存周报草稿");
      return report;
    });
  });

  app.patch("/api/weekly/:isoWeek", async (request) => {
    const { isoWeek } = z.object({ isoWeek: IsoWeekSchema }).parse(request.params);
    return editWeekly(isoWeek, WeeklyContentSchema.parse(request.body));
  });

  app.post("/api/weekly/:isoWeek/export", async (request) => {
    const { isoWeek } = z.object({ isoWeek: IsoWeekSchema }).parse(request.params);
    return createJob("export", async (update) => {
      update(20, "正在生成 Word 文档");
      const report = await exportWeekly(isoWeek);
      update(90, "Word 结构检查通过");
      return report;
    });
  });

  app.get("/api/jobs/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const job = getJob(id);
    if (!job) return reply.code(404).send({ error: "任务不存在。" });
    return job;
  });

  app.get("/api/jobs/:id/events", async (request, reply: FastifyReply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const job = getJob(id);
    if (!job) return reply.code(404).send({ error: "任务不存在。" });
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    });
    const send = (value: unknown) => reply.raw.write(`data: ${JSON.stringify(value)}\n\n`);
    send(job);
    if (["completed", "failed"].includes(job.status)) {
      reply.raw.end();
      return;
    }
    const unsubscribe = subscribeJob(id, (next) => {
      send(next);
      if (["completed", "failed"].includes(next.status)) {
        unsubscribe();
        reply.raw.end();
      }
    });
    request.raw.on("close", unsubscribe);
  });

  const clientRoot = path.join(config.workspaceRoot, "dist", "client");
  if (fs.existsSync(clientRoot)) {
    await app.register(fastifyStatic, { root: clientRoot, prefix: "/" });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) return reply.code(404).send({ error: "接口不存在。" });
      return reply.sendFile("index.html");
    });
  }

  return app;
}
