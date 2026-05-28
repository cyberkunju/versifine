# Versifine on AWS EC2

End-to-end runbook for the deployment at **https://versifine.com**.

## Architecture (single-instance)

```
┌──────────────────────────────────────────────────────┐
│  Fedora 43 / m8i.2xlarge / 30GiB RAM / 8 vCPU       │
│  Public IP: 40.192.113.52  (Cloudflare proxied)     │
│                                                       │
│  nginx :80 + :443 (Cloudflare full-strict)           │
│   ├─ /            → 127.0.0.1:3100 (web SSR)        │
│   ├─ /api/        → 127.0.0.1:5100 (api)            │
│   ├─ /ws          → 127.0.0.1:5100 (api WS upgrade) │
│   ├─ /wa-qr/      → 127.0.0.1:5101/qr (bot QR)      │
│   ├─ /healthz     → 200 ok                           │
│   └─ /_app/, /models/, /*.{ico,png,...} → web SSR   │
│                                                       │
│  systemd services (auto-restart):                    │
│   ├─ versifine-web    (Bun + SvelteKit adapter-node) │
│   ├─ versifine-api    (Bun + Hono + Drizzle)         │
│   └─ versifine-wabot  (Bun + whatsapp-web.js)        │
│                                                       │
│  Postgres 16 + pgvector (local, listening 127.0.0.1) │
│   ├─ versifine_dev   (production data)               │
│   └─ versifine_test  (CI / smoke runs)               │
│                                                       │
│  /opt/versifine/repo/   ← whole monorepo deployed    │
│  /opt/versifine/wabot-state/.wwebjs_auth (persists)  │
│  /etc/versifine/{api,web,wabot}.env (0640)           │
└──────────────────────────────────────────────────────┘
```

## One-time setup

### 1. Stop hastkala (don't remove)

```bash
ssh hastkala "sudo systemctl stop hastkala-web hastkala-api hastkala-wabot && \
              sudo systemctl disable hastkala-web hastkala-api hastkala-wabot"
```

Files in `/opt/hastkala/` and `/etc/hastkala/` stay untouched. Re-enable later with
`sudo systemctl enable --now hastkala-web hastkala-api hastkala-wabot`.

### 2. Bootstrap the box

```bash
ssh hastkala "curl -fsSL https://raw.githubusercontent.com/cyberkunju/versifine/main/scripts/remote-bootstrap.sh -o /tmp/v-bootstrap.sh && bash /tmp/v-bootstrap.sh"
```

This installs Bun, Postgres 16 + pgvector, Chromium runtime deps, swap, and creates
the `versifine` deploy user and `/opt/versifine/` layout. Re-runnable.

### 3. Generate + upload env files

Locally:

```bash
cp scripts/env-templates/api.env.example   .deploy-env/api.env
cp scripts/env-templates/web.env.example   .deploy-env/web.env
cp scripts/env-templates/wabot.env.example .deploy-env/wabot.env
# Open each file and fill in the real secrets:
#   - JWT_ACCESS_SECRET / JWT_REFRESH_SECRET (openssl rand -hex 32)
#   - BOT_SECRET (must match in api.env and wabot.env)
#   - OPENAI_API_KEY (yours)
```

Upload:

```bash
scp -i ~/.ssh/hastkala_ec2 .deploy-env/api.env   fedora@40.192.113.52:/tmp/
scp -i ~/.ssh/hastkala_ec2 .deploy-env/web.env   fedora@40.192.113.52:/tmp/
scp -i ~/.ssh/hastkala_ec2 .deploy-env/wabot.env fedora@40.192.113.52:/tmp/
ssh hastkala "
  sudo install -m 0640 -o root -g versifine /tmp/api.env   /etc/versifine/api.env &&
  sudo install -m 0640 -o root -g versifine /tmp/web.env   /etc/versifine/web.env &&
  sudo install -m 0640 -o root -g versifine /tmp/wabot.env /etc/versifine/wabot.env &&
  shred -u /tmp/api.env /tmp/web.env /tmp/wabot.env
"
```

### 4. Install the SSL cert

A Cloudflare Origin certificate signed for `versifine.com` and `*.versifine.com`.
Generate it from Cloudflare → SSL/TLS → Origin Server → Create Certificate.

```bash
scp -i ~/.ssh/hastkala_ec2 .deploy-env/versifine.com.cert.pem fedora@40.192.113.52:/tmp/
scp -i ~/.ssh/hastkala_ec2 .deploy-env/versifine.com.key.pem  fedora@40.192.113.52:/tmp/
ssh hastkala "
  sudo install -d -o root -g root -m 0755 /etc/ssl/versifine.com &&
  sudo install -m 0644 -o root -g root /tmp/versifine.com.cert.pem /etc/ssl/versifine.com/cert.pem &&
  sudo install -m 0600 -o root -g root /tmp/versifine.com.key.pem  /etc/ssl/versifine.com/key.pem &&
  shred -u /tmp/versifine.com.cert.pem /tmp/versifine.com.key.pem
"
```

### 5. First deploy

```bash
ssh hastkala "curl -fsSL https://raw.githubusercontent.com/cyberkunju/versifine/main/scripts/remote-deploy.sh -o /tmp/v-deploy.sh && bash /tmp/v-deploy.sh"
```

### 6. Configure GitHub Actions

```bash
gh secret set EC2_HOST    --repo cyberkunju/versifine --body "40.192.113.52"
gh secret set EC2_SSH_KEY --repo cyberkunju/versifine < ~/.ssh/hastkala_ec2
```

Pushes to `main` now redeploy automatically.

### 7. Pair the WhatsApp bot

Open https://versifine.com/wa-qr/ in your browser (page refreshes every 5s).
Open WhatsApp → Settings → Linked Devices → Link a Device → scan the code.
The session is persisted at `/opt/versifine/wabot-state/.wwebjs_auth/` and
survives every subsequent deploy.

## Service control

```bash
ssh hastkala
sudo systemctl status versifine-web versifine-api versifine-wabot
sudo journalctl -u versifine-wabot -f   # tail wabot logs (QR, errors)
sudo systemctl restart versifine-wabot
sudo nginx -t && sudo systemctl reload nginx
```

## Updating env files

```bash
ssh hastkala
sudo $EDITOR /etc/versifine/api.env       # also wabot.env, web.env
sudo systemctl restart versifine-api      # restart whichever changed
```

## Manual deploy

```bash
ssh hastkala "curl -fsSL https://raw.githubusercontent.com/cyberkunju/versifine/main/scripts/remote-deploy.sh -o /tmp/v-deploy.sh && bash /tmp/v-deploy.sh"
```

Or by exact commit:

```bash
SHA=$(git rev-parse HEAD)
ssh hastkala "curl -fsSL https://raw.githubusercontent.com/cyberkunju/versifine/$SHA/scripts/remote-deploy.sh -o /tmp/v-deploy.sh && bash /tmp/v-deploy.sh"
```

## Common issues

**Web returns 502** — `sudo journalctl -u versifine-web -n 100`. Almost always a
missing runtime dependency in `/opt/versifine/repo/apps/web/node_modules` after
a `package.json` change. Fix by re-running the deploy script.

**Bot Chromium fails to launch** — confirm `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser`
in `/etc/versifine/wabot.env` and that `~versifine/.config` and `~versifine/.cache` exist.

**WhatsApp session lost** — verify `/opt/versifine/repo/apps/wa-bot/.wwebjs_auth/`
is symlinked into `/opt/versifine/wabot-state/.wwebjs_auth/` and is owned by
`versifine:versifine`. Re-pair by tailing `journalctl -u versifine-wabot -f` and
opening `/wa-qr/`.

**API returns 502** — `sudo systemctl status versifine-api`. Most often a missing
env value in `/etc/versifine/api.env` (DB URL wrong, JWT secret too short).

**Bring hastkala back** — `sudo systemctl enable --now hastkala-web hastkala-api hastkala-wabot`.
The hastkala vhost continues to win on `cyberkunju.com` via SNI.

## Lab profile risk

This instance is part of an AWS Lab profile. Lab environments can wipe the
instance when the session ends. Re-deploy by running `remote-bootstrap.sh` then
`remote-deploy.sh` on the new IP, and re-uploading env files + SSL cert.
