#!/usr/bin/env bash
# Versifine remote bootstrap - Ubuntu (24.04/26.04, arm64 or amd64).
#
# Counterpart to remote-bootstrap.sh (which targets Fedora). Runs ON the
# Ubuntu EC2 instance and prepares everything needed for the first deploy:
# Bun runtime, PostgreSQL + pgvector, Chromium for the bot, nginx, swap,
# the deploy user and the /opt/versifine layout.
#
# Idempotent. Re-running is cheap and safe.
#
#   curl -fsSL https://raw.githubusercontent.com/cyberkunju/versifine/main/scripts/remote-bootstrap-ubuntu.sh | bash
#
# Notes vs the Fedora box:
#   - Package manager is apt, not dnf.
#   - PostgreSQL is Ubuntu's default major (18 on 26.04) + postgresql-NN-pgvector.
#     The app only needs the vector/pgcrypto/pg_trgm/citext extensions, all of
#     which PG16/17/18 provide, and it connects over a standard DATABASE_URL.
#   - Chromium: Ubuntu ships chromium only as a snap, whose strict confinement
#     can't open a profile dir under /opt. We install the snap (it provides the
#     engine) AND expose a stable /usr/bin/chromium-browser path that the
#     wa-bot systemd unit already points at via PUPPETEER_EXECUTABLE_PATH.
#   - Deploy user defaults to the box's primary login (e.g. 'reticule'); the
#     Fedora box uses 'versifine'. The deploy script derives paths from this.
set -euo pipefail
log() { printf "\033[1;36m[bootstrap]\033[0m %s\n" "$*"; }

# Mirror the Fedora box's two-user model so the systemd units and deploy
# script stay byte-identical:
#   - LOGIN_USER : the SSH/build user (fedora on the Fedora box; here it's
#                  whoever runs this script, e.g. reticule).
#   - DEPLOY_USER: the dedicated service user that owns /opt/versifine and is
#                  named in the systemd unit files (always 'versifine').
LOGIN_USER="$(id -un)"
DEPLOY_USER="${DEPLOY_USER:-versifine}"
BASE="/opt/versifine"
ENV_DIR="/etc/versifine"

export DEBIAN_FRONTEND=noninteractive

log "Login user: $LOGIN_USER ; service user: $DEPLOY_USER"

# ---------------------------------------------------------------------------
log "1/12 Updating apt package index"
sudo apt-get update -y -qq

log "2/12 Installing base packages"
sudo apt-get install -y -qq \
    nginx git rsync tar unzip curl ca-certificates jq \
    build-essential python3 \
    >/dev/null

log "3/12 Installing Node.js 22 (build helper for npm-only tooling)"
if ! command -v node >/dev/null || [[ "$(node -v 2>/dev/null)" != v22.* ]]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >/dev/null 2>&1
    sudo apt-get install -y -qq nodejs >/dev/null
fi
node -v

log "4/12 Installing Bun system-wide"
if [ ! -x /usr/local/bin/bun ] || [ -L /usr/local/bin/bun ]; then
    if ! command -v bun >/dev/null; then
        curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1
    fi
    # Replace any symlink with a real binary copy so it works under sudo -u
    # for any user (a symlink into $HOME/.bun fails because $HOME is 0700).
    BUN_SRC="${HOME}/.bun/bin/bun"
    [ -x "$BUN_SRC" ] || BUN_SRC="$(command -v bun)"
    sudo rm -f /usr/local/bin/bun
    sudo install -m 0755 "$BUN_SRC" /usr/local/bin/bun
fi
/usr/local/bin/bun --version

# ---------------------------------------------------------------------------
log "5/12 Installing PostgreSQL + pgvector"
if ! command -v psql >/dev/null; then
    sudo apt-get install -y -qq postgresql postgresql-contrib >/dev/null
fi
# Detect the installed major version (e.g. 16, 17, 18).
PG_MAJOR="$(ls /usr/lib/postgresql/ 2>/dev/null | sort -n | tail -1)"
[ -n "$PG_MAJOR" ] || { echo "ERROR: PostgreSQL not found after install"; exit 1; }
log "  Â· PostgreSQL major version: $PG_MAJOR"

# pgvector packaged per major: postgresql-<major>-pgvector.
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_available_extensions WHERE name='vector'" 2>/dev/null | grep -q 1; then
    sudo apt-get install -y -qq "postgresql-${PG_MAJOR}-pgvector" >/dev/null 2>&1 \
        || sudo apt-get install -y -qq pgvector >/dev/null 2>&1 \
        || { echo "ERROR: could not install pgvector for PG ${PG_MAJOR}"; exit 1; }
fi
sudo systemctl enable --now postgresql >/dev/null 2>&1 || true
# The Debian/Ubuntu postgresql service is an umbrella; ensure the cluster runs.
sudo systemctl enable --now "postgresql@${PG_MAJOR}-main" >/dev/null 2>&1 || true
sleep 2

log "6/12 Provisioning role + databases (versifine_dev / versifine_test)"
sudo -u postgres psql -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='versifine') THEN
        CREATE ROLE versifine WITH LOGIN PASSWORD 'versifine_local';
    END IF;
END$$;
SQL
sudo -u postgres createdb -O versifine versifine_dev 2>/dev/null || true
sudo -u postgres createdb -O versifine versifine_test 2>/dev/null || true
for DB in versifine_dev versifine_test; do
    sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS vector;
GRANT ALL ON SCHEMA public TO versifine;
SQL
done

log "7/12 Allowing local password auth from versifine"
PGCONF="$(sudo -u postgres psql -tAc 'SHOW hba_file')"
if ! sudo grep -q '^host[[:space:]]\+versifine_dev' "$PGCONF"; then
    # Insert versifine rules ABOVE the catch-all IPv4 line. Postgres uses
    # first-match semantics so we inject right after the IPv4 banner.
    sudo bash -c 'awk "
      /^# IPv4 local connections:/ {
        print
        print \"host    versifine_dev   versifine   127.0.0.1/32    md5\"
        print \"host    versifine_test  versifine   127.0.0.1/32    md5\"
        next
      }
      { print }
    " '"$PGCONF"' > /tmp/hba.versifine && install -m 0640 -o postgres -g postgres /tmp/hba.versifine '"$PGCONF"' && rm /tmp/hba.versifine'
    sudo systemctl reload postgresql >/dev/null 2>&1 \
        || sudo systemctl reload "postgresql@${PG_MAJOR}-main" >/dev/null 2>&1 || true
fi

# ---------------------------------------------------------------------------
log "8/12 Installing Chromium for the wa-bot (real binary, not snap)"
# Why not apt? Ubuntu ships chromium ONLY as a snap. Snap apps need privilege
# transitions that the wabot unit's NoNewPrivileges=yes blocks, and snap
# confinement can't open a profile dir under /opt. Puppeteer's bundled
# Chromium has no linux-arm64 build either. Playwright DOES publish real
# (non-snap) Chromium binaries for linux-arm64 - we use that and expose it at
# the stable /usr/bin/chromium-browser path the systemd unit already targets.
CHROME_BIN=""
# Reuse an existing real (non-snap) chromium if present.
for cand in /usr/bin/chromium-browser /usr/bin/chromium; do
    if [ -x "$cand" ] && ! readlink -f "$cand" | grep -q '/snap/'; then
        CHROME_BIN="$cand"; break
    fi
done
if [ -z "$CHROME_BIN" ]; then
    BROWSERS_DIR="$BASE/browsers"
    sudo install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$BROWSERS_DIR" 2>/dev/null \
        || sudo mkdir -p "$BROWSERS_DIR"
    # Install chromium into a fixed, service-readable location.
    sudo PLAYWRIGHT_BROWSERS_PATH="$BROWSERS_DIR" npx --yes playwright@1.49.1 install chromium >/dev/null 2>&1 \
        || sudo PLAYWRIGHT_BROWSERS_PATH="$BROWSERS_DIR" npx --yes playwright install chromium >/dev/null 2>&1 \
        || { echo "ERROR: playwright chromium install failed"; exit 1; }
    CHROME_BIN="$(find "$BROWSERS_DIR" -type f -name 'chrome' | head -1)"
    [ -n "$CHROME_BIN" ] || CHROME_BIN="$(find "$BROWSERS_DIR" -type f -name 'headless_shell' | head -1)"
    [ -n "$CHROME_BIN" ] || { echo "ERROR: chromium binary not found after install"; exit 1; }
    sudo chmod -R a+rX "$BROWSERS_DIR"
fi
# Chromium shared-library deps (best-effort via playwright, then explicit apt).
sudo npx --yes playwright@1.49.1 install-deps chromium >/dev/null 2>&1 || true
sudo apt-get install -y -qq \
    libnss3 libfreetype6 libharfbuzz0b \
    libdrm2 libxkbcommon0 libgbm1 \
    libasound2t64 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 \
    libgtk-3-0t64 libxcomposite1 libxdamage1 libxrandr2 libxfixes3 \
    libpango-1.0-0 libcairo2 fonts-liberation \
    >/dev/null 2>&1 || true
# Stable path the systemd unit expects (PUPPETEER_EXECUTABLE_PATH).
sudo ln -sfn "$CHROME_BIN" /usr/bin/chromium-browser
log "  Â· Chromium: $CHROME_BIN -> /usr/bin/chromium-browser"

log "9/12 Creating service user '${DEPLOY_USER}' + /opt/versifine layout"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
    sudo useradd -m -s /bin/bash "$DEPLOY_USER"
fi
DEPLOY_HOME="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
# The login user needs to write into /opt/versifine during rsync (the deploy
# runs as the login user and chowns to the service user via sudo), and must
# be able to read the env dir group. Add login user to the service group.
sudo usermod -aG "$DEPLOY_USER" "$LOGIN_USER" 2>/dev/null || true
# Bun must be on the service user's PATH for systemd ExecStart (it uses
# /usr/local/bin/bun, already installed system-wide above).
sudo install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$BASE"
sudo install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$BASE/wabot-state"
sudo install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$BASE/wabot-state/.wwebjs_auth"
sudo install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$BASE/wabot-state/.wwebjs_cache"
sudo install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$BASE/scripts"
# env dir: root owns, service user's group can read (0750).
sudo install -d -o root -g "$DEPLOY_USER" -m 0750 "$ENV_DIR"
# Puppeteer needs writable config/cache under the SERVICE user's home (the
# wabot runs as the service user). The systemd unit lists these in ReadWritePaths.
sudo install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DEPLOY_HOME/.config"
sudo install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DEPLOY_HOME/.cache"

log "10/12 Service-hash + state dir"
sudo install -d -o root -g root -m 0755 /var/lib/versifine

log "11/12 Swap (4G) for build-time memory headroom"
if ! swapon --show | grep -q .; then
    sudo fallocate -l 4G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile >/dev/null
    sudo swapon /swapfile
    grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

log "12/12 nginx running"
# Ubuntu ships a default site that owns `default_server` on :80 - it would
# collide with our 00-base.conf catch-all. Remove it. (conf.d/*.conf is
# included by the stock nginx.conf, so our vhosts load from there.)
sudo rm -f /etc/nginx/sites-enabled/default
sudo systemctl enable --now nginx >/dev/null 2>&1 || true

log "Bootstrap complete. Next steps:"
log "  1) Upload env files to ${ENV_DIR}/{api,web,wabot}.env"
log "  2) Install SSL cert pair to /etc/ssl/versifine.com/{cert,key}.pem"
log "  3) Install the base nginx vhost (nginx-base-ubuntu.conf) for the"
log "     \$connection_upgrade map + client_max_body_size + default 444."
log "  4) Run remote-deploy.sh"
