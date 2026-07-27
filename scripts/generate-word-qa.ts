import path from "node:path";
import { createWeeklyDocx, inspectWeeklyDocx } from "../src/server/word.js";

const outputRoot = path.resolve("data", "qa", "word-output");
const output = await createWeeklyDocx(
  "2026-W29",
  {
    projectName: "AI 对话驱动的日报周报生成系统",
    dateRange: "2026年7月13日 - 2026年7月19日",
    author: "朱双庆",
    workItems: [
      "完成 Codex、Claude Code Windows 与 WSL 会话适配及按上海时区归档。",
      "完成日报生成、结构化编辑、修订留痕和人工确认流程。",
      "完成周报合并、Word 导出、来源健康检查与本地任务进度展示。"
    ],
    problems: [
      {
        problem: "不同来源的事件结构与角色字段不一致。",
        solution: "使用独立适配器规范化为 SessionDay，并按事件哈希与会话 ID 去重。"
      },
      {
        problem: "原始对话可能包含凭据与大量工具输出。",
        solution: "在服务端过滤工具结果并执行敏感信息脱敏后再提交模型。"
      }
    ],
    nextWeekPlans: [
      "配置测试环境 API Key，完成 OpenAI 与 Anthropic 的真实结构化输出联调。",
      "根据实际日报样本微调提示词和周报措辞。"
    ],
    needHelp: "暂无需要协助的事项。"
  },
  outputRoot
);

console.log(JSON.stringify({ output, inspection: await inspectWeeklyDocx(output) }, null, 2));
