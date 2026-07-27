import { describe, expect, it } from "vitest";
import { isoWeekRange, localDate, redactSensitive } from "./util.js";

describe("date helpers", () => {
  it("uses Asia/Shanghai when a UTC event crosses local midnight", () => {
    expect(localDate("2026-07-26T16:30:00.000Z", "Asia/Shanghai")).toBe("2026-07-27");
  });

  it("formats ISO week folders with three digits", () => {
    const range = isoWeekRange("2026-W29");
    expect(range.start).toBe("2026-07-13");
    expect(range.end).toBe("2026-07-19");
    expect(range.folderName).toBe("2026-029");
    expect(range.fileRange).toBe("0713-0719");
  });
});

describe("redaction", () => {
  it("removes common credentials before model upload", () => {
    const value = redactSensitive(
      "Authorization: Bearer abc.def.ghi\nOPENAI_API_KEY=sk-example_1234567890123456\npassword=hunter2"
    );
    expect(value).not.toContain("abc.def.ghi");
    expect(value).not.toContain("hunter2");
    expect(value).not.toContain("sk-example");
    expect(value).toContain("<REDACTED");
  });

  it("removes Chinese password labels from source titles", () => {
    const value = redactSensitive("连接数据库，用户名demo-user，密码DemoP@ss-42,数据库名demo");
    expect(value).not.toContain("DemoP@ss-42");
    expect(value).toContain("密码=<REDACTED>");
  });
});
