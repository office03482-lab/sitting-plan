@echo off
echo ==========================================
echo Stopping Exam Seating Planner Servers...
echo ==========================================
echo.

echo Closing project console windows...
taskkill /FI "WINDOWTITLE eq Backend Server*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Frontend Dev Server*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Backend*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Frontend*" /T /F >nul 2>&1

echo Releasing project ports...
for %%P in (5173 5174 8000 8010 8020) do (
    for /f "tokens=5" %%A in ('netstat -ano ^| findstr :%%P ^| findstr LISTENING') do (
        echo Stopping PID %%A using port %%P
        taskkill /PID %%A /T /F >nul 2>&1
    )
)

echo.
echo Project servers have been stopped successfully.
echo Only this app's console windows and ports were targeted.
pause
