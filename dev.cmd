@echo off
rem AgentMatrix-SC dev helper. Usage: dev up | dev ps | dev logs api | dev health
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\dev.ps1" %*
