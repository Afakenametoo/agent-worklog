import { z } from "zod";

export const ProblemSchema = z.object({
  problem: z.string().trim().min(1),
  solution: z.string().trim().min(1)
});

export const SourceRefSchema = z.object({
  source: z.enum(["codex", "claude-windows", "claude-wsl"]),
  sessionId: z.string(),
  title: z.string(),
  project: z.string(),
  date: z.string(),
  eventCount: z.number().int().nonnegative(),
  contentHash: z.string()
});

export const DailyContentSchema = z.object({
  workItems: z.array(z.string().trim().min(1)),
  problems: z.array(ProblemSchema),
  nextSteps: z.array(z.string().trim().min(1)),
  uncertainties: z.array(z.string().trim().min(1)),
  sourceRefs: z.array(SourceRefSchema).default([])
});

export const SessionSummarySchema = z.object({
  projects: z.array(z.string().trim().min(1)),
  accomplishments: z.array(z.string().trim().min(1)),
  problems: z.array(ProblemSchema),
  nextSteps: z.array(z.string().trim().min(1)),
  uncertainties: z.array(z.string().trim().min(1))
});

export const WeeklyContentSchema = z.object({
  projectName: z.string().trim().min(1),
  dateRange: z.string().trim().min(1),
  author: z.string().trim().min(1),
  workItems: z.array(z.string().trim().min(1)),
  problems: z.array(ProblemSchema),
  nextWeekPlans: z.array(z.string().trim().min(1)),
  needHelp: z.string().trim().min(1)
});

export const DailyStatusSchema = z.enum(["draft", "confirmed"]);
export const WeeklyStatusSchema = z.enum(["draft", "exported"]);
export const AiProviderSchema = z.enum(["openai", "anthropic"]);

export type Problem = z.infer<typeof ProblemSchema>;
export type SourceRef = z.infer<typeof SourceRefSchema>;
export type DailyContent = z.infer<typeof DailyContentSchema>;
export type SessionSummary = z.infer<typeof SessionSummarySchema>;
export type WeeklyContent = z.infer<typeof WeeklyContentSchema>;
export type DailyStatus = z.infer<typeof DailyStatusSchema>;
export type WeeklyStatus = z.infer<typeof WeeklyStatusSchema>;
export type AiProvider = z.infer<typeof AiProviderSchema>;

export interface NormalizedEvent {
  id: string;
  timestamp: string;
  localDate: string;
  role: "user" | "assistant";
  phase: "prompt" | "commentary" | "final";
  text: string;
}

export interface SessionDay {
  source: SourceRef["source"];
  sessionId: string;
  title: string;
  project: string;
  date: string;
  sourcePath: string;
  events: NormalizedEvent[];
  contentHash: string;
}

export interface DailyReportRecord {
  id: number;
  date: string;
  revision: number;
  status: DailyStatus;
  content: DailyContent;
  provider: AiProvider | null;
  model: string | null;
  generatedAt: string;
  updatedAt: string;
  manuallyEdited: boolean;
}

export interface WeeklyReportRecord {
  id: number;
  isoWeek: string;
  revision: number;
  status: WeeklyStatus;
  content: WeeklyContent;
  dailyDates: string[];
  provider: AiProvider | null;
  model: string | null;
  outputPath: string | null;
  generatedAt: string;
  updatedAt: string;
}

export interface SourceHealth {
  id: string;
  source: SourceRef["source"];
  root: string;
  enabled: boolean;
  exists: boolean;
  fileCount: number;
  lastModified: string | null;
  message?: string;
}

export interface AppSettings {
  timezone: string;
  author: string;
  dailyOutputDir: string;
  weeklyReportRoot: string;
  weeklyTemplatePath: string;
  defaultProvider: AiProvider;
  openaiModel: string;
  anthropicModel: string;
  openaiConfigured: boolean;
  anthropicConfigured: boolean;
  codexHome: string;
  claudeHome: string;
  enableWslClaude: boolean;
  excludedProjects: string[];
}

export interface JobRecord {
  id: string;
  kind: "scan" | "daily" | "weekly" | "export";
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  message: string;
  result?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
}
