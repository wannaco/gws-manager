#!/usr/bin/env bash
# =============================================================================
# GWS Admin — Manage Script
# =============================================================================
# Manages a Docker-based GWS Admin deployment: status, logs, restart, backup, update.
#
# Usage: ./scripts/manage.sh [command]
#   status    — show running containers and health
#   logs      — tail container logs
#   restart   — restart the stack
#   stop      — stop the stack
#   start     — start the stack
#   backup    — backup data/ to ./backups/ (gzipped tar, keeps last 14)
#   update    — pull the latest image and recreate containers
#   help      — show this help
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$ROOT/docker-compose.yml"
BACKUP_DIR="$ROOT/backups"
CMD="${1:-help}"
SERVICE="${2:-gws}"

cd "$ROOT"

case "$CMD" in
  status)
    echo "═══ GWS Admin Status ═══"
    docker compose -f "$COMPOSE_FILE" ps 2>/dev/null || echo "No containers running"
    echo ""
    echo "Health:"
    curl -s -m 5 http://localhost:8090/api/health || echo "  ⚠  PocketBase not responding on :8090"
    echo ""
    echo "Signer:"
    docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE" \
      sh -c 'curl -sf -X POST http://127.0.0.1:9999/sign -o /dev/null && echo "  ✓ signer responding on :9999"' \
      2>/dev/null || echo "  ⚠  signer not responding (Google API calls will fail)"
    echo ""
    ;;
  logs)
    docker compose -f "$COMPOSE_FILE" logs -f "$SERVICE" 2>/dev/null || { echo "No logs — is the stack running?"; exit 1; }
    ;;
  restart)
    docker compose -f "$COMPOSE_FILE" restart 2>/dev/null || { echo "Stack not running — starting..."; docker compose -f "$COMPOSE_FILE" up -d; }
    echo "Restarted."
    ;;
  stop)
    docker compose -f "$COMPOSE_FILE" down 2>/dev/null || echo "Nothing to stop."
    echo "Stopped."
    ;;
  start)
    docker compose -f "$COMPOSE_FILE" up -d
    echo "Started."
    ;;
  backup)
    mkdir -p "$BACKUP_DIR"
    TS=$(date +%Y%m%d-%H%M%S)
    OUT="$BACKUP_DIR/gws-admin-data-$TS.tar.gz"
    tar czf "$OUT" -C "$ROOT" data 2>/dev/null || tar czf "$OUT" -C "$ROOT" ./data
    echo "Backup written: $OUT"
    echo "  Size: $(du -h "$OUT" | cut -f1)"
    # Keep the last 14 backups
    ls -1t "$BACKUP_DIR"/gws-admin-data-*.tar.gz 2>/dev/null | tail -n +15 | xargs -r rm -f
    echo "  (kept last 14)"
    ;;
  update)
    docker compose -f "$COMPOSE_FILE" pull 2>/dev/null || true
    docker compose -f "$COMPOSE_FILE" up -d --force-recreate
    echo "Updated."
    ;;
  *)
    sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
    ;;
esac
