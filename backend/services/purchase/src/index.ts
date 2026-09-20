import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
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
} from '@streamz/shared'

dotenv.config()

initLogging('purchase')
initTelemetry('purchase')

const app = express()
const PORT = process.env.PURCHASE_SERVICE_PORT || 4003

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
})

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-02-24.acacia',
})

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
})

const redisSub = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
})

applySecurity(app)
app.use(cors())
app.use(secureJsonParser({ limit: '256kb' }))
app.use(requestIdMiddleware())
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

async function publishOutboxRow(outboxId: string, channel: string, payload: object) {
  await redis.publish(channel, JSON.stringify(payload))
  await pool.query(
    `UPDATE events.outbox SET published_at = NOW() WHERE id = $1`,
    [outboxId]
  )
}

async function replayOutbox() {
  const result = await pool.query(
    `SELECT id, channel, payload FROM events.outbox
     WHERE published_at IS NULL ORDER BY created_at ASC`
  )
  for (const row of result.rows) {
    try {
      await publishOutboxRow(row.id, row.channel, row.payload)
      tracer.info(undefined, `Replayed outbox entry ${row.id} on ${row.channel}`)
    } catch (error) {
      tracer.error(undefined, `Failed to replay outbox entry ${row.id}:`, error)
    }
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
          await publishOutboxRow(outbox.rows[0].id, EVENTS.PURCHASE_RECORDED, outboxPayload)
        } catch (txError) {
          await client.query('ROLLBACK')
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

    const paymentIntent = await stripe.paymentIntents.create({
      amount: priceCents,
      currency: (process.env.STRIPE_CURRENCY || 'usd').toLowerCase(),
      customer: stripeCustomerId,
      metadata: metadata as any,
      description: `${type === 'rent' ? 'Rent' : 'Buy'}: ${video.title}`,
      automatic_payment_methods: {
        enabled: true,
      },
    })

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

replayOutbox().catch((error) => {
  tracer.error(undefined, 'Initial outbox replay failed:', error)
})

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
