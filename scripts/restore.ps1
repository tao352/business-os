# Automated Disaster Recovery / Restore Script for Business OS
# Master Plan Section 46 & 47

param (
    [Parameter(Mandatory=$true)]
    [string]$DumpFile,
    [string]$ManifestFile,
    [string]$ContainerName = "business_os_postgres",
    [string]$Database = "business_os",
    [string]$User = "postgres"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $DumpFile)) {
    throw "Dump file not found: $DumpFile"
}

if ($ManifestFile -and (Test-Path $ManifestFile)) {
    Write-Host "==> Verifying SHA-256 checksum against manifest..." -ForegroundColor Cyan
    $manifest = Get-Content $ManifestFile | ConvertFrom-Json
    $computedHash = (Get-FileHash -Path $DumpFile -Algorithm SHA256).Hash

    if ($computedHash -ne $manifest.sha256Checksum) {
        throw "CHECKSUM MISMATCH! Archive is corrupted. Expected $($manifest.sha256Checksum), got $computedHash"
    }
    Write-Host "==> Checksum verified OK ($computedHash)" -ForegroundColor Green
}

Write-Host "==> Restoring database [$Database] into container [$ContainerName]..." -ForegroundColor Cyan
Get-Content $DumpFile | docker exec -i $ContainerName psql -U $User -d $Database

Write-Host "==> Disaster Recovery Restore completed successfully!" -ForegroundColor Green
