import { expect, test } from "@playwright/test";

test("扫描来源并完成日报、周报编辑链路", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByText("让对话留下工作痕迹")).toBeVisible();
  await expect(page.getByText("数据源")).toBeVisible();

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
    author: "朱双庆",
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
