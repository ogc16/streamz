import type { Express } from 'express'
import { Router, RequestHandler, NextFunction, Request, Response } from 'express'
import helmet from 'helmet'
import express from 'express'

export interface HealthCheck {
  name: string
  check: () => void | Promise<void>
}

export function applySecurity(app: Express) {
  app.disable('x-powered-by')
  app.use(helmet())
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export function sanitizeObject(value: unknown): any {
  if (Array.isArray(value)) {
    return value.map(sanitizeObject)
  }
  if (!isObject(value)) {
    return value
  }
  const out: Record<string, any> = {}
  for (const key of Object.keys(value)) {
    if (BLOCKED_KEYS.has(key)) continue
    out[key] = sanitizeObject(value[key])
  }
  return out
}

export function secureJsonParser(options?: { limit?: string }): RequestHandler {
  const limit = options?.limit || '1mb'
  const raw = express.raw({ type: () => true, limit })

  return (req: Request, res: Response, next: NextFunction) => {
    raw(req, res, (err?: any) => {
      if (err) {
        return res.status(400).json({ error: 'Invalid body' })
      }
      let parsed: unknown = {}
      try {
        const text = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : req.body
        parsed = text ? JSON.parse(text) : {}
      } catch {
        return res.status(400).json({ error: 'Invalid JSON body' })
      }
      req.body = sanitizeObject(parsed)
      next()
    })
  }
}

export function healthRouter(service: string, checks: HealthCheck[] = []): Router {
  const router = Router()

  router.get('/health', (_req: Request, res: Response) => {
    res.json({ service, status: 'healthy', timestamp: new Date().toISOString() })
  })

  router.get('/health/live', (_req: Request, res: Response) => {
    res.json({ service, status: 'alive', timestamp: new Date().toISOString() })
  })

  router.get('/health/ready', async (_req: Request, res: Response) => {
    const results = await Promise.allSettled(checks.map((c) => c.check()))
    const failed = results
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.status === 'rejected')
      .map(({ i }) => checks[i].name)

    if (failed.length === 0) {
      return res.json({ service, status: 'ready', timestamp: new Date().toISOString() })
    }
    res.status(503).json({
      service,
      status: 'not_ready',
      failed: failed,
      timestamp: new Date().toISOString(),
    })
  })

  return router
}