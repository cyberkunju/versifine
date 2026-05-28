#!/usr/bin/env bash
# Versifine remote bootstrap.
#
# Runs ON the EC2 instance, prepares everything needed for the first
# deploy: Bun runtime, Postgres 16 + pgvector, Chromium, nginx vhost,
# SELinux contexts, swap, deploy user, /opt/versifine layout.
#
# Idempotent. Re-running is cheap and safe.
#
#   curl -fsSL https://raw.githubusercontent.com/cyberkunju/versifine/main/scripts/remote-bootstrap.sh | bash
set -euo pipefail
log() { printf "\033[1;36m[bootstrap]\033[0m %s\n" "$*"; }

DEPLOY_USER="${DEPLOY_USER:-versifine}"
BASE="/opt/versifine"
ENV_DIR="/etc/versifine"
PG_VERSION="${PG_VERSION:-16}"

log "1/12 Updating system packages"
sudo dnf -y -q upgrade --refresh >/dev/null

log "2/12 Installing base + Chromium dependencies"
sudo dnf -y -q install \
    nginx git rsync tar unzip curl ca-certificates jq \
    gcc gcc-c++ make redhat-rpm-config python3 \
    chromium \
    nss freetype harfbuzz \
    libdrm libxkbcommon mesa-libgbm \
    alsa-lib atk at-spi2-atk cups-libs gtk3 libXcomposite libXdamage libXrandr libxshmfence \
    pango cairo \
    >/dev/null

log "3/12 Installing Node.js 22 (build helper for npm-only tooling)"
if ! command -v node >/dev/null || [[ "$(node -v)" != v22.* ]]; then
    curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo -E bash - >/dev/null
    sudo dnf -y -q install nodejs >/dev/null
fi
node -v

log "4/12 Installing Bun system-wide"
if ! command -v bun >/dev/null; then
    curl -fsSL https://bun.sh/install | bash >/dev/null
    sudo install -m 0755 "$HOME/.bun/bin/bun" /usr/local/bin/bun
fi
bun --version

log "5/12 Installing PostgreSQL ${PG_VERSION} + pgvector"
if ! command -v psql >/dev/null; then
    sudo dnf -y -q module reset postgresql >/dev/null 2>&1 || true
    sudo dnf -y -q module enable "postgresql:${PG_VERSION}" >/dev/null 2>&1 || true
    sudo dnf -y -q install \
        "postgresql${PG_VERSION}-server" \
        "postgresql${PG_VERSION}" \
        "postgresql${PG_VERSION}-contrib" \
        || sudo dnf -y -q install postgresql-server postgresql postgresql-contrib >/dev/null
fi
# pgvector: use the dnf package on Fedora 43 if present, else build from source.
if ! sudo -u postgres -H psql -c "SELECT 1" 2>/dev/null | grep -q 1; then
    SETUP_BIN="$(command -v postgresql-setup || echo /usr/bin/postgresql-setup)"
    if [ -x "$SETUP_BIN" ]; then
        sudo "$SETUP_BIN" --initdb >/dev/null 2>&1 || true
    fi
fi
sudo systemctl enable --now postgresql
sleep 2
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_extension WHERE extname='vector'" 2>/dev/null | grep -q 1; then
    if sudo dnf list --installed pgvector >/dev/null 2>&1 || sudo dnf -y -q install pgvector 2>/dev/null; then
        log "  · pgvector installed via dnf"
    else
        log "  · pgvector dnf package missing — building from source"
        sudo dnf -y -q install postgresql-devel >/dev/null 2>&1 || true
        TMP="$(mktemp -d)"
        sudo dnf -y -q install git make gcc clang >/dev/null
        git clone --depth=1 --branch v0.8.0 https://github.com/pgvector/pgvector.git "$TMP/pgvector" >/dev/null
        ( cd "$TMP/pgvector" && make -s && sudo make -s install )
        rm -rf "$TMP"
    fi
fi
sudo systemctl restart postgresql
sleep 2

log "6/12 Provisioning role + databases (versifine_dev / versifine_test)"
sudo -u postgres psql -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='versifine') THEN
        CREATE ROLE versifine WITH LOGIN PASSWORD 'versifine_local';
    END IF;
END$$;
SELECT 'create-versifine_dev' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname='versifine_dev')\gexec
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
    sudo bash -c "cat >> '$PGCONF'" <<'HBA'
# versifine app
host    versifine_dev   versifine   127.0.0.1/32    md5
host    versifine_test  versifine   127.0.0.1/32    md5
HBA
    sudo systemctl reload postgresql
fi

log "8/12 Creating deploy user '${DEPLOY_USER}'"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
    sudo useradd -m -s /bin/bash "$DEPLOY_USER"
fi
sudo install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.config"
sudo install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.cache"
# Bun must be on the deploy user's PATH for systemd ExecStart.
if [ ! -x "/home/$DEPLOY_USER/.bun/bin/bun" ]; then
    sudo -u "$DEPLOY_USER" bash -lc 'curl -fsSL https://bun.sh/install | bash' >/dev/null
fi

log "9/12 Creating /opt/versifine layout"
sudo install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$BASE"
sudo install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$BASE/api"
sudo install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$BASE/wabot"
sudo install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$BASE/web"
sudo install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$BASE/packages-shared"
sudo install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$BASE/wabot-state"
sudo install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$BASE/wabot-state/.wwebjs_auth"
sudo install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$BASE/wabot-state/.wwebjs_cache"
sudo install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$BASE/scripts"
sudo install -d -o root -g "$DEPLOY_USER" -m 0750 "$ENV_DIR"

log "10/12 SELinux contexts for nginx + service hashes"
if command -v getenforce >/dev/null && [ "$(getenforce 2>/dev/null)" = "Enforcing" ]; then
    sudo dnf -y -q install policycoreutils-python-utils >/dev/null 2>&1 || true
    sudo semanage fcontext -a -t httpd_sys_content_t '/opt/versifine/web/build(/.*)?' 2>/dev/null || true
    sudo semanage fcontext -a -t httpd_sys_content_t '/opt/versifine/web/static(/.*)?' 2>/dev/null || true
    sudo restorecon -R "$BASE/web" 2>/dev/null || true
    sudo setsebool -P httpd_can_network_connect 1 2>/dev/null || true
fi
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
sudo systemctl enable --now nginx

log "Bootstrap complete. Next steps:"
log "  1) Stop hastkala : sudo systemctl stop hastkala-web hastkala-api hastkala-wabot && sudo systemctl disable hastkala-web hastkala-api hastkala-wabot"
log "  2) Upload env files to ${ENV_DIR}/{api,web,wabot}.env"
log "  3) Install SSL cert pair to /etc/ssl/versifine.com/{cert,key}.pem"
log "  4) Run remote-deploy.sh"
