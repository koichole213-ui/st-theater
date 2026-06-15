@echo off
cd /d "%~dp0"

echo.
echo === st-theater final check ===
echo.

echo [1/2] Git status:
git status --short
echo.

echo [2/2] JavaScript syntax check:
node --check index.js
if errorlevel 1 goto failed
node --check notify.js
if errorlevel 1 goto failed
node --check persona-follow.js
if errorlevel 1 goto failed
node --check notification-sound.js
if errorlevel 1 goto failed
node --check version-check.js
if errorlevel 1 goto failed

echo.
echo Done. No JavaScript syntax errors found.
echo If Git status shows an unfamiliar file, send this window screenshot to Codex.
echo.
pause
exit /b 0

:failed
echo.
echo Stopped. A JavaScript syntax error is shown above.
echo Send this window screenshot to Codex.
echo.
pause
exit /b 1
