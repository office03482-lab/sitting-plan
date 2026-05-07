@echo off
echo ==========================================
echo Exam Seating Planner - LAN Server
echo ==========================================
echo.
echo This starts the app for devices on the same Wi-Fi/network.
echo Frontend LAN URL will use this computer's IPv4 address.
echo.

echo Cleaning old backend listeners (8000/8010/8020)...
for %%P in (8000 8010 8020) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr :%%P ^| findstr LISTENING') do (
    taskkill /PID %%A /F >nul 2>&1
  )
)
timeout /t 1 /nobreak > nul

set "BACKEND_PORT=8000"
call :CHECK_PORT 8000
if "%PORT_BUSY%"=="1" set "BACKEND_PORT=8010"
if "%PORT_BUSY%"=="1" call :CHECK_PORT 8010
if "%PORT_BUSY%"=="1" set "BACKEND_PORT=8020"
if "%PORT_BUSY%"=="1" call :CHECK_PORT 8020
if "%PORT_BUSY%"=="1" (
  echo ERROR: No free backend port found (8000/8010/8020)
  pause
  exit /b 1
)

echo Starting backend on 0.0.0.0:%BACKEND_PORT%...
start "Backend LAN Server" cmd /k "cd /d ""%~dp0backend"" && venv\Scripts\uvicorn.exe app.main:app --reload --host 0.0.0.0 --port %BACKEND_PORT%"

timeout /t 3 /nobreak > nul

echo Starting frontend on 0.0.0.0:5173...
if "%BACKEND_PORT%"=="8000" (
  start "Frontend LAN Server" cmd /k "cd /d ""%~dp0frontend"" && npm run dev -- --host 0.0.0.0 --port 5173"
) else (
  start "Frontend LAN Server" cmd /k "cd /d ""%~dp0frontend"" && set VITE_API_PROXY_TARGET=http://127.0.0.1:%BACKEND_PORT% && npm run dev -- --host 0.0.0.0 --port 5173"
)

echo.
echo ==========================================
echo Use this computer's IPv4 address from ipconfig.
echo Example:
echo   http://192.168.1.36:5173
echo.
echo Backend:
echo   http://192.168.1.36:%BACKEND_PORT%/health
echo ==========================================
echo.
pause

:CHECK_PORT
set "PORT_BUSY=0"
for /f "tokens=5" %%A in ('netstat -ano ^| findstr :%1 ^| findstr LISTENING') do (
  set "PORT_BUSY=1"
)
goto :eof
