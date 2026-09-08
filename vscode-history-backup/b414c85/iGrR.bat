@echo off
setlocal

cd /d "%~dp0"

title Barnes Maze Analyzer

if not exist "runtime\node.exe" (
    echo.
    echo Barnes Maze Analyzer could not start.
    echo.
    echo Missing:
    echo   runtime\node.exe
    echo.
    pause
    exit /b 1
)

if not exist "app\index.html" (
    echo.
    echo Barnes Maze Analyzer could not start.
    echo.
    echo Missing:
    echo   app\index.html
    echo.
    pause
    exit /b 1
)

runtime\node.exe server.js

echo.
pause