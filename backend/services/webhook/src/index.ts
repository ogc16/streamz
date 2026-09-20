import express from 'express'
import dotenv from 'dotenv'
import { Pool } from 'pg'
import Stripe from 'stripe'
import { Redis } from 'ioredis'
import Mux from '@mux/mux-node'

const app = express()

dotenv.config()
const PORT = process.env.WEBHOOK_SERVICE_PORT || 4005

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
})

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-02-24.acacia',
})

const mux = new Mux({
  tokenId: process.env.MUX_TOKEN_ID!,
  tokenSecret: process.env.MUX_TOKEN_SECRET!,
})

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
})

async function clearVideoCache(redisClient: Redis) {
  const stream = redisClient.scanStream({
    match: 'videos:*',
    count: 100,
  })
  for await (const keys of stream) {
    if (Array.isArray(keys) && keys.length > 0) {
      await redisClient.unlink(...keys)
    }
  }
}

// Stripe webhook (raw body needed for signature verification)
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'] as string

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch (err: any) {
    console.error('Stripe webhook signature verification failed:', err.message)
    return res.status(400).json({ error: 'Invalid signature' })
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent
        const metadata = paymentIntent.metadata

        if (metadata.userId && metadata.videoId && metadata.purchaseType) {
          const expiresAt = metadata.purchaseType === 'rent' && metadata.rentalHours
            ? new Date(Date.now() + parseInt(metadata.rentalHours) * 3600000)
            : null

          await pool.query(
            `INSERT INTO purchase_service.purchases
             (user_id, video_id, stripe_payment_intent_id, type, amount_cents, status, expires_at)
             VALUES ($1, $2, $3, $4, $5, 'completed', $6)
             ON CONFLICT (stripe_payment_intent_id) DO NOTHING`,
            [
              metadata.userId,
              metadata.videoId,
              paymentIntent.id,
              metadata.purchaseType,
              paymentIntent.amount_received || paymentIntent.amount,
              expiresAt,
            ]
          )

          // Invalidate cache
          await redis.del(`purchases:${metadata.userId}`)
          await clearVideoCache(redis)

          // Publish event for other services
          await redis.publish('purchase:completed', JSON.stringify({
            userId: metadata.userId,
            videoId: metadata.videoId,
            type: metadata.purchaseType,
            expiresAt: expiresAt?.toISOString(),
          }))
        }
        break
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent
        console.error('Payment failed:', paymentIntent.id, paymentIntent.last_payment_error)
        break
      }

      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge
        const paymentIntentId = charge.payment_intent as string

        if (paymentIntentId) {
          await pool.query(
            `UPDATE purchase_service.purchases
             SET status = 'refunded', updated_at = NOW()
             WHERE stripe_payment_intent_id = $1`,
            [paymentIntentId]
          )
        }
        break
      }
    }

    res.json({ received: true })
  } catch (error) {
    console.error('Error processing webhook:', error)
    res.status(500).json({ error: 'Webhook processing failed' })
  }
})

// Mux webhook (raw body needed for signature verification)
app.post('/webhooks/mux', express.raw({ type: 'application/json' }), async (req, res) => {
  let type: string
  let data: any
  try {
    const body = req.body.toString()
    mux.webhooks.verifySignature(body, req.headers, process.env.MUX_WEBHOOK_SECRET)
    const event = JSON.parse(body)
    type = event.type
    data = event.data
  } catch (error) {
    console.error('Mux webhook signature verification failed:', error instanceof Error ? error.message : error)
    return res.status(400).json({ error: 'Invalid signature' })
  }

  try {
    switch (type) {
      case 'video.upload.asset_created': {
        const uploadId = data.id
        const assetId = data.asset_id

        await pool.query(
          `UPDATE video_service.videos
           SET mux_asset_id = $1
           WHERE mux_upload_id = $2`,
          [assetId, uploadId]
        )
        break
      }

      case 'video.asset.ready': {
        const assetId = data.id
        const playbackId = data.playback_ids?.[0]?.id
        const duration = Math.round(data.duration || 0)

        if (playbackId) {
          await pool.query(
            `UPDATE video_service.videos
             SET mux_playback_id = $1, duration_seconds = $2,
                 thumbnail_url = $3,
                 updated_at = NOW()
             WHERE mux_asset_id = $4`,
            [
              playbackId,
              duration,
              `https://image.mux.com/${playbackId}/thumbnail.jpg`,
              assetId,
            ]
          )

          await clearVideoCache(redis)
        }
        break
      }

      case 'video.asset.errored': {
        const erroredAssetId = data.id
        console.error('Mux asset processing failed:', erroredAssetId, data.errors)
        break
      }
    }

    res.json({ received: true })
  } catch (error) {
    console.error('Error processing Mux webhook:', error)
    res.status(500).json({ error: 'Webhook processing failed' })
  }
})

// Expired rentals cleanup cron (can be called by external scheduler)
app.post('/webhooks/cleanup-expired', async (_req, res) => {
  try {
    const result = await pool.query(
      `UPDATE purchase_service.purchases
       SET status = 'expired', updated_at = NOW()
       WHERE type = 'rent' AND status = 'completed'
       AND expires_at IS NOT NULL AND expires_at < NOW()
       RETURNING id`
    )

    res.json({ expired: result.rowCount })
  } catch (error) {
    console.error('Error cleaning up expired rentals:', error)
    res.status(500).json({ error: 'Cleanup failed' })
  }
})

app.listen(PORT, () => {
  console.log(`Webhook service running on port ${PORT}`)
})

export { pool }
