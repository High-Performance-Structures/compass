# One-shot HPS Test contact API validation. Run only in elevated PowerShell on
# the Sage host; this is not an installer and never enables contact sync.
$ErrorActionPreference = 'Stop'
$taskName = 'HPS Compass Sage Client Project Writer'
$installDir = 'C:\ProgramData\HPS\CompassSageWriter'
$installed = Join-Path $installDir 'CompassSageClientProjectWriter.exe'
$backup = Join-Path $installDir 'CompassSageClientProjectWriter.pre-contact-write-test-20260924.exe'
$work = Join-Path $env:TEMP 'compass-sage-contact-write-test-20260924'
$candidate = Join-Path $work 'CompassSageContactWriteTest.exe'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
$base = 'https://raw.githubusercontent.com/High-Performance-Structures/compass/martinevogel/contact-directory-review/scripts'
$sources = @(
    @{ Name = 'Sage.100.Contractor.CompassClientProjectWriter.cs'; Hash = '537670f08a0a50ada3c7d1996d572a04b822aa8005ac4ca046342a9b5e329104' },
    @{ Name = 'Sage.100.Contractor.CompassContactWriter.cs'; Hash = '33382f328024e450f0300cb72e39f189923a199a710b531c5457f4b942f2d940' }
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
    & $installed --contact-write-test
    $testExit = $LASTEXITCODE
} finally {
    [Environment]::SetEnvironmentVariable('SAGE_CONTACT_TEST_WRITES_ENABLED', $savedSwitch, 'Process')
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
if ($testExit -ne 0) { throw 'HPS Test contact write/readback did not pass; contact sync remains disabled.' }
& $installed --diagnose
if ($LASTEXITCODE -ne 0) { throw 'Restored production writer failed read-only diagnosis.' }
Write-Host 'HPS_TEST_CONTACT_WRITE_AND_RESTORE_OK'
