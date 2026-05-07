@echo off
REM Exam Seating Planner - Setup Script for Windows
REM This script sets up the development environment

echo.
echo ==========================================
echo Exam Seating Planner - Development Setup
echo ==========================================
echo.

REM Check Python
echo Checking Python installation...
python --version >nul 2>&1
if errorlevel 1 (
    echo Python is not installed. Please install Python 3.10+
    pause
    exit /b 1
)
for /f "tokens=2" %%i in ('python --version 2^>^&1') do set PYTHON_VERSION=%%i
echo [OK] Python %PYTHON_VERSION% found
echo.

REM Backend Setup
echo Setting up Backend...
cd backend

REM Create venv
if not exist "venv" (
    echo Creating virtual environment...
    python -m venv venv
)

REM Activate venv
call venv\Scripts\activate.bat

REM Install dependencies
echo Installing Python dependencies...
pip install -r requirements.txt >nul 2>&1

REM Copy .env if not exists
if not exist ".env" (
    echo Creating .env file from template...
    copy .env.example .env
    echo [!] Please edit backend\.env with your configuration
)

echo [OK] Backend setup complete
echo.

REM Frontend Setup
echo Setting up Frontend...
cd ..\frontend

REM Check Node
node --version >nul 2>&1
if errorlevel 1 (
    echo Node.js is not installed. Please install Node.js 18+
    pause
    exit /b 1
)
for /f %%i in ('node --version') do set NODE_VERSION=%%i
echo [OK] Node %NODE_VERSION% found

REM Install dependencies
echo Installing npm dependencies...
call npm install >nul 2>&1

echo [OK] Frontend setup complete
echo.

REM Summary
echo ==========================================
echo Setup Complete!
echo ==========================================
echo.
echo Next steps:
echo.
echo 1. Configure environment:
echo    - Edit backend\.env with database and email settings
echo.
echo 2. Start the backend (from backend directory, new terminal^):
echo    venv\Scripts\activate.bat
echo    uvicorn app.main:app --reload
echo.
echo 3. Start the frontend (from frontend directory, new terminal^):
echo    npm run dev
echo.
echo 4. Open your browser:
echo    Frontend: http://localhost:5173
echo    Backend API: http://localhost:8000
echo    API Docs: http://localhost:8000/docs
echo.
echo For more details, see START_GUIDE.md
echo.
pause
