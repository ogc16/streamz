-- Streamz Database Schema
-- Each service uses a separate schema for data isolation

-- Auth Service Schema
CREATE SCHEMA IF NOT EXISTS auth_service;

CREATE TABLE IF NOT EXISTS auth_service.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    stripe_customer_id VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON auth_service.users(email);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON auth_service.users(stripe_customer_id);

-- Video Service Schema
CREATE SCHEMA IF NOT EXISTS video_service;

CREATE TABLE IF NOT EXISTS video_service.videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    thumbnail_url VARCHAR(500),
    mux_upload_id VARCHAR(255) UNIQUE,
    mux_asset_id VARCHAR(255) UNIQUE,
    mux_playback_id VARCHAR(255) UNIQUE,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    rental_price_cents INTEGER CHECK (rental_price_cents >= 0),
    rental_duration_hours INTEGER CHECK (rental_duration_hours > 0),
    genre VARCHAR(50) NOT NULL,
    release_year INTEGER NOT NULL CHECK (release_year >= 1900 AND release_year <= 2030),
    rating VARCHAR(10) NOT NULL,
    featured BOOLEAN NOT NULL DEFAULT FALSE,
    purchase_type VARCHAR(10) NOT NULL CHECK (purchase_type IN ('buy', 'rent', 'both')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_videos_genre ON video_service.videos(genre);
CREATE INDEX IF NOT EXISTS idx_videos_featured ON video_service.videos(featured) WHERE featured = TRUE;
CREATE INDEX IF NOT EXISTS idx_videos_release_year ON video_service.videos(release_year DESC);
CREATE INDEX IF NOT EXISTS idx_videos_created_at ON video_service.videos(created_at DESC);

-- Purchase Service Schema
CREATE SCHEMA IF NOT EXISTS purchase_service;

CREATE TABLE IF NOT EXISTS purchase_service.purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    video_id UUID NOT NULL,
    stripe_payment_intent_id VARCHAR(255) NOT NULL UNIQUE,
    type VARCHAR(10) NOT NULL CHECK (type IN ('buy', 'rent')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'refunded', 'expired')),
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (user_id) REFERENCES auth_service.users(id),
    FOREIGN KEY (video_id) REFERENCES video_service.videos(id)
);

CREATE INDEX IF NOT EXISTS idx_purchases_user ON purchase_service.purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_purchases_video ON purchase_service.purchases(video_id);
CREATE INDEX IF NOT EXISTS idx_purchases_user_video ON purchase_service.purchases(user_id, video_id);
CREATE INDEX IF NOT EXISTS idx_purchases_status ON purchase_service.purchases(status);
CREATE INDEX IF NOT EXISTS idx_purchases_expires ON purchase_service.purchases(expires_at) WHERE expires_at IS NOT NULL;

-- Refresh Token Schema (for token rotation)
CREATE SCHEMA IF NOT EXISTS auth_tokens;

CREATE TABLE IF NOT EXISTS auth_tokens.refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked BOOLEAN NOT NULL DEFAULT FALSE,
    FOREIGN KEY (user_id) REFERENCES auth_service.users(id)
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON auth_tokens.refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON auth_tokens.refresh_tokens(user_id);
