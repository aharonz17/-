@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules (
  echo מתקין רכיבים בפעם הראשונה...
  call npm install || goto :err
)
if not exist .next\BUILD_ID (
  echo בונה את המערכת...
  call npm run build || goto :err
)
start "" http://localhost:3000
call npm start
goto :eof
:err
echo ההתקנה נכשלה. ודאו ש-Node.js 20 ומעלה מותקן: https://nodejs.org
pause
