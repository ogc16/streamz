# Streamz — Pay-Per-View Video Streaming

> Netflix/Hulu-style pay-per-view video streaming: native iOS (SwiftUI) and Android (Jetpack Compose) clients backed by a Node.js microservices monorepo with PostgreSQL, Redis, Stripe, and Mux.

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
node_webhook_service -->|"caches / publishes"| node_redis
node_stripe -->|"sends payment events"| node_webhook_service
node_mux -->|"sends asset events"| node_webhook_service
node_webhook_service -->|"records events"| node_postgres
node_webhook_service -->|"updates assets"| node_video_service

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
- **Rate limiting** — the API Gateway enforces an **IP-based** limiter (`express-rate-limit`, default key on client IP): 100 requests per 15-minute window, returning `429` beyond that.
- **JWT rotation** — short-lived access tokens with refresh tokens stored server-side and rotated on refresh.

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
DATABASE_URL=postgresql://postgres:password@localhost:5432/streamz
JWT_SECRET=your-secret
JWT_REFRESH_SECRET=your-refresh-secret
JWT_EXPIRES_IN=7d
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_CURRENCY=usd
MUX_TOKEN_ID=your-mux-id
MUX_TOKEN_SECRET=your-mux-secret
MUX_WEBHOOK_SECRET=your-mux-signing-secret
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
3. Replace `pk_test_placeholder` in `StreamzApp.swift` with your Stripe publishable key
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
| `POST /webhooks/stripe` | Stripe events (`payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`) | `stripe-signature` via `STRIPE_WEBHOOK_SECRET` | Records purchase (idempotent), invalidates cache, publishes `purchase:completed` on Redis |
| `POST /webhooks/mux` | Mux events (`video.upload.asset_created`, `video.asset.ready`, `video.asset.errored`) | `mux-signature` via `MUX_WEBHOOK_SECRET` | Links asset ID, sets playback ID + thumbnail + duration |
| `POST /webhooks/cleanup-expired` | — (internal/scheduler) | — | Marks expired rentals as `expired` |

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

- `GET /api/stream/playback/:playbackId` — Signed playback URL

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

## 9 · Project Structure

```
streamz/
├── backend/
│   ├── api-gateway/        # Request routing, JWT validation, rate limiting
│   ├── migrations/         # SQL schema (idempotent)
│   ├── services/
│   │   ├── auth/           # Registration, login, tokens
│   │   ├── video/          # Catalog, search, access-aware listings
│   │   ├── purchase/       # Stripe PaymentIntent, purchase history
│   │   ├── streaming/      # Mux uploads, HLS playback
│   │   └── webhook/        # Stripe + Mux webhook handlers (signature-verified)
│   ├── shared/             # Shared types, schemas, errors (@streamz/shared)
│   ├── Dockerfile
│   └── docker-compose.yml
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

## License

Private — All rights reserved.