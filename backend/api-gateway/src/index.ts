import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import rateLimit from 'express-rate-limit'
import jwt from 'jsonwebtoken'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { Redis } from 'ioredis'
import { JWTPayload, requestIdMiddleware, tracer } from '@streamz/shared'

dotenv.config()

const app = express()
const PORT = process.env.GATEWAY_PORT || 3000

app.use(requestIdMiddleware())

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
})

const SERVICE_MAP: Record<string, string> = {
  '/api/auth': process.env.AUTH_SERVICE_URL || 'http://localhost:4001',
  '/api/videos': process.env.VIDEO_SERVICE_URL || 'http://localhost:4002',
  '/api/purchases': process.env.PURCHASE_SERVICE_URL || 'http://localhost:4003',
  '/api/stream': process.env.STREAMING_SERVICE_URL || 'http://localhost:4004',
  '/webhooks': process.env.WEBHOOK_SERVICE_URL || 'http://localhost:4005',
}

const PUBLIC_ROUTES = [
  '/api/auth/register',
  '/api/auth/login',
  '/api/auth/refresh',
  '/webhooks/stripe',
  '/webhooks/mux',
  '/webhooks/cleanup-expired',
  '/health',
]

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
}))

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
}))

app.use('/health', (_req, res) => {
  res.json({
    service: 'streamz-api-gateway',
    status: 'healthy',
    timestamp: new Date().toISOString(),
  })
})

async function authMiddleware(req: any, _res: any, next: any) {
  const isPublic = PUBLIC_ROUTES.some(route => req.path.startsWith(route))
  if (isPublic) {
    return next()
  }

  const authHeader = req.headers.authorization
  if (!authHeader) {
    return _res.status(401).json({ error: 'No token provided' })
  }

  try {
    const token = authHeader.split(' ')[1]
    const decoded = jwt.verify(token, process.env.JWT_SECRET!, {
      algorithms: ['HS256'],
    }) as JWTPayload

    const session = await redis.get(`session:${decoded.userId}`)
    if (!session) {
      return _res.status(401).json({ error: 'Session expired' })
    }

    req.headers['x-user-id'] = decoded.userId
    req.headers['x-user-email'] = decoded.email
    next()
  } catch {
    _res.status(401).json({ error: 'Invalid token' })
  }
}

app.use('/api', authMiddleware)

Object.entries(SERVICE_MAP).forEach(([route, target]) => {
  app.use(
    route,
    createProxyMiddleware({
      target,
      changeOrigin: true,
      pathRewrite: (path) => path,
      proxyTimeout: 30000,
      timeout: 30000,
      on: {
        proxyReq: (proxyReq, req: any) => {
          if (req.headers['x-user-id']) {
            proxyReq.setHeader('x-user-id', req.headers['x-user-id'])
          }
          if (req.headers['x-user-email']) {
            proxyReq.setHeader('x-user-email', req.headers['x-user-email'])
          }
          if (req.requestId) {
            proxyReq.setHeader('x-request-id', req.requestId)
          }
        },
        proxyRes: (proxyRes) => {
          proxyRes.headers['x-powered-by'] = 'streamz-api-gateway'
        },
        error: (err, req, res: any) => {
          tracer.error((req as any).requestId, 'Proxy error:', err.message)
          if (!res.headersSent) {
            res.status(502).json({
              error: 'Service unavailable',
              service: 'unknown',
            })
          }
        },
      },
    })
  )
})

app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' })
})

app.use((err: any, req: any, res: any, _next: any) => {
  tracer.error(req.requestId, 'Gateway error:', err)
  res.status(500).json({ error: 'Internal gateway error' })
})

app.listen(PORT, () => {
  tracer.info(undefined, `API Gateway running on port ${PORT}`)
  tracer.info(undefined, 'Service routes:', SERVICE_MAP)
})

export { app }
