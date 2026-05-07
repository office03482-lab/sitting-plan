@echo off
setlocal ENABLEDELAYEDEXPANSION

echo ==========================================
echo Clean Backend Restart
echo ==========================================
echo.

cd /d "%~dp0"

if not exist "backend" (
  echo ERROR: Run this script from project root folder.
  pause
  exit /b 1
)

echo [1/5] Stopping old backend listeners on 8000/8010...
for %%P in (8000 8010) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr :%%P ^| findstr LISTENING') do (
    taskkill /PID %%A /F >nul 2>&1
  )
)
timeout /t 1 /nobreak >nul
echo [OK] Old listeners stopped (if any)
echo.

echo [2/5] Detecting Python runtime...
set "PYTHON_CMD="
set "BROKEN_VENV=0"

if exist "backend\venv\Scripts\python.exe" (
  backend\venv\Scripts\python.exe --version >nul 2>&1
  if errorlevel 1 (
    set "BROKEN_VENV=1"
  ) else (
    set "PYTHON_CMD=backend\venv\Scripts\python.exe"
  )
)

if not defined PYTHON_CMD (
  py --version >nul 2>&1
  if not errorlevel 1 set "PYTHON_CMD=py"
)

if not defined PYTHON_CMD (
  python --version >nul 2>&1
  if not errorlevel 1 set "PYTHON_CMD=python"
)

if not defined PYTHON_CMD (
  echo ERROR: No working Python found.
  echo Please install Python, then run this script again.
  echo Tip: run install_python.bat from this folder.
  pause
  exit /b 1
)
echo [OK] Python command: %PYTHON_CMD%
echo.

if "%BROKEN_VENV%"=="1" (
  echo [3/5] Broken backend venv detected. Recreating...
  if exist "backend\venv" rmdir /s /q "backend\venv"
  cd backend
  %PYTHON_CMD% -m venv venv
  if errorlevel 1 (
    echo ERROR: Could not recreate backend venv.
    cd ..
    pause
    exit /b 1
  )
  call venv\Scripts\activate.bat
  pip install -r requirements.txt
  if errorlevel 1 (
    echo ERROR: Failed to install backend dependencies.
    cd ..
    pause
    exit /b 1
  )
  cd ..
) else (
  echo [3/5] Backend venv is healthy
)
echo.

echo [4/5] Starting backend on http://127.0.0.1:8000 ...
start "Backend Server" cmd /k "cd /d ""%CD%\backend"" && call venv\Scripts\activate.bat && uvicorn app.main:app --host 127.0.0.1 --port 8000"
echo.

echo [5/5] Waiting for health check...
set "READY=0"
for /L %%I in (1,1,20) do (
  powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/health' -TimeoutSec 5; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
  if not errorlevel 1 (
    set "READY=1"
    goto :done
  )
  timeout /t 1 /nobreak >nul
)

:done
if "%READY%"=="1" (
  echo [OK] Backend is healthy on port 8000
  echo Login/API routes should now be available.
) else (
  echo [WARN] Backend health check did not pass yet.
  echo Check backend terminal window for startup error.
)
echo.
pause

