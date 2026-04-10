@echo off
echo ================================
echo  Email Warmup Tool - Starting
echo ================================
echo.
echo Dashboard will open at: http://localhost:3000
echo.
echo To stop the server, press Ctrl+C
echo Do NOT close this window while the tool is running.
echo.
start "" http://localhost:3000
node src/index.js
pause
