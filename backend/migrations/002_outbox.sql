-- Transactional outbox for exactly-once domain event publication.
-- Services write the domain row AND an outbox entry in the same PG
-- transaction, then a publisher relays the outbox to Redis. Any entry
-- left unpublished is replayed on service startup (at-least-once with
-- idempotent consumers).

CREATE SCHEMA IF NOT EXISTS events;

CREATE TABLE IF NOT EXISTS events.outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_outbox_unpublished
  ON events.outbox (published_at)
  WHERE published_at IS NULL;