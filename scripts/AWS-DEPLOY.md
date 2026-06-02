# Versifine on AWS EC2

Reticule-only runbook for the deployment at **https://versifine.com**.

## Architecture

- Instance: Ubuntu arm64 EC2, SSH user `reticule`.
- Public traffic: nginx on `:80` and `:443` with the Cloudflare origin certificate.
- Services: `versifine-web`, `versifine-api`, `versifine-wabot`.
- Runtime paths:
  - `/opt/versifine/repo/` deployed monorepo
  - `/opt/versifine/wabot-state/.wwebjs_auth/` persistent WhatsApp session
  - `/etc/versifine/{api,web,wabot}.env` deployment env files

The old Fedora deployment target is no longer part of GitHub Actions or the
production runbook.

## One-Time Setup

Bootstrap the reticule box:

```bash
ssh reticule "curl -fsSL https://raw.githubusercontent.com/cyberkunju/versifine/main/scripts/remote-bootstrap-ubuntu.sh -o /tmp/v-bootstrap.sh && bash /tmp/v-bootstrap.sh"
```

Create local env files from the templates, fill the real secrets, then upload:

```bash
cp scripts/env-templates/api.env.example   .deploy-env/api.env
cp scripts/env-templates/web.env.example   .deploy-env/web.env
cp scripts/env-templates/wabot.env.example .deploy-env/wabot.env

scp .deploy-env/api.env   reticule:/tmp/
scp .deploy-env/web.env   reticule:/tmp/
scp .deploy-env/wabot.env reticule:/tmp/
ssh reticule "
  sudo install -m 0640 -o root -g versifine /tmp/api.env   /etc/versifine/api.env &&
  sudo install -m 0640 -o root -g versifine /tmp/web.env   /etc/versifine/web.env &&
  sudo install -m 0640 -o root -g versifine /tmp/wabot.env /etc/versifine/wabot.env &&
  shred -u /tmp/api.env /tmp/web.env /tmp/wabot.env
"
```

Install the Cloudflare origin certificate:

```bash
scp .deploy-env/versifine.com.cert.pem reticule:/tmp/
scp .deploy-env/versifine.com.key.pem  reticule:/tmp/
ssh reticule "
  sudo install -d -o root -g root -m 0755 /etc/ssl/versifine.com &&
  sudo install -m 0644 -o root -g root /tmp/versifine.com.cert.pem /etc/ssl/versifine.com/cert.pem &&
  sudo install -m 0600 -o root -g root /tmp/versifine.com.key.pem  /etc/ssl/versifine.com/key.pem &&
  shred -u /tmp/versifine.com.cert.pem /tmp/versifine.com.key.pem
"
```

Run the first deploy:

```bash
ssh reticule "curl -fsSL https://raw.githubusercontent.com/cyberkunju/versifine/main/scripts/remote-deploy.sh -o /tmp/v-deploy.sh && BRANCH=main bash /tmp/v-deploy.sh"
```

## GitHub Actions

Set only the reticule secrets:

```bash
gh secret set RETICULE_HOST    --repo cyberkunju/versifine --body "<reticule-public-ip-or-host>"
gh secret set RETICULE_SSH_KEY --repo cyberkunju/versifine < ~/.ssh/reticule_ec2
```

Pushes to `main` deploy automatically to reticule.

## Operations

```bash
ssh reticule
sudo systemctl status versifine-web versifine-api versifine-wabot
sudo journalctl -u versifine-wabot -f
sudo nginx -t && sudo systemctl reload nginx
```

Manual deploy:

```bash
ssh reticule "curl -fsSL https://raw.githubusercontent.com/cyberkunju/versifine/main/scripts/remote-deploy.sh -o /tmp/v-deploy.sh && BRANCH=main bash /tmp/v-deploy.sh"
```

Pair WhatsApp at `https://versifine.com/wa-qr/`. The auth directory is symlinked
to `/opt/versifine/wabot-state/.wwebjs_auth/`, so normal deploys preserve the
session.
