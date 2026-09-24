# One-shot HPS Test contact API validation. Run only in elevated PowerShell on
# the Sage host; this is not an installer and never enables contact sync.
$ErrorActionPreference = 'Stop'
$taskName = 'HPS Compass Sage Client Project Writer'
$installDir = 'C:\ProgramData\HPS\CompassSageWriter'
$installed = Join-Path $installDir 'CompassSageClientProjectWriter.exe'
$backup = Join-Path $installDir ('CompassSageClientProjectWriter.pre-contact-write-test-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.exe')
$priorBackup = Join-Path $installDir 'CompassSageClientProjectWriter.pre-contact-write-test-20260924.exe'
$work = Join-Path $env:TEMP 'compass-sage-contact-write-test-20260924'
$candidate = Join-Path $work 'CompassSageContactWriteTest.exe'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
$testRecordNumbers = @{
    SAGE_CONTACT_TEST_CLIENT_NUMBER = '2890'
    SAGE_CONTACT_TEST_VENDOR_NUMBER = '2883'
    SAGE_CONTACT_TEST_EMPLOYEE_NUMBER = '17'
}
$base = 'https://raw.githubusercontent.com/High-Performance-Structures/compass/martinevogel/contact-directory-review/scripts'
$sources = @(
    @{ Name = 'Sage.100.Contractor.CompassClientProjectWriter.cs'; Hash = '26f64a8c937f9256db3ad1aee6a99ae33a92c511177cb17075087314aaa8ac83' },
    @{ Name = 'Sage.100.Contractor.CompassContactWriter.cs'; Hash = 'c737c78945d300fb068ef5f6bbdd6bd119db76eccb15b8f57d369ac3095b00d8' }
)

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this one-shot test from elevated PowerShell.'
}
if (-not (Test-Path -LiteralPath $installed) -or -not (Test-Path -LiteralPath $compiler)) {
    throw 'Approved writer or C# compiler was not found.'
}
if (Test-Path -LiteralPath $backup) { throw 'This test backup already exists; inspect it before retrying.' }
if ((Test-Path -LiteralPath $priorBackup) -and
    (Get-FileHash -LiteralPath $priorBackup -Algorithm SHA256).Hash -ne
    (Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash) {
    throw 'The earlier test backup differs from the installed writer; inspect both before retrying.'
}
if ((Get-ScheduledTask -TaskName $taskName).State -ne 'Ready') {
    throw 'Production writer task must be Ready before the test.'
}

New-Item -ItemType Directory -Path $work -Force | Out-Null
foreach ($source in $sources) {
    $destination = Join-Path $work $source.Name
    Invoke-WebRequest -Uri "$base/$($source.Name)" -OutFile $destination -UseBasicParsing
    if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ne $source.Hash) {
        throw "Downloaded source hash mismatch: $($source.Name)"
    }
}
& $compiler /nologo /optimize+ /target:exe "/out:$candidate" /reference:System.Data.dll /reference:System.Web.Extensions.dll (Join-Path $work $sources[0].Name) (Join-Path $work $sources[1].Name)
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $candidate)) {
    throw 'Contact test candidate did not compile; production writer was not touched.'
}
& $candidate --contact-schema-test
if ($LASTEXITCODE -ne 0) { throw 'Contact schema preflight failed; production writer was not touched.' }

$originalHash = (Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash
$disabled = $false
$swapped = $false
$savedSwitch = [Environment]::GetEnvironmentVariable('SAGE_CONTACT_TEST_WRITES_ENABLED', 'Process')
$savedRecordNumbers = @{}
foreach ($name in $testRecordNumbers.Keys) {
    $savedRecordNumbers[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
$testExit = 1
try {
    Disable-ScheduledTask -TaskName $taskName | Out-Null
    $disabled = $true
    if ((Get-ScheduledTask -TaskName $taskName).State -ne 'Disabled') {
        throw 'Production writer task did not disable; no executable swap attempted.'
    }
    Copy-Item -LiteralPath $installed -Destination $backup
    if ((Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash -ne $originalHash) {
        throw 'Production writer backup hash mismatch; no executable swap attempted.'
    }
    Copy-Item -LiteralPath $candidate -Destination $installed -Force
    $swapped = $true
    [Environment]::SetEnvironmentVariable('SAGE_CONTACT_TEST_WRITES_ENABLED', 'true', 'Process')
    foreach ($name in $testRecordNumbers.Keys) {
        [Environment]::SetEnvironmentVariable($name, $testRecordNumbers[$name], 'Process')
    }
    & $installed --contact-write-test
    $testExit = $LASTEXITCODE
    if ($testExit -eq 0) {
        & $installed --contact-email-map-test
        $testExit = $LASTEXITCODE
    }
} finally {
    [Environment]::SetEnvironmentVariable('SAGE_CONTACT_TEST_WRITES_ENABLED', $savedSwitch, 'Process')
    foreach ($name in $testRecordNumbers.Keys) {
        [Environment]::SetEnvironmentVariable($name, $savedRecordNumbers[$name], 'Process')
    }
    if ($swapped) { Copy-Item -LiteralPath $backup -Destination $installed -Force }
    $restored = (Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash -eq $originalHash
    Write-Host "production_writer_restored=$restored"
    if ($disabled -and $restored) { Enable-ScheduledTask -TaskName $taskName | Out-Null }
    Write-Host "production_task_state=$((Get-ScheduledTask -TaskName $taskName).State)"
    if (-not $restored) {
        throw 'Production writer hash did not restore. Task remains disabled; recover original backup before resuming.'
    }
}
Write-Host "contact_write_test_exit=$testExit"
if ($testExit -ne 0) { throw 'HPS Test contact or email mapping write/readback did not pass; contact sync remains disabled.' }
& $installed --diagnose
if ($LASTEXITCODE -ne 0) { throw 'Restored production writer failed read-only diagnosis.' }
Write-Host 'HPS_TEST_CONTACT_WRITE_AND_RESTORE_OK'
