@echo off
echo ================================
echo  Email Warmup Tool - Setup
echo ================================
echo.

:: Check Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed.
    echo Please download and install Node.js v20 from: https://nodejs.org
    pause
    exit /b 1
)

echo Node.js found. Installing dependencies...
call npm install

if %errorlevel% neq 0 (
    echo.
    echo ERROR: npm install failed. See above for details.
    pause
    exit /b 1
)

echo.
echo ================================
echo  Setup complete!
echo  Now double-click start.bat
echo ================================
pause
