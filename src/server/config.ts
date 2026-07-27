import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";
import type { AiProvider, AppSettings } from "../shared/types.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

const workspaceRoot = path.resolve(process.cwd());
const userHome = os.homedir();

function envBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return !["0", "false", "no", "off"].includes(raw.toLowerCase());
}

function envList(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export const config = {
  workspaceRoot,
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 4178),
  dataDir: path.join(workspaceRoot, "data"),
  databasePath: path.join(workspaceRoot, "data", "report.db"),
  dailyDir: path.join(workspaceRoot, "data", "daily"),
  qaDir: path.join(workspaceRoot, "data", "qa"),
  timezone: process.env.TIMEZONE || "Asia/Shanghai",
  author: process.env.REPORT_AUTHOR || "朱双庆",
  weeklyReportRoot: process.env.WEEKLY_REPORT_ROOT || "D:\\code\\weekly_report",
  weeklyTemplatePath:
    process.env.WEEKLY_TEMPLATE_PATH ||
    "D:\\code\\weekly_report\\2026-004\\01驻场人员研发周报模板.docx",
  codexHome:
    process.env.CODEX_HOME || path.join(userHome, ".codex"),
  claudeHome:
    process.env.CLAUDE_HOME || path.join(userHome, ".claude"),
  enableWslClaude: envBoolean("ENABLE_WSL_CLAUDE", true),
  excludedProjects: envList("EXCLUDED_PROJECTS"),
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  anthropicAuthToken: process.env.ANTHROPIC_AUTH_TOKEN || "",
  anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL || "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-5.6-terra",
  anthropicModel: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
  defaultProvider: (
    process.env.DEFAULT_AI_PROVIDER === "anthropic" ? "anthropic" : "openai"
  ) as AiProvider
};

export function publicSettings(): AppSettings {
  return {
    timezone: config.timezone,
    author: config.author,
    weeklyReportRoot: config.weeklyReportRoot,
    weeklyTemplatePath: config.weeklyTemplatePath,
    defaultProvider: config.defaultProvider,
    openaiModel: config.openaiModel,
    anthropicModel: config.anthropicModel,
    openaiConfigured: Boolean(config.openaiApiKey),
    anthropicConfigured: Boolean(config.anthropicApiKey || config.anthropicAuthToken),
    codexHome: config.codexHome,
    claudeHome: config.claudeHome,
    enableWslClaude: config.enableWslClaude,
    excludedProjects: config.excludedProjects
  };
}

export function applyPublicSettings(
  settings: Partial<
    Pick<
      AppSettings,
      | "timezone"
      | "author"
      | "weeklyReportRoot"
      | "weeklyTemplatePath"
      | "defaultProvider"
      | "openaiModel"
      | "anthropicModel"
      | "codexHome"
      | "claudeHome"
      | "enableWslClaude"
      | "excludedProjects"
    >
  >
): void {
  if (settings.timezone !== undefined) config.timezone = settings.timezone;
  if (settings.author !== undefined) config.author = settings.author;
  if (settings.weeklyReportRoot !== undefined) config.weeklyReportRoot = settings.weeklyReportRoot;
  if (settings.weeklyTemplatePath !== undefined)
    config.weeklyTemplatePath = settings.weeklyTemplatePath;
  if (settings.defaultProvider !== undefined) config.defaultProvider = settings.defaultProvider;
  if (settings.openaiModel !== undefined) config.openaiModel = settings.openaiModel;
  if (settings.anthropicModel !== undefined) config.anthropicModel = settings.anthropicModel;
  if (settings.codexHome !== undefined) config.codexHome = settings.codexHome;
  if (settings.claudeHome !== undefined) config.claudeHome = settings.claudeHome;
  if (settings.enableWslClaude !== undefined) config.enableWslClaude = settings.enableWslClaude;
  if (settings.excludedProjects !== undefined) config.excludedProjects = settings.excludedProjects;
}
