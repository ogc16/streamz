#!/usr/bin/env bash
# Boots the full Streamz backend from source for load/chaos jobs (CI).
# Expects: docker, node 22, npm deps installed.
set -euo pipefail

cd "$(dirname "$0")/../.." # backend/

export JWT_SECRET=${JWT_SECRET:-ci-jwt-secret}
export JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET:-ci-jwt-refresh-secret}
export STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY:-sk_test_ci_dummy}
export STRIPE_WEBHOOK_SECRET=${STRIPE_WEBHOOK_SECRET:-whsec_ci_dummy}
export MUX_TOKEN_ID=${MUX_TOKEN_ID:-ci-mux-id}
export MUX_TOKEN_SECRET=${MUX_TOKEN_SECRET:-ci-mux-secret}
export MUX_WEBHOOK_SECRET=${MUX_WEBHOOK_SECRET:-whsec_ci_dummy}
# The CI postgres container reads POSTGRES_PASSWORD; generate a fresh random
# value per run instead of committing one.
export POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-$(head -c 24 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 24)}
export DATABASE_URL=${DATABASE_URL:-postgresql://streamz:${POSTGRES_PASSWORD}@localhost:5432/streamz}
# Load tests and chaos drives come from a single source IP; relax the per-IP cap.
export RATE_LIMIT_MAX=${RATE_LIMIT_MAX:-1000000}
# Native bcrypt compares run on libuv's threadpool; widen it so logins parallelize.
export UV_THREADPOOL_SIZE=${UV_THREADPOOL_SIZE:-16}

# 1. Infra
docker compose -f docker-compose.ci.yml up -d --wait postgres redis

# 2. Schema + seed (with a purchase so playback returns 200)
npm run migrate
SEED_PURCHASE=1 node scripts/seed-demo.mjs

# 3. Services from source
(npm run dev > /tmp/streamz-dev.log 2>&1) &
echo $! > /tmp/streamz-dev.pid

# 4. Wait for all health endpoints
for port in 3000 4001 4002 4003 4004 4005; do
  i=0
  until curl -fsS "http://localhost:${port}/health/live" > /dev/null 2>&1; do
    i=$((i + 1))
    if [ "$i" -gt 60 ]; then
      echo "service :${port} did not become ready (log tail):" >&2
      tail -n 40 /tmp/streamz-dev.log >&2
      exit 1
    fi
    sleep 2
  done
  echo "ready :${port}"
done