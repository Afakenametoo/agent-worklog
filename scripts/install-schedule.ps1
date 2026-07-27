$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source

$dailyAction = New-ScheduledTaskAction `
  -Execute $npm `
  -Argument "run report:daily -- --date today" `
  -WorkingDirectory $projectRoot
$dailyTrigger = New-ScheduledTaskTrigger -Daily -At "23:00"

$weeklyAction = New-ScheduledTaskAction `
  -Execute $npm `
  -Argument "run report:weekly -- --export" `
  -WorkingDirectory $projectRoot
$weeklyTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At "23:30"

Register-ScheduledTask `
  -TaskName "AI工作手记-日报草稿" `
  -Description "读取本机 Codex 与 Claude 会话并生成日报草稿" `
  -Action $dailyAction `
  -Trigger $dailyTrigger `
  -Force | Out-Null

Register-ScheduledTask `
  -TaskName "AI工作手记-周报草稿" `
  -Description "合并本周已确认日报并导出 Word 周报" `
  -Action $weeklyAction `
  -Trigger $weeklyTrigger `
  -Force | Out-Null

Write-Output "已注册：AI工作手记-日报草稿（每日 23:00）"
Write-Output "已注册：AI工作手记-周报草稿（周日 23:30）"
