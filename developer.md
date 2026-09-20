# Streamz — Developer Deep-Dive & Technology Decision Log

Companion to `README.md` (architecture), `docs/observability.md` (SLOs/tracing) and
`benchmark.md` (load numbers). This file is meant to be read before coding in this
repo, and doubles as the engineering story behind every stack decision — the "why
this technology" answers for architecture reviews and technical interviews.

Code paths are cited as `backend/<path>:<line>`; they match `master` at v1.0.0.

---

## Part 1 — Why every technology (decision log)

### 1. Node.js + Express + TypeScript (npm workspaces)

- One language across gateway, six services, shared library, tests, and load scripts.
  No polyglot contract drift — the shared DTO/schema/layout layer in
  `backend/shared/src` (zod schemas, event names, JWT payloads) is imported by every
  workspace.
- Express was chosen over Nest/Fastify: minimal surface, the gateway only proxies,
  and codebase-wide conventions (per-service index.ts entrypoint, hand-rolled
  metrics/retry/telemetry) keep dependencies low and auditable.
- npm workspaces give us `@streamz/shared` as a source package (`main: src/index.ts`)
  that tsx/ts-node can run directly in dev and CI. Containers need a compiled copy —
  see the Docker section below for the subtle wiring this requires.

**Trade-off accepted:** Node's single-threaded event loop. CPU-bound work is pushed to
a libuv threadpool (bcrypt) or to Postgres/Redis; inter-service fan-out is handled by
async Redis pub/sub, not threads. That is the right shape for I/O-bound HTTP
services and removes the need for a consumer-group bus at this scale.

### 2. PostgreSQL 16 (single instance, multi-schema)

- Per-service schemas (`auth_service`, `video_service`, `purchase_service`,
  `events.outbox`) give service ownership inside one engine — zero operational
  overhead of separate databases while keeping foreign keys within a service local.
- Default isolation is `READ COMMITTED`. Our writes are single-row, idempotent
  (`ON CONFLICT`) upserts inside short transactions; the rarely hit anomaly window
  does not justify `REPEATABLE READ` or row locks today. If a wallet/ledger feature
  lands, we add `SELECT ... FOR UPDATE` on the balance row, not a global isolation
  bump.
- Every migration is one `.sql` file run by `backend/migrations/run.ts` as a single
  simple-query (PG wraps multi-statement strings in one implicit transaction → each
  file is atomic). The runner is idempotent (`IF NOT EXISTS`) and runs files in
  sorted order.

### 3. Redis 7 (cache, sessions, rate-limit, event bus)

Three duties, one dependency:

1. **Cache** — catalog lists/featured, invalidated via pub/sub on
   `purchase:completed`, `purchase:refunded` (`videos:*` unlink in the video service);
   the purchase service keys its cache by user to feature freshly-bought titles.
2. **Sessions** — `session:<userId>` set on login/refresh with a 7-day TTL; the
   gateway checks it on every authenticated call, so revocation is instant even on a
   valid JWT.
3. **Event bus** — `PURCHASE_COMPLETED`, `PURCHASE_REFUNDED`, `RENTAL_CLEANUP` pub/sub
   between webhook→purchase and purchase→(video cache watchers/subscribers).

**Why not Kafka / NATS JetStream?** The durable, record-of-truth side of our events
lives in Postgres via the transactional outbox (`events.outbox`), not in the bus.
Redis pub/sub is a fast notification layer riding on top of that durable log, giving
at-least-once delivery *with* persistence for everything after the purchase commit.
That combination removes the operational weight of Kafka (ZK/KRaft brokers, topic
schemas, consumer-group tooling) from a system whose only transactional producer is a
single Postgres row. The honest caveat — the *webhook→purchase* hop is at-least-once
only while the purchase service is subscribed; see Part 3 for the Stripe-retry +
reconciliation story.

### 4. Transactional outbox — and why not 2PC or CDC

`purchase` writes `purchase_service.purchases` **and** `events.outbox` inside one
`BEGIN … COMMIT` (`backend/services/purchase/src/index.ts`). The outbox row is the
domain event (`purchase:recorded`) persisted with its transaction. A worker then
publishes it to Redis and marks `published_at`.

- **Why not 2PC:** a distributed commit coordinator is a new failure domain (and a
  second datastore) just to coordinate two writes that already share one Postgres
  transaction anyway. There is no second database to coordinate.
- **Why not CDC/Debezium:** we control the write path and the schema; an app-level
  outbox gives us exactly the retry budget, dead-lettering, and observability we want
  without standing up a CDC pipeline and WAL-decoding machinery for a single table.
  CDC/event-sourcing are the right call when the *event log* is the source of truth;
  here Postgres rows are the truth and events are notifications.

The worker is **bounded-batch, claim-based, and never holds table locks** —
see Part 3 for the concurrency mechanics.

### 5. PgBouncer (transaction pooling)

Clients talk to `:6432`, PgBouncer pools to `:5432`
(`backend/pgbouncer.ini`: `pool_mode = transaction`, `default_pool_size = 20`,
`max_client_conn = 500`). Prevents a fleet of Node services from exhausting Postgres
connections, and matches our usage: short transactions, no long-lived sessions.

**What transaction mode breaks (and how we stay safe):**

| Feature | Broken by transaction pooling? | Our position |
| --- | --- | --- |
| Named prepared statements | Yes | We only use `pool.query(sql, params)` → unnamed statements, re-prepared per transaction. Safe. |
| `LISTEN`/`NOTIFY` | Yes | We deliberately use Redis pub/sub for notifications. Safe. |
| Session-level advisory locks | Yes | Not used. |
| `SET session_...` / Temp tables | Yes | Not used; every read is per-request. |

### 6. Stripe (payments) + Mux (video)

- **Stripe** — backend creates payment `intents` (purchase service) and customers
  (auth service); the webhook consumes `payment_intent.succeeded` events. Webhook
  idempotency is delegated to Postgres: the purchase INSERT uses
  `ON CONFLICT (stripe_payment_intent_id) DO NOTHING`, so Stripe re-deliveries or a
  racing `RENTAL_CLEANUP` can never double-record or double-count.
- **Mux** — upload URLs, asset ingest, and signed playback. Playback tokens carry a
  TTL derived from the exact remaining rental time (Part 2.3). Signing is on only
  when `MUX_SIGNING_KEY` + `MUX_PRIVATE_KEY` are configured, so the public/dev path
  still works.
- **Vendor calls are wrapped by a circuit breaker + retry policy** (`shared/src/circuitBreaker.ts`,
  `shared/src/retry.ts`). See Part 2.1/3.6.

### 7. Auth: bcrypt + JWT hardening

- **bcrypt (native), cost 10.** We benchmarked native `bcrypt` vs `bcryptjs` under
  concurrent logins; native on the libuv threadpool is dramatically faster under load
  (pool 4: ~2.06s vs pool 16: ~1.16s for 50 compares; single compare ~140 ms at
  cost 10). Hash cost 12→10 keeps the same work while staying under async-latency
  budgets. `UV_THREADPOOL_SIZE=16` is wired via the `dev` script (cross-env),
  `scripts/ci/setup-stack.sh`, docker-compose, and Helm.
- **Timing equalization:** unknown email runs the same bcrypt workload (same cost)
  as a wrong password, so response time doesn't leak whether an account exists.
  The dummy compare must use the **same work factor** as real hashes, or the
  equalizer itself becomes the oracle.
- **JWT:** HS256 pinned (algorithm-confusion safe), 15-minute access + 7-day refresh
  tokens, two separate secrets (`JWT_SECRET`/`JWT_REFRESH_SECRET`), and a Redis
  session row checked by the gateway for instant revocation. Rotation design in
  Part 3.4.

### 8. API Gateway and global middleware

- **Dependency-light, hand-rolled primitives** in `backend/shared`: our own tiny
  Prometheus registry (counter/histogram/gauge), tracer on top of OpenTelemetry,
  exponential-backoff+jitter retry, request-ID middleware, graceful shutdown,
  secrets loading, and the circuit breaker. When the same 20-line primitive would
  otherwise be copy-pasted into six services, it lives in shared — but we prefer a
  60-line auditable implementation over a dependency whose surface we don't use.
- **express-rate-limit + rate-limit-redis** on the gateway (Part 2.1) — the memory
  store is fine for one instance and is the classic "what would you change" trap; the
  Redis store makes limits consistent across replicas.
- **helmet + secure JSON parsing + CORS allowlist** applied uniformly.
- **Proxying** via `http-proxy-middleware`: preserves `x-user-id`/`x-user-email`/
  `x-request-id` and forwards W3C `traceparent`/`tracestate` for end-to-end tracing.

### 9. Observability, CI/CD, and reliability tooling

- **Prometheus text-format metrics** exported by every service (`/metrics`): HTTP
  request counters + latency histograms, outbox delivery/dead-letter, payment-intent
  success, circuit-breaker state, playback issuance latency. Zero deps, one file,
  scraped by the Prometheus/Grafana compose stack; SLO alert rules in
  `backend/deploy/prometheus.rules.yml`.
- **OpenTelemetry** — `@opentelemetry/auto-instrumentations-node` + OTLP exporter
  (`shared/src/otel.ts`); enabled only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set
  (zero overhead otherwise). `traceparent` passes through the gateway.
- **k6** load tests (auth/catalog/playback/purchase/burst/stream-soak) with
  env-tunable thresholds; CI runs smoke gates, strict SLOs are for ≥4 vCPU runners.
- **Testcontainers** integration tests (`webhook → purchase` boot the real Postgres +
  Redis + services), health-gated to avoid boot-order races.
- **GitHub Actions:** lint+typecheck, integration tests, chaos smoke, k6 gates, Helm
  lint/template, gitleaks + trivy + CodeQL (SARIF), Pages docs.

### 10. Containers (the part that bites)

Services resolve `@streamz/shared` by npm-workspace symlink whose `main` is
TypeScript (`src/index.ts`). That runs under tsx/ts-node (dev + CI) but a plain
`node dist/index.js` in a container crashes at `require('@streamz/shared')`. The
Dockerfile therefore:

1. installs the 7 runtime workspaces (toolchain for native bcrypt on Alpine),
2. `tsc`-compiles shared,
3. replaces the `node_modules/@streamz/shared` symlink with a self-contained npm
   package pointing at `dist/index.js`,
4. copies that plus each service's `dist` into thin runtime images
   (multi-stage `--target auth|video|purchase|streaming|webhook|gateway`).

`backend/.dockerignore` keeps local `node_modules`/`dist` out of the build context.

---

## Part 2 — The hands-on / "live demo" questions

### 2.1 Distributed rate limiting (memory → Redis)

**Current implementation** (`backend/api-gateway/src/index.ts`):

```ts
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX) || 100,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
  store: new RedisStore({
    sendCommand: (...args) => (redis.call as (...a) => Promise<string>)(...args),
    prefix: 'rl:streamz:',
  }),
}))
```

- **Shared store:** limits live in Redis, so 10 gateway replicas behind a LB enforce
  one global budget, and a client that rotates backend IPs can't refill by reconnecting.
- **`sendCommand` wrapper** adapts ioredis to rate-limit-redis' `SET`/`INCR` protocol —
  no second connection, no blocking loops; one Lua-free INCR + EXPIRE per request.
- **Fail-open vs fail-closed:** we fail **closed** — if the store throws, the request
  is rejected (500). Rationale: a limiter that silently disables during an attack is
  worse than a short outage window; the effect is visible in `/health` (readiness
  pings Redis) and Grafana. Document this choice in the PR; a
  `handleMissingStore`/fallback-to-memory policy is the alternative if availability
  trumps defense.
- **Behind a proxy/NAT:** default `keyGenerator` is `req.ip`, which is the socket
  address — behind a LB without `trust proxy` that's the LB IP, collapsing all users
  into one bucket. Fix (also needed for real IP liming):
  `app.set('trust proxy', 1)` and validate `X-Forwarded-For` at the edge, then either
  rate-limit by `x-user-id` for authenticated routes, or by the first untrusted
  hop. Document `trust proxy` as the gatekeeper — trusting it blindly lets clients
  spoof their own limit bucket.

**Demo:** start two gateway instances on different ports with one Redis; hit them
alternately; with `RATE_LIMIT_MAX=3`, the 7th combined request returns 429 while each
instance's in-memory counter would have allowed 6.

### 2.2 Outbox replay under a network partition

The durable copy of every domain event is the Postgres row, so killing Redis cannot
lose work:

1. `npm run migrate` first (creates `events.outbox`).
2. `docker stop backend-redis-1` (or the test Redis) **before** triggering a payment.
3. `npm run mock:webhook` sends a signed `payment_intent.succeeded`. The webhook
   publishes to a dead Redis — that publish is best-effort and may throw, but the
   purchase subscription simply never receives it **unless it is persisted first**.
   To force the durable path deterministically, check the purchase INSERT/outbox
   INSERT transactional write succeeded:
   ```sql
   SELECT id, channel, deliveries, published_at, failed_at, last_error
   FROM events.outbox WHERE channel = 'purchase:recorded';
   -- → published_at IS NULL, deliveries = 0   (captured in Postgres, not yet delivered)
   ```
4. `docker start backend-redis-1`.
5. The purchase `flushOutboxLoop()` (tick every 15 s, plus an immediate pass on boot)
   claims the row, publishes on `purchase:recorded`, sets `published_at`, and the
   video service's cache watcher invalidates `videos:*`. Verify:
   ```sql
   SELECT id, published_at IS NOT NULL AS published FROM events.outbox WHERE channel='purchase:recorded';
   ```

**No double processing:** delivery is a claim-update
(`UPDATE … SET deliveries = deliveries + 1 … RETURNING`) so two workers can never
deliver the same attempt twice; consumers are idempotent (`ON CONFLICT … DO NOTHING`).
**Dead-lettering:** after `OUTBOX_MAX_DELIVERIES = 5` attempts the row is marked
`failed_at`/`last_error` and raises the `StreamzOutboxDeadLetters` alert; a sweep
closes the race where another replica exhausted attempts without marking.

### 2.3 Playback token TTL = min(default, remaining rental)

`backend/services/streaming/src/index.ts` (`GET /api/stream/playback/:playbackId`):

```ts
const remainingMs = expires_at ? new Date(expires_at).getTime() - Date.now() : null
const defaultTtl = Math.max(60, +process.env.PLAYBACK_TTL_SECONDS || 3600)
let ttl = defaultTtl
if (remainingMs !== null)
  ttl = Math.max(60, Math.min(defaultTtl, Math.ceil(remainingMs / 1000)))
// signingOn ? token = mux.jwt.signPlaybackId(playbackId, { type:'video', expiration: `${ttl}s` })
```

- `Math.min` — a rental that has 10 min left gets a 10-min token, never the full hour.
- `Math.max(60, …)` — floor so a token is never issued that dies before a player can
  start (playlist fetch + key rotation guard).
- Non-rental (buy) → `remainingMs = null` → default TTL.

**Edge cases to test:**
- Expired rental → the access query (`expires_at > NOW()`) returns no row → **403**
  `No access. Please purchase this video.` — token issuance is gated by entitlement,
  so expiry is enforced at request time regardless of TTL math.
- Mid-stream expiry — see Part 3.3 (HLS edge keeps serving until the token's segments
  are exhausted; the *next* fetch 403s; we cap TTL to minimize the window).
- `remainingMs <= 60_000` → clamps to 60, floor applies.
- Signing disabled (no Mux keys) → unsigned `stream.mux.com/…m3u8`, TTL headers still
  returned as metadata.

Write the unit test around a pure function extracted from the handler
(`computeTtl(defaultTtl, remainingMs)`), plus an integration test asserting 403 for
`expires_at < NOW()`.

### 2.4 PgBouncer stress test

Methodology (no cluster needed — docker-compose has postgres `:5432` behind
pgbouncer `:6432`):

1. **Baseline vs pooled.** With a large pool (`max: 50` in the Node `pg` Pool),
   hammer the two endpoints with a quick concurrent script (`node:test` or `k6`):
   - `:5432` — direct: N connections, each held for the request lifetime.
   - `:6432` — pgbouncer transaction mode: a client gains a server connection only
     during an open transaction (`poo` s are released at COMMIT), so 500 gateway
     connections need only `default_pool_size` server connections.
2. **What to watch:**
   - `SHOW POOLS;` on pgbouncer → `cl_active`, `cl_waiting`, `sv_active`, `sv_idle`.
   - PgExporter / `pg_stat_activity` on Postgres → active connections stay ≤ 20 even
     while gateway latency-stable.
   - `p95` request latency **must not grow** as concurrency exceeds the pool size —
     that's the transaction-mode payoff.
3. **The trap:** run one query that *holds* a transaction open across the request
   (e.g. an un-committed UPDATE or a named prepared statement). Under pooling this
   serializes or errors — demonstrating why we keep every `pool.query` self-contained
   and avoid named prepares.

### 2.5 DLQ/retry for the event consumer

Handled in `backend/services/purchase/src/index.ts` (the outbox flush) *and* the
`redisSub` handler:

- **Transient vs permanent separation:** transient failures (Redis connect, Postgres
  `08xxx`/idle timeouts) are classified by `vendorRetryable`/`DEFAULT_RETRYABLE` and
  retried with exponential backoff + jitter (`shared/src/retry.ts`). Permanent
  failures surface as **dead-lettered rows** (`failed_at`, `last_error`,
  `streamz_outbox_dead_lettered_total` + `StreamzOutboxDeadLetters` alert), not as
  silent retry loops.
- **Schema/validation failures:** if a payload fails to parse (no `paymentIntentId`
  or unknown `purchaseType`), the parse is inside the consumer's `try/catch`; json is
  validated before DB work so we never half-insert.
- **Idempotency preserved:** connect-time retries re-run `ON CONFLICT … DO NOTHING`.
- **Structured logging:** every attempt logs request ID, outbox ID, delivery count,
  and error `message`; metrics carry `status` labels (`published|retryable-failed|dead-lettered`).

### 2.6 Mobile native storage

**Android — `android/app/src/main/java/com/streamz/app/data/local/TokenManager.kt`**

- A 256-bit AES key is generated **inside the AndroidKeyStore** (`KeyGenParameterSpec`
  with `PURPOSE_ENCRYPT|PURPOSE_DECRYPT`, AES/GCM) — the private key material never
  leaves secure hardware (TEE/StrongBox where available).
- Tokens are encrypted with AES-GCM (128-bit tag → authenticity + confidentiality);
  IV is 12 bytes, prepended to the ciphertext, Base64-encoded, stored in a
  preferences DataStore. `accessToken`/`refreshToken` are **Flow<String?>** produced by
  `::decrypt` — the ciphertext is decrypted on read.
- **Graceful failure:** `decrypt` catches every exception and returns `null`, mapping
  to a logged-out state. If the Keystore key was invalidated (key rotation, restore
  across device, tampering), the app degrades to login instead of crashing — and
  `clearTokens()` wipes stale ciphertext so the next login writes fresh ones.

**iOS — `ios/Streamz/Helpers/KeychainManager.swift`**

- kSecClassGenericPassword, service `com.streamz.app`; values live in the Keychain
  (hardware-backed, encrypted at rest, survives app uninstall unless restricted).
- `read` returns `nil` on `errSecSuccess` failure (missing/erased item) → the app
  treats it as signed-out and routes to the login flow in `StreamzApp.swift`'s
  `RootView`/`AuthViewModel.checkAuth`.

**Weakness to voice honestly:** tokens persist unencrypted-in-Keychain semantics on
iOS rely on the OS; on Android, DataStore-only encryption means the ciphertext is at
rest protected by the hardware key — good. What we don't yet do (see Part 3.7):
certificate pinning, DRM offline keys, and jailbreak/root detection.

---

## Part 3 — Architecture & system design (Q&A)

### 3.1 Outbox vs Event Sourcing vs 2PC vs CDC

- Event sourcing makes the *log* the state; our truth is mutable Postgres rows
  (purchases with `ON CONFLICT` idempotency, `status` transitions). Retrofitting
  event sourcing would complicate read models and idempotency for no current benefit.
- 2PC needs a coordinator + second datastore; we have one DB, so one local
  transaction (**outbox**) is strictly simpler.
- CDC (Debezium) adds WAL-decoding ops and event ordering hidden from application
  code; **outbox keeps ordering and retry control in-code**, where the purchase
  service already lives.
- **High-concurrency polling without locking the table** (the real question):
  1. `flushOutboxBatch()` selects up to 100 pending rows (`ORDER BY created_at`) —
     a *stage*, not a lock: `WHERE published_at IS NULL AND failed_at IS NULL AND deliveries < 5`.
  2. Each delivery is a **claim-update** (`UPDATE … deliveries = deliveries + 1 …
     RETURNING`) — no `SELECT FOR UPDATE` held across work, so two nodes never double
     deliver, and running out of a batch is just "somebody else clained it."
  3. Work is concurrency-bounded (`OUTBOX_FLUSH_CONCURRENCY = 8`, max 10 passes per
     tick, 15 s interval, `flushing` guard prevents overlapping loops). A fast
     producer back-pressures instead of growing queues unboundedly.

### 3.2 Redis pub/sub message loss — webhook → purchase

Because webhooks are HTTP, Stripe is the real durability layer on the ingest side:

- Stripe **retries undelivered webhooks** (exponential backoff, ~3 days) until the
  endpoint returns 200. Our webhook *service* is the 200-returner; with Redis up it
  always ACKs quickly.
- The remaining loss window is "purchase booted after the publish" (Redis has no
  replay). We close the *observable* part: multiple replicas, liveness/readiness
  probes (Part 3.8), and doc'd boot ordering. A *deterministic* fix for the strictest
  guarantee — webhook-side outbox (Persist the signed payload in `events.outbox` at
  the webhook service, consumer = purchase) or a Stripe `payment_intent` drift-scan
  reconcile job that re-materializes any `succeeded` intent with no purchase row —
  is the documented "next" item. For a strip job, `ON CONFLICT` idempotency makes
  re-insertion safe by construction.

### 3.3 Gateway at 10 replicas + rate limiting redesign

Covered by the implementation in 2.1. Redesign in three moves:

1. Rate limit in Redis (done), keyed by `x-user-id` for authenticated routes and by
   normalized client address for public endpoints.
2. `trust proxy = 1..N` + strict validation so `X-Forwarded-For` can never be forged
   to reset a bucket; keep `X-Forwarded-For` appending disabled if the LB already adds.
3. Per-tenant buckets respect a `windowMs`/`max` matrix (anonymous, per-user, per-IP)
   and a global emergency shutdown limiter at the ingress.

### 3.4 Mid-stream expiry of playback tokens

Concretely: HLS segment requests are signed with the token until its TTL. When the
token expires **during** playback, the edge returns 403 for the *next* segment; the
player shows a playback failure, not a graceful "renew." We minimize the window by
issuing exactly `min(60, remainingMs…)`-bounded tokens, and the access check will have
**already said no** to any new playback URL after the rental end.

**Production upgrade (designed, not shipped):** short-lived rotation — the streaming
service issues a *renewable* short token; the client calls `/playback` again before
TTL elapses, and the service re-validates the rental (`expires_at > NOW()`) before
issuing a new token. Renewals extend only within the rental window, so a mid-stream
expiry becomes "player refreshes silently, then cleanly stops at rental end." Player
side: ExoPlayer/AVPlayer error handler distinguishes 403 (entitlement ended → show
re-buy) from network (retry/idle).

### 3.5 JWT signing-key rotation without logging out users

Design:

- Introduce a **`kid` (key id)** in the token header + payload at issuance, alongside
  `JWT_SECRET`.
- The gateway AND every service that verifies (auth refresh, gateway verify, session
  lookup) do **key lookup by kid** against a `keys` map loaded from
  `JWT_SIGNING_KEYS` (JSON: `{ "2026-01": "…", "2026-02": "…" }`) or a versioned k8s
  Secret. Algorithm stays pinned `HS256`.
- Rotation = publish a **new** key as "signing" while old keys remain "verify-only"
  (`sign: latestKids[0]`, `verify: all`). Because access tokens are short (15 m),
  JWTs minted under the old key expire naturally; refresh tokens (7 d) verify against
  the whole set during rotation and get re-minted under the new key on each refresh
  cycle. No user is logged out.
- Graceful config reload: hook `SIGHUP`/Secret watch to swap the key map without
  process restarts; `kid`-based lookup means a half-updated fleet still verifies.
- The gate `session:<userId>` in Redis is key-agnostic, so revocation semantics are
  unaffected by rotation.

### 3.6 Vendor circuit breaking (Stripe/Mux) at scale

The 100k-user / Stripe-latency question in code:

- **Retry inside a breaker.** `CircuitBreaker.execute(w)` wraps `withRetry(vendor…
  , { retryable: vendorRetryable })` so transient 429/5xx are retried **inside** the
  breaker; only the *final* failure counts toward opening. 5 consecutive failures →
  `open` (30 s) → half-open probe → 2 successes → `closed`
  (`backend/shared/src/circuitBreaker.ts`).
- **Cost of opening:** during a Stripe degradation, checkouts `throw CircuitOpenError`
  immediately (~ms) instead of each spawning retry attempts → the DB and Redis stay
  quiet, the p95 collapses, and a `purchase` idle-path keeps serving existing
  entitlements. The `streamz_circuit_breaker_state` gauge makes break-state visible in
  Grafana.
- **Double-charge / lock-contention prevention:** there is no balance row to contend;
  each user's row is `ON CONFLICT (stripe_payment_intent_id) DO NOTHING` from the
  purchase transaction. "Double charge" risk lives in the *checkout* endpoint, which
  guards with the existing-completed-purchase check (`409 Already purchased`) before
  creating an intent.
- **Backpressure to the client during the webhook delay:** the client polls
  `/api/purchases/check/:videoId` (`hasAccess`) and owned-purchases list rather than
  polling Stripe. The eventual success arrives via the outbox→Redis→cache-invalidate
  chain; the poll just waits for the row to exist. If webhooks are delayed, users see
  "processing" with bounded retry (exponential backoff) instead of a spinner storm.
- **Where we do it (real calls, not signing):** `stripe.paymentIntents.create`
  (purchase), `stripe.customers.create` (auth), `mux uploads.create/retrieve`,
  `mux assets.retrieve` (streaming). `mux.jwt.signPlaybackId` is local RSA/HMAC — no
  breaker.

### 3.7 Offline playback & DRM hardening (design)

- **Storage:** never raw media. Mux widevine/fairplay licensing requires the
  `asset.playback_ids` with DRM policy; encrypted segment caching would use
  `ExoPlayer` `DownloadManager` (Android) / `AVAssetDownloadTask` (iOS), both of which
  persist **encrypted** content and hold license/keys in platform secure storage.
- **Keys ≠ tokens:** separate the auth/entitlement session (already in Keychain/
  Keystore) from the DRM license context. Platform then ties license persistence to
  device security.
- **Rooted/jailbroken:** at a minimum gate the offline entitlement download behind the
  same server-side `expires_at` check and re-verify on every app foreground/playback
  start; detect untrusted environments via SafetyNet/Play Integrity + device jailbreak
  checks and refuse offline downloads (still allow streaming, since the edge enforces
  TTL). Full guarantee needs license-server reconciliation — a Stripe-verified
  entitlement that also checks `purchase.status` on each long-form DRM license
  request. This is the honest boundary: **client-side storage can be made hard to
  extract, but enforcement always lives server-side** — our `expires_at` gate is the
  enforcement point that never lives on-device.

### 3.8 The boot-race fix → readiness probe design

`purchase-flow.test.ts` failed intermittently in CI with `expected purchase row to be
recorded` after ~20 s. Root cause: the test spawned both services but only waited for
the **webhook's** HTTP readiness before firing the event; if the purchase service
hadn't subscribed to Redis yet, the `PURCHASE_COMPLETED` publish had no subscriber
(Redis pub/sub has no queue), the event was dropped, and the row never appeared.

Two lessons shipped:

1. **Test determinism:** await each service's `/health/live` before dependent steps
   (and widen the poll window for cold CI runners). Readiness != liveness: liveness
   means "process alive"; readiness means "able to do its job." The purchase service
   considered itself `ready` only after `SELECT 1`, `redis.ping()`, and subscription —
   the test now gates on that.
2. **Production deployment shape:** k8s probes use exactly the same split —
   liveness probes a cheap handler; readiness probes check Postgres + Redis (and Mux
   creds for streaming). HPA minReplicas=2 for consumers means a rolling restart never
   leaves zero subscribers, closing the "no queue" window that the test exposed.
   Inter-service dependencies are therefore boot-ordered by readiness, not by guesses
   about starts.

---

## Part 4 — Honest "what I'd change next" list

1. **Webhook-side outbox + Stripe drift reconcile job** — closes the last
   at-least-once gap (ingest → purchase) without Kafka.
2. **`trust proxy` + per-user rate-limit keys** — needed before exposing the gateway
   behind a real LB/NAT.
3. **JWT `kid`-based key rotation + SIGHUP reload** — the only auth knob not yet
   operational-grade (Part 3.5).
4. **Playback token renewal endpoint** — turns mid-stream expiry into silent refresh.
5. **Read replicas / search** — only when query volume justifies; the catalog is
   cacheable today (Redis + pub/sub invalidation).
6. **Play Integrity / jailbreak gating for offline DRM** — Part 3.7.
7. **Cockatiel vs hand-rolled breaker:** we chose hand-rolled for dep-minimalism and
   metrics integration; if the team standardizes on a library, Cockatiel is the
   drop-in (same semantics: `handleAll().retry().circuitBreaker()`), and ports directly
   because all vendor calls already go through the one `shared` wrapper.

## Changelog note

- v1.0.0 branch: native `bcrypt` behind `UV_THREADPOOL_SIZE=16`; Redis-backed
  gateway rate limiting; circuit breakers around Stripe/Mux; business SLO metrics
  (payment-intent success, outbox latency, playback issuance) + alerts; OTel
  `traceparent` forwarding; outbox dead-letter + bounded batched flush; Container
  build fixed to compile `@streamz/shared` and ship it with each service image.
- Auth timing-equalizer dummy compare now uses **cost 10** (same work factor as real
  hashes) so the equalizer itself cannot become a timing oracle.