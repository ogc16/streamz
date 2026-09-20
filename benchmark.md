# Streamz Performance Benchmark

Single source of truth for how Streamz performance is measured, what the release
gates are, and where the current numbers stand. Benchmarks are re-run on every
performance-sensitive PR and part of the CI/CD pipeline (see “CI integration”).

## 1. Objectives

These benchmarks exist to prove the scalability and reliability targets in the
roadmap, measured consistently so trends are comparable over time and across
environments:

- **10k+ concurrent streams** served with **p95 latency < 200 ms** for playback setup.
- **API throughput** that scales with autoscaling (HPA) without degrading error rate.
- **Resilience** under injected failures (Redis kill, DB connection drop, upstream down).
- **Regression detection**: page/API latency and memory regressions caught at PR time.

## 2. Benchmark scenarios

Load is generated with **k6** (scripted HTTP + WebSocket capable, CI-friendly).
Scenarios map to the primary user journeys.

| Scenario | Script | Primary endpoint | Synthetic users | Target (p95) | Target error rate |
| --- | --- | --- | --- | --- | --- |
| Auth – register + login | `scripts/load/k6-auth.js` | `POST /api/auth/login` | 500 | < 300 ms | < 0.5% |
| Catalog browsing (cache hit) | `scripts/load/k6-catalog.js` | `GET /api/videos` | 2,000 | < 100 ms | < 0.1% |
| Playback setup (signed URL) | `scripts/load/k6-playback.js` | `GET /api/stream/playback/:id` | 1,000 | < 200 ms | < 0.1% |
| Payment read (purchase) | `scripts/load/k6-purchase.js` | `GET /api/purchases/check/:id` | 250 | < 400 ms | < 1% |
| **Concurrency soak – 10k streams** | `scripts/load/k6-stream-soak.js` | mixed playback setup | 10,000 | < 200 ms | < 0.1% |
| Streak / burst (ramp to 10k in 60s) | `scripts/load/k6-burst.js` | mixed read + playback | 10,000 | < 250 ms | < 1% |

Secondary signals recorded on every run:

- **Throughput** (rps) per service, split by endpoint.
- **Redis cache hit ratio** (`redis` INFO `keyspace_hits/(keyspace_hits+keyspace_misses)`).
- **Error breakdown** (4xx/5xx, timeouts, connection resets).
- **p50 / p90 / p95 / p99** latency per endpoint.
- **Saturation**: CPU / mem / connection pool (`pgbouncer` pools), long-running queries (`pg_stat_activity`).

## 3. SLOs tied to benchmarks

| SLO | Definition | Target | Threatend by |
| --- | --- | --- | --- |
| Playback setup latency | p95 `GET /api/stream/playback/:id` (excl. Mux signing under 50 ms) | ≤ 200 ms | pg latency, Redis eviction, service saturation |
| Stream capacity | concurrent active playback setups | 10k+ | connection pool exhaustion, pgbouncer default pool size |
| Error budget | 5xx across proxied routes | < 0.1% over 30d | upstream timeouts, DB failover, webhook storms |
| Cache efficiency | Redis video/catalog hit ratio | ≥ 90% | unbounded writes, key churn, client cache-bypass |
| Time-to-user | gateway p50 end-to-end (`x-request-id` traced) | ≤ 150 ms | service fan-out, reintro'd latency budgets |

Alerting (PagerDuty/Slack) fires when any SLO is breached; benchmarks failing in
CI are a merge gate (see §7).

## 4. Running locally

Prereqs: Docker Desktop, Node 22+, playwright not required. k6 runs in Docker so no
local install needed.

```powershell
# 1. Infra + services
docker compose up -d postgres redis pgbouncer
npm run migrate
npm run dev                  # gateway:3000, auth:4001, video:4002,
                             # purchase:4003, streaming:4004, webhook:4005

# 2. Seed a few videos + users (mock providers are fine)
node scripts/seed-demo.mjs

# 3. Run one scenario (uses video_service + purchase service on the live stack)
docker run --rm -i -v ${PWD}/scripts/load:/scripts grafana/k6 run --vus 250 --duration 60s /scripts/k6-auth.js

# 4. Watch cache + pools during the run
docker exec streamz-redis-1 redis-cli info stats | findstr keyspace
docker exec streamz-pgbouncer-1 psql -U streamz -c "show pools;"
```

Pointing k6 at the **gateway** (port 3000) exercises auth+proxy+routing; pointing at
individual services isolates service-level behaviour. Production benchmarks are run
via a cloud/isolation namespace against a canary deployment.

## 5. Benchmark protocol (so runs are comparable)

1. Clean stack: fresh `pgdata` volume, no server-side warm cache. Record a **cold** baseline.
2. Warm: run `k6-warmup.js` (1,000 requests, 60 s) then record **hot** numbers.
3. Each scenario runs for ≥ 60 s steady state at the vus/ramp specified in the table.
4. Capture service logs + `/metrics` snapshots for the run window.
5. Record summary in §8 with commit SHA, date, environment (local/docker/k8s-prod).
6. Mark the run with the CI job link; push a new row, never overwrite history.

## 6. Chaos integration (reliability)

Chaos steps are scripted so the same failures run locally and in CI:

| Failure | Script | Expected behaviour | Assertion |
| --- | --- | --- | --- |
| Redis killed | `scripts/chaos-kill-redis.mjs` | services return 503 on readiness, no crash loop | `/health/ready` reports `redis` failed |
| DB connection dropped | `scripts/chaos-drop-pg.mjs` | pgbouncer pools drain, requests degrade to 503, service stays up | process alive after 10 s |
| Upstream (Mux) down | `scripts/chaos-mux-down.mjs` | signed-URL path returns clear 4xx/503, not a hang | p95 < 2 s during failure |
| Webhook storm (duplicate) | `scripts/mock-webhooks.mjs` | idempotent processing, no duplicate outbox rows | outbox count stable |

The load run immediately after a recovery is compared against the pre-failure
baseline; a +30% latency or +1% error regression fails the gate.

## 7. CI integration (GitHub Actions)

Workflow `.github/workflows/benchmark.yml` runs on `pull_request` (labeled
`perf`) and nightly on `master`:

1. Build + `npm run lint` + unit/integration tests (Testcontainers).
2. Boot compose stack with mock Stripe/Mux (`scripts/mock-webhooks.mjs`).
3. `k6 run` the table scenarios (warm + cold).
4. Report summary comment on the PR (k6 JSON threshold + checks `<<slack||prometheus>>`).
5. `helm template` render check; any threshold breach fails the check.

Failures block merge; nightly runs post results to the observability stack
(see `docs/observability.md`).

## 8. Results ledger

Append-only. Compare a new run against the **last run of the same scenario +
environment**, not against absolute numbers (env-dependent).

| Date | Commit | Environment | Scenario | Users | p50 ms | p95 ms | p99 ms | rps | Error % | Cache hit % | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| – | – | – | – | – | – | – | – | – | – | – | awaiting first logged run |
| – | – | – | – | – | – | – | – | – | – | – | – |

## 9. Tuning references

- PgBouncer pool sizing: `backend/pgbouncer.ini` (default pool 20 → scale with 10k streams).
- Redis cache TTLs: video list + detail cache in `services/video`; invalidation on write.
- HPA thresholds: `helm/streamz` (CPU 70%, memory 80%; see `docs/deployment.md`).