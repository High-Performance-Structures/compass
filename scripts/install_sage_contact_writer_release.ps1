# Install the validated contact-capable binary at Sage's approved application
# path. Contact polling and writes stay off until separately enabled.
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F]{40}$')]
    [string]$SourceCommit
)
$ErrorActionPreference = 'Stop'
$taskName = 'HPS Compass Sage Client Project Writer'
$installDir = 'C:\ProgramData\HPS\CompassSageWriter'
$installed = Join-Path $installDir 'CompassSageClientProjectWriter.exe'
$backup = Join-Path $installDir ('CompassSageClientProjectWriter.pre-contacts-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.exe')
$work = Join-Path $env:TEMP 'compass-sage-contact-release-20260924'
$candidate = Join-Path $work 'CompassSageContactRelease.exe'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
$base = "https://raw.githubusercontent.com/High-Performance-Structures/compass/$SourceCommit/scripts"
$sources = @(
    @{ Name = 'Sage.100.Contractor.CompassClientProjectWriter.cs'; Hash = '965525DC6343796AD081430F93297B284841326BE50FF44BD1B18387877C901D' },
    @{ Name = 'Sage.100.Contractor.CompassContactWriter.cs'; Hash = '1B7F76F6BB5467BC883A76A1A1BFDD4E71D153BB12B4465ECEBED49B38E2E6C9' }
)

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run from elevated PowerShell on the approved Sage host.'
}
if (-not (Test-Path -LiteralPath $installed) -or -not (Test-Path -LiteralPath $compiler)) {
    throw 'Approved writer or compiler is missing.'
}
if ([Environment]::GetEnvironmentVariable('SAGE_CONTACT_BRIDGE_ENABLED', 'Machine') -eq 'true') {
    throw 'Disable local contact polling before upgrading the installed writer.'
}
if ((Get-ScheduledTask -TaskName $taskName).State -ne 'Ready') {
    throw 'Scheduled writer must be Ready before the guarded install.'
}
if (Test-Path -LiteralPath $backup) { throw 'Backup filename already exists.' }

New-Item -ItemType Directory -Path $work -Force | Out-Null
foreach ($source in $sources) {
    $path = Join-Path $work $source.Name
    Invoke-WebRequest -Uri "$base/$($source.Name)" -OutFile $path -UseBasicParsing
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $source.Hash) {
        throw "Downloaded source hash mismatch: $($source.Name)"
    }
}
& $compiler /nologo /optimize+ /target:exe "/out:$candidate" /reference:System.Data.dll /reference:System.Web.Extensions.dll (Join-Path $work $sources[0].Name) (Join-Path $work $sources[1].Name)
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $candidate)) {
    throw 'Contact-capable writer did not compile; installed writer was not touched.'
}
& $candidate --contact-schema-test
if ($LASTEXITCODE -ne 0) { throw 'Contact schema preflight failed; installed writer was not touched.' }

$originalHash = (Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash
$candidateHash = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash
$disabled = $false
$swapped = $false
$success = $false
try {
    Disable-ScheduledTask -TaskName $taskName | Out-Null
    $disabled = $true
    if ((Get-ScheduledTask -TaskName $taskName).State -ne 'Disabled') {
        throw 'Scheduled writer did not disable; executable was not changed.'
    }
    $activeWriter = Get-CimInstance Win32_Process -Filter "Name = 'CompassSageClientProjectWriter.exe'" |
        Where-Object { $_.ExecutablePath -eq $installed }
    if ($activeWriter) { throw 'Writer process is still active; executable was not changed.' }
    Copy-Item -LiteralPath $installed -Destination $backup
    if ((Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash -ne $originalHash) {
        throw 'Writer backup hash mismatch; executable was not changed.'
    }
    Copy-Item -LiteralPath $candidate -Destination $installed -Force
    $swapped = $true
    if ((Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash -ne $candidateHash) {
        throw 'Installed candidate hash mismatch.'
    }
    & $installed --diagnose
    if ($LASTEXITCODE -ne 0) { throw 'Installed writer failed Sage production diagnostic.' }
    Enable-ScheduledTask -TaskName $taskName | Out-Null
    $taskState = (Get-ScheduledTask -TaskName $taskName).State
    if ($taskState -eq 'Disabled') { throw 'Scheduled writer did not re-enable.' }
    $disabled = $false
    $success = $true
    Write-Host "CONTACT_WRITER_INSTALL_OK task=$taskState binary_sha256=$candidateHash"
    Write-Host "Original writer backup: $backup"
} finally {
    if (-not $success) {
        if ($swapped) { Copy-Item -LiteralPath $backup -Destination $installed -Force }
        $restored = (Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash -eq $originalHash
        Write-Host "original_writer_restored=$restored"
        if ($disabled -and $restored) { Enable-ScheduledTask -TaskName $taskName | Out-Null }
        if (-not $restored) {
            throw 'Original writer did not restore; task remains disabled. Recover the printed backup before resuming.'
        }
    }
}
