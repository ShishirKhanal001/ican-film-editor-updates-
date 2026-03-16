@echo off
title ICAN Film Editor — Server
color 0C

echo.
echo   ==========================================
echo    ICAN Film Editor — Starting Server...
echo   ==========================================
echo.

:: ---- Kill any old server on port 3737 ----
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":3737 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul

:: ---- Add firewall rule for node.exe (silent, safe to run every time) ----
for /f "delims=" %%i in ('where node 2^>nul') do set NODE_EXE=%%i
if defined NODE_EXE (
    netsh advfirewall firewall show rule name="ICAN node.exe Outbound" >nul 2>&1
    if errorlevel 1 (
        echo   Adding firewall rule for node.exe...
        netsh advfirewall firewall add rule name="ICAN node.exe Outbound" dir=out action=allow program="%NODE_EXE%" enable=yes profile=any >nul 2>&1
        echo   Firewall rule added.
    )
)

echo   Keep this window open while editing.
echo   You can minimize it — don't close it.
echo.

cd /d "%~dp0ican-film-editor\server"

:loop
node server.js
echo.
echo   [Server stopped — restarting in 2 seconds...]
timeout /t 2 /nobreak >nul
goto loop
