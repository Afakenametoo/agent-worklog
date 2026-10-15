import type {
  AiProvider,
  DailyContent,
  DailyReportRecord,
  WeeklyContent,
  WeeklyReportRecord
} from "../shared/types.js";
import { DailyContentSchema, WeeklyContentSchema } from "../shared/types.js";
import { generateDailyContent, generateWeeklyContent, modelFor } from "./ai.js";
import {
  getLatestDaily,
  getLatestWeekly,
  listDailiesForWeekly,
  listLatestConfirmedDailies,
  listLatestDailies,
  saveDaily,
  saveWeekly
} from "./db.js";
import { writeDailyMarkdown } from "./markdown.js";
import { scanSessions } from "./scanner.js";
import { isoWeekRange } from "./util.js";
import { createWeeklyDocx, inspectWeeklyDocx } from "./word.js";

export async function generateDaily(
  date: string,
  provider: AiProvider,
  onProgress?: (done: number, total: number) => void
): Promise<DailyReportRecord> {
  const sessions = await scanSessions(date, date);
  const content = await generateDailyContent(date, sessions, provider, modelFor(provider), onProgress);
  const report = saveDaily({
    date,
    status: "draft",
    content,
    provider,
    model: modelFor(provider),
    manuallyEdited: false
  });
  await writeDailyMarkdown(report);
  return report;
}

export async function editDaily(date: string, content: DailyContent): Promise<DailyReportRecord> {
  const current = getLatestDaily(date);
  const report = saveDaily({
    date,
    status: current?.status ?? "draft",
    content: DailyContentSchema.parse(content),
    provider: current?.provider ?? null,
    model: current?.model ?? null,
    manuallyEdited: true
  });
  await writeDailyMarkdown(report);
  return report;
}

export async function confirmDaily(date: string): Promise<DailyReportRecord> {
  const current = getLatestDaily(date);
  if (!current) throw new Error(`${date} 尚无日报。`);
  if (current.status === "confirmed") return current;
  const report = saveDaily({
    date,
    status: "confirmed",
    content: current.content,
    provider: current.provider,
    model: current.model,
    manuallyEdited: current.manuallyEdited
  });
  await writeDailyMarkdown(report);
  return report;
}

export async function generateWeekly(
  isoWeek: string,
  provider: AiProvider
): Promise<WeeklyReportRecord> {
  const range = isoWeekRange(isoWeek);
  const latest = listLatestDailies(range.start, range.end);
  const dailies = listLatestConfirmedDailies(range.start, range.end);
  const confirmedDates = new Set(dailies.map((daily) => daily.date));
  const unconfirmed = latest.filter(
    (daily) => daily.status !== "confirmed" && !confirmedDates.has(daily.date)
  );
  if (unconfirmed.length) {
    throw new Error(`存在未确认日报：${unconfirmed.map((daily) => daily.date).join("、")}`);
  }
  if (!dailies.length) throw new Error(`${isoWeek} 没有已确认日报。`);
  const content = await generateWeeklyContent(
    isoWeek,
    range.displayRange,
    dailies,
    provider,
    modelFor(provider)
  );
  return saveWeekly({
    isoWeek,
    status: "draft",
    content,
    dailyDates: dailies.map((daily) => daily.date),
    provider,
    model: modelFor(provider)
  });
}

export function editWeekly(isoWeek: string, content: WeeklyContent): WeeklyReportRecord {
  const current = getLatestWeekly(isoWeek);
  const range = isoWeekRange(isoWeek);
  return saveWeekly({
    isoWeek,
    status: "draft",
    content: WeeklyContentSchema.parse(content),
    dailyDates: current?.dailyDates ?? listDailiesForWeekly(range.start, range.end).map((item) => item.date),
    provider: current?.provider ?? null,
    model: current?.model ?? null
  });
}

export async function exportWeekly(isoWeek: string): Promise<WeeklyReportRecord> {
  const current = getLatestWeekly(isoWeek);
  if (!current) throw new Error(`${isoWeek} 尚无周报草稿。`);
  const outputPath = await createWeeklyDocx(isoWeek, current.content);
  const inspection = await inspectWeeklyDocx(outputPath);
  if (!inspection.extensionValid || inspection.bytes < 1000) {
    throw new Error("生成的 Word 文件结构检查失败。");
  }
  return saveWeekly({
    isoWeek,
    status: "exported",
    content: current.content,
    dailyDates: current.dailyDates,
    provider: current.provider,
    model: current.model,
    outputPath
  });
}
