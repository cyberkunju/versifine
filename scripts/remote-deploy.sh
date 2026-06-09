#!/usr/bin/env bash
# Versifine remote deploy.
#
# Runs ON the EC2 instance every push to main. Pulls the repo at the
# requested SHA/branch, builds the four workspaces, syncs the whole
# monorepo into /opt/versifine/repo, runs migrations, and bounces only
# services whose dist hash changed (so the WhatsApp Web session survives
# unrelated deploys).
#
# Required env on the box (in /etc/versifine/{api,web,wabot}.env). The
# bootstrap script doesn't generate these — we upload them once with `scp`
# and then this script just sources them via systemd EnvironmentFile.
set -euo pipefail
log() { printf "\033[1;32m[deploy]\033[0m %s\n" "$*"; }

REPO="${REPO:-https://github.com/cyberkunju/versifine.git}"
BRANCH="${BRANCH:-main}"
DEPLOY_USER="${DEPLOY_USER:-versifine}"
# Build dir lives in the reticule login user's home. Deriving from $HOME keeps
# the deploy independent of the absolute account path.
WORK="${HOME}/versifine-build"
BASE="/opt/versifine"
APP="$BASE/repo"            # deployed monorepo lives here
ENV_DIR="/etc/versifine"

# ---- 1. Source ------------------------------------------------------------
if [ -d "$WORK/.git" ]; then
    log "Updating existing checkout"
    git -C "$WORK" remote set-url origin "$REPO"
    git -C "$WORK" fetch --depth=1 origin "$BRANCH"
    git -C "$WORK" reset --hard "origin/$BRANCH"
    git -C "$WORK" clean -fdx -e node_modules
else
    log "Cloning $REPO"
    rm -rf "$WORK"
    git clone --depth=1 --branch "$BRANCH" "$REPO" "$WORK"
fi
cd "$WORK"
COMMIT_SHORT="$(git rev-parse --short HEAD)"
log "Commit: $COMMIT_SHORT"

# ---- 2. Install workspace deps + build -----------------------------------
log "Installing workspace dependencies"
/usr/local/bin/bun install --frozen-lockfile

log "Type-checking API (runs from source; no bundle)"
# The API runs straight from TypeScript source (see versifine-api.service):
# Bun executes .ts natively. We don't bundle it — bundling caused thrown
# AppErrors to escape to a text/plain 500 and broke string-concat dynamic
# imports. A typecheck here keeps the deploy failing fast on a broken API.
( cd apps/api && /usr/local/bin/bun run typecheck ) \
    || { echo "ERROR: API typecheck failed"; exit 1; }
[ -f apps/api/src/index.ts ] || { echo "ERROR: apps/api/src/index.ts missing"; exit 1; }

# ---- 2b. Deterministic test gate (no DB, no LLM, zero false-flakes) ---------
# Only the deterministic, pure-function test slices run here. LLM/DB-dependent
# tests stay as a separate manual harness. This gate catches parser regressions
# (amount/currency/date/guard) before they ever hit production — the most common
# source of silent ledger corruption. Blocked exit → deploy aborts, services
# unchanged.
log "Running deterministic test gate"
(
  set -a
  source "$ENV_DIR/api.env"
  set +a
  cd apps/api
  /usr/local/bin/bun test \
    tests/parser-regex.test.ts \
    tests/guard.test.ts \
    tests/currencies.test.ts \
    tests/query-period.test.ts \
    tests/parser-fallback.test.ts \
    2>&1
) || { log "ERROR: deterministic test gate FAILED — deploy aborted"; exit 1; }
log "Deterministic test gate passed"

log "Building wa-bot bundle"
# Mark optional/native deps as external — these aren't actually used by our
# code path but are conditionally `require()`d inside dependencies (e.g.
# unzipper's S3 backend, puppeteer's chromium downloader). Bun's bundler is
# strict about resolution; marking them external lets `bun run dist/index.js`
# defer the resolution to the runtime, where they remain unresolved no-ops.
/usr/local/bin/bun build apps/wa-bot/src/index.ts \
    --target=bun \
    --outdir=apps/wa-bot/dist \
    --external '@aws-sdk/client-s3' \
    --external 'puppeteer' \
    --external 'whatsapp-web.js' \
    --external 'qrcode' \
    --external 'qrcode-terminal'
[ -f apps/wa-bot/dist/index.js ] || { echo "ERROR: apps/wa-bot/dist/index.js missing"; exit 1; }

log "Building web (SvelteKit + adapter-node)"
# `svelte-kit sync` regenerates `.svelte-kit/tsconfig.json` and the
# generated route types. The deploy clones a fresh checkout so this dir
# doesn't exist yet — without sync the build fails on the tsconfig
# extends path.
#
# Vite only inlines `import.meta.env.PUBLIC_*` from a `.env` FILE in the
# web project root. We materialise `apps/web/.env` from the PUBLIC_* keys in
# the deployment web.env so public config (e.g. the Google client ID) lands
# in the client bundle deterministically.
#
# IMPORTANT: web.env is mode 0640 root:versifine and may not be readable by
# the login user, so it must be read via sudo - a plain
# `source` silently yields nothing and the client bundle ends up unconfigured.
sudo grep -E '^PUBLIC_[A-Z0-9_]+=' "$ENV_DIR/web.env" > apps/web/.env 2>/dev/null || : > apps/web/.env
(
    cd apps/web
    /usr/local/bin/bun x svelte-kit sync
    /usr/local/bin/bun x vite build
)
[ -f apps/web/build/index.js ] || { echo "ERROR: apps/web/build/index.js missing"; exit 1; }

# ---- 3. Hash existing dist trees BEFORE we overwrite them ---------------
hash_pre() {
    local d="$1"
    [ -d "$d" ] || { echo ""; return; }
    sudo find "$d" -type f \! -name '*.map' -exec sha256sum {} + 2>/dev/null \
        | awk '{print $1}' | sort | sha256sum | awk '{print $1}'
}
WEB_HASH_OLD=$(hash_pre   "$APP/apps/web/build")
API_HASH_OLD=$(hash_pre   "$APP/apps/api/src")
WABOT_HASH_OLD=$(hash_pre "$APP/apps/wa-bot/dist")

# ---- 4. Sync the whole monorepo into /opt/versifine/repo ------------------
# We ship the full source + dist to the server. node_modules is intentionally
# omitted; we re-install on the server with --production for runtime deps.
# .wwebjs_auth and .wwebjs_cache are protected so a paired bot survives.
log "Syncing monorepo to $APP"
sudo install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP"
sudo rsync -a --delete \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='.svelte-kit' \
    --exclude='_study' \
    --exclude='apps/wa-bot/.wwebjs_auth' \
    --exclude='apps/wa-bot/.wwebjs_auth/**' \
    --exclude='apps/wa-bot/.wwebjs_cache' \
    --exclude='apps/wa-bot/.wwebjs_cache/**' \
    --exclude='apps/wa-bot/.qr.png' \
    "$WORK"/ "$APP"/
sudo chown -R --no-dereference "$DEPLOY_USER":"$DEPLOY_USER" "$APP"

# ---- 5. Wire the persistent wa-bot session dir ---------------------------
log "Linking persistent wa-bot session dir"
sudo install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$BASE/wabot-state/.wwebjs_auth"
sudo install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$BASE/wabot-state/.wwebjs_cache"
sudo -u "$DEPLOY_USER" ln -sfn "$BASE/wabot-state/.wwebjs_auth"  "$APP/apps/wa-bot/.wwebjs_auth"
sudo -u "$DEPLOY_USER" ln -sfn "$BASE/wabot-state/.wwebjs_cache" "$APP/apps/wa-bot/.wwebjs_cache"

# ---- 6. Install runtime dependencies on the server ----------------------
# Bun's workspace resolver needs the lockfile + workspace package.json files
# to wire @versifine/shared correctly. We re-install at /opt/versifine/repo
# so the deploy user owns its own node_modules.
log "Installing runtime dependencies on the server"
sudo -u "$DEPLOY_USER" bash -lc "cd $APP && /usr/local/bin/bun install --frozen-lockfile"

# ---- 7. Apply DB migrations ---------------------------------------------
log "Running DB migrations"
sudo -u "$DEPLOY_USER" bash -lc "set -a; source $ENV_DIR/api.env; set +a; cd $APP/apps/api && /usr/local/bin/bun run scripts/migrate.ts" \
    || { log "migrations failed"; exit 1; }

# ---- 8. Install systemd unit files + nginx vhost ------------------------
log "Installing systemd unit files"
sudo install -m 0644 "$APP/scripts/versifine-api.service"   /etc/systemd/system/versifine-api.service
sudo install -m 0644 "$APP/scripts/versifine-web.service"   /etc/systemd/system/versifine-web.service
sudo install -m 0644 "$APP/scripts/versifine-wabot.service" /etc/systemd/system/versifine-wabot.service

log "Installing nginx vhost"
sudo install -d -o root -g root -m 0755 /etc/nginx/snippets
sudo install -m 0644 "$APP/scripts/nginx-base-ubuntu.conf"       /etc/nginx/conf.d/00-base.conf
sudo install -m 0644 "$APP/scripts/nginx-versifine-proxy.conf"  /etc/nginx/snippets/versifine-proxy.conf
sudo install -m 0644 "$APP/scripts/nginx-versifine-routes.conf" /etc/nginx/snippets/versifine-routes.conf
sudo install -m 0644 "$APP/scripts/nginx-versifine.conf"        /etc/nginx/conf.d/versifine.conf

sudo systemctl daemon-reload
sudo systemctl enable versifine-api.service versifine-web.service versifine-wabot.service >/dev/null

# ---- 9. Smart restart (only bounce services whose dist actually changed) ----
hash_dist() {
    local d="$1"
    [ -d "$d" ] || { echo ""; return; }
    sudo find "$d" -type f \! -name '*.map' -exec sha256sum {} + 2>/dev/null \
        | awk '{print $1}' | sort | sha256sum | awk '{print $1}'
}
restart_if_changed() {
    local svc="$1" dist="$2" hashfile="$3" old="$4"
    local new
    new=$(hash_dist "$dist")
    if [ "$new" != "$old" ]; then
        log "$svc dist changed (old=${old:0:8} new=${new:0:8}); restarting"
        sudo systemctl restart "$svc"
        sleep 3
        sudo systemctl is-active "$svc" >/dev/null || { sudo journalctl -u "$svc" -n 60 --no-pager; exit 1; }
        echo "$new" | sudo tee "$hashfile" >/dev/null
    else
        log "$svc dist unchanged (${new:0:8}); ensuring active"
        sudo systemctl is-active "$svc" >/dev/null || sudo systemctl start "$svc"
    fi
}
restart_if_changed versifine-api   "$APP/apps/api/src"      /var/lib/versifine/api.dist.sha256   "$API_HASH_OLD"
restart_if_changed versifine-web   "$APP/apps/web/build"    /var/lib/versifine/web.dist.sha256   "$WEB_HASH_OLD"
restart_if_changed versifine-wabot "$APP/apps/wa-bot/dist"  /var/lib/versifine/wabot.dist.sha256 "$WABOT_HASH_OLD"

# ---- 10. Reload nginx ---------------------------------------------------
log "Reloading nginx"
sudo nginx -t
sudo systemctl reload nginx

log "Deploy complete: $COMMIT_SHORT"

# ---- 11. Trim build cache (keep $APP, drop $WORK heavies) ----------------
log "Trimming build cache"
rm -rf "$WORK/node_modules" \
       "$WORK/apps/api/node_modules" \
       "$WORK/apps/wa-bot/node_modules" \
       "$WORK/apps/web/node_modules" \
       "$WORK/apps/web/.svelte-kit" \
       2>/dev/null || true
du -sh "$WORK" "$APP" 2>/dev/null || true
