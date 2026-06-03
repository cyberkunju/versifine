@echo off
cd /d "%~dp0"
node verify3.mjs > verify3.txt 2>&1
echo EXIT_CODE=%errorlevel% >> verify3.txt
