@echo off
cd /d c:\Users\knava\Downloads\Finehance
for /f "delims=" %%i in ('node -e "const fs=require('fs');const m=fs.readFileSync('.env','utf8').match(/^OPENAI_API_KEY=(.*)$/m);process.stdout.write(m[1].trim())"') do set OPENAI_API_KEY=%%i
node _bench\run2.mjs > _bench\results2.txt 2>&1
echo DONE >> _bench\results2.txt
