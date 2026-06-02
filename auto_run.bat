@echo off
setlocal
echo ==========================================
echo Exam Seating Planner - Auto Setup ^& Run
echo ==========================================
echo.

REM Check if we're in the right directory
if not exist "backend" (
    echo ERROR: Please run this script from the SITTING PLAN root directory
    pause
    exit /b 1
)

echo [1/8] Checking Python installation...
set "PYTHON_CMD="

if exist "backend\venv\Scripts\python.exe" (
    set "PYTHON_CMD=%CD%\backend\venv\Scripts\python.exe"
    "%PYTHON_CMD%" --version >nul 2>&1
    if errorlevel 1 (
        echo WARNING: Existing backend virtual environment is broken.
        echo Its original Python installation is missing, so this venv cannot be reused.
        set "PYTHON_CMD="
    )
)

if not defined PYTHON_CMD (
    if exist "%CD%\.venv\Scripts\python.exe" (
        set "PYTHON_CMD=%CD%\.venv\Scripts\python.exe"
    )
)

if not defined PYTHON_CMD (
    if exist "%LocalAppData%\Programs\Python\Python311\python.exe" (
        set "PYTHON_CMD=%LocalAppData%\Programs\Python\Python311\python.exe"
    )
)

if not defined PYTHON_CMD (
    py --version >nul 2>&1
    if not errorlevel 1 (
        set "PYTHON_CMD=py"
    )
)

if not defined PYTHON_CMD (
    python --version >nul 2>&1
    if not errorlevel 1 (
        set "PYTHON_CMD=python"
    )
)

if not defined PYTHON_CMD (
    echo ERROR: No working Python installation was found.
    echo Please install Python 3.10+ and then recreate the backend virtual environment.
    echo Tip: you can run install_python.bat from this folder, then run auto_run.bat again.
    pause
    exit /b 1
)
echo [OK] Python ready: %PYTHON_CMD%

echo.
echo [2/8] Checking Node.js installation...
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed or not available in PATH!
    echo Please install Node.js 18+ and restart the terminal.
    pause
    exit /b 1
)
echo [OK] Node.js found

echo.
echo [3/8] Setting up Python virtual environment...
cd backend
if not exist "venv" (
    %PYTHON_CMD% -m venv venv
    if errorlevel 1 (
        echo ERROR: Failed to create virtual environment
        cd ..
        pause
        exit /b 1
    )
)
if exist "venv" (
    if not exist "venv\pyvenv.cfg" (
        echo WARNING: Broken virtual environment detected. Recreating...
        rmdir /s /q venv
        %PYTHON_CMD% -m venv venv
    )
)
if exist "venv" (
    if not exist "venv\Scripts\activate.bat" (
        echo WARNING: Incomplete virtual environment detected. Recreating...
        rmdir /s /q venv
        %PYTHON_CMD% -m venv venv
    )
)
if exist "venv" (
    if not exist "venv\Scripts\python.exe" (
        echo WARNING: Virtual environment python missing. Recreating...
        rmdir /s /q venv
        %PYTHON_CMD% -m venv venv
    )
)
if exist "venv" (
    venv\Scripts\python.exe --version >nul 2>&1
    if errorlevel 1 (
        echo WARNING: Virtual environment points to a missing Python install. Recreating...
        rmdir /s /q venv
        %PYTHON_CMD% -m venv venv
    )
)
echo [OK] Virtual environment ready

echo.
echo [4/8] Activating virtual environment...
call venv\Scripts\activate.bat
if errorlevel 1 (
    echo ERROR: Failed to activate virtual environment
    cd ..
    pause
    exit /b 1
)
echo [OK] Virtual environment activated

echo.
echo [5/8] Installing Python dependencies...
pip install -r requirements.txt >nul 2>&1
if errorlevel 1 (
    echo ERROR: Failed to install Python dependencies
    cd ..
    pause
    exit /b 1
)
echo [OK] Python dependencies installed

echo.
echo [6/8] Setting up database...
python -m alembic upgrade head >nul 2>&1
if errorlevel 1 (
    echo [WARN] Database migration failed.
    echo [WARN] Continuing anyway - make sure your DATABASE_URL is correct.
) else (
    echo [OK] Database migration complete
)

echo.
echo [7/8] Cleaning old app listeners (5173/5174/8000/8010/8020)...
for %%P in (5173 5174 8000 8010 8020) do (
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
    echo ERROR: No free backend port found (8000/8010/8020).
    cd ..
    pause
    exit /b 1
)

if not "%BACKEND_PORT%"=="8000" (
    set "VITE_API_PROXY_TARGET=http://127.0.0.1:%BACKEND_PORT%"
    echo [WARN] Port 8000 busy. Using backend port %BACKEND_PORT%
)

echo [7/8] Starting backend server on port %BACKEND_PORT%...
start "Backend Server" cmd /k "call venv\Scripts\activate.bat && uvicorn app.main:app --reload --host 0.0.0.0 --port %BACKEND_PORT%"

echo.
echo [8/8] Setting up frontend...
cd ..
if not exist "frontend" (
    echo ERROR: Frontend directory not found
    pause
    exit /b 1
)

cd frontend
if not exist "node_modules" (
    echo Installing npm dependencies...
    call npm install
    if errorlevel 1 (
        echo ERROR: Failed to install npm dependencies
        cd ..
        pause
        exit /b 1
    )
)
echo [OK] Frontend dependencies ready

echo.
echo Starting frontend development server...
if defined VITE_API_PROXY_TARGET (
    start "Frontend Dev Server" cmd /k "set VITE_API_PROXY_TARGET=%VITE_API_PROXY_TARGET% && npm run dev -- --host 0.0.0.0 --port 5173"
) else (
    start "Frontend Dev Server" cmd /k "npm run dev -- --host 0.0.0.0 --port 5173"
)

echo.
echo ==========================================
echo SUCCESS! Application is starting up...
echo ==========================================
echo.
echo Backend will be available at: http://localhost:%BACKEND_PORT%
echo Frontend will be available at: http://localhost:5173
echo API Documentation: http://localhost:%BACKEND_PORT%/docs
echo For other devices on the same Wi-Fi, use this computer's IPv4 address.
echo.
echo Please wait 10-15 seconds for services to fully start...
echo.
timeout /t 10 /nobreak > nul
echo Opening browser...
start http://localhost:5173
echo.
echo Application is now running! Check the opened browser window.
echo You can close this window - the servers will continue running.
echo.
pause

:CHECK_PORT
set "PORT_BUSY=0"
for /f "tokens=5" %%A in ('netstat -ano ^| findstr :%1 ^| findstr LISTENING') do (
    set "PORT_BUSY=1"
)
goto :eof
