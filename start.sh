#!/bin/bash
set -e
export ROLE=vps
export HEALTH_PORT="${HEALTH_PORT:-10000}"
export PORT="${PORT:-10000}"
# Render injeta $PORT (ex 10000). Garante que o server ouça nele:
if [ -n "$PORT" ]; then export HEALTH_PORT="$PORT"; fi

echo "[start] OpenCode serve na 4096..."
opencode serve --port 4096 --hostname 127.0.0.1 > /tmp/opencode.log 2>&1 &
echo "[start] health server na $HEALTH_PORT..."
ROLE=vps HEALTH_PORT="$HEALTH_PORT" node server.js > /tmp/ha-server.log 2>&1 &
 sleep 6
echo "[start] monitor failover (standby)..."
node monitor-vps.js
