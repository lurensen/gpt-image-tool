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

rem -- Port already listening: reuse running server, just show addresses --
netstat -ano | findstr /r ":!PORT! .*LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo Server already running ^(note: it may be the local-only variant^).
  goto showip
)

echo Starting server bound to 0.0.0.0 (LAN - same WiFi phones can reach it)...
start "GPT-Image server LAN (close this window to stop)" cmd /k "set HOST=0.0.0.0&& node server.js"

rem -- wait for the port (max 10s) --
set TRIES=0
:waitport
timeout /t 1 /nobreak >nul
netstat -ano | findstr /r ":!PORT! .*LISTENING" >nul 2>nul
if not errorlevel 1 goto showip
set /a TRIES+=1
if !TRIES! lss 10 goto waitport
echo [ERROR] server did not come up. Check the black server window,
echo         and look for server-crash.log next to server.js
pause
exit /b 1

:showip
start "" "http://localhost:!PORT!"
echo.
echo ====== Phone URLs (phone must be on the same WiFi) ======
for /f "usebackq tokens=2 delims=:" %%a in (`ipconfig ^| findstr /i "IPv4"`) do (
  for /f "tokens=1" %%b in ("%%a") do echo       http://%%b:!PORT!
)
echo ==========================================================
echo.
echo If the phone cannot open it: allow Node.js through the Windows firewall
echo (Private networks) when prompted, or open TCP port !PORT! manually.
echo Keep the black server window open while using the tool; closing it stops the server.
timeout /t 20 /nobreak >nul
endlocal
