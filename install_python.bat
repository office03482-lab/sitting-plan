@echo off
setlocal
echo ==========================================
echo Installing Python for Exam Seating Planner
echo ==========================================
echo.

echo This script will download and install Python 3.11.8
echo.

REM Download Python installer
echo Downloading Python installer...
powershell -Command "& {Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.11.8/python-3.11.8-amd64.exe' -OutFile 'python-installer.exe'}"

if not exist "python-installer.exe" (
    echo ERROR: Failed to download Python installer
    echo Please download manually from: https://www.python.org/ftp/python/3.11.8/python-3.11.8-amd64.exe
    pause
    exit /b 1
)

echo.
echo Installing Python (this may take a few minutes)...
python-installer.exe /quiet InstallAllUsers=0 PrependPath=1 Include_test=0 Include_launcher=1 InstallLauncherAllUsers=0

echo.
echo Waiting for installation to complete...
timeout /t 60 /nobreak > nul

echo.
echo Cleaning up installer...
if exist "python-installer.exe" del python-installer.exe

echo.
echo Verifying installation...
set "PYTHON_CMD="
py --version >nul 2>&1
if not errorlevel 1 (
    set "PYTHON_CMD=py"
)

if not defined PYTHON_CMD (
    python --version >nul 2>&1
    if not errorlevel 1 (
        set "PYTHON_CMD=python"
    )
)

if not defined PYTHON_CMD (
    echo WARNING: Python may not be in PATH yet.
    echo Please restart your command prompt and run auto_run.bat
) else (
    %PYTHON_CMD% --version
    echo SUCCESS: Python installed successfully!
)

echo.
echo Next step: Run auto_run.bat to start the application
echo.
pause
