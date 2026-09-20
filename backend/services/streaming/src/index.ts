import express from 'express'
import cors from 'cors'
import { Pool } from 'pg'
import jwt from 'jsonwebtoken'
import Mux from '@mux/mux-node'
import { Redis } from 'ioredis'
import {
  JWTPayload,
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
  loadEnv,
} from '@streamz/shared'

loadEnv()

initLogging('streaming')
initTelemetry('streaming')

const app = express()
const PORT = process.env.STREAMING_SERVICE_PORT || 4004

app.use(requestIdMiddleware())

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
})
pool.on('error', (err: Error) => tracer.error(undefined, 'Postgres pool error', err.message))

const mux = new Mux({
  tokenId: process.env.MUX_TOKEN_ID!,
  tokenSecret: process.env.MUX_TOKEN_SECRET!,
})

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
})
redis.on('error', (err: Error) => tracer.error(undefined, 'Redis error', err.message))

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

applySecurity(app)
app.use(cors())
app.use(secureJsonParser({ limit: '512kb' }))

const registry = new MetricsRegistry()
app.use(httpMetricsMiddleware(registry, 'streaming'))
app.get('/metrics', metricsHandler(registry))

app.use(
  healthRouter('streaming', [
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
    {
      name: 'mux',
      check: async () => {
        if (!(process.env.MUX_TOKEN_ID && process.env.MUX_TOKEN_SECRET)) {
          throw new Error('mux credentials not configured')
        }
      },
    },
  ])
)

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

function signingConfigured() {
  return !!(process.env.MUX_SIGNING_KEY && process.env.MUX_PRIVATE_KEY)
}

app.post('/api/stream/upload-url', authMiddleware, async (req, res) => {
  try {
    const { videoId } = req.body
    if (!videoId) {
      return res.status(400).json({ error: 'videoId is required' })
    }

    const upload = await mux.video.uploads.create({
      new_asset_settings: {
        playback_policy: signingConfigured() ? ['signed'] : ['public'],
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
    tracer.error(req.requestId, 'Error creating upload URL:', error)
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
    tracer.error(req.requestId, 'Error completing upload:', error)
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
      `SELECT expires_at FROM purchase_service.purchases
       WHERE user_id = $1 AND video_id = $2 AND status = 'completed'
       AND (expires_at IS NULL OR expires_at > NOW())
       LIMIT 1`,
      [req.user!.userId, videoId]
    )

    if (purchaseResult.rows.length === 0) {
      return res.status(403).json({ error: 'No access. Please purchase this video.' })
    }

    const remainingMs = purchaseResult.rows[0].expires_at
      ? new Date(purchaseResult.rows[0].expires_at).getTime() - Date.now()
      : null

    const defaultTtl = Math.max(60, parseInt(process.env.PLAYBACK_TTL_SECONDS || '3600', 10))
    let ttl = defaultTtl
    if (remainingMs !== null) {
      // Bound the signed URL lifetime to the exact remaining rental time
      ttl = Math.max(60, Math.min(defaultTtl, Math.ceil(remainingMs / 1000)))
    }

    const signingOn = signingConfigured()
    const basePlaybackUrl = `https://stream.mux.com/${playbackId}.m3u8`
    let playbackUrl = basePlaybackUrl

    if (signingOn) {
      const token = await mux.jwt.signPlaybackId(playbackId, {
        type: 'video',
        expiration: `${ttl}s`,
      })
      playbackUrl = `${basePlaybackUrl}?token=${encodeURIComponent(token)}`
    }

    res.json({
      playbackUrl,
      playbackId,
      expiresInSeconds: ttl,
      signed: signingOn,
    })
  } catch (error) {
    tracer.error(req.requestId, 'Error getting playback URL:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.post('/api/stream/thumbnail/:playbackId', authMiddleware, async (req, res) => {
  try {
    const { playbackId } = req.params
    const { time = 0 } = req.body

    let thumbnailUrl = `https://image.mux.com/${playbackId}/thumbnail.jpg?time=${time}`
    if (signingConfigured()) {
      const token = await mux.jwt.signPlaybackId(playbackId, {
        type: 'thumbnail',
        expiration: `${Math.max(60, parseInt(process.env.PLAYBACK_TTL_SECONDS || '3600', 10))}s`,
      })
      thumbnailUrl = `${thumbnailUrl}&token=${encodeURIComponent(token)}`
    }

    res.json({ thumbnailUrl })
  } catch (error) {
    tracer.error(req.requestId, 'Error generating thumbnail:', error)
    res.status(500).json({ error: 'Failed to generate thumbnail' })
  }
})

const server = app.listen(PORT, () => {
  tracer.info(undefined, `Streaming service running on port ${PORT}`)
})

gracefulShutdown({
  service: 'streaming',
  server,
  shutdown: async () => {
    await pool.end()
    await redis.quit()
  },
})

export { pool }
