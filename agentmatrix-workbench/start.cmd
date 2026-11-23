@echo off
rem AgentMatrix-SC workbench launcher.
rem
rem ASCII only on purpose: cmd.exe parses .cmd files with the OEM code page
rem (GBK on Chinese Windows), so any UTF-8 Chinese here would be split into
rem bogus "commands". All Chinese output lives in scripts\launch.cjs.
rem
rem Usage: start.cmd

setlocal
cd /d "%~dp0"
chcp 65001 >nul 2>nul

rem Defensive: a leftover ELECTRON_RUN_AS_NODE=1 makes Electron run as plain
rem Node and exit with "Cannot read properties of undefined (reading 'whenReady')".
set ELECTRON_RUN_AS_NODE=

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24+ is required but "node" was not found in PATH.
  pause
  exit /b 1
)

node "scripts\launch.cjs" %*
set EXITCODE=%ERRORLEVEL%
if not "%EXITCODE%"=="0" pause
exit /b %EXITCODE%
