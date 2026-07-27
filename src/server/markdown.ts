import fs from "node:fs/promises";
import path from "node:path";
import type { DailyReportRecord } from "../shared/types.js";
import { config } from "./config.js";
import { ensureDirectory } from "./util.js";

function yamlString(value: string): string {
  return JSON.stringify(value);
}

export function dailyMarkdown(report: DailyReportRecord): string {
  const lines = [
    "---",
    `date: ${yamlString(report.date)}`,
    `status: ${yamlString(report.status)}`,
    `revision: ${report.revision}`,
    `provider: ${yamlString(report.provider ?? "")}`,
    `model: ${yamlString(report.model ?? "")}`,
    `updated_at: ${yamlString(report.updatedAt)}`,
    "---",
    "",
    `# ${report.date} 日报`,
    "",
    "## 今日完成",
    "",
    ...(report.content.workItems.length
      ? report.content.workItems.map((item) => `- ${item}`)
      : ["- 暂无可确认完成事项。"]),
    "",
    "## 问题与处理",
    "",
    ...(report.content.problems.length
      ? report.content.problems.flatMap((item) => [
          `- 问题：${item.problem}`,
          `  - 处理：${item.solution}`
        ])
      : ["- 暂无明确问题记录。"]),
    "",
    "## 后续计划",
    "",
    ...(report.content.nextSteps.length
      ? report.content.nextSteps.map((item) => `- ${item}`)
      : ["- 暂无明确后续计划。"]),
    "",
    "## 待确认事项",
    "",
    ...(report.content.uncertainties.length
      ? report.content.uncertainties.map((item) => `- ${item}`)
      : ["- 无。"]),
    "",
    "## 来源会话",
    "",
    ...(report.content.sourceRefs.length
      ? report.content.sourceRefs.map(
          (source) =>
            `- ${source.source} · ${source.project} · ${source.title}（${source.eventCount} 条有效消息）`
        )
      : ["- 当日未发现有效会话。"]),
    ""
  ];
  return lines.join("\n");
}

export async function writeDailyMarkdown(report: DailyReportRecord): Promise<string> {
  const year = report.date.slice(0, 4);
  const dir = path.join(config.dailyOutputDir, year);
  await ensureDirectory(dir);
  const outputPath = path.join(dir, `${report.date}.md`);
  const temporary = `${outputPath}.tmp`;
  await fs.writeFile(temporary, dailyMarkdown(report), "utf8");
  await fs.rename(temporary, outputPath);
  return outputPath;
}
