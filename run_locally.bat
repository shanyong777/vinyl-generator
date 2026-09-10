@echo off
title Vinyloop Local Server
echo ==============================================
echo        Vinyloop Local Dev Server Setup
echo ==============================================
echo.

where python >nul 2>nul
if %errorlevel% equ 0 (
    echo [+] Python detected. Starting Python HTTP Server...
    echo [+] Server will run at: http://127.0.0.1:8000
    echo [+] Opening web browser...
    start "" "http://127.0.0.1:8000"
    python -m http.server 8000 --bind 127.0.0.1
) else (
    where npx >nul 2>nul
    if %errorlevel% equ 0 (
        echo [+] Node.js detected. Starting serve via npx...
        echo [+] Server will run at: http://localhost:3000
        echo [+] Opening web browser...
        start "" "http://localhost:3000"
        npx -y serve
    ) else (
        echo [!] Warning: Neither Python nor Node.js/npx was found on your system.
        echo [!] You can still try opening 'index.html' directly in your browser.
        echo.
        pause
    )
)
