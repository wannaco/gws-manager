#!/usr/bin/env bash
# =============================================================================
# GWS Admin — One-Click Install Script (bare metal)
# =============================================================================
# Installs GWS Admin on Linux/macOS without Docker.
#
# Usage:
#   ./install.sh                       # install into ~/gws-admin
#   INSTALL_DIR=/opt/gws-admin ./install.sh
#
# Requires: curl, tar, unzip. Internet access for the PocketBase download.
# The Go signer is built from source, so Go 1.22+ is required unless a
# prebuilt signer binary already sits in ./sidecar/.
# =============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
BOLD='\033[1m'
log()  { echo -e "${CYAN}[gws-admin]${NC} $*"; }
ok()   { echo -e "${GREEN}[✓]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*"; exit 1; }

# ── Config ──────────────────────────────────────────────────────────────────
INSTALL_DIR="${INSTALL_DIR:-$HOME/gws-admin}"
PB_VERSION="${PB_VERSION:-0.39.0}"   # app requires PocketBase 0.39.x (routerUse API)

# ── Detect OS/Arch ──────────────────────────────────────────────────────────
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$ARCH" in
  x86_64|amd64)    ARCH="amd64" ;;
  aarch64|arm64)   ARCH="arm64" ;;
  *) err "Unsupported architecture: $ARCH" ;;
esac

case "$OS" in
  linux)   PLATFORM="linux" ;;
  darwin)  PLATFORM="darwin" ;;
  *) err "Unsupported OS: $OS. Linux and macOS are supported." ;;
esac

log "Detected: ${BOLD}${PLATFORM}/${ARCH}${NC}"
log "Install directory: ${BOLD}${INSTALL_DIR}${NC}"

mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# ── Fetch app files (from the repo this script lives in, or a release bundle) ─
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -f "$SRC_DIR/hooks/main.pb.js" ]; then
  log "Copying application files from $SRC_DIR ..."
  for d in frontend hooks lib backend; do
    mkdir -p "$INSTALL_DIR/$d"
    cp -r "$SRC_DIR/$d"/. "$INSTALL_DIR/$d/"
  done
  mkdir -p "$INSTALL_DIR/sidecar"
  cp "$SRC_DIR/sidecar/main.go" "$SRC_DIR/sidecar/go.mod" "$INSTALL_DIR/sidecar/" 2>/dev/null || true
  ok "Application files copied"
else
  err "Could not find application files (expected $SRC_DIR/hooks/main.pb.js).
Run this script from inside a GWS Admin checkout, or download a release bundle first."
fi

# ── PocketBase ──────────────────────────────────────────────────────────────
if [ -x "$INSTALL_DIR/pocketbase" ] && "$INSTALL_DIR/pocketbase" --version 2>/dev/null | grep -q "$PB_VERSION"; then
  ok "PocketBase $PB_VERSION already present"
else
  PB_FILE="pocketbase_${PB_VERSION}_${PLATFORM}_${ARCH}.zip"
  PB_URL="https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/${PB_FILE}"
  log "Downloading PocketBase ${PB_VERSION} ..."
  curl -fSL --progress-bar "$PB_URL" -o "/tmp/${PB_FILE}" || err "Failed to download PocketBase"
  unzip -o "/tmp/${PB_FILE}" pocketbase -d "$INSTALL_DIR" > /dev/null
  rm -f "/tmp/${PB_FILE}"
  chmod +x "$INSTALL_DIR/pocketbase"
  ok "PocketBase installed"
fi

# ── Signer (RS256 JWT sidecar) ──────────────────────────────────────────────
# PocketBase 0.39 removed rsaSign, so this sidecar signs the JWTs used to
# impersonate Google Workspace users. It must be built for the host platform.
SIGNER_BIN="$INSTALL_DIR/sidecar/signer"
if [ -x "$SIGNER_BIN" ]; then
  ok "Signer already built"
elif command -v go >/dev/null 2>&1; then
  log "Building signer from source ..."
  (cd "$INSTALL_DIR/sidecar" && CGO_ENABLED=0 go build -ldflags="-s -w" -o signer .) \
    || err "Failed to build the signer"
  ok "Signer built"
else
  err "Go is required to build the signer (PocketBase 0.39 removed rsaSign).
Install Go 1.22+ and re-run, or copy a prebuilt 'signer' into $INSTALL_DIR/sidecar/."
fi

# ── Data directory ──────────────────────────────────────────────────────────
mkdir -p "$INSTALL_DIR/data"
touch "$INSTALL_DIR/data/.gitkeep"

# ── Environment file ────────────────────────────────────────────────────────
if [ ! -f "$INSTALL_DIR/.env" ]; then
  KEY="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  cat > "$INSTALL_DIR/.env" << ENVFILE
# Encrypts the Google service-account key at rest.
# Keep this safe and back it up: it is the only way to read back a stored key.
ENCRYPTION_KEY=${KEY}

# Optional: restrict API calls to a single origin.
# GWS_ALLOWED_ORIGIN=
ENVFILE
  chmod 600 "$INSTALL_DIR/.env"
  ok "Generated .env with a fresh ENCRYPTION_KEY"
else
  log ".env already exists — leaving it untouched"
fi

# ── Launcher ────────────────────────────────────────────────────────────────
cat > "$INSTALL_DIR/start.sh" << 'STARTSCRIPT'
#!/usr/bin/env bash
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
[ -f "$DIR/.env" ] && set -a && . "$DIR/.env" && set +a

echo "=== GWS Admin ==="
if ! pgrep -f "$DIR/sidecar/signer" >/dev/null 2>&1; then
  echo "Starting signer on 127.0.0.1:9999 ..."
  nohup "$DIR/sidecar/signer" > /tmp/gws-signer.log 2>&1 &
fi

echo "Starting PocketBase on :8090 ..."
exec "$DIR/pocketbase" serve \
  --http=0.0.0.0:8090 \
  --dir="$DIR/data" \
  --hooksDir="$DIR/hooks" \
  --migrationsDir="$DIR/backend" \
  --publicDir="$DIR/frontend"
STARTSCRIPT
chmod +x "$INSTALL_DIR/start.sh"
ok "Created start.sh"

# ── Systemd service (Linux only) ────────────────────────────────────────────
if [ "$PLATFORM" = "linux" ] && command -v systemctl >/dev/null 2>&1; then
  printf "Install systemd service (gws-admin)? (y/N) "
  read -r -n 1 REPLY || REPLY=""
  echo
  if [[ "$REPLY" =~ ^[Yy]$ ]]; then
    sudo tee /etc/systemd/system/gws-admin.service > /dev/null << SERVICEDEF
[Unit]
Description=GWS Admin
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR
ExecStart=$INSTALL_DIR/start.sh
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICEDEF
    sudo systemctl daemon-reload
    sudo systemctl enable --now gws-admin
    ok "Systemd service installed and started"
    log "Check status: sudo systemctl status gws-admin"
  fi
fi

echo ""
echo -e "${GREEN}${BOLD}═══════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  GWS Admin installed!${NC}"
echo -e "${GREEN}${BOLD}═══════════════════════════════════════${NC}"
echo ""
echo "  Start:  cd $INSTALL_DIR && ./start.sh"
echo "  Open:   http://localhost:8090"
echo ""
echo "  First time? Register with your Google Workspace domain email, then"
echo "  upload a service-account JSON key (domain-wide delegation) in Settings."
echo ""
