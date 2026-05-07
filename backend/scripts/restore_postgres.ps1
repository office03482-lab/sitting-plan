param(
    [Parameter(Mandatory = $true)]
    [string]$BackupFile,
    [string]$Host = "localhost",
    [int]$Port = 5432,
    [string]$Database = "seating_planner",
    [string]$User = "postgres",
    [switch]$DropExistingObjects
)

$ErrorActionPreference = "Stop"

if (-not $env:PGPASSWORD) {
    throw "Set PGPASSWORD before running the restore script."
}

if (-not (Test-Path $BackupFile)) {
    throw "Backup file not found: $BackupFile"
}

$extension = [System.IO.Path]::GetExtension($BackupFile).ToLowerInvariant()

if ($extension -eq ".sql") {
    $psqlArgs = @(
        "--host=$Host",
        "--port=$Port",
        "--username=$User",
        "--dbname=$Database",
        "--single-transaction",
        "--set=ON_ERROR_STOP=1",
        "--file=$BackupFile"
    )
    & psql @psqlArgs
}
else {
    $restoreArgs = @(
        "--host=$Host",
        "--port=$Port",
        "--username=$User",
        "--dbname=$Database",
        "--no-owner",
        "--no-privileges",
        "--verbose"
    )

    if ($DropExistingObjects) {
        $restoreArgs += "--clean"
        $restoreArgs += "--if-exists"
    }

    $restoreArgs += $BackupFile
    & pg_restore @restoreArgs
}

Write-Output "Restore completed from: $BackupFile"
