#!/usr/bin/env bash
# GWS Admin — bare-metal launcher (no Docker)
# Usage: ./scripts/start.sh
set -euo pipefail

cd "$(dirname "$0")/.."

# Load environment (.env in the repo root, if present)
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

# 1. PocketBase binary — run scripts/install.sh to fetch it.
if [ ! -x ./pocketbase ]; then
  echo "ERROR: ./pocketbase not found." >&2
  echo "Run scripts/install.sh to download PocketBase and build the signer," >&2
  echo "or place the binary here manually (https://github.com/pocketbase/pocketbase/releases)." >&2
  exit 1
fi

# 2. Signer sidecar — binds 127.0.0.1 only (the private key never leaves the box).
#    Built from source: PocketBase 0.39 removed rsaSign, so JWT signing needs it.
if [ ! -x ./sidecar/signer ]; then
  if command -v go >/dev/null 2>&1; then
    echo "Building signer from source ..."
    (cd sidecar && CGO_ENABLED=0 go build -ldflags="-s -w" -o signer .)
  else
    echo "ERROR: ./sidecar/signer is missing and Go is not installed." >&2
    echo "Install Go 1.22+ (or run scripts/install.sh) — Google API calls will fail without it." >&2
    exit 1
  fi
fi

if ! pgrep -f 'sidecar/signer' >/dev/null 2>&1; then
  echo "Starting signer on 127.0.0.1:9999 ..."
  (./sidecar/signer >/tmp/gws-signer.log 2>&1 &)
  sleep 1
fi

# 3. PocketBase
echo "Starting PocketBase on :8090 ..."
exec ./pocketbase serve \
  --http=0.0.0.0:8090 \
  --dir=./data \
  --hooksDir=./hooks \
  --migrationsDir=./backend \
  --publicDir=./frontend
