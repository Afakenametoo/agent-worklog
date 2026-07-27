# 工作手记：AI 对话驱动的日报/周报

本地读取 Codex 与 Claude Code 会话，过滤系统指令、推理和原始工具输出，通过 OpenAI 或 Anthropic API 生成可审阅日报，再把已确认日报合并为 Word 周报。

## 快速开始

```powershell
Copy-Item .env.example .env.local
# 编辑 .env.local，至少配置一种 API Key
npm install
npm run dev
```

浏览器打开 <http://127.0.0.1:5178>。生产模式：

首次打开时先填写用户名（报告编写人）和日报输出目录。这些全局设置保存在本机 SQLite 中，后续启动自动沿用，也可以随时在“来源设置”中修改。

```powershell
npm run build
npm start
```

服务固定监听 `127.0.0.1`，拒绝非本机 Origin。API Key 只从服务端环境变量读取，不会通过设置接口返回。

Anthropic 兼容服务可通过 `ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_BASE_URL`
和 `ANTHROPIC_MODEL` 配置。使用智谱 Anthropic 兼容端点时，模型应填写其 GLM
模型编码，而不是 Claude 模型编码。

## 数据来源

- Codex：`%CODEX_HOME%` 或 `%USERPROFILE%\.codex`
  - `sessions/**/*.jsonl`
  - `archived_sessions/*.jsonl`
  - `session_index.jsonl`
- Claude Windows：`%USERPROFILE%\.claude\projects/**/*.jsonl`
- Claude WSL：自动发现非 `docker-desktop` 发行版的 `/home/*/.claude`
会话按每条消息的时间戳换算为 `Asia/Shanghai` 日期。Codex 的 developer、reasoning、工具输出和注入上下文，以及 Claude 的 thinking、tool_result、sidechain、subagent 日志不会进入总结输入。

## 报告工作流

1. 在“今日总览”检查来源和有效会话。
2. 生成日报草稿，在“日报编辑”修订后确认。
3. “周报编排”只合并周一至周日的已确认日报。
4. Word 输出到 `<周报目录>\YYYY-NNN\<编写人>MMDD-MMDD.docx`。

日报同时写入 `<日报目录>\YYYY\YYYY-MM-DD.md`；目录可以在首次设置或“来源设置”中选择。SQLite 只保存报告、摘要缓存、设置和任务状态，不复制完整原始对话。

## 命令行和定时任务

```powershell
npm run cli -- scan -- --from 2026-07-13 --to 2026-07-19
npm run report:daily -- --date today
npm run report:weekly -- --week 2026-W29 --export
```

显式安装或移除 Windows 任务计划：

```powershell
.\scripts\install-schedule.ps1
.\scripts\uninstall-schedule.ps1
```

安装脚本不会由 `npm install` 或应用启动自动执行。

## 主要接口

- `POST /api/scan`
- `GET|POST|PATCH /api/daily/:date`
- `POST /api/daily/:date/confirm`
- `GET|POST|PATCH /api/weekly/:isoWeek`
- `POST /api/weekly/:isoWeek/export`
- `GET /api/jobs/:id`
- `GET /api/jobs/:id/events`
- `GET|PATCH /api/settings`

## 验证

```powershell
npm run typecheck
npm test
npm run build
npm run test:e2e
```

没有 API Key 时，扫描、编辑、确认和 Word 导出仍可使用；AI 生成接口会返回明确的配置错误。
