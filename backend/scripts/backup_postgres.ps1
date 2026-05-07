param(
    [string]$Host = "localhost",
    [int]$Port = 5432,
    [string]$Database = "seating_planner",
    [string]$User = "postgres",
    [string]$OutputDir = ".\backups",
    [ValidateSet("custom", "plain")]
    [string]$Format = "custom"
)

$ErrorActionPreference = "Stop"

if (-not $env:PGPASSWORD) {
    throw "Set PGPASSWORD before running the backup script."
}

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$resolvedOutputDir = Resolve-Path $OutputDir -ErrorAction SilentlyContinue
if (-not $resolvedOutputDir) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
    $resolvedOutputDir = Resolve-Path $OutputDir
}

$extension = if ($Format -eq "plain") { "sql" } else { "dump" }
$backupFile = Join-Path $resolvedOutputDir "${Database}_${timestamp}.${extension}"

$args = @(
    "--host=$Host",
    "--port=$Port",
    "--username=$User",
    "--dbname=$Database",
    "--no-owner",
    "--no-privileges",
    "--verbose"
)

if ($Format -eq "plain") {
    $args += "--format=plain"
    $args += "--file=$backupFile"
}
else {
    $args += "--format=custom"
    $args += "--file=$backupFile"
}

& pg_dump @args

Write-Output "Backup created: $backupFile"
