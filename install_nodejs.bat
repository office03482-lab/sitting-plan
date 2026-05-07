@echo off
REM Install Node.js automatically
echo Installing Node.js...

REM Download Node.js installer
powershell -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v18.19.0/node-v18.19.0-x64.msi' -OutFile 'node-installer.msi'"

REM Install Node.js silently
msiexec /i node-installer.msi /quiet /norestart

REM Wait for installation
timeout /t 10 /nobreak > nul

REM Clean up
del node-installer.msi

echo Node.js installation complete!
echo Please restart your command prompt and try running the app again.

pause