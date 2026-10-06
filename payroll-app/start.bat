@echo off
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org and run this file again.
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  echo Node.js 22.13 or newer is required. Install the LTS version from https://nodejs.org
  pause
  exit /b 1
)

call node scripts\prepare.mjs
if errorlevel 1 goto :err

echo.
echo The app is running at http://localhost:3000
echo Keep this window open while you work. Close it to stop the app.
echo.
start "" http://localhost:3000
call npm start
goto :eof

:err
echo.
echo Setup failed. Send a screenshot of this window.
pause
exit /b 1
