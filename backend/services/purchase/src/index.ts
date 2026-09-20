import express from 'express'
import cors from 'cors'
import { Pool } from 'pg'
import jwt from 'jsonwebtoken'
import Stripe from 'stripe'
import { Redis } from 'ioredis'
import {
  JWTPayload,
  StripeMetadata,
  PurchaseDTO,
  paymentIntentSchema,
  EVENTS,
  PurchaseCompletedEvent,
  PurchaseRecordedEvent,
  PurchaseRefundedEvent,
  requestIdMiddleware,
  tracer,
  applySecurity,
  secureJsonParser,
  healthRouter,
  gracefulShutdown,
  initLogging,
  initTelemetry,
  MetricsRegistry,
  metricsHandler,
  httpMetricsMiddleware,
  withRetry,
  vendorRetryable,
  CircuitBreaker,
  loadEnv,
} from '@streamz/shared'

loadEnv()

initLogging('purchase')
initTelemetry('purchase')

const app = express()
const PORT = process.env.PURCHASE_SERVICE_PORT || 4003

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
})
pool.on('error', (err: Error) => tracer.error(undefined, 'Postgres pool error', err.message))

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-02-24.acacia',
})

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
})
redis.on('error', (err: Error) => tracer.error(undefined, 'Redis error', err.message))

const redisSub = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
})
redisSub.on('error', (err: Error) => tracer.error(undefined, 'Redis subscriber error', err.message))

applySecurity(app)
app.use(cors())
app.use(secureJsonParser({ limit: '256kb' }))
app.use(requestIdMiddleware())

const registry = new MetricsRegistry()
app.use(httpMetricsMiddleware(registry, 'purchase'))
app.get('/metrics', metricsHandler(registry))

const outboxDelivery = registry.counter('streamz_outbox_delivery_total', 'Outbox delivery attempts by outcome', ['status'])
const outboxDeadLetter = registry.counter('streamz_outbox_dead_lettered_total', 'Outbox entries permanently failed after max attempts')
const outboxLatency = registry.histogram(
  'streamz_outbox_delivery_latency_seconds',
  'Outbox publish latency (flush-claim to published_at)',
  ['status'],
  [0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]
)
const paymentIntents = registry.counter('streamz_payment_intents_total', 'Stripe payment intent creation attempts by result', ['result'])

const stripeBreaker = new CircuitBreaker('stripe:paymentIntents.create', { registry })

// Outbox flush bounds: at most FLUSH_BATCH_SIZE rows per pass, FLUSH_MAX_PASSES
// passes per tick, FLUSH_CONCURRENCY in-flight, FLUSH_INTERVAL_MS apart. A fast
// producer thus backpressures on a bounded buffer instead of unbounded queue growth.
const OUTBOX_FLUSH_INTERVAL_MS = 15_000
const OUTBOX_FLUSH_BATCH_SIZE = 100
const OUTBOX_FLUSH_MAX_PASSES = 10
const OUTBOX_FLUSH_CONCURRENCY = 8
const OUTBOX_MAX_DELIVERIES = 5

interface OutboxRow {
  id: string
  channel: string
  payload: string
  deliveries: number
}

app.use(
  healthRouter('purchase', [
    {
      name: 'postgres',
      check: async () => {
        await pool.query('SELECT 1')
      },
    },
    {
      name: 'redis',
      check: async () => {
        await redis.ping()
      },
    },
  ])
)

async function deliverOutboxRow(row: OutboxRow): Promise<'published' | 'dead-lettered' | 'retryable-failed'> {
  // Claim one bounded delivery attempt. Rows at the cap are skipped and dead-lettered.
  const claimed = await pool.query<{ id: string; deliveries: number }>(
    `UPDATE events.outbox SET deliveries = deliveries + 1
     WHERE id = $1 AND published_at IS NULL AND failed_at IS NULL AND deliveries < $2
     RETURNING id, deliveries`,
    [row.id, OUTBOX_MAX_DELIVERIES]
  )
  if (claimed.rows.length === 0) {
    return 'dead-lettered'
  }

  try {
    const publishStart = Date.now()
    await withRetry(
      async () => {
        // row.payload is a raw JSONB string; publish it verbatim (no re-stringify).
        await redis.publish(row.channel, row.payload)
        await pool.query(
          `UPDATE events.outbox SET published_at = NOW() WHERE id = $1`,
          [row.id]
        )
      },
      { attempts: 3, baseDelayMs: 100, label: `outbox publish ${row.channel}` }
    )
    outboxLatency.observe({ status: 'published' }, (Date.now() - publishStart) / 1000)
    tracer.info(undefined, `Dispatched outbox entry ${row.id} on ${row.channel}`)
    return 'published'
  } catch (error) {
    const lastError = (error as Error)?.message || String(error)
    if (claimed.rows[0].deliveries >= OUTBOX_MAX_DELIVERIES) {
      await pool.query(
        `UPDATE events.outbox SET failed_at = NOW(), last_error = $2 WHERE id = $1`,
        [row.id, lastError]
      )
      outboxDeadLetter.inc()
      tracer.error(undefined, `Outbox entry ${row.id} dead-lettered after ${OUTBOX_MAX_DELIVERIES} attempts:`, lastError)
      return 'dead-lettered'
    }
    tracer.warn(undefined, `Outbox entry ${row.id} failed (delivery ${claimed.rows[0].deliveries}/${OUTBOX_MAX_DELIVERIES}), will retry:`, lastError)
    return 'retryable-failed'
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const idx = next++
      results[idx] = await fn(items[idx])
    }
  })
  await Promise.all(workers)
  return results
}

// Bounded batch flush: pending rows (unpublished, not dead-lettered, attempts
// remaining) are processed in batches of OUTBOX_FLUSH_BATCH_SIZE with at most
// OUTBOX_FLUSH_CONCURRENCY in flight, so memory stays bounded under a flood.
async function flushOutboxBatch(): Promise<number> {
  const pending = await pool.query<OutboxRow>(
    `SELECT id, channel, payload, deliveries FROM events.outbox
     WHERE published_at IS NULL AND failed_at IS NULL
       AND deliveries < $1
     ORDER BY created_at ASC
     LIMIT $2`,
    [OUTBOX_MAX_DELIVERIES, OUTBOX_FLUSH_BATCH_SIZE]
  )
  await mapLimit(pending.rows, OUTBOX_FLUSH_CONCURRENCY, async (row) => {
    const outcome = await deliverOutboxRow(row)
    outboxDelivery.inc({ status: outcome })
  })
  return pending.rows.length
}

let flushing = false
async function flushOutboxLoop(): Promise<void> {
  if (flushing) return
  flushing = true
  try {
    for (let pass = 0; pass < OUTBOX_FLUSH_MAX_PASSES; pass++) {
      const processed = await flushOutboxBatch()
      if (processed < OUTBOX_FLUSH_BATCH_SIZE) break
    }
    // Sweep: surface rows that exhausted attempts without ever being marked
    // (e.g. raced by another replica) so they stop silently accumulating.
    const swept = await pool.query(
      `UPDATE events.outbox SET failed_at = NOW(),
              last_error = COALESCE(last_error, 'exceeded delivery attempts')
       WHERE published_at IS NULL AND failed_at IS NULL AND deliveries >= $1
       RETURNING id`,
      [OUTBOX_MAX_DELIVERIES]
    )
    if (swept.rowCount) {
      outboxDeadLetter.inc(undefined, swept.rowCount)
      tracer.error(undefined, `Dead-lettered ${swept.rowCount} outbox entr(ies) that exceeded attempts`)
    }
  } catch (error) {
    tracer.error(undefined, 'Outbox flush failed:', error)
  } finally {
    flushing = false
  }
}

redisSub.on('message', async (channel, message) => {
  try {
    switch (channel) {
      case EVENTS.PURCHASE_COMPLETED: {
        const event = JSON.parse(message) as PurchaseCompletedEvent
        const outboxPayload: PurchaseRecordedEvent = {
          ...event,
          recordedAt: new Date().toISOString(),
        }
        const client = await pool.connect()
        try {
          await withRetry(
            async () => {
              await client.query('BEGIN')
              await client.query(
                `INSERT INTO purchase_service.purchases
                 (user_id, video_id, stripe_payment_intent_id, type, amount_cents, status, expires_at)
                 VALUES ($1, $2, $3, $4, $5, 'completed', $6)
                 ON CONFLICT (stripe_payment_intent_id) DO NOTHING`,
                [
                  event.userId,
                  event.videoId,
                  event.paymentIntentId,
                  event.purchaseType,
                  event.amountCents,
                  event.expiresAt,
                ]
              )
              const outbox = await client.query(
                `INSERT INTO events.outbox (channel, payload)
                 VALUES ($1, $2)
                 RETURNING id`,
                [EVENTS.PURCHASE_RECORDED, JSON.stringify(outboxPayload)]
              )
              await client.query('COMMIT')
              return outbox
            },
            {
              attempts: 3,
              baseDelayMs: 150,
              maxDelayMs: 1500,
              label: `purchase+outbox tx ${event.paymentIntentId}`,
            }
          ).then((outbox) => {
            const outboxId = outbox.rows[0].id
            const payload = JSON.stringify(outboxPayload)
            // Best-effort immediate publish (keeps the common path low-latency);
            // on failure the continuous flush loop retries with bounded attempts
            // and dead-letters the row after OUTBOX_MAX_DELIVERIES.
            const publishStart = Date.now()
            return withRetry(
              () => redis.publish(EVENTS.PURCHASE_RECORDED, payload),
              { attempts: 3, baseDelayMs: 100, label: `outbox publish ${outboxId}` }
            )
              .then(() => pool.query(
                `UPDATE events.outbox SET published_at = NOW() WHERE id = $1`,
                [outboxId]
              ))
              .then(() => outboxLatency.observe({ status: 'published' }, (Date.now() - publishStart) / 1000))
              .catch((error) => {
                tracer.warn(undefined, `Immediate outbox publish ${outboxId} failed; flush loop will retry:`, (error as Error)?.message)
              })
          })
        } catch (txError) {
          try {
            await client.query('ROLLBACK')
          } catch {
            // connection may be unusable after the failure; original error wins
          }
          throw txError
        } finally {
          client.release()
        }
        await redis.del(`purchases:${event.userId}`)
        await redis.del(`videos:list:${event.userId}`)
        await redis.del(`videos:featured:${event.userId}`)
        tracer.info(undefined, 'Purchase recorded from event:', event.paymentIntentId)
        break
      }

      case EVENTS.PURCHASE_REFUNDED: {
        const event = JSON.parse(message) as PurchaseRefundedEvent
        await pool.query(
          `UPDATE purchase_service.purchases
           SET status = 'refunded', updated_at = NOW()
           WHERE stripe_payment_intent_id = $1`,
          [event.paymentIntentId]
        )
        tracer.info(undefined, 'Purchase refunded from event:', event.paymentIntentId)
        break
      }

      case EVENTS.RENTAL_CLEANUP: {
        const result = await pool.query(
          `UPDATE purchase_service.purchases
           SET status = 'expired', updated_at = NOW()
           WHERE type = 'rent' AND status = 'completed'
           AND expires_at IS NOT NULL AND expires_at < NOW()
           RETURNING id`
        )
        tracer.info(undefined, 'Rental cleanup expired:', result.rowCount, 'purchase(s)')
        break
      }
    }
  } catch (error) {
    tracer.error(undefined, `Error handling event on channel ${channel}:`, error)
  }
})

redisSub.subscribe(EVENTS.PURCHASE_COMPLETED, EVENTS.PURCHASE_REFUNDED, EVENTS.RENTAL_CLEANUP)

function authMiddleware(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization
  if (!authHeader) {
    return res.status(401).json({ error: 'No token provided' })
  }
  try {
    const token = authHeader.split(' ')[1]
    const decoded = jwt.verify(token, process.env.JWT_SECRET!, {
      algorithms: ['HS256'],
    }) as JWTPayload
    req.user = decoded
    next()
  } catch {
    res.status(401).json({ error: 'Invalid token' })
  }
}

function purchaseToDTO(p: any): PurchaseDTO {
  return {
    id: p.id,
    userId: p.user_id,
    videoId: p.video_id,
    type: p.type,
    amountCents: p.amount_cents,
    status: p.status,
    expiresAt: p.expires_at ? p.expires_at.toISOString() : null,
    createdAt: p.created_at.toISOString(),
  }
}

app.post('/api/purchases/create-payment-intent', authMiddleware, async (req, res) => {
  try {
    const { videoId, type } = paymentIntentSchema.parse(req.body)
    const userId = req.user!.userId

    const videoResult = await pool.query(
      'SELECT * FROM video_service.videos WHERE id = $1',
      [videoId]
    )

    if (videoResult.rows.length === 0) {
      return res.status(404).json({ error: 'Video not found' })
    }

    const video = videoResult.rows[0]

    // Validate purchase type against video's supported purchase types
    if (video.purchase_type !== 'both' && video.purchase_type !== type) {
      return res.status(400).json({
        error: `This video is only available for ${video.purchase_type === 'buy' ? 'purchase' : 'rental'}`
      })
    }

    const priceCents = type === 'rent'
      ? (video.rental_price_cents || video.price_cents)
      : video.price_cents

    // Check for existing valid purchase
    const existing = await pool.query(
      `SELECT id, status FROM purchase_service.purchases
       WHERE user_id = $1 AND video_id = $2 AND status = 'completed'
       AND (expires_at IS NULL OR expires_at > NOW())
       LIMIT 1`,
      [userId, videoId]
    )

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Already purchased', purchaseId: existing.rows[0].id })
    }

    // Get user's Stripe customer ID
    const userResult = await pool.query(
      'SELECT stripe_customer_id FROM auth_service.users WHERE id = $1',
      [userId]
    )

    const stripeCustomerId = userResult.rows[0]?.stripe_customer_id
    if (!stripeCustomerId) {
      return res.status(400).json({ error: 'User has no payment profile' })
    }

    const metadata: StripeMetadata = {
      userId,
      videoId,
      purchaseType: type,
    }

    if (type === 'rent' && video.rental_duration_hours) {
      metadata.rentalHours = String(video.rental_duration_hours)
    }

    let paymentIntent
    try {
      // Retry vendor 429/5xx inside a circuit breaker so a degraded Stripe fails
      // fast instead of letting every concurrent checkout pile up on it.
      paymentIntent = await stripeBreaker.execute(() =>
        withRetry(
          () => stripe.paymentIntents.create({
            amount: priceCents,
            currency: (process.env.STRIPE_CURRENCY || 'usd').toLowerCase(),
            customer: stripeCustomerId,
            metadata: metadata as any,
            description: `${type === 'rent' ? 'Rent' : 'Buy'}: ${video.title}`,
            automatic_payment_methods: {
              enabled: true,
            },
          }),
          { attempts: 3, baseDelayMs: 200, maxDelayMs: 1200, retryable: vendorRetryable, label: 'stripe paymentIntents.create' }
        )
      )
      paymentIntents.inc({ result: 'success' })
    } catch (error) {
      paymentIntents.inc({ result: 'failure' })
      throw error
    }

    res.json({
      clientSecret: paymentIntent.client_secret,
      amount: priceCents,
    })
  } catch (error) {
    tracer.error(req.requestId, 'Error creating payment intent:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.get('/api/purchases', authMiddleware, async (req, res) => {
  try {
    const userId = req.user!.userId

    const result = await pool.query(
      `SELECT p.*, v.title, v.thumbnail_url, v.mux_playback_id, v.duration_seconds
       FROM purchase_service.purchases p
       JOIN video_service.videos v ON p.video_id = v.id
       WHERE p.user_id = $1 AND p.status = 'completed'
       AND (p.expires_at IS NULL OR p.expires_at > NOW())
       ORDER BY p.created_at DESC`,
      [userId]
    )

    res.json(result.rows.map((row: any) => ({
      purchase: purchaseToDTO(row),
      video: {
        title: row.title,
        thumbnailUrl: row.thumbnail_url,
        playbackId: row.mux_playback_id,
        durationSeconds: row.duration_seconds,
      },
    })))
  } catch (error) {
    tracer.error(req.requestId, 'Error fetching purchases:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.get('/api/purchases/check/:videoId', authMiddleware, async (req, res) => {
  try {
    const { videoId } = req.params
    const userId = req.user!.userId

    const result = await pool.query(
      `SELECT type, status, expires_at FROM purchase_service.purchases
       WHERE user_id = $1 AND video_id = $2 AND status = 'completed'
       AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at DESC LIMIT 1`,
      [userId, videoId]
    )

    if (result.rows.length === 0) {
      return res.json({ hasAccess: false })
    }

    const purchase = result.rows[0]
    res.json({
      hasAccess: true,
      type: purchase.type,
      expiresAt: purchase.expires_at?.toISOString() || null,
    })
  } catch (error) {
    tracer.error(req.requestId, 'Error checking purchase:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Continuous bounded outbox flush: an immediate pass on boot (replaces the old
// single boot-time replay) plus periodic passes. Non-overlapping via `flushing`.
flushOutboxLoop()
setInterval(flushOutboxLoop, OUTBOX_FLUSH_INTERVAL_MS).unref()

const server = app.listen(PORT, () => {
  tracer.info(undefined, `Purchase service running on port ${PORT}`)
})

gracefulShutdown({
  service: 'purchase',
  server,
  shutdown: async () => {
    await pool.end()
    await redis.quit()
    await redisSub.quit()
  },
})

export { pool, stripe }
