import express from 'express'
import cors from 'cors'
import { Pool } from 'pg'
import jwt from 'jsonwebtoken'
import { Redis } from 'ioredis'
import { createVideoSchema, JWTPayload, VideoDTO } from '@streamz/shared'

const app = express()
const PORT = process.env.VIDEO_SERVICE_PORT || 4002

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
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
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' })
  }
}

function videoToDTO(video: any): VideoDTO {
  return {
    id: video.id,
    title: video.title,
    description: video.description,
    thumbnailUrl: video.thumbnail_url || `https://image.mux.com/default/thumbnail.jpg`,
    playbackId: video.mux_playback_id || '',
    durationSeconds: video.duration_seconds || 0,
    priceCents: video.price_cents,
    rentalPriceCents: video.rental_price_cents || null,
    rentalDurationHours: video.rental_duration_hours || null,
    genre: video.genre,
    releaseYear: video.release_year,
    rating: video.rating,
    featured: video.featured,
    purchaseType: video.purchase_type,
    createdAt: video.created_at.toISOString(),
  }
}

app.get('/api/videos', authMiddleware, async (req, res) => {
  try {
    const {
      genre,
      featured,
      search,
      page = '1',
      limit = '20',
      sort = 'created_at',
      order = 'desc',
    } = req.query

    const userId = req.user?.userId || 'anonymous'
    const cacheKey = `videos:list:${userId}:${JSON.stringify(req.query)}`
    const cached = await redis.get(cacheKey)
    if (cached) {
      return res.json(JSON.parse(cached))
    }

    const conditions: string[] = []
    const params: any[] = []
    let paramIndex = 1

    if (genre) {
      conditions.push(`v.genre = $${paramIndex++}`)
      params.push(genre)
    }
    if (featured === 'true') {
      conditions.push('v.featured = TRUE')
    }
    if (search) {
      conditions.push(`(v.title ILIKE $${paramIndex} OR v.description ILIKE $${paramIndex})`)
      params.push(`%${search}%`)
      paramIndex++
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : ''

    const allowedSorts = ['created_at', 'title', 'release_year', 'price_cents']
    const sortColumn = allowedSorts.includes(sort as string) ? sort : 'created_at'
    const sortOrder = order === 'asc' ? 'ASC' : 'DESC'

    const offset = (parseInt(page as string) - 1) * parseInt(limit as string)

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM video_service.videos v ${whereClause}`,
      params
    )

    const result = await pool.query(
      `SELECT v.* FROM video_service.videos v
       ${whereClause}
       ORDER BY v.${sortColumn} ${sortOrder}, v.id
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, parseInt(limit as string), offset]
    )

    // Check which videos the user has purchased
    let purchasedIds = new Set<string>()
    if (req.user) {
      const purchases = await pool.query(
        `SELECT video_id, type FROM purchase_service.purchases
         WHERE user_id = $1 AND status = 'completed'
         AND (expires_at IS NULL OR expires_at > NOW())`,
        [req.user.userId]
      )
      purchasedIds = new Set(purchases.rows.map((p: any) => p.video_id))
    }

    const response = {
      items: result.rows.map((v: any) => ({
        ...videoToDTO(v),
        purchased: purchasedIds.has(v.id),
      })),
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page as string),
      limit: parseInt(limit as string),
    }

    await redis.setex(cacheKey, 60, JSON.stringify(response))

    res.json(response)
  } catch (error) {
    console.error('Error fetching videos:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.get('/api/videos/featured', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.userId || 'anonymous'
    const cacheKey = `videos:featured:${userId}`
    const cached = await redis.get(cacheKey)
    if (cached) {
      return res.json(JSON.parse(cached))
    }

    const result = await pool.query(
      `SELECT * FROM video_service.videos
       WHERE featured = TRUE
       ORDER BY created_at DESC
       LIMIT 10`
    )

    let purchasedIds = new Set<string>()
    if (req.user) {
      const purchases = await pool.query(
        `SELECT video_id FROM purchase_service.purchases
         WHERE user_id = $1 AND status = 'completed'
         AND (expires_at IS NULL OR expires_at > NOW())`,
        [req.user.userId]
      )
      purchasedIds = new Set(purchases.rows.map((p: any) => p.video_id))
    }

    const response = result.rows.map((v: any) => ({
      ...videoToDTO(v),
      purchased: purchasedIds.has(v.id),
    }))

    await redis.setex(cacheKey, 300, JSON.stringify(response))

    res.json(response)
  } catch (error) {
    console.error('Error fetching featured videos:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.get('/api/videos/genres', authMiddleware, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT genre, COUNT(*) as count
       FROM video_service.videos
       GROUP BY genre
       ORDER BY genre`
    )
    res.json(result.rows)
  } catch (error) {
    console.error('Error fetching genres:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.get('/api/videos/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params

    const result = await pool.query(
      'SELECT * FROM video_service.videos WHERE id = $1',
      [id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Video not found' })
    }

    const video = result.rows[0]
    let purchased = false
    let purchaseType: string | null = null

    if (req.user) {
      const purchaseResult = await pool.query(
        `SELECT type, expires_at FROM purchase_service.purchases
         WHERE user_id = $1 AND video_id = $2 AND status = 'completed'
         AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY created_at DESC LIMIT 1`,
        [req.user.userId, id]
      )

      if (purchaseResult.rows.length > 0) {
        purchased = true
        purchaseType = purchaseResult.rows[0].type
      }
    }

    res.json({
      ...videoToDTO(video),
      purchased,
      purchaseType,
    })
  } catch (error) {
    console.error('Error fetching video:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.post('/api/videos', authMiddleware, async (req, res) => {
  try {
    const data = createVideoSchema.parse(req.body)

    const result =     await pool.query(
      `INSERT INTO video_service.videos
       (title, description, thumbnail_url, mux_asset_id, mux_playback_id,
        duration_seconds, price_cents, rental_price_cents,
        rental_duration_hours, genre, release_year, rating, featured, purchase_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        data.title, data.description,
        'https://image.mux.com/default/thumbnail.jpg',
        null, null,
        0, data.priceCents,
        data.rentalPriceCents || null,
        data.rentalDurationHours || null,
        data.genre, data.releaseYear, data.rating,
        data.featured || false, data.purchaseType,
      ]
    )

    // Invalidate all user-scoped video list and featured caches
    const stream = redis.scanStream({ match: 'videos:*', count: 100 })
    for await (const keys of stream) {
      if (Array.isArray(keys) && keys.length > 0) {
        await redis.unlink(...keys)
      }
    }

    res.status(201).json(videoToDTO(result.rows[0]))
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: error.errors })
    }
    console.error('Error creating video:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.listen(PORT, () => {
  console.log(`Video service running on port ${PORT}`)
})

export { pool }
