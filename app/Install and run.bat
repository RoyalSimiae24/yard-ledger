@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org, then run this file again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing for the first time. This takes a minute.
  call npm install
)
call npm start
