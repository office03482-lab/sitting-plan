@echo off
setlocal
REM Setup Database and Sample Data
echo ==========================================
echo Setting up Database and Sample Data
echo ==========================================
echo.

cd backend

set "VENV_PY=%CD%\venv\Scripts\python.exe"
if not exist "%VENV_PY%" (
    echo [WARN] backend venv python not found. Skipping sample data script.
    exit /b 1
)

REM Setup database and add sample data
echo Setting up database and adding sample data...
"%VENV_PY%" setup_db_script.py

if errorlevel 1 (
    echo [WARN] Legacy sample-data script failed.
    echo [WARN] The application can still start and will create tables automatically.
    exit /b 1
)

echo [OK] Database setup complete
echo.
exit /b 0
