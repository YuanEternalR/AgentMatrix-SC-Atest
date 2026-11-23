@echo off
rem AgentMatrix-SC workbench shell launcher.
rem Keep this file ASCII-only: cmd.exe parses .cmd files with the OEM code page
rem (GBK on Chinese Windows), so UTF-8 Chinese text here gets split into bogus
rem commands. All Chinese output lives in scripts\launch.mjs instead.
rem
rem Usage:  start.cmd          Electron window
rem         start.cmd web      browser mode (http://127.0.0.1:4180)
rem         start.cmd check    self-check only

setlocal
cd /d "%~dp0"
chcp 65001 >nul 2>nul

rem Defensive: a leftover ELECTRON_RUN_AS_NODE=1 makes Electron run as plain Node
rem and exit with "Cannot read properties of undefined (reading 'whenReady')".
set ELECTRON_RUN_AS_NODE=

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24+ is required but "node" was not found in PATH.
  pause
  exit /b 1
)

node "scripts\launch.mjs" %*
set EXITCODE=%ERRORLEVEL%
if not "%EXITCODE%"=="0" pause
exit /b %EXITCODE%