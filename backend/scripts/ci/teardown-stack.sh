#!/usr/bin/env bash
# Stops the backend source processes + CI infra.
set -euo pipefail

cd "$(dirname "$0")/../.." # backend/

if [ -f /tmp/streamz-dev.pid ]; then
  kill "$(cat /tmp/streamz-dev.pid)" 2> /dev/null || true
  pkill -f "npm run dev" 2> /dev/null || true
  pkill -f "concurrently" 2> /dev/null || true
  rm -f /tmp/streamz-dev.pid
fi

docker compose -f docker-compose.ci.yml down -v > /dev/null 2>&1 || true