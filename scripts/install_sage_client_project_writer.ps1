param(
  [Parameter(Mandatory = $true)][string]$CompassBaseUrl
)

$ErrorActionPreference = "Stop"
$source = Join-Path $PSScriptRoot "Sage.100.Contractor.CompassClientProjectWriter.cs"
$install = "C:\ProgramData\HPS\CompassSageWriter"
$binary = Join-Path $install "CompassSageClientProjectWriter.exe"
$compiler = Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe"

New-Item -ItemType Directory -Force -Path $install | Out-Null
& $compiler /nologo /optimize+ /target:exe /out:$binary /reference:System.Data.dll /reference:System.Web.Extensions.dll $source
if ($LASTEXITCODE -ne 0) { throw "C# compilation failed." }

Write-Host "Compiled $binary"
Write-Host "Set the machine-level environment variables listed in docs/wip/sage-client-project-write-runbook.md before registering the task."
Write-Host "Compass URL: $CompassBaseUrl"
