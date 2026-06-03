@echo off
cd /d "%~dp0"
node verify2.mjs > verify2.txt 2>&1
echo EXIT_CODE=%errorlevel% >> verify2.txt
