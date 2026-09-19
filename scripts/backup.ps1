# Automated Database Backup Script for Business OS
# Master Plan Section 46

param (
    [string]$ContainerName = "business_os_postgres",
    [string]$Database = "business_os",
    [string]$User = "postgres",
    [string]$BackupDir = "./backups"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$dumpFile = "$BackupDir/dump_${Database}_${timestamp}.sql"
$manifestFile = "$BackupDir/manifest_${Database}_${timestamp}.json"

Write-Host "==> Creating PostgreSQL backup for [$Database]..." -ForegroundColor Cyan

docker exec -t $ContainerName pg_dump -U $User -d $Database --clean --if-exists > $dumpFile

$hash = (Get-FileHash -Path $dumpFile -Algorithm SHA256).Hash
$fileSize = (Get-Item -Path $dumpFile).Length

$manifest = @{
    id = [Guid]::NewGuid().ToString()
    databaseName = $Database
    timestamp = (Get-Date).ToString("o")
    sha256Checksum = $hash
    sizeBytes = $fileSize
    status = "COMPLETED"
}

$manifest | ConvertTo-Json | Set-Content -Path $manifestFile

Write-Host "==> Backup completed successfully!" -ForegroundColor Green
Write-Host "    Dump: $dumpFile ($fileSize bytes)"
Write-Host "    SHA-256: $hash"
