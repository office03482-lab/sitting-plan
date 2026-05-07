@echo off
echo ==========================================
echo Exam Seating Planner - Status Check
echo ==========================================
echo.

echo Checking running services...
echo.

REM Check backend
echo Backend (port 8000):
powershell -Command "& {try {$response = Invoke-WebRequest -Uri 'http://localhost:8000/health' -TimeoutSec 5; Write-Host '✅ RUNNING' -ForegroundColor Green} catch {Write-Host '❌ NOT RUNNING' -ForegroundColor Red}}"

echo.
echo Frontend (port 5173):
powershell -Command "& {try {$response = Invoke-WebRequest -Uri 'http://localhost:5173' -TimeoutSec 5; Write-Host '✅ RUNNING' -ForegroundColor Green} catch {Write-Host '❌ NOT RUNNING' -ForegroundColor Red}}"

echo.
echo API Documentation (port 8000/docs):
powershell -Command "& {try {$response = Invoke-WebRequest -Uri 'http://localhost:8000/docs' -TimeoutSec 5; Write-Host '✅ AVAILABLE' -ForegroundColor Green} catch {Write-Host '❌ NOT AVAILABLE' -ForegroundColor Red}}"

echo.
echo ==========================================
echo Access URLs:
echo ==========================================
echo Main Application: http://localhost:5173
echo Backend API:      http://localhost:8000
echo API Docs:         http://localhost:8000/docs
echo.

if exist "backend\venv" (
    echo ✅ Python virtual environment: READY
) else (
    echo ❌ Python virtual environment: NOT FOUND
)

if exist "frontend\node_modules" (
    echo ✅ Node.js dependencies: INSTALLED
) else (
    echo ❌ Node.js dependencies: NOT INSTALLED
)

echo.
echo If services are not running, run: quick_start.bat
echo.
pause