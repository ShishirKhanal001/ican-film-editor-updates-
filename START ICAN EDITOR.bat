@echo off
title ICAN Film Editor — Server
color 0C

echo.
echo   ==========================================
echo    ICAN Film Editor — Starting Server...
echo   ==========================================
echo.
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
