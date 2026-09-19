#!/bin/sh
# GWS Admin — container entrypoint
# Starts the Go signer sidecar + PocketBase with the app's dirs.

set -e

# Signer: bind to localhost only (private key never leaves the box)
/app/signer &
SIGNER_PID=$!

# Wait for signer to come up
for i in 1 2 3 4 5; do
  if curl -sf http://127.0.0.1:9999/sign -X POST -o /dev/null 2>/dev/null; then
    break
  fi
  sleep 1
done

# PocketBase: relative to /app (WORKDIR)
exec /app/pocketbase serve \
  --http=0.0.0.0:8090 \
  --dir=/app/data \
  --hooksDir=/app/hooks \
  --migrationsDir=/app/backend \
  --publicDir=/app/frontend
