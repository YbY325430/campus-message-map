@echo off
"%SystemRoot%\System32\chcp.com" 65001 >nul
title Xiaoyuanxing Platform
cd /d "%~dp0"
"%~dp0runtime\node.exe" "%~dp0launcher.js"
if errorlevel 1 pause
