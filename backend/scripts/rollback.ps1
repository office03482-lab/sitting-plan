param(
    [string]$Revision = "-1",
    [string]$DatabaseUrl = ""
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Split-Path -Parent $scriptDir

Push-Location $backendDir
try {
    if ($DatabaseUrl) {
        $env:DATABASE_URL = $DatabaseUrl
    }

    if (-not (Test-Path "venv\Scripts\python.exe")) {
        throw "Virtual environment not found at backend\venv. Recreate it before running migrations."
    }

    & .\venv\Scripts\python.exe -m alembic downgrade $Revision
}
finally {
    Pop-Location
}
