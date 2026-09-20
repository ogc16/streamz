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
    const contentLength = Number(req.headers['content-length'] || 0)
    const hasBody = contentLength > 0 || req.headers['transfer-encoding'] !== undefined

    if (!hasBody) {
      req.body = {}
      return next()
    }

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
    // Probe each dependency with a hard deadline so readiness fails fast and
    // returns 503 (rather than hanging while a client waits in its reconnect
    // queue), which is what k8s/HPA expect from startup/liveness/readiness.
    const run = (check: HealthCheck) =>
      Promise.race([
        Promise.resolve().then(() => check.check()),
        new Promise((_resolve, reject) =>
          setTimeout(() => reject(new Error(`${check.name} timed out`)), 1000)
        ),
      ])

    const results = await Promise.allSettled(checks.map(run))
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