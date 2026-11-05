@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo.
  echo Created .env
  echo Please fill DEEPSEEK_API_KEY and ADMIN_TOKEN, then run start.bat again.
  echo.
  notepad ".env"
  pause
  exit /b
)
node server.js
pause
