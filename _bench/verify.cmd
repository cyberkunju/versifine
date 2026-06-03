@echo off
cd /d "%~dp0"
node verify.mjs > verify.txt 2>&1
echo EXIT_CODE=%errorlevel% >> verify.txt
