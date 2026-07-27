import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AiProvider,
  AppSettings,
  DailyContent,
  DailyReportRecord,
  JobRecord,
  Problem,
  SourceHealth,
  SourceRef,
  WeeklyContent,
  WeeklyReportRecord
} from "../shared/types";
import { api, waitForJob } from "./api";

type View = "dashboard" | "daily" | "weekly" | "settings";

interface DashboardData {
  date: string;
  sourceSummary: {
    sessions: number;
    events: number;
    projects: string[];
    bySource: Record<string, number>;
  };
  sessions: SourceRef[];
  sources: SourceHealth[];
  daily: DailyReportRecord | null;
}

interface WeeklyResponse {
  report: WeeklyReportRecord | null;
  range: { start: string; end: string; dates: string[]; displayRange: string };
  dailies: DailyReportRecord[];
}

function localToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function currentIsoWeek(dateText: string): string {
  const date = new Date(`${dateText}T12:00:00`);
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const emptyDaily: DailyContent = {
  workItems: [],
  problems: [],
  nextSteps: [],
  uncertainties: [],
  sourceRefs: []
};

const emptyWeekly: WeeklyContent = {
  projectName: "",
  dateRange: "",
  author: "",
  workItems: [],
  problems: [],
  nextWeekPlans: [],
  needHelp: "暂无需要协助的事项。"
};

function Mark({ name }: { name: "book" | "day" | "week" | "gear" | "scan" }) {
  const paths = {
    book: "M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21V5.5Zm16 0A2.5 2.5 0 0 0 17.5 3H13v16h4.5A2.5 2.5 0 0 1 20 21V5.5Z",
    day: "M6 3v3m12-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Zm3 8h3v3H8v-3Z",
    week: "M4 4h16v16H4V4Zm0 5h16M9 9v11m6-11v11",
    gear: "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0-5 1 2.1 2.3.6 1.9-1.3 1.9 1.9-1.3 1.9.6 2.3 2.1 1-2.1 1-.6 2.3 1.3 1.9-1.9 1.9-1.9-1.3-2.3.6-1 2.1-1-2.1-2.3-.6-1.9 1.3-1.9-1.9 1.3-1.9-.6-2.3-2.1-1 2.1-1 .6-2.3-1.3-1.9 1.9-1.9 1.9 1.3 2.3-.6 1-2.1Z",
    scan: "M4 7V4h3m10 0h3v3m0 10v3h-3M7 20H4v-3M7 12h10M12 7v10"
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}

function StatusStamp({ status }: { status?: string }) {
  const label =
    status === "confirmed" ? "已确认" : status === "exported" ? "已导出" : status ? "草稿" : "未生成";
  return <span className={`stamp stamp-${status || "empty"}`}>{label}</span>;
}

function ListEditor({
  title,
  value,
  onChange,
  placeholder
}: {
  title: string;
  value: string[];
  onChange: (value: string[]) => void;
  placeholder: string;
}) {
  return (
    <section className="editor-section">
      <div className="section-heading">
        <span>{title}</span>
        <button className="text-button" onClick={() => onChange([...value, ""])}>＋ 添加</button>
      </div>
      {value.length === 0 && <p className="empty-line">{placeholder}</p>}
      {value.map((item, index) => (
        <div className="list-row" key={`${title}-${index}`}>
          <span className="list-index">{String(index + 1).padStart(2, "0")}</span>
          <textarea
            value={item}
            rows={2}
            placeholder={placeholder}
            onChange={(event) => {
              const next = [...value];
              next[index] = event.target.value;
              onChange(next);
            }}
          />
          <button className="remove-button" onClick={() => onChange(value.filter((_, i) => i !== index))}>
            ×
          </button>
        </div>
      ))}
    </section>
  );
}

function ProblemsEditor({
  value,
  onChange
}: {
  value: Problem[];
  onChange: (value: Problem[]) => void;
}) {
  return (
    <section className="editor-section">
      <div className="section-heading">
        <span>问题与处理</span>
        <button className="text-button" onClick={() => onChange([...value, { problem: "", solution: "" }])}>
          ＋ 添加
        </button>
      </div>
      {value.length === 0 && <p className="empty-line">暂无明确问题记录。</p>}
      {value.map((item, index) => (
        <div className="problem-card" key={`problem-${index}`}>
          <div className="problem-number">{index + 1}</div>
          <label>
            <span>问题</span>
            <textarea
              rows={2}
              value={item.problem}
              onChange={(event) => {
                const next = [...value];
                next[index] = { ...item, problem: event.target.value };
                onChange(next);
              }}
            />
          </label>
          <label>
            <span>对策</span>
            <textarea
              rows={2}
              value={item.solution}
              onChange={(event) => {
                const next = [...value];
                next[index] = { ...item, solution: event.target.value };
                onChange(next);
              }}
            />
          </label>
          <button className="remove-button" onClick={() => onChange(value.filter((_, i) => i !== index))}>
            ×
          </button>
        </div>
      ))}
    </section>
  );
}

export function App() {
  const today = useMemo(localToday, []);
  const [view, setView] = useState<View>("dashboard");
  const [date, setDate] = useState(today);
  const [isoWeek, setIsoWeek] = useState(currentIsoWeek(today));
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [profileReady, setProfileReady] = useState<boolean | null>(null);
  const [provider, setProvider] = useState<AiProvider>("openai");
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [daily, setDaily] = useState<DailyReportRecord | null>(null);
  const [dailyContent, setDailyContent] = useState<DailyContent>(emptyDaily);
  const [weeklyData, setWeeklyData] = useState<WeeklyResponse | null>(null);
  const [weeklyContent, setWeeklyContent] = useState<WeeklyContent>(emptyWeekly);
  const [job, setJob] = useState<JobRecord | null>(null);
  const [notice, setNotice] = useState<string>("");
  const [error, setError] = useState<string>("");

  const run = useCallback(async (action: () => Promise<void>) => {
    setError("");
    setNotice("");
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);

  const refreshDashboard = useCallback(
    () =>
      run(async () => {
        const data = await api.get<DashboardData>(`/api/dashboard?date=${date}`);
        setDashboard(data);
        setDaily(data.daily);
        setDailyContent(data.daily?.content ?? emptyDaily);
      }),
    [date, run]
  );

  useEffect(() => {
    void run(async () => {
      const next = await api.get<AppSettings>("/api/settings");
      setSettings(next);
      setProfileReady(Boolean(next.author.trim()));
      setProvider(next.defaultProvider);
    });
  }, [run]);

  useEffect(() => {
    if (view === "dashboard" || view === "daily") void refreshDashboard();
  }, [view, refreshDashboard]);

  const runJob = async (created: JobRecord) => {
    setJob(created);
    return waitForJob(created, setJob);
  };

  const loadWeekly = () =>
    run(async () => {
      const data = await api.get<WeeklyResponse>(`/api/weekly/${isoWeek}`);
      setWeeklyData(data);
      setWeeklyContent(data.report?.content ?? emptyWeekly);
    });

  useEffect(() => {
    if (view === "weekly") void loadWeekly();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, isoWeek]);

  const generateDaily = () =>
    run(async () => {
      const created = await api.post<JobRecord>(`/api/daily/${date}`, { provider });
      const completed = await runJob(created);
      const report = completed.result as DailyReportRecord;
      setDaily(report);
      setDailyContent(report.content);
      setNotice("日报草稿已生成并同步为 Markdown。");
      await refreshDashboard();
    });

  const saveDaily = () =>
    run(async () => {
      const report = await api.patch<DailyReportRecord>(`/api/daily/${date}`, {
        ...dailyContent,
        workItems: dailyContent.workItems.filter(Boolean),
        problems: dailyContent.problems.filter((item) => item.problem && item.solution),
        nextSteps: dailyContent.nextSteps.filter(Boolean),
        uncertainties: dailyContent.uncertainties.filter(Boolean)
      });
      setDaily(report);
      setDailyContent(report.content);
      setNotice(`已保存为第 ${report.revision} 版。`);
    });

  const confirmDailyReport = () =>
    run(async () => {
      const report = await api.post<DailyReportRecord>(`/api/daily/${date}/confirm`);
      setDaily(report);
      setDailyContent(report.content);
      setNotice("日报已确认，可参与周报合并。");
    });

  const generateWeeklyReport = () =>
    run(async () => {
      const created = await api.post<JobRecord>(`/api/weekly/${isoWeek}`, { provider });
      const completed = await runJob(created);
      const report = completed.result as WeeklyReportRecord;
      setWeeklyData((current) => current && { ...current, report });
      setWeeklyContent(report.content);
      setNotice("周报草稿已生成。");
      await loadWeekly();
    });

  const saveWeeklyReport = () =>
    run(async () => {
      const report = await api.patch<WeeklyReportRecord>(`/api/weekly/${isoWeek}`, {
        ...weeklyContent,
        workItems: weeklyContent.workItems.filter(Boolean),
        problems: weeklyContent.problems.filter((item) => item.problem && item.solution),
        nextWeekPlans: weeklyContent.nextWeekPlans.filter(Boolean)
      });
      setWeeklyData((current) => current && { ...current, report });
      setWeeklyContent(report.content);
      setNotice(`周报已保存为第 ${report.revision} 版。`);
    });

  const exportWeeklyReport = () =>
    run(async () => {
      const created = await api.post<JobRecord>(`/api/weekly/${isoWeek}/export`);
      const completed = await runJob(created);
      const report = completed.result as WeeklyReportRecord;
      setWeeklyData((current) => current && { ...current, report });
      setNotice(`Word 已导出：${report.outputPath}`);
    });

  const saveSettings = () =>
    run(async () => {
      if (!settings) return;
      const next = await api.patch<AppSettings>("/api/settings", {
        timezone: settings.timezone,
        author: settings.author,
        dailyOutputDir: settings.dailyOutputDir,
        weeklyReportRoot: settings.weeklyReportRoot,
        weeklyTemplatePath: settings.weeklyTemplatePath,
        defaultProvider: settings.defaultProvider,
        openaiModel: settings.openaiModel,
        anthropicModel: settings.anthropicModel,
        codexHome: settings.codexHome,
        claudeHome: settings.claudeHome,
        enableWslClaude: settings.enableWslClaude,
        excludedProjects: settings.excludedProjects
      });
      setSettings(next);
      setProfileReady(true);
      setProvider(next.defaultProvider);
      setNotice("设置已保存到本机 SQLite；API Key 仍只从环境变量读取。");
    });

  return (
    <div className="app-shell">
      {settings && profileReady === false && (
        <div className="first-run-backdrop" role="presentation">
          <section
            className="first-run-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="first-run-title"
          >
            <span className="first-run-kicker">FIRST ENTRY · 首次启用</span>
            <div className="first-run-heading">
              <span className="brand-seal">启</span>
              <div>
                <h2 id="first-run-title">先留下你的署名</h2>
                <p>这是本机单用户应用，无需注册账号。用户名会作为报告编写人全局保存。</p>
              </div>
            </div>
            <label>
              用户名 / 报告编写人
              <input
                autoFocus
                value={settings.author}
                placeholder="例如：张三"
                onChange={(event) => setSettings({ ...settings, author: event.target.value })}
              />
            </label>
            <label>
              日报输出目录
              <input
                value={settings.dailyOutputDir}
                placeholder="例如：D:\reports\daily"
                onChange={(event) =>
                  setSettings({ ...settings, dailyOutputDir: event.target.value })
                }
              />
            </label>
            <p className="first-run-note">
              设置保存在本机 SQLite，不会上传用户名；日报将按年份写入所选目录。
            </p>
            <button
              className="primary-action wide"
              disabled={!settings.author.trim() || !settings.dailyOutputDir.trim()}
              onClick={saveSettings}
            >
              保存并进入工作台
            </button>
          </section>
        </div>
      )}
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-seal">记</span>
          <div>
            <strong>工作手记</strong>
            <small>AI REPORT DESK</small>
          </div>
        </div>
        <nav>
          {([
            ["dashboard", "book", "今日总览"],
            ["daily", "day", "日报编辑"],
            ["weekly", "week", "周报编排"],
            ["settings", "gear", "来源设置"]
          ] as const).map(([id, icon, label]) => (
            <button className={view === id ? "active" : ""} key={id} onClick={() => setView(id)}>
              <Mark name={icon} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="pulse" />
          <div>
            <strong>本机模式</strong>
            <small>127.0.0.1 · 数据不离盘</small>
          </div>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <p className="eyebrow">{view === "weekly" ? "WEEKLY COMPOSITION" : "DAILY FIELD NOTES"}</p>
            <h1>
              {view === "dashboard" && "让对话留下工作痕迹"}
              {view === "daily" && "日报编辑台"}
              {view === "weekly" && "周报编排台"}
              {view === "settings" && "来源与运行设置"}
            </h1>
          </div>
          <div className="top-controls">
            {view !== "settings" && (
              <select value={provider} onChange={(event) => setProvider(event.target.value as AiProvider)}>
                <option value="openai">OpenAI · {settings?.openaiModel || "未配置"}</option>
                <option value="anthropic">Anthropic · {settings?.anthropicModel || "未配置"}</option>
              </select>
            )}
            {view === "weekly" ? (
              <input type="week" value={isoWeek} onChange={(event) => setIsoWeek(event.target.value)} />
            ) : view !== "settings" ? (
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            ) : null}
          </div>
        </header>

        {job && !["completed", "failed"].includes(job.status) && (
          <div className="job-strip">
            <span>{job.message}</span>
            <div><i style={{ width: `${job.progress}%` }} /></div>
            <b>{job.progress}%</b>
          </div>
        )}
        {error && <div className="notice notice-error">{error}</div>}
        {notice && <div className="notice notice-success">{notice}</div>}

        {view === "dashboard" && (
          <div className="dashboard-grid">
            <section className="hero-card">
              <div className="hero-date">
                <span>{date.slice(5).replace("-", " / ")}</span>
                <small>{date.slice(0, 4)}</small>
              </div>
              <div className="hero-copy">
                <p>今日被识别为</p>
                <strong>{dashboard?.sourceSummary.projects.length || 0} 个项目</strong>
                <span>
                  {dashboard?.sourceSummary.sessions || 0} 段会话 · {dashboard?.sourceSummary.events || 0} 条有效消息
                </span>
              </div>
              <StatusStamp status={dashboard?.daily?.status} />
              <button className="primary-action" onClick={generateDaily}>
                <Mark name="scan" /> 扫描并生成日报
              </button>
            </section>

            <section className="source-panel">
              <div className="panel-title">
                <div><span>数据源</span><small>SOURCE PULSE</small></div>
                <button className="text-button" onClick={refreshDashboard}>刷新</button>
              </div>
              <div className="source-list">
                {(dashboard?.sources ?? []).map((source) => (
                  <div className="source-row" key={source.id}>
                    <span className={`source-dot ${source.exists ? "online" : ""}`} />
                    <div>
                      <strong>{source.source}</strong>
                      <small title={source.root}>{source.root}</small>
                    </div>
                    <b>{source.exists ? `${source.fileCount} 个记录` : "未发现"}</b>
                  </div>
                ))}
              </div>
            </section>

            <section className="session-panel">
              <div className="panel-title">
                <div><span>今日会话索引</span><small>EVIDENCE LEDGER</small></div>
              </div>
              <div className="session-table">
                {(dashboard?.sessions ?? []).length === 0 && <p className="empty-line">当日没有发现有效会话。</p>}
                {(dashboard?.sessions ?? []).map((session, index) => (
                  <div className="session-row" key={`${session.sessionId}-${index}`}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <strong>{session.title}</strong>
                      <small>{session.project} · {session.source}</small>
                    </div>
                    <b>{session.eventCount} 条</b>
                  </div>
                ))}
              </div>
            </section>

            <section className="workflow-panel">
              <span className="vertical-label">WORKFLOW</span>
              {["读取会话", "提取事实", "人工确认", "合并周报"].map((item, index) => (
                <div className="workflow-step" key={item}>
                  <b>{index + 1}</b><span>{item}</span>
                </div>
              ))}
            </section>
          </div>
        )}

        {view === "daily" && (
          <div className="report-layout">
            <article className="paper-editor">
              <div className="paper-head">
                <div><span>DAILY / {date}</span><h2>{date} 日报</h2></div>
                <StatusStamp status={daily?.status} />
              </div>
              {!daily && (
                <div className="blank-state">
                  <span className="brand-seal">启</span>
                  <h3>这一天还没有日报</h3>
                  <p>先扫描 Codex 与 Claude 对话，再生成一份可审阅的结构化草稿。</p>
                  <button className="primary-action" onClick={generateDaily}>生成日报草稿</button>
                </div>
              )}
              {daily && (
                <>
                  <ListEditor title="今日完成" value={dailyContent.workItems} onChange={(workItems) => setDailyContent({ ...dailyContent, workItems })} placeholder="填写一项可验证的完成事项" />
                  <ProblemsEditor value={dailyContent.problems} onChange={(problems) => setDailyContent({ ...dailyContent, problems })} />
                  <ListEditor title="后续计划" value={dailyContent.nextSteps} onChange={(nextSteps) => setDailyContent({ ...dailyContent, nextSteps })} placeholder="填写明确出现过的后续计划" />
                  <ListEditor title="待确认事项" value={dailyContent.uncertainties} onChange={(uncertainties) => setDailyContent({ ...dailyContent, uncertainties })} placeholder="记录证据不足或需要人工判断的内容" />
                </>
              )}
            </article>
            <aside className="evidence-drawer">
              <div className="panel-title"><div><span>来源凭据</span><small>LOCAL ONLY</small></div></div>
              {(dailyContent.sourceRefs ?? []).map((source) => (
                <div className="evidence-card" key={`${source.source}-${source.sessionId}`}>
                  <span>{source.source}</span>
                  <strong>{source.title}</strong>
                  <small>{source.project} · {source.eventCount} 条有效消息</small>
                </div>
              ))}
              <div className="action-stack">
                <button className="secondary-action" disabled={!daily} onClick={saveDaily}>保存修订</button>
                <button className="primary-action" disabled={!daily || daily.status === "confirmed"} onClick={confirmDailyReport}>确认日报</button>
              </div>
            </aside>
          </div>
        )}

        {view === "weekly" && (
          <div className="weekly-layout">
            <aside className="week-rail">
              <div className="panel-title"><div><span>本周日报</span><small>{weeklyData?.range.displayRange}</small></div></div>
              {(weeklyData?.range.dates ?? []).map((day) => {
                const report = weeklyData?.dailies.find((item) => item.date === day);
                return (
                  <div className="day-node" key={day}>
                    <span className={report?.status === "confirmed" ? "complete" : ""} />
                    <div><strong>{day.slice(5)}</strong><small>{report ? `${report.content.workItems.length} 项工作` : "无日报"}</small></div>
                    <StatusStamp status={report?.status} />
                  </div>
                );
              })}
              <button className="primary-action wide" onClick={generateWeeklyReport}>合并已确认日报</button>
            </aside>

            <article className="paper-editor weekly-paper">
              <div className="paper-head">
                <div><span>WEEKLY / {isoWeek}</span><h2>研发周报</h2></div>
                <StatusStamp status={weeklyData?.report?.status} />
              </div>
              {!weeklyData?.report && <div className="blank-state"><h3>等待合并</h3><p>确认本周日报后，系统会在这里生成正式周报草稿。</p></div>}
              {weeklyData?.report && (
                <>
                  <div className="metadata-grid">
                    <label>项目名称<input value={weeklyContent.projectName} onChange={(event) => setWeeklyContent({ ...weeklyContent, projectName: event.target.value })} /></label>
                    <label>起止日期<input value={weeklyContent.dateRange} onChange={(event) => setWeeklyContent({ ...weeklyContent, dateRange: event.target.value })} /></label>
                    <label>编写人<input value={weeklyContent.author} onChange={(event) => setWeeklyContent({ ...weeklyContent, author: event.target.value })} /></label>
                  </div>
                  <ListEditor title="本周事务开展及完成情况" value={weeklyContent.workItems} onChange={(workItems) => setWeeklyContent({ ...weeklyContent, workItems })} placeholder="填写本周完成事项" />
                  <ProblemsEditor value={weeklyContent.problems} onChange={(problems) => setWeeklyContent({ ...weeklyContent, problems })} />
                  <ListEditor title="下周工作计划" value={weeklyContent.nextWeekPlans} onChange={(nextWeekPlans) => setWeeklyContent({ ...weeklyContent, nextWeekPlans })} placeholder="填写下周计划" />
                  <section className="editor-section">
                    <div className="section-heading"><span>需要协助的事项</span></div>
                    <textarea rows={3} value={weeklyContent.needHelp} onChange={(event) => setWeeklyContent({ ...weeklyContent, needHelp: event.target.value })} />
                  </section>
                </>
              )}
              <div className="paper-actions">
                <button className="secondary-action" disabled={!weeklyData?.report} onClick={saveWeeklyReport}>保存周报</button>
                <button className="primary-action" disabled={!weeklyData?.report} onClick={exportWeeklyReport}>导出 Word</button>
              </div>
            </article>
          </div>
        )}

        {view === "settings" && settings && (
          <div className="settings-grid">
            <section className="settings-card">
              <div className="panel-title"><div><span>会话来源</span><small>READ-ONLY ROOTS</small></div></div>
              <label>Codex 主目录<input value={settings.codexHome} onChange={(event) => setSettings({ ...settings, codexHome: event.target.value })} /></label>
              <label>Claude 主目录<input value={settings.claudeHome} onChange={(event) => setSettings({ ...settings, claudeHome: event.target.value })} /></label>
              <button className="switch-row switch-button" onClick={() => setSettings({ ...settings, enableWslClaude: !settings.enableWslClaude })}><span>扫描 WSL Claude</span><b>{settings.enableWslClaude ? "已启用" : "已关闭"}</b></button>
              <p>应用只读访问会话日志；修改路径不会移动或改写原记录。</p>
            </section>
            <section className="settings-card">
              <div className="panel-title"><div><span>模型服务</span><small>SERVER-SIDE SECRETS</small></div></div>
              <div className="credential-row"><span>OpenAI</span><input value={settings.openaiModel} onChange={(event) => setSettings({ ...settings, openaiModel: event.target.value })} /><b className={settings.openaiConfigured ? "configured" : ""}>{settings.openaiConfigured ? "已配置" : "缺少 Key"}</b></div>
              <div className="credential-row"><span>Anthropic</span><input value={settings.anthropicModel} onChange={(event) => setSettings({ ...settings, anthropicModel: event.target.value })} /><b className={settings.anthropicConfigured ? "configured" : ""}>{settings.anthropicConfigured ? "已配置" : "缺少 Key"}</b></div>
              <label>默认提供商
                <select value={settings.defaultProvider} onChange={(event) => setSettings({ ...settings, defaultProvider: event.target.value as AiProvider })}>
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                </select>
              </label>
              <p>浏览器永远不会收到 API Key；修改环境变量后需重启服务。</p>
            </section>
            <section className="settings-card">
              <div className="panel-title"><div><span>报告输出</span><small>DOCUMENT ROUTING</small></div></div>
              <label>用户名 / 编写人<input value={settings.author} onChange={(event) => setSettings({ ...settings, author: event.target.value })} /></label>
              <label>时区<input value={settings.timezone} onChange={(event) => setSettings({ ...settings, timezone: event.target.value })} /></label>
              <label>日报目录<input value={settings.dailyOutputDir} onChange={(event) => setSettings({ ...settings, dailyOutputDir: event.target.value })} /></label>
              <label>周报目录<input value={settings.weeklyReportRoot} onChange={(event) => setSettings({ ...settings, weeklyReportRoot: event.target.value })} /></label>
              <label>参考模板<input value={settings.weeklyTemplatePath} onChange={(event) => setSettings({ ...settings, weeklyTemplatePath: event.target.value })} /></label>
              <label>排除项目（逗号分隔）<input value={settings.excludedProjects.join(", ")} onChange={(event) => setSettings({ ...settings, excludedProjects: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} /></label>
            </section>
            <section className="settings-card schedule-card">
              <div className="panel-title"><div><span>定时草稿</span><small>OPT-IN AUTOMATION</small></div></div>
              <div className="schedule-time"><strong>23:00</strong><span>每日生成日报草稿</span></div>
              <div className="schedule-time"><strong>周日 23:30</strong><span>合并已确认日报</span></div>
              <p>默认不注册系统任务。需要时在 PowerShell 执行 <code>scripts\install-schedule.ps1</code>；撤销执行 <code>scripts\uninstall-schedule.ps1</code>。</p>
              <button className="primary-action wide" onClick={saveSettings}>保存全部设置</button>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
