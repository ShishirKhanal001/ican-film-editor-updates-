@echo off
:: ======================================
:: ICAN Film Editor — Server Launcher
:: Called by CEP panel auto-start
:: ======================================

:: Kill any existing process on port 3737 (prevents EADDRINUSE)
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":3737 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)

:: Wait a moment for port to be released
timeout /t 1 /nobreak >nul 2>&1

:: Add Windows Firewall rule for node.exe if missing (allows Groq/OpenAI API calls)
for /f %%i in ('where node 2^>nul') do (
    netsh advfirewall firewall show rule name="ICAN node.exe Outbound" >nul 2>&1
    if errorlevel 1 (
        netsh advfirewall firewall add rule name="ICAN node.exe Outbound" dir=out action=allow program="%%i" enable=yes profile=any >nul 2>&1
    )
)

:: Start the server
node server.js
