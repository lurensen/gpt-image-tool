@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

set PORT=8788

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] node not found. Install Node.js and make sure it is in PATH.
  pause
  exit /b 1
)

rem -- If something already listens on PORT, just open the browser (no double start) --
netstat -ano | findstr /r ":!PORT! .*LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo Port !PORT! already in use - server seems running. Opening browser...
  start "" "http://localhost:!PORT!"
  timeout /t 2 /nobreak >nul
  exit /b 0
)

echo Starting gpt-image server on port !PORT! ^(with SenseNova /v1 proxy^)...
start "GPT-Image server (close this window to stop)" cmd /k "node server.js"

rem -- wait until the port is really listening (max 10s), then open browser --
set TRIES=0
:waitport
timeout /t 1 /nobreak >nul
netstat -ano | findstr /r ":!PORT! .*LISTENING" >nul 2>nul
if not errorlevel 1 goto openbrowser
set /a TRIES+=1
if !TRIES! lss 10 goto waitport
echo [ERROR] server did not come up. Check the black server window for errors,
echo         and look for server-crash.log next to server.js
pause
exit /b 1

:openbrowser
start "" "http://localhost:!PORT!"
echo Done. Browser opened at http://localhost:!PORT!
echo Keep the black server window open while using the tool; closing it stops the server.
timeout /t 4 /nobreak >nul
endlocal
