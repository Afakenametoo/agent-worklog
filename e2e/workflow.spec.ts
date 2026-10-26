import { expect, test } from "@playwright/test";

test("首次打开先保存全局用户名和日报目录", async ({ page }) => {
  const settings = {
    timezone: "Asia/Shanghai",
    author: "",
    dailyOutputDir: "D:\\reports\\daily",
    weeklyReportRoot: "D:\\reports\\weekly",
    weeklyTemplatePath: "",
    defaultProvider: "openai",
    openaiModel: "test-openai",
    anthropicModel: "test-anthropic",
    openaiConfigured: false,
    anthropicConfigured: false,
    codexHome: "D:\\sessions\\codex",
    claudeHome: "D:\\sessions\\claude",
    opencodeDataDir: "D:\\sessions\\opencode",
    workbuddyHome: "D:\\sessions\\workbuddy",
    enableWslClaude: false,
    excludedProjects: []
  };
  let savedAuthor = "";

  await page.route("**/api/settings", async (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as { author: string };
      savedAuthor = body.author;
      await route.fulfill({ json: { ...settings, ...body } });
      return;
    }
    await route.fulfill({ json: settings });
  });

  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "先留下你的署名" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("用户名 / 报告编写人").fill("测试用户");
  await dialog.getByRole("button", { name: "保存并进入工作台" }).click();

  await expect(dialog).toBeHidden();
  expect(savedAuthor).toBe("测试用户");
  await page.getByRole("button", { name: "来源设置" }).click();
  await expect(page.getByLabel("OpenCode 数据目录")).toHaveValue("D:\\sessions\\opencode");
  await expect(page.getByLabel("WorkBuddy 主目录")).toHaveValue("D:\\sessions\\workbuddy");
});

test("扫描来源并完成日报、周报编辑链路", async ({ page, request }) => {
  const currentSettings = await request.get("/api/settings").then((response) => response.json());
  if (!currentSettings.author) {
    expect(
      (
        await request.patch("/api/settings", {
          data: {
            author: "测试用户",
            dailyOutputDir: currentSettings.dailyOutputDir
          }
        })
      ).ok()
    ).toBeTruthy();
  }

  await page.goto("/");
  await expect(page.getByText("让对话留下工作痕迹")).toBeVisible();
  await expect(page.getByText("数据源")).toBeVisible();
  await expect(page.getByText("opencode-windows", { exact: true })).toBeVisible({
    timeout: 20_000
  });

  const date = "2026-07-13";
  const daily = {
    workItems: ["完成会话解析适配器"],
    problems: [{ problem: "日志格式不同", solution: "统一为 SessionDay" }],
    nextSteps: ["补充接口回归测试"],
    uncertainties: [],
    sourceRefs: []
  };
  expect((await request.patch(`/api/daily/${date}`, { data: daily })).ok()).toBeTruthy();
  expect((await request.post(`/api/daily/${date}/confirm`)).ok()).toBeTruthy();

  const weekly = {
    projectName: "AI 日报周报生成系统",
    dateRange: "2026年7月13日 - 2026年7月19日",
    author: currentSettings.author || "测试用户",
    workItems: daily.workItems,
    problems: daily.problems,
    nextWeekPlans: daily.nextSteps,
    needHelp: "暂无需要协助的事项。"
  };
  expect((await request.patch("/api/weekly/2026-W29", { data: weekly })).ok()).toBeTruthy();

  await page.getByRole("button", { name: "周报编排" }).click();
  await page.locator('input[type="week"]').fill("2026-W29");
  await expect(page.getByLabel("项目名称")).toHaveValue("AI 日报周报生成系统");
  await expect(page.getByText("已确认", { exact: true })).toBeVisible();
});
