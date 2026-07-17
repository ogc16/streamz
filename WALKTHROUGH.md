# Streamz - Changes Walkthrough Report

**Date:** 2026-07-18  
**Scope:** iOS client fixes, backend service fixes, database schema updates, project configuration

---

## 1. iOS Client Fixes

### 1.1 `ios/Streamz/Models/Video.swift`

**Problem:** `Video` and `VideoDetailResponse` structs declared `rentalPriceCents: Int`, `rentalDurationHours: Int`, `thumbnailUrl: String`, `playbackId: String`, and `durationSeconds: Int` as non-optional. The backend API returns `null` for these fields (new videos lack Mux metadata; rental fields are nullable). JSON decoding crashes at runtime when encountering `null` into a non-optional Swift property.

**Fix:**
- Made `thumbnailUrl`, `playbackId`, `durationSeconds`, `rentalPriceCents`, `rentalDurationHours` optional (`?`) on both `Video` and `VideoDetailResponse`
- Added `priceDisplay`, `rentalPriceDisplay`, `durationDisplay` computed properties to `VideoDetailResponse` (previously only existed on `Video`)
- Updated `rentalPriceDisplay` and `durationDisplay` on `Video` to safely unwrap optionals with fallbacks

### 1.2 `ios/Streamz/StreamzApp.swift`

**Problem 1:** `hasCheckedAuth` was initialized to `true`, so the splash/loading screen was never displayed -- the app jumped straight to Login or Home before the auth check completed.

**Fix:** Changed `hasCheckedAuth` to `false` so the branded splash screen with `ProgressView` is shown during the async `checkAuth()` call.

**Problem 2:** Stripe SDK was never initialized with a publishable key, causing runtime failures when attempting to present `PaymentSheet`.

**Fix:** Added `import StripePaymentSheet` and `StripeAPI.defaultPublishableKey = "pk_test_placeholder"` in `StreamzApp.init()`. The placeholder must be replaced with the real test/live key.

### 1.3 `ios/Streamz/Services/APIClient.swift`

**Problem:** Token refresh used a bare `isRefreshing: Bool` flag + `refreshCompletionHandlers` array. Under Swift concurrency, multiple tasks could read `isRefreshing` as `false` simultaneously before any task sets it to `true`, causing parallel refresh requests and dangling continuations.

**Fix:** Replaced the boolean + handler array with a single `refreshTask: Task<String, Error>?`. When a refresh is in progress, subsequent callers `await` the same `Task.value` -- only one network request is made, and all callers receive the same result.

### 1.4 View Updates (`HomeView.swift`, `VideoDetailView.swift`, `ProfileView.swift`)

All views accessing the now-optional Video properties were updated:
- `video.thumbnailUrl` → `video.thumbnailUrl ?? ""`
- `video.rentalDurationHours` → `video.rentalDurationHours ?? 0`
- `item.video.playbackId` → guarded with `guard let` before passing to `getPlaybackUrl()`

---

## 2. Backend Service Fixes

### 2.1 `backend/services/video/src/index.ts`

**Problem 1 - Null Mux columns:** `videoToDTO()` passed `video.thumbnail_url` and `video.duration_seconds` directly. For newly created videos (before upload), these are `null`, causing the DTO to emit `null` where the `VideoDTO` type requires `string` and `number`.

**Fix:** Added fallback defaults: `video.thumbnail_url || 'https://image.mux.com/default/thumbnail.jpg'` and `video.duration_seconds || 0`.

**Problem 2 - Broken cache invalidation:** The `POST /api/videos` endpoint called `redis.del('videos:featured')` which only deletes the literal key `videos:featured`. Actual cached keys are user-scoped: `videos:featured:<userId>`, `videos:list:<userId>:<query>`. The invalidation silently deleted nothing.

**Fix:** Replaced `redis.del()` with `scanStream({ match: 'videos:*' })` + `redis.unlink()` to invalidate all video cache entries. Added `Array.isArray(keys)` guard for safety.

### 2.2 `backend/services/streaming/src/index.ts`

**Problem 1 - Untrusted videoId:** `POST /api/stream/upload-complete` accepted `videoId` from the client body. A malicious client could associate an upload with any video.

**Fix:** Server now looks up the video by `mux_upload_id` from the database (`SELECT id FROM video_service.videos WHERE mux_upload_id = $1`), ignoring the client-provided `videoId`.

**Problem 2 - `clearVideoCache` crash:** The `redis.del(...keys)` spread could fail on certain ioredis versions when `keys` was not a proper array.

**Fix:** Added `Array.isArray(keys)` guard and switched from `del` to `unlink` (non-blocking deletion).

### 2.3 `backend/services/webhook/src/index.ts`

**Problem 1 - Wrong Mux webhook field:** The `video.upload.asset_created` handler used `data.upload_id` to find the upload ID. In the Mux webhook payload, the upload ID is at `data.id`, not `data.upload_id`. The UPDATE query matched zero rows.

**Fix:** Changed `data.upload_id` → `data.id`.

**Problem 2 - `clearVideoCache` crash:** Same issue as streaming service.

**Fix:** Same fix: `Array.isArray(keys)` guard + `unlink`.

### 2.4 `backend/services/purchase/src/index.ts`

**Problem:** `POST /api/purchases/create-payment-intent` accepted any `type` value without validating it against the video's `purchase_type`. A client could request to rent a buy-only video, creating a PaymentIntent with incorrect pricing.

**Fix:** Added validation: if `video.purchase_type` is not `'both'` and doesn't match the requested `type`, returns `400` with a descriptive error.

---

## 3. Database Schema

### 3.1 `backend/migrations/001_initial_schema.sql`

**Change:** Made `thumbnail_url` nullable:
```sql
-- Before
thumbnail_url VARCHAR(500) NOT NULL,
-- After
thumbnail_url VARCHAR(500),
```

**Rationale:** Videos are created before upload/processing. The thumbnail is only known after Mux processes the asset. The `videoToDTO` function provides a fallback default.

**Idempotency:** All DDL statements use `IF NOT EXISTS` (`CREATE SCHEMA`, `CREATE TABLE`, `CREATE INDEX`), so the migration can be run repeatedly without errors.

**Existing constraints already support idempotency:**
- `stripe_payment_intent_id VARCHAR(255) NOT NULL UNIQUE` enables `ON CONFLICT (stripe_payment_intent_id) DO NOTHING` in the Stripe webhook handler
- `mux_upload_id VARCHAR(255) UNIQUE`, `mux_asset_id VARCHAR(255) UNIQUE`, `mux_playback_id VARCHAR(255) UNIQUE` prevent duplicate Mux associations

---

## 4. Project Configuration

### 4.1 `.gitignore`

Rewrote the root `.gitignore` with comprehensive coverage:

| Category | Patterns Added |
|---|---|
| **Secrets** | `.env`, `.env.*`, `*.pem`, `*.key`, `*.cert`, `*.p12`, `secrets.json`, `service-account*.json` |
| **Dependencies** | `node_modules/`, `.pnpm-store/` |
| **Build outputs** | `dist/`, `build/`, `*.tsbuildinfo` |
| **iOS** | `DerivedData/`, `xcuserdata/`, `Pods/`, `Podfile.lock` |
| **Android** | `.gradle/`, `local.properties`, `*.apk`, `*.aab`, `*.jks`, `*.keystore` |
| **Testing** | `coverage/`, `.nyc_output/` |
| **Misc** | `.turbo/`, `.DS_Store`, `Thumbs.db` |

**Note:** `backend/.env` contains real secrets (Stripe sk_test key, JWT secrets, Mux tokens). The `.gitignore` patterns cover it, but it should never have been committed.

### 4.2 `backend/package.json`

Added npm workspaces so `@streamz/shared` resolves locally:
```json
"workspaces": ["shared", "services/*", "api-gateway"]
```

---

## 5. Verification Results

### Migration Idempotency
All DDL uses `IF NOT EXISTS` -- safe to run repeatedly.

### TypeScript Compilation

| Service | Status | Notes |
|---|---|---|
| `api-gateway` | **Clean** | No errors |
| `video` | Pre-existing errors | `req.user` not typed on Express Request (all services share this) |
| `streaming` | Pre-existing errors | `Mux.Video`/`Mux.Asset` API changed in SDK v8 |
| `purchase` | Pre-existing errors | Stripe API version `2024-11-20.acacia` vs SDK expects `2025-02-24.acacia` |
| `webhook` | Pre-existing errors | Same Stripe version mismatch |
| `auth` | Pre-existing errors | Same Stripe version mismatch |

**None of the compilation errors are introduced by this changeset.** They are all pre-existing type issues:
- Express `Request.user` needs a module augmentation (`declare global { namespace Express { interface Request { user?: JWTPayload } } }`)
- Mux SDK v8 changed from `Video`/`Asset` properties to a different API shape
- Stripe SDK v17+ ships with newer API version types than what the code declares
