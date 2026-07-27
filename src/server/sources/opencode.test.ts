import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { config } from "../config.js";
import {
  getOpenCodeHealth,
  listOpenCodeDatabases,
  parseOpenCodeDatabase,
  scanOpenCode
} from "./opencode.js";

const temporary: string[] = [];
const originalTimezone = config.timezone;

function createDatabase(
  filePath: string,
  options: { extraSessionColumns?: boolean; wal?: boolean } = {}
): Database.Database {
  const database = new Database(filePath);
  if (options.wal) database.pragma("journal_mode = WAL");
  database.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      directory TEXT NOT NULL,
      title TEXT NOT NULL
      ${options.extraSessionColumns ? ", version TEXT, metadata TEXT" : ""}
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      data TEXT NOT NULL
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `);
  return database;
}

function insertSession(
  database: Database.Database,
  input: {
    sessionId?: string;
    parentId?: string | null;
    title?: string;
    directory?: string;
    prefix?: string;
  } = {}
): void {
  const sessionId = input.sessionId ?? "session-1";
  const prefix = input.prefix ?? "";
  database
    .prepare("INSERT INTO session (id, parent_id, directory, title) VALUES (?, ?, ?, ?)")
    .run(
      sessionId,
      input.parentId ?? null,
      input.directory ?? "D:\\code\\open-project",
      input.title ?? "OpenCode 任务"
    );
  database
    .prepare("INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)")
    .run(
      `${prefix}message-user`,
      sessionId,
      Date.parse("2026-07-26T15:58:00.000Z"),
      JSON.stringify({ role: "user" })
    );
  database
    .prepare(
      "INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)"
    )
    .run(
      `${prefix}part-user`,
      `${prefix}message-user`,
      sessionId,
      Date.parse("2026-07-26T15:59:00.000Z"),
      JSON.stringify({ type: "text", text: "实现 OpenCode 数据源" })
    );
}

afterEach(async () => {
  config.timezone = originalTimezone;
  await Promise.all(temporary.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("OpenCode Windows parser", () => {
  it("按 part 时间跨日，并只保留主会话的非 synthetic 文本", async () => {
    config.timezone = "Asia/Shanghai";
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "report-opencode-filter-"));
    temporary.push(root);
    const file = path.join(root, "opencode-main.db");
    const database = createDatabase(file);
    insertSession(database, {
      title:
        "修复 密码：中文秘密 password=super-secret Token=abcdefghijklmnop Cookie: session=private"
    });

    database
      .prepare("INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)")
      .run(
        "message-assistant",
        "session-1",
        Date.parse("2026-07-26T15:59:10.000Z"),
        JSON.stringify({ role: "assistant" })
      );
    const insertPart = database.prepare(
      "INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)"
    );
    insertPart.run(
      "part-commentary",
      "message-assistant",
      "session-1",
      Date.parse("2026-07-26T15:59:11.000Z"),
      JSON.stringify({ type: "text", text: "正在整理结构。" })
    );
    insertPart.run(
      "part-reasoning",
      "message-assistant",
      "session-1",
      Date.parse("2026-07-26T15:59:12.000Z"),
      JSON.stringify({ type: "reasoning", text: "隐藏推理" })
    );
    insertPart.run(
      "part-tool",
      "message-assistant",
      "session-1",
      Date.parse("2026-07-26T15:59:13.000Z"),
      JSON.stringify({ type: "tool", state: { output: "工具输出" } })
    );
    insertPart.run(
      "part-final",
      "message-assistant",
      "session-1",
      Date.parse("2026-07-26T15:59:14.000Z"),
      JSON.stringify({ type: "text", text: "适配器和测试已完成。" })
    );
    insertPart.run(
      "part-synthetic",
      "message-assistant",
      "session-1",
      Date.parse("2026-07-26T15:59:15.000Z"),
      JSON.stringify({ type: "text", text: "合成文本", synthetic: true })
    );
    for (const [id, type] of [
      ["part-step", "step-start"],
      ["part-compaction", "compaction"],
      ["part-file", "file"],
      ["part-snapshot", "snapshot"],
      ["part-unknown", "future-part"]
    ]) {
      insertPart.run(
        id,
        "message-assistant",
        "session-1",
        Date.parse("2026-07-26T15:59:16.000Z"),
        JSON.stringify({ type, text: `不应保留：${type}` })
      );
    }

    database
      .prepare("INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)")
      .run(
        "message-next-day",
        "session-1",
        Date.parse("2026-07-26T16:00:00.000Z"),
        JSON.stringify({ role: "user" })
      );
    insertPart.run(
      "part-next-day",
      "message-next-day",
      "session-1",
      Date.parse("2026-07-26T16:01:00.000Z"),
      JSON.stringify({ type: "text", text: "继续补充跨日测试" })
    );

    database
      .prepare("INSERT INTO session (id, parent_id, directory, title) VALUES (?, ?, ?, ?)")
      .run("child-session", "session-1", "D:\\code\\open-project", "子会话");
    database
      .prepare("INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)")
      .run(
        "child-message",
        "child-session",
        Date.parse("2026-07-26T15:30:00.000Z"),
        JSON.stringify({ role: "assistant" })
      );
    insertPart.run(
      "child-part",
      "child-message",
      "child-session",
      Date.parse("2026-07-26T15:31:00.000Z"),
      JSON.stringify({ type: "text", text: "子会话内容" })
    );
    database.close();

    const result = parseOpenCodeDatabase(file);

    expect(result.map((session) => session.date)).toEqual(["2026-07-26", "2026-07-27"]);
    expect(result[0]?.project).toBe("open-project");
    expect(result[0]?.title).not.toContain("super-secret");
    expect(result[0]?.title).not.toContain("中文秘密");
    expect(result[0]?.title).not.toContain("abcdefghijklmnop");
    expect(result[0]?.title).not.toContain("private");
    expect(result[0]?.events.map(({ text, phase }) => [text, phase])).toEqual([
      ["实现 OpenCode 数据源", "prompt"],
      ["正在整理结构。", "commentary"],
      ["适配器和测试已完成。", "final"]
    ]);
    expect(result[1]?.events.map((event) => event.text)).toEqual(["继续补充跨日测试"]);
  });

  it("发现多版本数据库、排除 WAL/SHM，并按事件 ID 去除复制记录", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "report-opencode-multi-"));
    temporary.push(root);
    for (const [name, extra] of [
      ["opencode-main.db", true],
      ["opencode-local.db", false]
    ] as const) {
      const database = createDatabase(path.join(root, name), { extraSessionColumns: extra });
      insertSession(database);
      database.close();
    }
    await fs.writeFile(path.join(root, "opencode-main.db-wal"), "ignored");
    await fs.writeFile(path.join(root, "opencode-main.db-shm"), "ignored");
    await fs.writeFile(path.join(root, "other.db"), "ignored");

    expect((await listOpenCodeDatabases(root)).map((file) => path.basename(file))).toEqual([
      "opencode-local.db",
      "opencode-main.db"
    ]);
    const result = await scanOpenCode("2026-07-26", "2026-07-26", root);
    expect(result).toHaveLength(1);
    expect(result[0]?.events).toHaveLength(1);
  });

  it("单库缺表或 JSON 损坏时跳过该库，不阻断其他数据库", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "report-opencode-broken-"));
    temporary.push(root);
    const good = createDatabase(path.join(root, "opencode-good.db"));
    insertSession(good);
    good.close();

    const missing = new Database(path.join(root, "opencode-missing.db"));
    missing.exec("CREATE TABLE session (id TEXT PRIMARY KEY)");
    missing.close();

    const corrupt = createDatabase(path.join(root, "opencode-corrupt.db"));
    insertSession(corrupt, { sessionId: "corrupt-session", prefix: "corrupt-" });
    corrupt.prepare("UPDATE part SET data = ?").run("{not-json");
    corrupt.close();

    const result = await scanOpenCode("2026-07-26", "2026-07-26", root);
    expect(result).toHaveLength(1);
    expect(result[0]?.sessionId).toBe("session-1");
    const health = await getOpenCodeHealth(root);
    expect(health.fileCount).toBe(3);
    expect(health.message).toContain("opencode-corrupt.db");
    expect(health.message).toContain("opencode-missing.db");
  });

  it("以只读连接读取仍在 WAL 中的已提交会话", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "report-opencode-wal-"));
    temporary.push(root);
    const file = path.join(root, "opencode-live.db");
    const writer = createDatabase(file, { wal: true });
    insertSession(writer);

    const result = await scanOpenCode("2026-07-26", "2026-07-26", root);

    expect(result).toHaveLength(1);
    expect(result[0]?.events[0]?.text).toBe("实现 OpenCode 数据源");
    writer.close();
  });
});
