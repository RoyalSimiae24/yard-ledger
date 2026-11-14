@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org, then run this file again.
  pause
  exit /b 1
)
echo Building Yard Ledger.exe. This takes a few minutes.
call npm install
call npx electron-packager . "Yard Ledger" --platform=win32 --arch=x64 --out=dist --overwrite --ignore="^/dist" --ignore="\.bat$" --ignore="\.txt$"
echo.
echo Done. Open the dist folder, then Yard Ledger-win32-x64, then Yard Ledger.exe
pause
