@echo off
chcp 65001 >nul
setlocal
title LiveDesign

rem 同じコマンドプロンプトから続けて起動しても前回の選択が残らないようにする
set "DEMO_MODE="

echo ========================================
echo   LiveDesign Studio
echo ========================================
echo.
echo     1. Demo Mode (no TikTok connection)
echo     2. Live Mode (TikTok LIVE)
echo.
set /p MODESEL="Select mode (1 or 2): "

if "%MODESEL%"=="1" set DEMO_MODE=true
if "%MODESEL%"=="2" set DEMO_MODE=false
if not defined DEMO_MODE goto INVALID

cd /d "%~dp0"

echo.
echo ----------------------------------------
echo   DEMO_MODE : %DEMO_MODE%
echo   Studio    : http://localhost:3000/studio
echo ----------------------------------------
echo.
start "" "http://localhost:3000/studio"
node index.js
goto END

:INVALID
echo.
echo Invalid selection. Nothing was started.

:END
echo.
pause
