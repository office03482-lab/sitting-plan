@echo off
setlocal
echo ==========================================
echo Exam Seating Planner - Quick Start
echo ==========================================
echo.
set "BACKEND_PORT=8000"
set "BACKEND_URL=http://127.0.0.1:%BACKEND_PORT%"

REM Try different Python commands
echo Checking for Python...
if exist "%CD%\.venv\Scripts\python.exe" (
    set PYTHON_CMD=%CD%\.venv\Scripts\python.exe
    goto :python_found
)

py --version >nul 2>&1
if not errorlevel 1 (
    set PYTHON_CMD=py
    goto :python_found
)

python --version >nul 2>&1
if not errorlevel 1 (
    set PYTHON_CMD=python
    goto :python_found
)

echo ERROR: Python is not installed or not in PATH
echo Please run install_python.bat first
pause
exit /b 1

:python_found
echo [OK] Python found: %PYTHON_CMD%

REM Backend setup
echo.
echo [1/4] Setting up backend...
cd backend

if not exist "venv" (
    echo Creating virtual environment...
    %PYTHON_CMD% -m venv venv
)

echo Activating virtual environment...
call venv\Scripts\activate.bat

echo Installing dependencies...
pip install -r requirements.txt

echo Running backend preflight check...
python check_system.py
if errorlevel 1 (
    echo [ERROR] Backend preflight failed. Please fix the error above first.
    cd ..
    pause
    exit /b 1
)

REM Start backend
echo.
echo [2/4] Starting backend server...
REM Avoid Uvicorn's Windows reload subprocess here; it can fail reopening stdin.
start "Backend" cmd /k "call venv\Scripts\activate.bat && uvicorn app.main:app --host 0.0.0.0 --port %BACKEND_PORT% > ..\backend.log 2>&1"

echo Waiting for backend health check...
set "BACKEND_READY=0"
for /L %%I in (1,1,12) do (
    powershell -Command "try { $resp = Invoke-WebRequest -Uri '%BACKEND_URL%/health' -TimeoutSec 5; if ($resp.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
    if not errorlevel 1 (
        set "BACKEND_READY=1"
        goto :backend_ready
    )
    timeout /t 2 /nobreak > nul
)

:backend_ready
if not "%BACKEND_READY%"=="1" (
    powershell -Command "try { $resp = Invoke-WebRequest -Uri 'http://127.0.0.1:8010/health' -TimeoutSec 5; if ($resp.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
    if not errorlevel 1 (
        set "BACKEND_URL=http://127.0.0.1:8010"
        echo [WARN] Backend on port %BACKEND_PORT% unavailable, using existing backend on 8010.
        goto :backend_ready_ok
    )
    echo [ERROR] Backend did not become healthy on %BACKEND_URL%
    echo [ERROR] Check backend.log for the startup error.
    cd ..
    pause
    exit /b 1
)
echo [OK] Backend is healthy
:backend_ready_ok

REM Frontend setup
echo.
echo [3/4] Setting up frontend...
cd ..

cd frontend
if not exist "node_modules" (
    echo Installing npm packages...
    call npm install
)

REM Start frontend
echo.
echo [4/4] Starting frontend...
start "Frontend" cmd /k "set VITE_API_PROXY_TARGET=%BACKEND_URL% && npm run dev"

echo.
echo ==========================================
echo SUCCESS! Application starting...
echo ==========================================
echo.
echo Backend: %BACKEND_URL%
echo Frontend: http://localhost:5173
echo.
echo Opening browser in 5 seconds...
timeout /t 5 /nobreak > nul
start http://localhost:5173
echo.
echo Application is running! Close this window.
echo.
pause
