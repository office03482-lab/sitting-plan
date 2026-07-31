@echo off
setlocal
REM Run Exam Seating Planner - Complete Setup
echo ==========================================
echo Exam Seating Planner - Complete Setup
echo ==========================================
echo.

REM Check if Node.js is installed
echo Checking Node.js installation...
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed!
    echo Please run install_nodejs.bat first, then restart your command prompt.
    pause
    exit /b 1
)
echo [OK] Node.js found
echo.

REM Check Python
echo Checking Python installation...
set "PYTHON_CMD="
if exist "%CD%\backend\venv\Scripts\python.exe" (
    set "PYTHON_CMD=%CD%\backend\venv\Scripts\python.exe"
    "%PYTHON_CMD%" --version >nul 2>&1
    if errorlevel 1 set "PYTHON_CMD="
)

if not defined PYTHON_CMD (
    if exist "%CD%\tools\python311\python.exe" (
        set "PYTHON_CMD=%CD%\tools\python311\python.exe"
        "%PYTHON_CMD%" --version >nul 2>&1
        if errorlevel 1 set "PYTHON_CMD="
    )
)

if not defined PYTHON_CMD (
    if exist "%LocalAppData%\Programs\Python\Python311\python.exe" (
        set "PYTHON_CMD=%LocalAppData%\Programs\Python\Python311\python.exe"
        "%PYTHON_CMD%" --version >nul 2>&1
        if errorlevel 1 set "PYTHON_CMD="
    )
)

if not defined PYTHON_CMD (
    if exist "%LocalAppData%\Programs\Python\Python312\python.exe" (
        set "PYTHON_CMD=%LocalAppData%\Programs\Python\Python312\python.exe"
        "%PYTHON_CMD%" --version >nul 2>&1
        if errorlevel 1 set "PYTHON_CMD="
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
    echo ERROR: No working Python installation was found!
    echo Please run install_python.bat first.
    pause
    exit /b 1
)
echo [OK] Python found: %PYTHON_CMD%
echo.

REM Backend Setup
echo Setting up Backend...
cd backend

REM Create venv if not exists
if not exist "venv" (
    echo Creating virtual environment...
    %PYTHON_CMD% -m venv venv
)
if exist "venv" (
    if not exist "venv\pyvenv.cfg" (
        echo Detected broken virtual environment. Recreating venv...
        rmdir /s /q venv
        %PYTHON_CMD% -m venv venv
    )
)
if exist "venv" (
    if not exist "venv\Scripts\activate.bat" (
        echo Detected incomplete virtual environment. Recreating venv...
        rmdir /s /q venv
        %PYTHON_CMD% -m venv venv
    )
)
if exist "venv" (
    if not exist "venv\Scripts\pip.exe" (
        echo Detected broken virtual environment. Recreating venv...
        rmdir /s /q venv
        %PYTHON_CMD% -m venv venv
    )
)

REM Activate venv
set "VENV_PY=%CD%\venv\Scripts\python.exe"
if not exist "%VENV_PY%" (
    echo [ERROR] Virtual environment python not found: %VENV_PY%
    cd ..
    pause
    exit /b 1
)

REM Install/update dependencies
echo Installing Python dependencies...
"%VENV_PY%" -m pip install -r requirements.txt

REM Copy .env if not exists
if not exist ".env" (
    echo Creating .env file from template...
    copy .env.example .env
    echo [!] Please edit backend\.env with your configuration
)

REM Setup database and sample data
echo Setting up database and sample data...
"%VENV_PY%" -m alembic upgrade head

if errorlevel 1 (
    echo [WARN] Database migration failed.
    echo [WARN] Continuing anyway - make sure your DATABASE_URL is correct.
) else (
    echo [OK] Backend setup complete
)
echo.

REM Backend preflight check
echo Running backend preflight check...
"%VENV_PY%" check_system.py
if errorlevel 1 (
    echo [ERROR] Backend preflight failed.
    echo [ERROR] Fix the backend issue shown above, then run this script again.
    cd ..
    pause
    exit /b 1
)
echo [OK] Backend preflight passed
echo.

REM Start backend in background
echo Cleaning old backend listeners (8000/8010/8020)...
for %%P in (8000 8010 8020) do (
    for /f "tokens=5" %%A in ('netstat -ano ^| findstr :%%P ^| findstr LISTENING') do (
        taskkill /PID %%A /F >nul 2>&1
    )
)
timeout /t 1 /nobreak >nul

set "BACKEND_PORT=8000"
call :CHECK_PORT 8000
if "%PORT_BUSY%"=="1" set "BACKEND_PORT=8010"
if "%PORT_BUSY%"=="1" call :CHECK_PORT 8010
if "%PORT_BUSY%"=="1" set "BACKEND_PORT=8020"
if "%PORT_BUSY%"=="1" call :CHECK_PORT 8020
if "%PORT_BUSY%"=="1" (
    echo [ERROR] No free backend port found (8000/8010/8020).
    cd ..
    pause
    exit /b 1
)

echo Starting backend server on port %BACKEND_PORT%...
REM Avoid Uvicorn's Windows reload subprocess here; it can fail reopening stdin.
start "Backend Server" cmd /k "\"%VENV_PY%\" -m uvicorn app.main:app --host 0.0.0.0 --port %BACKEND_PORT% > ..\backend.log 2>&1"

REM Wait for backend to become healthy
echo Waiting for backend health check...
set "BACKEND_READY=0"
for /L %%I in (1,1,12) do (
    powershell -Command "try { $resp = Invoke-WebRequest -Uri 'http://127.0.0.1:%BACKEND_PORT%/health' -TimeoutSec 5; if ($resp.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
    if not errorlevel 1 (
        set "BACKEND_READY=1"
        goto :backend_ready
    )
    timeout /t 2 /nobreak >nul
)

:backend_ready
if not "%BACKEND_READY%"=="1" (
    echo [ERROR] Backend did not become healthy on http://127.0.0.1:%BACKEND_PORT%
    echo [ERROR] Check backend.log for the startup error.
    cd ..
    pause
    exit /b 1
)
echo [OK] Backend is healthy
echo.

REM Frontend Setup
echo Setting up Frontend...
cd ..\frontend

REM Install dependencies if node_modules doesn't exist
if not exist "node_modules" (
    echo Installing npm dependencies...
    call npm install
)

echo [OK] Frontend setup complete
echo.

REM Start frontend in background
echo Starting frontend development server...
if defined VITE_API_PROXY_TARGET (
    start "Frontend Dev Server" cmd /k "set VITE_API_PROXY_TARGET=%VITE_API_PROXY_TARGET% && npm run dev"
) else (
    start "Frontend Dev Server" cmd /k "npm run dev"
)

REM Wait for services to start
echo Waiting for services to start...
timeout /t 5 /nobreak > nul

echo.
echo ==========================================
echo Services Started Successfully!
echo ==========================================
echo.
echo Frontend: http://localhost:5173
echo Backend:  http://localhost:%BACKEND_PORT%
echo API Docs: http://localhost:%BACKEND_PORT%/docs
echo.
echo Press any key to open the application in your browser...
pause > nul

REM Open browser
start http://localhost:5173

echo.
echo Application is running! You can close this window.
echo The backend and frontend will continue running in the background.
echo.
pause

:CHECK_PORT
set "PORT_BUSY=0"
for /f "tokens=5" %%A in ('netstat -ano ^| findstr :%1 ^| findstr LISTENING') do (
    set "PORT_BUSY=1"
)
goto :eof
