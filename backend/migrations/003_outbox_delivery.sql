-- Outbox delivery hardening: bounded delivery attempts with dead-letter.
-- - deliveries: number of delivery attempts (informational; rows at the cap are dead-lettered)
-- - failed_at  : set when a row exhausts attempts -> it is dead-lettered and never replayed
-- - last_error : last failure message (DLQ forensics)

ALTER TABLE events.outbox
  ADD COLUMN IF NOT EXISTS deliveries INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error TEXT;

-- Pending dispatch = unpublished, not dead-lettered, attempts remaining.
CREATE INDEX IF NOT EXISTS idx_outbox_pending
  ON events.outbox (created_at)
  WHERE published_at IS NULL AND failed_at IS NULL;