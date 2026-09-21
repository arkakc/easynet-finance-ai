$ErrorActionPreference = 'Stop'
$TaskName = 'Easynet Finance AI - Daily Database Backup'
$Existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $Existing) {
  Write-Output "Scheduled task '$TaskName' is not installed."
  exit 0
}
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Output "Removed scheduled task '$TaskName'. Existing backup files were kept."
