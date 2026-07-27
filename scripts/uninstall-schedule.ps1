$ErrorActionPreference = "Stop"

foreach ($name in @("AI工作手记-日报草稿", "AI工作手记-周报草稿")) {
  if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $name -Confirm:$false
    Write-Output "已移除：$name"
  }
}
