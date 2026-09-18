import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { Pool } from 'pg'
import jwt from 'jsonwebtoken'
import Mux from '@mux/mux-node'
import { Redis } from 'ioredis'
import { JWTPayload } from '@streamz/shared'

dotenv.config()

const app = express()
const PORT = process.env.STREAMING_SERVICE_PORT || 4004

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
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

app.use(cors())
app.use(express.json({ limit: '50mb' }))

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

app.post('/api/stream/upload-url', authMiddleware, async (req, res) => {
  try {
    const { videoId } = req.body
    if (!videoId) {
      return res.status(400).json({ error: 'videoId is required' })
    }

    const upload = await mux.video.uploads.create({
      new_asset_settings: {
        playback_policy: ['public'],
        mp4_support: 'none',
        normalize_audio: true,
      },
      cors_origin: '*',
    })

    await pool.query(
      `UPDATE video_service.videos
       SET mux_upload_id = $1
       WHERE id = $2`,
      [upload.id, videoId]
    )

    res.json({
      uploadUrl: upload.url,
      uploadId: upload.id,
    })
  } catch (error) {
    console.error('Error creating upload URL:', error)
    res.status(500).json({ error: 'Failed to create upload URL' })
  }
})

app.post('/api/stream/upload-complete', authMiddleware, async (req, res) => {
  try {
    const { uploadId } = req.body

    const upload = await mux.video.uploads.retrieve(uploadId)
    if (upload.asset_id) {
      const asset = await mux.video.assets.retrieve(upload.asset_id)

      // Look up video by upload ID instead of trusting client-provided videoId
      const videoResult = await pool.query(
        'SELECT id FROM video_service.videos WHERE mux_upload_id = $1',
        [uploadId]
      )

      if (videoResult.rows.length === 0) {
        return res.status(404).json({ error: 'No video associated with this upload' })
      }

      const videoId = videoResult.rows[0].id

      await pool.query(
        `UPDATE video_service.videos
         SET mux_asset_id = $1, mux_playback_id = $2, duration_seconds = $3,
             thumbnail_url = $4
         WHERE id = $5`,
        [
          asset.id,
          asset.playback_ids?.[0]?.id,
          Math.round(asset.duration || 0),
          `https://image.mux.com/${asset.playback_ids?.[0]?.id}/thumbnail.jpg`,
          videoId,
        ]
      )

      await clearVideoCache(redis)

      res.json({ success: true })
    } else {
      res.status(202).json({
        status: 'processing',
        message: 'Asset is still being processed',
      })
    }
  } catch (error) {
    console.error('Error completing upload:', error)
    res.status(500).json({ error: 'Failed to process upload' })
  }
})

app.get('/api/stream/playback/:playbackId', authMiddleware, async (req, res) => {
  try {
    const { playbackId } = req.params

    const videoResult = await pool.query(
      'SELECT id FROM video_service.videos WHERE mux_playback_id = $1',
      [playbackId]
    )

    if (videoResult.rows.length === 0) {
      return res.status(404).json({ error: 'Video not found' })
    }

    const videoId = videoResult.rows[0].id

    const purchaseResult = await pool.query(
      `SELECT id FROM purchase_service.purchases
       WHERE user_id = $1 AND video_id = $2 AND status = 'completed'
       AND (expires_at IS NULL OR expires_at > NOW())
       LIMIT 1`,
      [req.user!.userId, videoId]
    )

    if (purchaseResult.rows.length === 0) {
      return res.status(403).json({ error: 'No access. Please purchase this video.' })
    }

    const playbackUrl = `https://stream.mux.com/${playbackId}.m3u8`

    res.json({
      playbackUrl,
      playbackId,
    })
  } catch (error) {
    console.error('Error getting playback URL:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.post('/api/stream/thumbnail/:playbackId', authMiddleware, async (req, res) => {
  try {
    const { playbackId } = req.params
    const { time = 0 } = req.body

    const thumbnailUrl = `https://image.mux.com/${playbackId}/thumbnail.jpg?time=${time}`

    res.json({ thumbnailUrl })
  } catch (error) {
    console.error('Error generating thumbnail:', error)
    res.status(500).json({ error: 'Failed to generate thumbnail' })
  }
})

app.listen(PORT, () => {
  console.log(`Streaming service running on port ${PORT}`)
})

export { pool }
