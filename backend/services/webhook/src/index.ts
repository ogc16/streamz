import express from 'express'
import dotenv from 'dotenv'
import Stripe from 'stripe'
import { Redis } from 'ioredis'
import Mux from '@mux/mux-node'
import {
  EVENTS,
  PurchaseCompletedEvent,
  PurchaseRefundedEvent,
  VideoAssetCreatedEvent,
  VideoAssetReadyEvent,
  requestIdMiddleware,
  tracer,
} from '@streamz/shared'

const app = express()

dotenv.config()
const PORT = process.env.WEBHOOK_SERVICE_PORT || 4005

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

app.use(requestIdMiddleware())

function publish(channel: string, payload: object) {
  return redis.publish(channel, JSON.stringify(payload))
}

function safeJsonParse(body: string): any {
  return JSON.parse(body, (key, value) => {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return undefined
    }
    return value
  })
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
    tracer.error(req.requestId, 'Stripe webhook signature verification failed:', err.message)
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

          const payload: PurchaseCompletedEvent = {
            userId: metadata.userId,
            videoId: metadata.videoId,
            purchaseType: metadata.purchaseType as PurchaseCompletedEvent['purchaseType'],
            paymentIntentId: paymentIntent.id,
            amountCents: paymentIntent.amount_received || paymentIntent.amount,
            expiresAt: expiresAt?.toISOString() || null,
          }
          await publish(EVENTS.PURCHASE_COMPLETED, payload)
        }
        break
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent
        tracer.error(req.requestId, 'Payment failed:', paymentIntent.id, paymentIntent.last_payment_error)
        break
      }

      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge
        const paymentIntentId = charge.payment_intent as string

        if (paymentIntentId) {
          await publish(EVENTS.PURCHASE_REFUNDED, { paymentIntentId } satisfies PurchaseRefundedEvent)
        }
        break
      }
    }

    res.json({ received: true })
  } catch (error) {
    tracer.error(req.requestId, 'Error processing webhook:', error)
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
    const event = safeJsonParse(body)
    type = event.type
    data = event.data
  } catch (error) {
    tracer.error(req.requestId, 'Mux webhook signature verification failed:', error instanceof Error ? error.message : error)
    return res.status(400).json({ error: 'Invalid signature' })
  }

  try {
    switch (type) {
      case 'video.upload.asset_created': {
        await publish(EVENTS.VIDEO_ASSET_CREATED, {
          uploadId: data.id,
          assetId: data.asset_id,
        } satisfies VideoAssetCreatedEvent)
        break
      }

      case 'video.asset.ready': {
        await publish(EVENTS.VIDEO_ASSET_READY, {
          assetId: data.id,
          playbackId: data.playback_ids?.[0]?.id || null,
          durationSeconds: Math.round(data.duration || 0),
        } satisfies VideoAssetReadyEvent)
        break
      }

      case 'video.asset.errored': {
        tracer.error(req.requestId, 'Mux asset processing failed:', data.id, data.errors)
        break
      }
    }

    res.json({ received: true })
  } catch (error) {
    tracer.error(req.requestId, 'Error processing Mux webhook:', error)
    res.status(500).json({ error: 'Webhook processing failed' })
  }
})

// Expired rentals cleanup — signals purchase service to purge on its own schema
app.post('/webhooks/cleanup-expired', async (_req, res) => {
  try {
    await publish(EVENTS.RENTAL_CLEANUP, { id: _req.requestId || '' })
    res.json({ acknowledged: true, event: EVENTS.RENTAL_CLEANUP })
  } catch (error) {
    tracer.error(_req.requestId, 'Error signaling rental cleanup:', error)
    res.status(500).json({ error: 'Cleanup failed' })
  }
})

app.listen(PORT, () => {
  tracer.info(undefined, `Webhook service running on port ${PORT}`)
})