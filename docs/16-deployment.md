# 16 · Deployment status

Live at **https://versifine.com** (Cloudflare-proxied to AWS EC2 in `ap-south-2`).

## Where things landed

| Component | Status | Where |
| --- | --- | --- |
| **EC2 instance** | Running | `i-084c0491501ecd8e8`, `m8i.2xlarge`, Fedora 43, public IP `40.192.113.52` |
| **Hastkala (previous tenant)** | Stopped + disabled, files preserved | `/opt/hastkala/`, services `hastkala-{web,api,wabot}.service` |
| **Postgres 16 + pgvector** | Running | local socket + `127.0.0.1:5432`, role `versifine`, dbs `versifine_dev` & `versifine_test` |
| **Versifine API** | Running | `versifine-api.service`, `127.0.0.1:5100` |
| **Versifine Web** | Running | `versifine-web.service`, `127.0.0.1:3100` |
| **Versifine WhatsApp Bot** | Running, awaiting first QR scan | `versifine-wabot.service`, `127.0.0.1:5101` |
| **nginx vhost** | Active | `/etc/nginx/conf.d/versifine.conf`, routes `/`, `/api/`, `/ws`, `/wa-qr/`, `/healthz` |
| **TLS cert** | Self-signed (placeholder) | `/etc/ssl/versifine.com/{cert,key}.pem` |
| **GitHub Actions CI/CD** | Wired | `.github/workflows/deploy.yml`, secrets `EC2_HOST` + `EC2_SSH_KEY` set |

## Verification (origin-direct, run from the EC2 box)

```bash
ssh hastkala "for u in / /healthz /api/health /wa-qr/ /wa-qr/qr.png; do
  echo -n \"\$u -> \"; curl -sk -o /dev/null -w '%{http_code}\n' -H 'Host: versifine.com' https://127.0.0.1\$u
done"
```

Result on the live deploy:

```
/ -> 200
/healthz -> 200
/api/health -> 200
/wa-qr/ -> 200
/wa-qr/qr.png -> 200
```

## One outstanding action item

**Cloudflare SSL/TLS mode**: the origin currently uses a placeholder self-signed cert. Cloudflare's default `Full (strict)` mode rejects it and refuses to proxy. Fix in the Cloudflare dashboard:

1. Go to `versifine.com` zone → SSL/TLS → Overview.
2. Switch encryption mode to **Full** (not "Full (strict)").
3. The site comes up at https://versifine.com immediately.

Optional follow-up: generate a Cloudflare Origin Certificate in the same dashboard (SSL/TLS → Origin Server → Create Certificate, RSA, 15 years, hostnames `versifine.com` + `*.versifine.com`), then `scp` the pem files into `/etc/ssl/versifine.com/`, `sudo systemctl reload nginx`, and switch the SSL mode back to **Full (strict)**.

## Operating

```bash
ssh -i ~/.ssh/hastkala_ec2 fedora@40.192.113.52
sudo systemctl status versifine-{web,api,wabot}
sudo journalctl -u versifine-wabot -f       # tail bot logs (QR, errors)
sudo systemctl restart versifine-{web,api,wabot}
sudo nginx -t && sudo systemctl reload nginx
```

## First-time WhatsApp pairing

Open https://versifine.com/wa-qr/ once Cloudflare is in `Full` mode. Auto-refreshes every 5 seconds. Scan the QR with WhatsApp on your phone (Settings → Linked Devices → Link a Device). The session persists at `/opt/versifine/wabot-state/.wwebjs_auth/` and survives every subsequent deploy.

## CI/CD

Pushes to `main` automatically run `.github/workflows/deploy.yml`:

1. SSH into the EC2 box using `EC2_SSH_KEY`.
2. Curl the deploy script for that exact commit SHA.
3. Run `remote-deploy.sh` which builds + syncs + migrates + smart-restarts.
4. Smoke-test origin (Host header) and public (via Cloudflare).

Manual redeploy when needed:

```bash
ssh -i ~/.ssh/hastkala_ec2 fedora@40.192.113.52 "curl -fsSL 'https://raw.githubusercontent.com/cyberkunju/versifine/main/scripts/remote-deploy.sh?nocache=`date +%s`' -o /tmp/v-deploy.sh && bash /tmp/v-deploy.sh"
```

## Bringing hastkala back

```bash
ssh hastkala "sudo systemctl enable --now hastkala-web hastkala-api hastkala-wabot"
```

The hastkala vhost still wins on `cyberkunju.com` via SNI; versifine wins on `versifine.com`. Both can run side-by-side once you re-enable.

## Lab profile risk

The instance is part of an AWS Lab profile (`EC2SSMRoleForLab1`). If the lab session expires the box may be wiped. To redeploy on a fresh box:

```bash
# 1. New IP
NEW_IP=<ip>
# 2. Update Cloudflare DNS A record for versifine.com to NEW_IP.
# 3. Update GH secret: gh secret set EC2_HOST --repo cyberkunju/versifine --body "<NEW_IP>"
# 4. Bootstrap + deploy:
ssh fedora@$NEW_IP "curl -fsSL https://raw.githubusercontent.com/cyberkunju/versifine/main/scripts/remote-bootstrap.sh -o /tmp/v-bootstrap.sh && bash /tmp/v-bootstrap.sh"
# 5. Re-upload .deploy-env/{api,web,wabot}.env and the SSL cert, then run remote-deploy.sh.
```
