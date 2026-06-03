@echo off
cd /d "%~dp0"
python sdk_test.py > sdk_test.txt 2>&1
echo EXIT_CODE=%errorlevel% >> sdk_test.txt
