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

# Install all dependencies (uses npm workspaces)
npm install

# Run individual services
npm run dev -w services/auth
npm run dev -w services/video
npm run dev -w services/purchase
npm run dev -w services/streaming
npm run dev -w services/webhook
npm run dev -w api-gateway
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

## Payment Flow

1. User browses catalog → selects a video
2. Chooses **Buy** (permanent) or **Rent** (time-limited)
3. Backend validates purchase type against video's supported types
4. Backend creates a Stripe PaymentIntent → returns `client_secret`
5. Mobile app presents Stripe PaymentSheet → user pays
6. Stripe webhook confirms → purchase recorded in DB (idempotent via `ON CONFLICT`) → access granted
7. User streams video via Mux HLS URL

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
- `POST /api/videos` — Create video (admin)

### Purchases
- `POST /api/purchases/create-payment-intent` — `{ videoId, type }` (validates purchase type)
- `GET /api/purchases` — User's purchase history
- `GET /api/purchases/check/:videoId` — Access check

### Streaming
- `POST /api/stream/upload-url` — Create Mux upload URL for a video
- `POST /api/stream/upload-complete` — Finalize upload (looks up video by upload ID)
- `GET /api/stream/playback/:playbackId` — Signed playback URL
- `POST /api/stream/thumbnail/:playbackId` — Generate thumbnail

### Webhooks
- `POST /webhooks/stripe` — Stripe event handling (idempotent via `ON CONFLICT`)
- `POST /webhooks/mux` — Mux asset processing events
- `POST /webhooks/cleanup-expired` — Expired rental cleanup

## Database Schema

Three service-specific schemas in PostgreSQL:

- `auth_service.users` — User accounts, Stripe customer IDs
- `video_service.videos` — Video metadata, Mux asset/playback IDs (nullable before upload)
- `purchase_service.purchases` — Payment records, rental expiry (idempotent on `stripe_payment_intent_id`)
- `auth_tokens.refresh_tokens` — Token rotation

## Project Structure

```
streamz/
├── backend/
│   ├── api-gateway/        # Request routing, JWT validation
│   ├── migrations/         # SQL schema (idempotent)
│   ├── services/
│   │   ├── auth/           # Registration, login, tokens
│   │   ├── video/          # Catalog, search, access-aware listings
│   │   ├── purchase/       # Stripe PaymentIntent, purchase history
│   │   ├── streaming/      # Mux uploads, HLS playback
│   │   └── webhook/        # Stripe + Mux webhook handlers
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
├── .gitignore
├── WALKTHROUGH.md          # Detailed change log
└── README.md
```

## License

Private — All rights reserved.
