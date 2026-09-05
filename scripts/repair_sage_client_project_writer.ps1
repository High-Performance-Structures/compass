param(
  [string]$SourcePath = (Join-Path $PSScriptRoot "Sage.100.Contractor.CompassClientProjectWriter.cs")
)

$ErrorActionPreference = "Stop"

$taskName = "HPS Compass Sage Client Project Writer"
$installDirectory = "C:\ProgramData\HPS\CompassSageWriter"
$logsDirectory = Join-Path $installDirectory "logs"
$binary = Join-Path $installDirectory "CompassSageClientProjectWriter.exe"
$candidateBinary = Join-Path $installDirectory "CompassSageClientProjectWriter.candidate.exe"
$binaryBackup = Join-Path $installDirectory "CompassSageClientProjectWriter.before-repair.exe"
$taskBackup = Join-Path $installDirectory "scheduled-task-before-repair.xml"
$diagnosticLog = Join-Path $logsDirectory "diagnostic-task.log"
$compiler = Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe"

if (-not (Test-Path $SourcePath)) { throw "Writer source not found: $SourcePath" }
if (-not (Test-Path $binary)) { throw "Installed writer not found: $binary" }
if (-not (Test-Path $compiler)) { throw "C# compiler not found: $compiler" }

$task = Get-ScheduledTask -TaskName $taskName
$taskInfo = Get-ScheduledTaskInfo -TaskName $taskName
$originalActions = $task.Actions
$originalTriggers = $task.Triggers
$originalSettings = $task.Settings
$wasRunning = $task.State -eq "Running"
$taskUser = $task.Principal.UserId
$binaryReplaced = $false
$repairSucceeded = $false

New-Item -ItemType Directory -Force -Path $logsDirectory | Out-Null
& icacls.exe $logsDirectory /inheritance:r /grant "Administrators:(OI)(CI)F" /grant "SYSTEM:(OI)(CI)F" /grant "${taskUser}:(OI)(CI)M" | Out-Null
Export-ScheduledTask -TaskName $taskName | Set-Content -Path $taskBackup -Encoding Unicode

try {
  if ($wasRunning) {
    Stop-ScheduledTask -TaskName $taskName
    Start-Sleep -Seconds 1
  }

  Remove-Item -Path $candidateBinary -Force -ErrorAction SilentlyContinue
  & $compiler /nologo /optimize+ /target:exe /out:$candidateBinary /reference:System.Data.dll /reference:System.Web.Extensions.dll $SourcePath
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $candidateBinary)) {
    throw "C# compilation failed."
  }

  Copy-Item -Path $binary -Destination $binaryBackup -Force
  # Sage authorizes the installed executable identity. Test the candidate at
  # the production filename, with the old binary already available to restore.
  $binaryReplaced = $true
  Copy-Item -Path $candidateBinary -Destination $binary -Force

  Remove-Item -Path $diagnosticLog -Force -ErrorAction SilentlyContinue
  $diagnosticArguments = "/d /c `"`"$binary`" --diagnose > `"$diagnosticLog`" 2>&1`""
  $diagnosticAction = New-ScheduledTaskAction -Execute "cmd.exe" -Argument $diagnosticArguments
  Set-ScheduledTask -TaskName $taskName -Action $diagnosticAction | Out-Null
  Start-ScheduledTask -TaskName $taskName

  $deadline = (Get-Date).AddSeconds(90)
  do {
    Start-Sleep -Milliseconds 500
    $diagnosticState = (Get-ScheduledTask -TaskName $taskName).State
  } while ($diagnosticState -eq "Running" -and (Get-Date) -lt $deadline)

  $diagnosticInfo = Get-ScheduledTaskInfo -TaskName $taskName
  $diagnosticText = if (Test-Path $diagnosticLog) {
    Get-Content -Path $diagnosticLog -Raw
  } else {
    ""
  }
  if ($diagnosticState -eq "Running") {
    Stop-ScheduledTask -TaskName $taskName
    throw "Diagnostic timed out after 90 seconds."
  }
  if ($diagnosticInfo.LastTaskResult -ne 0 -or $diagnosticText -notmatch "DIAGNOSTIC_OK") {
    throw "Task-identity diagnostic failed (result $($diagnosticInfo.LastTaskResult)): $diagnosticText"
  }

  Copy-Item -Path $SourcePath -Destination (Join-Path $installDirectory "CompassSageClientProjectWriter.cs") -Force

  $writerAction = New-ScheduledTaskAction -Execute $binary -Argument "--once"
  $startupTrigger = New-ScheduledTaskTrigger -AtStartup
  $recoveryTrigger = New-ScheduledTaskTrigger `
    -Once `
    -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 1) `
    -RepetitionDuration (New-TimeSpan -Days 3650)
  $settings = New-ScheduledTaskSettingsSet `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries

  Set-ScheduledTask `
    -TaskName $taskName `
    -Action $writerAction `
    -Trigger @($startupTrigger, $recoveryTrigger) `
    -Settings $settings | Out-Null
  Start-ScheduledTask -TaskName $taskName
  $runDeadline = (Get-Date).AddSeconds(90)
  do {
    Start-Sleep -Milliseconds 500
    $finalTask = Get-ScheduledTask -TaskName $taskName
  } while ($finalTask.State -eq "Running" -and (Get-Date) -lt $runDeadline)

  $finalInfo = Get-ScheduledTaskInfo -TaskName $taskName
  if ($finalTask.State -eq "Running") {
    Stop-ScheduledTask -TaskName $taskName
    throw "Repaired writer verification run timed out after 90 seconds."
  }
  if ($finalInfo.LastTaskResult -ne 0) {
    throw "Repaired writer verification run failed (result $($finalInfo.LastTaskResult))."
  }

  $repairSucceeded = $true
  Write-Output "REPAIR_OK"
  Write-Output "TASK_STATE=$($finalTask.State)"
  Write-Output "TASK_USER=$taskUser"
  Write-Output "PREVIOUS_RESULT=$($taskInfo.LastTaskResult)"
  Write-Output "DIAGNOSTIC_RESULT=$($diagnosticInfo.LastTaskResult)"
  if (Test-Path (Join-Path $logsDirectory "writer.log")) {
    Get-Content -Path (Join-Path $logsDirectory "writer.log") -Tail 20
  }
} finally {
  if (-not $repairSucceeded) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Set-ScheduledTask `
      -TaskName $taskName `
      -Action $originalActions `
      -Trigger $originalTriggers `
      -Settings $originalSettings | Out-Null
    if ($binaryReplaced -and (Test-Path $binaryBackup)) {
      Copy-Item -Path $binaryBackup -Destination $binary -Force
    }
    if ($wasRunning) { Start-ScheduledTask -TaskName $taskName }
    Write-Output "REPAIR_ROLLED_BACK"
  }
  Remove-Item -Path $candidateBinary -Force -ErrorAction SilentlyContinue
}
