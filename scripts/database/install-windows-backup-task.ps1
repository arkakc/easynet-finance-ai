param(
  [ValidatePattern('^([01]\d|2[0-3]):[0-5]\d$')]
  [string]$DailyAt = '19:00'
)

$ErrorActionPreference = 'Stop'
$TaskName = 'Easynet Finance AI - Daily Database Backup'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$EscapedProjectRoot = $ProjectRoot.Replace("'", "''")
$Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command `"& { Set-Location -LiteralPath '$EscapedProjectRoot'; npm run db:backup }`""
$Action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $Arguments
$Trigger = New-ScheduledTaskTrigger -Daily -At $DailyAt
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Description 'Creates an integrity-checked local Easynet Finance AI SQLite backup. Runs only while this Windows user can execute the task.' -Force | Out-Null
Write-Output "Installed scheduled task '$TaskName' at $DailyAt."
Write-Output "Retention is controlled by BACKUP_RETENTION_COUNT (default 30)."
