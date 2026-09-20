# Observability

Every Service exposes three contracts:

- `GET /health`, `/health/live`, `/health/ready` — liveness/readiness (used by
  Kubernetes probes).
- `GET /metrics` — Prometheus text-format metrics (dependency-free registry in
  `backend/shared/src/metrics.ts`).
- OTLP traces — exported only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set
  (`backend/shared/src/otel.ts`).

## Ports

| Component | Port | What it does |
| --- | --- | --- |
| `api-gateway` | 3000 | `/metrics`, proxy, rate limiting |
| `auth` | 4001 | `/metrics` |
| `video` | 4002 | `/metrics` |
| `purchase` | 4003 | `/metrics`, claim of record for payments |
| `streaming` | 4004 | `/metrics`, signed playback URLs |
| `webhook` | 4005 | `/metrics` |
| `redis-exporter` | 9121 | Redis INFO → Prometheus |
| `otel-collector` | 4317/4318/8889 | OTLP → debug + remote-write, own `/metrics` |
| `prometheus` | 9090 | scrape + SLO alert rules |
| `grafana` | 3001 | dashboards (provisioned) |

## Starting the stack

```powershell
docker compose up -d otel-collector redis-exporter prometheus grafana
npm run dev
```

- Prometheus scrapes `host.docker.internal:<port>/metrics` for each service, so the
  host-run dev stack is picked up without rebuilding containers.
- Traces are exported by each service to `http://otel-collector:4318` when you run
  inside compose. For local dev, set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`.

## Dashboards

`deploy/grafana/provisioning/dashboards/streamz-overview.json` (auto-loaded, folder
**Streamz**):

- Requests per second by service
- p95 latency (playback-setup threshold 200 ms)
- 5xx error rate (budget 0.1%)
- Redis cache hit ratio (target ≥ 90%)
- Service availability (`up`)
- In-flight requests

Login: `admin` / password from `GRAFANA_ADMIN_PASSWORD` (default `admin`). Change it
in production.

## Alerting

Rules live in `deploy/prometheus.rules.yml` and fire these alerts:

| Alert | Condition (5 min window) | Severity |
| --- | --- | --- |
| `StreamzServiceDown` | `up == 0` | critical |
| `StreamzHigh5xxRate` | 5xx ratio > 5% | critical |
| `StreamzPlaybackLatency` | streaming p95 > 200 ms (10 min) | warning |
| `StreamzCacheEfficiency` | cache hit ratio < 60% (15 min) | warning |

In Kubernetes, Alertmanager routes to Slack/PagerDuty. Recording rules
(`job:http_5xx_ratio:rate5m`, `job:http_p95:5m`, `job:redis_cache_hit_ratio:5m`)
drive the SLO dashboards and error-budget burn-rate views.

## Logging

- Pretty-printed by default; set `LOG_JSON=1` for structured JSON with
  `requestId`/`traceId`/`spanId` (`LOG_LEVEL` controls verbosity).
- Every request carries `x-request-id` end-to-end (gateway propagates it to
  services), so a failing request can be stitched from gateway to service logs.

## Troubleshooting

- **Metrics not showing in Grafana**: confirm `GET http://localhost:<port>/metrics`
  returns 200 on the host; Prometheus targets page shows scrape health.
- **No traces on the collector**: verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set and the
  service prints `[otel] OpenTelemetry tracing started`. The collector `debug`
  exporter prints spans to `docker compose logs -f otel-collector`.
- **Readiness 503**: `GET /health/ready` returns `{"checks":[{"name":...,"ok":false}]}`.
  Redis/Postgres down → gateway/auth/video/purchase/streaming report it.
- **5xx spike during webhook push**: `http_request_duration_seconds_bucket`
  histogram + `outbox` table (`published_at IS NULL`) reveal stuck replays.
- Alert runbooks: see `benchmark.md` §6 (chaos) for DR of killed Redis/DB.