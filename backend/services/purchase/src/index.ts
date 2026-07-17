import express from 'express'
import cors from 'cors'
import { Pool } from 'pg'
import jwt from 'jsonwebtoken'
import Stripe from 'stripe'
import { Redis } from 'ioredis'
import { JWTPayload, StripeMetadata, PurchaseDTO } from '@streamz/shared'

const app = express()
const PORT = process.env.PURCHASE_SERVICE_PORT || 4003

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
})

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-11-20.acacia',
})

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
})

app.use(cors())
app.use(express.json())

function authMiddleware(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization
  if (!authHeader) {
    return res.status(401).json({ error: 'No token provided' })
  }
  try {
    const token = authHeader.split(' ')[1]
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JWTPayload
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
    const { videoId, type } = req.body
    const userId = req.user.userId

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
    console.error('Error creating payment intent:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.get('/api/purchases', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId

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
    console.error('Error fetching purchases:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.get('/api/purchases/check/:videoId', authMiddleware, async (req, res) => {
  try {
    const { videoId } = req.params
    const userId = req.user.userId

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
    console.error('Error checking purchase:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.listen(PORT, () => {
  console.log(`Purchase service running on port ${PORT}`)
})

export { pool, stripe }
