import type { AiProvider } from "../shared/types.js";
import { config } from "./config.js";
import { exportWeekly, generateDaily, generateWeekly } from "./report-service.js";
import { scanSessions, sourceSummary } from "./scanner.js";
import { isoWeekId, todayInTimezone } from "./util.js";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const command = process.argv[2];
const provider: AiProvider = arg("provider") === "anthropic" ? "anthropic" : config.defaultProvider;
const today = todayInTimezone(config.timezone);

try {
  if (command === "scan") {
    const from = arg("from") || today;
    const to = arg("to") || from;
    console.log(JSON.stringify({ from, to, ...sourceSummary(await scanSessions(from, to)) }, null, 2));
  } else if (command === "daily") {
    const date = arg("date") === "today" || !arg("date") ? today : String(arg("date"));
    const report = await generateDaily(date, provider, (done, total) =>
      console.log(`会话摘要 ${done}/${total}`)
    );
    console.log(JSON.stringify(report, null, 2));
  } else if (command === "weekly") {
    const isoWeek = arg("week") || isoWeekId(today);
    const report = await generateWeekly(isoWeek, provider);
    console.log(JSON.stringify(report, null, 2));
    if (process.argv.includes("--export")) {
      console.log(JSON.stringify(await exportWeekly(isoWeek), null, 2));
    }
  } else {
    console.error(
      "用法：npm run cli -- scan [--from YYYY-MM-DD --to YYYY-MM-DD] | daily [--date today] | weekly [--week YYYY-Www --export]"
    );
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
