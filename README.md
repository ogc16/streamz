# Streamz — Pay-Per-View Video Streaming

> Netflix/Hulu-style pay-per-view video streaming: native iOS (SwiftUI) and Android (Jetpack Compose) clients backed by a Node.js microservices monorepo with PostgreSQL, Redis, Stripe, and Mux.

## Contents

1. [Overview, Features & Roadmap](#1--overview-features--roadmap)
2. [Screenshots & Preview](#2--screenshots--preview)
3. [Architecture & System Diagram](#3--architecture--system-diagram)
4. [Engineering Highlights & Security](#4--engineering-highlights--security)
5. [Tech Stack Summary](#5--tech-stack-summary)
6. [Getting Started & Environment Setup](#6--getting-started--environment-setup)
7. [Payment & Webhook Logic](#7--payment--webhook-logic)
8. [API Specifications & Payloads](#8--api-specifications--payloads)
9. [Project Structure](#9--project-structure)
10. [Testing](#10--testing)
11. [Deployment](#11--deployment)
12. [Contributing & Community](#12--contributing--community)

## 1 · Overview, Features & Roadmap

**Streamz** is a complete pay-per-view streaming product that runs end-to-end on your own stack: a mobile-first viewer experience (iOS + Android), a microservices backend, and production deployment paths (Docker Compose and Kubernetes/Helm).

### What's built

- **Native apps** — SwiftUI (iOS, MVVM + `@MainActor`) and Jetpack Compose (Android, MVVM + Hilt), both with secure token storage (Keychain / Keystore-encrypted DataStore) and Stripe PaymentSheet checkout.
- **Microservices backend** — six TypeScript services (gateway, auth, video, purchase, streaming, webhook) on npm workspaces with shared, type-checked contracts in `@streamz/shared`.
- **Pay-per-view commerce** — buy or rent any video; rental expiry and access checks enforced on the server, not the client.
- **Streaming on Mux** — upload URLs, signed HLS playback with rental-aligned TTLs, thumbnails; works optionally without signing keys for local development.
- **Reliable event pipeline** — signature-verified webhooks publish Redis Pub/Sub events; the purchase service persists via a [transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html) (`events.outbox`) with startup replay, so no purchase is ever lost.
- **Observability & robustness** — one-command boot, correlation IDs (`X-Request-ID`) across every service, PgBouncer pooling, rate limiting, and JWT hardening.
- **Deployment** — `docker-compose.yml` for local/VM, plus a parameterized Helm chart under `helm/streamz/` for Kubernetes (see [Deployment](#11--deployment)).

### Roadmap

| Status | Item |
|--------|------|
| In progress | CI pipeline that runs the Testcontainers integration suite and mobile builds on every PR |
| Backlog | Admin video-management UI (curation, pricing, uploader) |
| Backlog | Player resume/seek state per user profile |
| Backlog | Push notifications on rental expiry and featured drops |
| Backlog | Localization (i18n) for iOS + Android |

## 2 · Screenshots & Preview

- **Interactive HTML prototype:** open [`index.html`](./index.html) in any browser for a click-through preview of the catalog, player, and purchase flows.
- Native app screenshots to be added as the mobile clients stabilize.

## 3 · Architecture & System Diagram

### Backend (Microservices)

| Service | Port | Description |
|---------|------|-------------|
| API Gateway | `3000` | Entry point, JWT validation, rate limiting, request routing |
| Auth Service | `4001` | User registration, login, JWT + refresh tokens |
| Video Service | `4002` | Catalog CRUD, search/filter/pagination, access-aware responses |
| Purchase Service | `4003` | Stripe PaymentIntent, access checks, purchase history |
| Streaming Service | `4004` | Mux upload URLs, HLS playback, thumbnail generation |
| Webhook Service | `4005` | Stripe payments, Mux asset events, rental expiry |

### System Diagram

```mermaid
flowchart TD

subgraph group_clients["Mobile Clients"]
  node_android_app["Android App<br/>[MainActivity.kt]"]
  node_ios_app["iOS App<br/>[StreamzApp.swift]"]
  node_android_auth["Android Auth<br/>[AuthViewModel.kt]"]
  node_ios_auth["iOS Auth"]
  node_android_tokens["Android Tokens<br/>[TokenManager.kt]"]
  node_ios_keychain["iOS Keychain"]
  node_android_catalog["Android Catalog<br/>[HomeViewModel.kt]"]
  node_ios_catalog["iOS Catalog"]
  node_android_video_data["Android Video Data<br/>[VideoRepository.kt]"]
  node_ios_video_data["iOS Video Data<br/>[VideoService.swift]"]
  node_purchase_ui["Purchase UI<br/>[PurchaseScreen.kt]"]
  node_purchase_data["Purchase Data"]
  node_android_player["Android Player<br/>[PlayerScreen.kt]"]
  node_ios_player["iOS Player<br/>[PlayerView.swift]"]
  node_android_transport["Android Transport<br/>[ApiClient.kt]"]
  node_ios_transport["iOS Transport<br/>[APIClient.swift]"]
end

subgraph group_edge["API Edge"]
  node_gateway["API Gateway<br/>[index.ts]"]
end

subgraph group_domains["Domain Services"]
  node_auth_service["Auth Service<br/>[index.ts]"]
  node_video_service["Video Service<br/>[index.ts]"]
  node_purchase_service["Purchase Service<br/>[index.ts]"]
  node_streaming_service["Streaming Service<br/>[index.ts]"]
  node_webhook_service["Webhook Service<br/>[index.ts]"]
end

subgraph group_infra["Media And Data"]
  node_postgres[("PostgreSQL")]
  node_redis[("Redis")]
  node_stripe["Stripe"]
  node_mux["Mux"]
end

node_viewer(("Viewer"))

node_viewer -->|"uses"| node_android_app
node_viewer -->|"uses"| node_ios_app
node_android_app -->|"restores session"| node_android_auth
node_android_auth -->|"calls auth API"| node_android_transport
node_android_auth -->|"stores tokens"| node_android_tokens
node_ios_auth -->|"calls auth API"| node_ios_transport
node_ios_transport -->|"stores tokens"| node_ios_keychain
node_android_catalog -->|"loads catalog"| node_android_video_data
node_android_video_data -->|"requests videos"| node_android_transport
node_ios_catalog -->|"loads catalog"| node_ios_video_data
node_ios_video_data -->|"requests videos"| node_ios_transport
node_purchase_ui -->|"starts purchase"| node_purchase_data
node_purchase_data -->|"requests payment"| node_android_transport
node_purchase_ui -.->|"presents payment"| node_stripe
node_android_player -->|"requests playback"| node_android_transport
node_ios_player -->|"requests playback"| node_ios_transport
node_android_transport -->|"sends requests"| node_gateway
node_ios_transport -->|"sends requests"| node_gateway
node_gateway -->|"routes auth"| node_auth_service
node_gateway -->|"routes videos"| node_video_service
node_gateway -->|"routes purchases"| node_purchase_service
node_gateway -->|"routes playback"| node_streaming_service
node_gateway -.->|"checks sessions"| node_redis
node_auth_service -->|"stores accounts"| node_postgres
node_auth_service -->|"stores sessions"| node_redis
node_video_service -->|"reads catalog"| node_postgres
node_purchase_service -->|"creates intents"| node_stripe
node_purchase_service -->|"stores purchases"| node_postgres
node_streaming_service -->|"gets media URLs"| node_mux
node_webhook_service -->|"verifies + publishes<br/>provider events"| node_redis
node_stripe -->|"sends payment events"| node_webhook_service
node_mux -->|"sends asset events"| node_webhook_service
node_redis -->|"purchase:recorded / outbox"| node_purchase_service
node_purchase_service -.->|"subscribes to<br/>purchase events"| node_redis

click node_android_app "https://github.com/ogc16/streamz/blob/master/android/app/src/main/java/com/streamz/app/MainActivity.kt"
click node_ios_app "https://github.com/ogc16/streamz/blob/master/ios/Streamz/StreamzApp.swift"
click node_android_auth "https://github.com/ogc16/streamz/blob/master/android/app/src/main/java/com/streamz/app/ui/auth/AuthViewModel.kt"
click node_ios_auth "https://github.com/ogc16/streamz/blob/master/ios/Streamz/ViewModels/AuthViewModel.swift"
click node_android_tokens "https://github.com/ogc16/streamz/blob/master/android/app/src/main/java/com/streamz/app/data/local/TokenManager.kt"
click node_ios_keychain "https://github.com/ogc16/streamz/blob/master/ios/Streamz/Helpers/KeychainManager.swift"
click node_android_catalog "https://github.com/ogc16/streamz/blob/master/android/app/src/main/java/com/streamz/app/ui/home/HomeViewModel.kt"
click node_ios_catalog "https://github.com/ogc16/streamz/blob/master/ios/Streamz/ViewModels/HomeViewModel.swift"
click node_android_video_data "https://github.com/ogc16/streamz/blob/master/android/app/src/main/java/com/streamz/app/data/repository/VideoRepository.kt"
click node_ios_video_data "https://github.com/ogc16/streamz/blob/master/ios/Streamz/Services/VideoService.swift"
click node_purchase_ui "https://github.com/ogc16/streamz/blob/master/android/app/src/main/java/com/streamz/app/ui/purchase/PurchaseScreen.kt"
click node_purchase_data "https://github.com/ogc16/streamz/blob/master/android/app/src/main/java/com/streamz/app/data/repository/PurchaseRepository.kt"
click node_android_player "https://github.com/ogc16/streamz/blob/master/android/app/src/main/java/com/streamz/app/ui/player/PlayerScreen.kt"
click node_ios_player "https://github.com/ogc16/streamz/blob/master/ios/Streamz/Views/PlayerView.swift"
click node_android_transport "https://github.com/ogc16/streamz/blob/master/android/app/src/main/java/com/streamz/app/data/remote/ApiClient.kt"
click node_ios_transport "https://github.com/ogc16/streamz/blob/master/ios/Streamz/Services/APIClient.swift"
click node_gateway "https://github.com/ogc16/streamz/blob/master/backend/api-gateway/src/index.ts"
click node_auth_service "https://github.com/ogc16/streamz/blob/master/backend/services/auth/src/index.ts"
click node_video_service "https://github.com/ogc16/streamz/blob/master/backend/services/video/src/index.ts"
click node_purchase_service "https://github.com/ogc16/streamz/blob/master/backend/services/purchase/src/index.ts"
click node_streaming_service "https://github.com/ogc16/streamz/blob/master/backend/services/streaming/src/index.ts"
click node_webhook_service "https://github.com/ogc16/streamz/blob/master/backend/services/webhook/src/index.ts"

classDef toneNeutral fill:#f8fafc,stroke:#334155,stroke-width:1.5px,color:#0f172a
classDef toneBlue fill:#dbeafe,stroke:#2563eb,stroke-width:1.5px,color:#172554
classDef toneAmber fill:#fef3c7,stroke:#d97706,stroke-width:1.5px,color:#78350f
classDef toneMint fill:#dcfce7,stroke:#16a34a,stroke-width:1.5px,color:#14532d
classDef toneRose fill:#ffe4e6,stroke:#e11d48,stroke-width:1.5px,color:#881337
classDef toneIndigo fill:#e0e7ff,stroke:#4f46e5,stroke-width:1.5px,color:#312e81
classDef toneTeal fill:#ccfbf1,stroke:#0f766e,stroke-width:1.5px,color:#134e4a
class node_android_app,node_ios_app,node_android_auth,node_ios_auth,node_android_tokens,node_ios_keychain,node_android_catalog,node_ios_catalog,node_android_video_data,node_ios_video_data,node_purchase_ui,node_purchase_data,node_android_player,node_ios_player,node_android_transport,node_ios_transport,node_viewer toneBlue
class node_gateway toneAmber
class node_auth_service,node_video_service,node_purchase_service,node_streaming_service,node_webhook_service toneMint
class node_postgres,node_stripe,node_mux,node_redis toneRose
```

## 4 · Engineering Highlights & Security

### Engineering Highlights

- **One-command boot** — `npm run dev` starts all six microservices concurrently (auth, video, purchase, streaming, webhook, gateway) with color-coded logs; no per-service terminals.
- **Type-safe monorepo** — npm workspaces with shared types (`@streamz/shared`); `tsc` builds pass clean across every service and the gateway; ESLint enforced.
- **Idempotent webhooks** — Stripe payment events dedupe via `ON CONFLICT (stripe_payment_intent_id)`; safe to replay.
- **Cache invalidation** — purchase/webhook events bust the Redis-backed video & purchase caches immediately.
- **Access-aware API** — the video service hides purchase-gated content unless the viewer owns a valid rental/purchase.

### Security & Reliability

- **Client-side key storage**
  - *iOS:* tokens and credentials live in **Keychain Services** (`kSecClassGenericPassword`) via `KeychainManager.swift`.
  - *Android:* tokens are encrypted with an **Android Keystore** AES/GCM key (`AndroidKeyStore`, non-exportable) before persistence, via `TokenManager.kt`. `Access`/`refresh` values are never stored in plaintext.
- **Webhook verification**
  - *Stripe:* every `/webhooks/stripe` payload is verified with `stripe.webhooks.constructEvent` against `STRIPE_WEBHOOK_SECRET` (`stripe-signature` header).
  - *Mux:* every `/webhooks/mux` payload is verified with `mux.webhooks.verifySignature` against `MUX_WEBHOOK_SECRET` (`mux-signature` header).
  - Requests failing signature checks are rejected with `400` before any state is touched.
  - Webhook bodies are parsed with a prototype-pollution guard (`__proto__`/`constructor` keys stripped).
- **Rate limiting** — the API Gateway enforces an **IP-based** limiter (`express-rate-limit`, default key on client IP): 100 requests per 15-minute window, returning `429` beyond that.
- **JWT hardening** — all `jwt.verify` calls pin the algorithm (`algorithms: ['HS256']`) to block confusion attacks; access tokens are short-lived (15m) and refreshed tokens are rotated server-side.
- **Signed Mux playback (rental-aligned TTL)** — when `MUX_SIGNING_KEY` + `MUX_PRIVATE_KEY` are set, uploads use a **signed** playback policy and every playback/thumbnail URL carries a JWT whose expiry is `min(defaultTTL, remaining rental time)`, so a leaked `.m3u8` dies with the rental.
- **Timing-equalized login** — unknown emails run a dummy `bcrypt.compare` so response time doesn't reveal whether an account exists.
- **Parameterized SQL everywhere** — video search/genre/sort/filters use parameterized queries plus an allow-listed `sort` column and clamped `page`/`limit`; no client input reaches the SQL text.
- **Transactional outbox** — the purchase service writes the purchase row + an outbox entry (`events.outbox`) in **one DB transaction**, then publishes `purchase:recorded`; unpublished rows are replayed on startup. Exactly-once domain events with at-least-once delivery.
- **Connection pooling** — services are configured to route through **PgBouncer** (transaction pooling, `:6432`) in Docker to prevent connection exhaustion.
- **Correlation IDs** — shared `requestIdMiddleware` attaches/generates an `X-Request-ID` per request through gateway → services and prefixes all logs, so a payment flow is traceable end-to-end.
- **Checkout resilience** — after a successful Stripe PaymentSheet, mobile clients **poll** `GET /api/purchases/check/:videoId` until access is granted, so an interrupted webhook round-trip can't silently ghost an order.
- **Off-main thread playback** — Android fetches the playback URL on `Dispatchers.IO` and surfaces an explicit buffering spinner (ExoPlayer `STATE_BUFFERING`); AVPlayer/ExoPlayer render on their own media threads.

## 5 · Tech Stack Summary

**Backend:** Node.js 20+, Express 4, TypeScript, PostgreSQL, Redis (ioredis), Stripe, Mux, Zod

| Client | Stack | Architecture |
|--------|-------|--------------|
| iOS | Swift 5, SwiftUI, AVPlayer, StripePaymentSheet SDK | MVVM with `@MainActor` view models, async/await networking, Keychain token storage |
| Android | Kotlin, Jetpack Compose, Hilt, Retrofit, ExoPlayer, Stripe SDK | MVVM with `StateFlow`, Hilt DI, Repository pattern, Keystore-encrypted token storage |

## 6 · Getting Started & Environment Setup

### Prerequisites

- Node.js 20+
- Docker Desktop (PostgreSQL + Redis)
- Android Studio (for Android build)
- Xcode 15+ (for iOS build)
- Stripe account (API keys)
- Mux account (video streaming)

### One-Command Boot

```bash
# 1. Start infrastructure
cd backend
docker-compose up -d

# 2. Install all dependencies (uses npm workspaces)
npm install

# 3. Boot ALL microservices from the project root (single command)
npm run dev
```

`npm run dev` launches auth, video, purchase, streaming, webhook, and the API gateway together. Logs are prefixed and color-coded per service; if any process exits, the rest are stopped.

### Run Services Individually

```bash
npm run dev:gateway          # gateway only
npm run dev -w services/auth
npm run dev -w services/video
npm run dev -w services/purchase
npm run dev -w services/streaming
npm run dev -w services/webhook
```

### Environment Variables

Copy `backend/.env.example` to `backend/.env` and fill in your credentials:

```env
# Generate a strong random value (e.g. openssl rand -hex 32); compose requires it.
POSTGRES_PASSWORD=your-database-password
DATABASE_URL=postgresql://streamz:your-database-password@localhost:5432/streamz
JWT_SECRET=your-secret
JWT_REFRESH_SECRET=your-refresh-secret
JWT_EXPIRES_IN=7d
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_CURRENCY=usd
MUX_TOKEN_ID=your-mux-id
MUX_TOKEN_SECRET=your-mux-secret
MUX_WEBHOOK_SECRET=your-mux-signing-secret
# Signed playback (optional, enables Mux signing):
MUX_SIGNING_KEY=your-mux-signing-key-id
MUX_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----
PLAYBACK_TTL_SECONDS=3600
CORS_ORIGIN=*
```

> **Security:** `.env` files are git-ignored. Never commit secrets.

### Database Setup

```bash
cd backend
npm run migrate
```

The migration is idempotent — safe to run multiple times.

### Android Build

```bash
cd android
./gradlew assembleDebug
# APK output: app/build/outputs/apk/debug/app-debug.apk
```

### iOS Build

1. Open `ios/Streamz/` in Xcode
2. Add Stripe package dependency: `https://github.com/stripe/stripe-ios` (latest major version)
3. Replace `stripe-key-pls-set-in-info-plist` in `StreamzApp.swift` with your Stripe publishable key
4. Build & run (⌘R)

## 7 · Payment & Webhook Logic

### Payment Flow

1. User browses catalog → selects a video
2. Chooses **Buy** (permanent) or **Rent** (time-limited)
3. Backend validates purchase type against video's supported types
4. Backend creates a Stripe PaymentIntent → returns `client_secret`
5. Mobile app presents Stripe PaymentSheet → user pays
6. Stripe webhook confirms → purchase recorded in DB (idempotent via `ON CONFLICT`) → access granted
7. User streams video via Mux HLS URL

### Webhook Handling

| Webhook | Payload | Validation | Effect |
|---------|---------|------------|--------|
| `POST /webhooks/stripe` | Stripe events (`payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`) | `stripe-signature` via `STRIPE_WEBHOOK_SECRET` | Publishes `purchase:completed` / `purchase:refunded` on Redis |
| `POST /webhooks/mux` | Mux events (`video.upload.asset_created`, `video.asset.ready`, `video.asset.errored`) | `mux-signature` via `MUX_WEBHOOK_SECRET` | Publishes `video:asset_created` / `video:asset.ready` on Redis |
| `POST /webhooks/cleanup-expired` | — (internal/scheduler) | — | Publishes `rental:cleanup` |

The webhook service is a **signature-verified event publisher** — it never touches the database. The **purchase service** consumes `purchase:completed`, records the purchase + a transactional outbox row (`purchase:recorded`) in one commit, then replays any unpublished outbox on startup.

### Local Webhook Testing

Sign and push synthetic provider events without real Stripe/Mux infrastructure:

```bash
# Boot the stack, then in another terminal:
npm run mock:webhook -- --provider stripe --event payment_intent.succeeded --secret whsec_xxx
npm run mock:webhook -- --provider mux --event video.asset.ready --secret mux_secret
npm run mock:webhook -- --provider stripe --event charge.refunded --secret whsec_xxx --print   # print only
```

The harness signs `t=<ts>,v1=<hmac-sha256>` exactly like the providers. `--params` lets you override event data (e.g. the userId/videoId).

## 8 · API Specifications & Payloads

All routes are proxied through the gateway at `http://localhost:3000`. Payloads are JSON.

### Auth

- `POST /api/auth/register` — `{ email, password, name }`
- `POST /api/auth/login` — `{ email, password }`
- `POST /api/auth/refresh` — `{ refreshToken }`
- `POST /api/auth/logout` — `Authorization: Bearer <token>`
- `GET /api/auth/me` — Current user info

### Videos

- `GET /api/videos` — List with filters (genre, search, page, limit, sort)
- `GET /api/videos/featured` — Featured videos
- `GET /api/videos/genres` — Genre list with counts
- `GET /api/videos/:id` — Video detail + purchase status
- `POST /api/videos` — Create video (admin)

### Purchases

- `GET /api/purchases` — User's purchase history
- `GET /api/purchases/check/:videoId` — Access check

#### `POST /api/purchases/create-payment-intent`

Creates a Stripe PaymentIntent for a video. The access entitlement is granted only after the `payment_intent.succeeded` webhook arrives.

- Request (`Authorization: Bearer <token>`):

```json
{ "videoId": "vid_123", "type": "RENTAL" }
```

- Response (`200 OK`):

```json
{
  "clientSecret": "pi_3MtwB2LkdIwXvc3w1_secret_AbC123XYZ",
  "amount": 499
}
```

> `amount` is in minor units (cents) of `STRIPE_CURRENCY` (default `usd`).
> Errors: `404` unknown video · `400` unsupported purchase type / no payment profile · `409` already purchased.

### Streaming

- `GET /api/stream/playback/:playbackId` — Playback URL, optionally **signed** when Mux signing is configured. Requires an active purchase on the video; the returned token expires in `min(PLAYBACK_TTL_SECONDS, remaining rental time)` — clients should re-fetch this endpoint when it expires. Response includes `expiresInSeconds` and `signed`.

#### `POST /api/stream/upload-url`

- Request (`Authorization: Bearer <token>`):

```json
{ "videoId": "vid_123" }
```

- Response (`200 OK`):

```json
{
  "uploadUrl": "https://up.mux.com/ZifJCp1ECBeiJ4IOxsAYlgOPJKkq3UyJoN01qubtJ4rgk",
  "uploadId": "CfO100Wm022gJd04AMh2uPvKCagHI01w5EnVqOjDVO800"
}
```

- `POST /api/stream/upload-complete` — Finalize upload (looks up video by upload ID)
- `POST /api/stream/thumbnail/:playbackId` — Generate thumbnail

### Webhooks

- `POST /webhooks/stripe` — Stripe event handling (idempotent via `ON CONFLICT`)
- `POST /webhooks/mux` — Mux asset processing events
- `POST /webhooks/cleanup-expired` — Expired rental cleanup

### Database Schema

Three service-specific schemas in PostgreSQL:

- `auth_service.users` — User accounts, Stripe customer IDs
- `video_service.videos` — Video metadata, Mux asset/playback IDs (nullable before upload)
- `purchase_service.purchases` — Payment records, rental expiry (idempotent on `stripe_payment_intent_id`)
- `auth_tokens.refresh_tokens` — Token rotation
- `events.outbox` — Transactional outbox: domain events written atomically with their data, replayed on startup if unpublished

## 9 · Project Structure

```
streamz/
├── backend/
│   ├── api-gateway/        # Request routing, JWT validation, rate limiting
│   ├── migrations/         # SQL schema (idempotent, incl. events.outbox)
│   ├── integration-tests/  # Testcontainers integration tests (Docker required)
│   ├── scripts/            # Dev tooling (mock webhooks: `npm run mock:webhook`)
│   ├── pgbouncer.ini       # Connection pooler config (docker-compose)
│   ├── services/
│   │   ├── auth/           # Registration, login, tokens
│   │   ├── video/          # Catalog, search, access-aware listings
│   │   ├── purchase/       # Stripe PaymentIntent, purchase history, outbox publisher
│   │   ├── streaming/      # Mux uploads, signed HLS playback, thumbnails
│   │   └── webhook/        # Signature-verified Stripe + Mux event publisher
│   ├── shared/             # Shared types, schemas, events, tracing (@streamz/shared)
│   ├── Dockerfile
│   └── docker-compose.yml  # postgres, redis, pgbouncer + all services
├── helm/streamz/           # Kubernetes Helm chart (services, postgres, redis, ingress)
├── k8s/README.md           # Build/push images + install instructions
├── ios/Streamz/
│   ├── Models/             # Video, User, Purchase
│   ├── Services/           # APIClient, AuthService, VideoService, etc.
│   ├── ViewModels/         # AuthViewModel, HomeViewModel, etc.
│   ├── Views/              # SwiftUI views
│   └── Helpers/            # KeychainManager, StripeManager
├── android/                # Jetpack Compose Android app
├── index.html              # Interactive HTML prototype
├── .gitignore
├── WALKTHROUGH.md          # Detailed change log
└── README.md
```

## 10 · Testing

Requires Docker Desktop (Testcontainers spins up real PostgreSQL and Redis).

```bash
cd backend
npm install          # installs the integration-tests workspace too
npm test -w integration-tests
```

The suite covers:

- **Migrations** — applies every SQL migration in order against a fresh Postgres and asserts the expected schemas (`auth_service`, `video_service`, `purchase_service`) and tables (`events.outbox`) exist.
- **Webhook → purchase pipeline** — spins up webhook + purchase services against containerized Postgres/Redis, posts a **signed** `payment_intent.succeeded`, and asserts the purchase row is recorded and the `purchase:recorded` outbox row is published; verifies a forged signature is rejected with `400`.

Webhook payloads can also be rehearsed by hand with the mock harness — see [Local Webhook Testing](#local-webhook-testing).

## 11 · Deployment

### Docker Compose (local / single VM)

```bash
cd backend
docker-compose up -d --build
```

Compose runs PostgreSQL, Redis, **PgBouncer** (transaction pool on `:6432`), and all six services. Point services at infrastructure via `backend/.env` (see [Environment Variables](#environment-variables)).

### Kubernetes (Helm chart)

`helm/streamz/` is a parameterized chart for the same stack (six services + Postgres + Redis + ingress). Chart values control image registry/tag, secrets, replicas, and resource limits.

```bash
# build + push per-service images (multi-stage Dockerfile, target = service name)
docker build --target auth -t <registry>/streamz-auth:tag backend/
# ...repeat for video, purchase, streaming, webhook, gateway

helm template streamz ./helm/streamz --set registry=<registry>,imageTag=tag  # dry-run
helm install streamz ./helm/streamz --set registry=<registry>,imageTag=tag
```

See [`k8s/README.md`](./k8s/README.md) for the full build/install/scale runbook.

### Secrets

Never commit real credentials. Compose reads `backend/.env`; the Helm chart takes secrets via values/lookup and injects them as a Kubernetes `Secret`.

## 12 · Contributing & Community

**Streamz welcomes everyone** — first-time open-source contributors and seasoned maintainers alike. We want this repo to be a place where people from any background feel able to contribute code, docs, tests, designs, translations, or ideas.

- **Get started:** read [CONTRIBUTING.md](./CONTRIBUTING.md) — it has a step-by-step onboarding path, from "install the project" to "open your first PR".
- **Code of conduct:** all participants agree to the [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md). Be excellent to each other.
- **Good first issues:** look for the `good-first-issue` and `help-wanted` labels; anything tagged `documentation` rarely needs more than `README` courage.
- **Just want to discuss?** Open a GitHub Discussion or file an issue on [github.com/ogc16/streamz](https://github.com/ogc16/streamz) — questions are welcome, not just bug reports.
- **Contributor recognition:** contributors who land changes are thanked in the release notes and acknowledged in the project docs.

## License

[MIT](./LICENSE) — Copyright (c) 2026 Streamz contributors.