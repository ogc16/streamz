# Streamz — Pay-Per-View Video Streaming

A Netflix/Hulu-style pay-per-view video streaming app with native iOS (SwiftUI) and Android (Jetpack Compose) clients, powered by a Node.js microservices backend.

## Architecture

### Backend (Microservices)

| Service | Port | Description |
|---------|------|-------------|
| API Gateway | `3000` | Entry point, JWT validation, rate limiting, request routing |
| Auth Service | `4001` | User registration, login, JWT + refresh tokens |
| Video Service | `4002` | Catalog CRUD, search/filter/pagination, access-aware responses |
| Purchase Service | `4003` | Stripe PaymentIntent, access checks, purchase history |
| Streaming Service | `4004` | Mux upload URLs, HLS playback, thumbnail generation |
| Webhook Service | `4005` | Stripe payments, Mux asset events, rental expiry |

**Stack:** Node.js, Express, TypeScript, PostgreSQL, Redis, Stripe, Mux

### iOS App

**Stack:** Swift 5, SwiftUI, AVPlayer, StripePaymentSheet SDK

**Architecture:** MVVM with `@MainActor` view models, async/await networking, Keychain token storage

**Screens:** Login, Home (Netflix-style hero + grid), Video Detail, Player (HLS), Purchase (Stripe PaymentSheet), Profile

### Android App

**Stack:** Kotlin, Jetpack Compose, Hilt, Retrofit, ExoPlayer, Stripe SDK

**Architecture:** MVVM with `StateFlow`, Hilt DI, Repository pattern

**Screens:** Auth, Home (hero pager + grid), Detail, Player (HLS), Purchase (Stripe PaymentSheet), Profile

## Getting Started

### Prerequisites

- Node.js 20+
- Docker Desktop (PostgreSQL + Redis)
- Android Studio (for Android build)
- Xcode 15+ (for iOS build)
- Stripe account (API keys)
- Mux account (video streaming)

### Backend Setup

```bash
# Start infrastructure
cd backend
docker-compose up -d

# Install dependencies and run services
# Each service can be run independently:
cd services/auth && npm install && npm run dev
cd services/video && npm install && npm run dev
# ... etc, or use the API Gateway to route
cd api-gateway && npm install && npm run dev
```

### Environment Variables

Create a `.env` file in `backend/`:

```env
JWT_SECRET=your-secret
JWT_REFRESH_SECRET=your-refresh-secret
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
MUX_TOKEN_ID=your-mux-id
MUX_TOKEN_SECRET=your-mux-secret
```

### Android Build

```bash
cd android
./gradlew assembleDebug
# APK output: app/build/outputs/apk/debug/app-debug.apk
```

### iOS Build

Open `ios/Streamz/` in Xcode, add Stripe package dependency (`https://github.com/stripe/stripe-ios`), then build & run.

## Payment Flow

1. User browses catalog → selects a video
2. Chooses **Buy** (permanent) or **Rent** (time-limited)
3. Backend creates a Stripe PaymentIntent → returns `client_secret`
4. Mobile app presents Stripe PaymentSheet → user pays
5. Stripe webhook confirms → purchase recorded in DB → access granted
6. User streams video via Mux HLS URL

## API Endpoints

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

### Purchases
- `POST /api/purchases/create-payment-intent` — `{ videoId, type }`
- `GET /api/purchases` — User's purchase history
- `GET /api/purchases/check/:videoId` — Access check

### Streaming
- `GET /api/stream/playback/:playbackId` — Signed playback URL

### Webhooks
- `POST /webhooks/stripe` — Stripe event handling
- `POST /webhooks/mux` — Mux asset processing events
- `POST /webhooks/cleanup-expired` — Expired rental cleanup

## Database Schema

Three service-specific schemas in PostgreSQL:
- `auth_service.users` — User accounts, Stripe customer IDs
- `video_service.videos` — Video metadata, Mux asset/playback IDs
- `purchase_service.purchases` — Payment records, rental expiry
- `auth_tokens.refresh_tokens` — Token rotation
