# 14 · Runbook

> Everything you need to install, run, debug, demo, or hand over the project. Aimed at "I've cloned the repo and have nothing else."

## Prerequisites

- Bun ≥ 1.1 (`bun --version`)
- PostgreSQL 16 (`psql --version`)
- pgvector 0.8.2 installed in Postgres
- Git
- Optional: an OpenAI API key (the API boots without it; AI features degrade to stubs)

The audit at the start of this session installed Postgres + pgvector via winget. Re-instructions:

```powershell
# Install Postgres 16 silently
winget install --id PostgreSQL.PostgreSQL.16 --silent --accept-source-agreements `
  --accept-package-agreements `
  --override "--mode unattended --superpassword versifine_dev --servicename postgresql-x64-16 --servicepassword versifine_dev --serverport 5432"

# Add to PATH
$pgBin = 'C:\Program Files\PostgreSQL\16\bin'
[Environment]::SetEnvironmentVariable('Path', "$pgBin;$([Environment]::GetEnvironmentVariable('Path', 'User'))", 'User')

# Install pgvector
$tmp = "$env:TEMP\pgvector"
New-Item -ItemType Directory $tmp -Force
$url = 'https://raw.githubusercontent.com/andreiramani/pgvector_pgsql_windows/main/zip/0.8.2/vector.v0.8.2-pg16.zip'
Invoke-WebRequest -Uri $url -OutFile "$tmp\vector.zip" -UseBasicParsing
Expand-Archive "$tmp\vector.zip" -DestinationPath $tmp -Force

# Elevated copy into Postgres dirs (run as administrator)
Copy-Item "$tmp\lib\vector.dll" "C:\Program Files\PostgreSQL\16\lib\vector.dll" -Force
Copy-Item "$tmp\share\extension\*" "C:\Program Files\PostgreSQL\16\share\extension\" -Force
Copy-Item "$tmp\include\server\extension\vector\*" "C:\Program Files\PostgreSQL\16\include\server\extension\" -Recurse -Force
```

## First-time setup

```bash
# 1. Clone (or already in workspace)
cd c:\Users\knava\Downloads\Versifine

# 2. Install workspace deps
bun install

# 3. Bootstrap Postgres (drops + recreates databases, role, extensions)
bun run db:init
# Output: creates versifine_dev + versifine_test, role versifine/versifine,
# enables pgcrypto, pg_trgm, citext, vector

# 4. Configure environment
# .env already exists with sane dev defaults; just set OPENAI_API_KEY if you have one:
notepad .env

# 5. Apply migrations
bun run --cwd apps/api db:migrate
# Output: 16 tables created, 3 migrations applied

# 6. (Optional, currently a stub) Seed demo data
bun run --cwd apps/api db:seed

# 7. Verify the API boots
bun run --cwd apps/api dev
# In another terminal:
curl http://127.0.0.1:5000/health
# {"success":true,"data":{"service":"versifine-api","uptime":...}}
```

If everything works you'll see a log line like:

```
{"ts":"2026-05-28T15:05:07.260Z","level":"info","event":"API_LISTENING","host":"127.0.0.1","port":5000,"env":"development","openaiConfigured":true,"ws":"/ws"}
```

## Daily development

```bash
# Single-app dev (recommended while focusing on one workspace)
bun run --cwd apps/api dev          # API on :5000
bun run --cwd apps/web dev          # Web on :5173 (when Phase 12 lands)
bun run --cwd apps/wa-bot dev       # Bot on :5001 (when Phase 10–11 lands)

# All-apps dev (root concurrently script)
bun run dev
# Note: this currently fails because apps/wa-bot has no entry file yet.
# Once Phase 10 lands, the script runs all three with named/colored output.

# Typecheck
bun run --cwd packages/shared typecheck
bun run --cwd apps/api typecheck
# (apps/wa-bot typecheck has a known bun-types issue, see 13-issues.md)

# Tests (currently broken due to bunfig issue, see 13-issues.md)
bun test --cwd apps/api

# Database operations
bun run db:init                       # full nuke + recreate
bun run --cwd apps/api db:migrate     # apply pending migrations
bun run --cwd apps/api db:reset       # drop tables, re-migrate, re-seed (uses migrate + seed scripts)
bun run --cwd apps/api db:seed        # seed only (currently stub)

# Smoke tests against a running API (in another terminal)
bun run --cwd apps/api smoke:auth      # register/login/refresh/me
bun run --cwd apps/api smoke:transaction
bun run --cwd apps/api smoke:budget
bun run --cwd apps/api smoke:goal
bun run --cwd apps/api smoke:ledger
bun run --cwd apps/api smoke:recurring
bun run --cwd apps/api smoke:forecast
bun run --cwd apps/api smoke:reports
bun run --cwd apps/api smoke:advice
bun run --cwd apps/api smoke:copilot
```

## Debugging

### "Invalid environment configuration. Aborting boot."

The Zod schema in `apps/api/src/env.ts` (or `apps/wa-bot/src/config.ts`) printed the field errors. Check `.env`:

```bash
type .env | findstr /V "^#" | findstr /V "^$"
```

Required keys:
- `DATABASE_URL`
- `JWT_ACCESS_SECRET` (≥16 chars)
- `JWT_REFRESH_SECRET` (≥16 chars)
- `BOT_SECRET` (≥8 chars)

### "relation X does not exist"

```bash
psql -U versifine -h localhost -d versifine_dev -c "\dt"
```

If empty, run `bun run --cwd apps/api db:migrate`. If `\dt` shows tables but the failing query mentions a column that doesn't exist, you're missing a migration:

```bash
psql -U versifine -h localhost -d versifine_dev -c "SELECT * FROM drizzle.__drizzle_migrations ORDER BY created_at;"
```

Should show 3 rows for `0000_*`, `0001_*`, `0002_*`. Re-run migrate if any are missing.

### "401 Unauthorized" everywhere

```bash
# Verify JWT secret length
echo -n "$JWT_ACCESS_SECRET" | wc -c   # Linux/Mac
$env:JWT_ACCESS_SECRET.Length             # PowerShell
```

Must be ≥ 16. Also check the access token's TTL — `JWT_ACCESS_TTL_SECONDS` defaults to 3600. If you're testing for a long time, use refresh:

```bash
curl -sX POST http://127.0.0.1:5000/auth/refresh \
  -H 'content-type: application/json' \
  -d "{\"refreshToken\":\"$REFRESH_TOKEN\"}"
```

### Capture intent always returns `unknown` or category always `Other`

OpenAI key is missing OR the MiniLM ONNX file isn't in place. Check:

```bash
echo $env:OPENAI_API_KEY    # PowerShell
echo $OPENAI_API_KEY         # Linux/Mac

dir apps\api\src\ml\model\onnx
# Should contain model.onnx (~30 MB). If not, run the conversion script per 13-issues.md.
```

### Forecast returns method=`rolling_average`

Need 14+ non-zero days of historical expense data. Either run the seed (when implemented) or insert ~20 manual transactions across different days.

### WebSocket upgrade returns 401

```bash
# Check the JWT manually
$token = "<your-access-token>"
$payload = ($token.Split('.')[1] + '==' + '==').Substring(0, ($token.Split('.')[1].Length + 4 - $token.Split('.')[1].Length % 4))
[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($payload.Replace('-', '+').Replace('_', '/')))
```

Should show `{"sub":"<user-uuid>","asid":"<space-uuid>","iat":...,"exp":...}`. If `exp` < now, refresh.

### Database is too "polluted" from testing

```bash
# Full reset — drops everything, recreates, runs migrations
bun run db:init && bun run --cwd apps/api db:migrate
```

## Demo flow

For a hackathon judge:

```
1. Open the README — show the 60-second setup
2. cd into the project and run:
     bun install
     bun run db:init
     bun run --cwd apps/api db:migrate
     bun run --cwd apps/api db:seed
     bun run --cwd apps/api dev
   (Once Phase 10–11 land, also: bun run --cwd apps/wa-bot dev)
   (Once Phase 12+ land, also: bun run --cwd apps/web dev)
3. Open http://localhost:5173 (web) → register → see seeded transactions
4. Type "spent 450 on auto" in the omnibar → instant categorization → live update
5. Open http://localhost:5001/qr (bot) → scan QR → bot is paired
6. Send "spent 200 on coffee" via WhatsApp → bot replies in localized text + voice
7. Web dashboard updates live (WS event)
8. Open Copilot → "where am I overspending?" → grounded response with tool calls visible
9. Toggle Privacy Mode → next capture runs in browser → categorize event still posts
10. Show the docs/ folder, the spec, the architecture, the multi-language story
```

## Known long-running commands (use start, not execute)

| Command | Reason |
| --- | --- |
| `bun run --cwd apps/api dev` | Starts a server, doesn't terminate |
| `bun run --cwd apps/web dev` | Vite dev server |
| `bun run --cwd apps/wa-bot dev` | WhatsApp bot, runs forever |
| `bun run dev` | Concurrently runs all three |

When testing these, use the `control_pwsh_process` tool with `action: "start"` to spawn in background, then `get_process_output` to read logs, then `action: "stop"` when done.

## Observability

All processes write structured JSON logs to stdout (info/debug) and stderr (warn/error). Each line:

```json
{"ts":"2026-05-28T15:05:07.260Z","level":"info","event":"AUTH_LOGIN_OK","userId":"01J...","requestId":"a1b2c3"}
```

Common event names you'll see:

- `API_LISTENING` — boot success
- `API_SHUTDOWN` — clean exit
- `AUTH_LOGIN_OK` / `AUTH_LOGIN_FAIL`
- `AUTH_REGISTER_OK`
- `CAPTURE_INTENT` — intent classifier result
- `CAPTURE_PIPELINE_OK` / `CAPTURE_PIPELINE_FAIL`
- `AI_CALL_OK` / `AI_CALL_FAIL` — every OpenAI call
- `BUDGET_RECOMPUTE_FAIL` — silent budget alert recompute error
- `WS_ATTACH` / `WS_DETACH` — socket lifecycle
- `WS_SEND_FAIL` — backpressure or send error
- `FORECAST_COMPUTE_OK` — successful forecast (with method field)
- `CATEGORIZE_MINILM_UNAVAILABLE` — Tier 3 disabled (ONNX missing)

To filter logs:

```bash
bun run --cwd apps/api dev 2>&1 | findstr /C:"event\":\"AUTH"
```

## Backup and restore

```bash
# Backup
pg_dump -U versifine -h localhost -d versifine_dev > backup-$(Get-Date -Format yyyy-MM-dd).dump

# Restore
psql -U versifine -h localhost -d versifine_dev < backup-2026-05-28.dump
```

For a full machine move:
1. Install Postgres + pgvector on the new machine.
2. `bun run db:init` to create the empty databases.
3. `psql -d versifine_dev < backup.dump` to restore data.
4. Copy `.env` (or recreate from `.env.example`).
5. `bun install` then `bun run --cwd apps/api dev`.

## Production notes (for later)

This is a hackathon project, not a production deployment. Before going live you'd want:

- HTTPS termination (nginx or Caddy in front of `apps/api`)
- Real refresh token storage (httpOnly cookies, not localStorage)
- Move WS auth from subprotocol to a proper session cookie
- Replace whatsapp-web.js with WhatsApp Business Cloud API
- Move Postgres to managed service (Neon, Supabase, RDS)
- Move from in-process rate limiter / event bus to Redis
- Add Sentry / OpenTelemetry for production observability
- Real backup strategy (point-in-time recovery)
- CI pipeline running typecheck, lint, tests on every push

None of this blocks the demo, all of it is captured in [15-roadmap.md](./15-roadmap.md) → "Stretch / production-readiness".
