@echo off
echo ==========================================
echo Installing Node.js for Exam Seating Planner
echo ==========================================
echo.

echo This script will download and install Node.js 18.19.0
echo.

REM Download Node.js installer
echo Downloading Node.js installer...
powershell -Command "& {Invoke-WebRequest -Uri 'https://nodejs.org/dist/v18.19.0/node-v18.19.0-x64.msi' -OutFile 'node-v18.19.0-x64.msi'}"

if not exist "node-v18.19.0-x64.msi" (
    echo ERROR: Failed to download Node.js installer
    echo Please download manually from: https://nodejs.org/dist/v18.19.0/node-v18.19.0-x64.msi
    pause
    exit /b 1
)

echo.
echo Installing Node.js (this may take a few minutes)...
msiexec /i node-v18.19.0-x64.msi /quiet /norestart

echo.
echo Waiting for installation to complete...
timeout /t 30 /nobreak > nul

echo.
echo Cleaning up installer...
del node-v18.19.0-x64.msi

echo.
echo Verifying installation...
node --version
if errorlevel 1 (
    echo WARNING: Node.js may not be in PATH yet.
    echo Please restart your command prompt and run auto_run.bat
) else (
    echo SUCCESS: Node.js installed successfully!
    echo.
    echo Next step: Run auto_run.bat to start the application
)

echo.
pause