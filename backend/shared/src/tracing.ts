import crypto from 'crypto'
import { RequestHandler } from 'express'

declare global {
  namespace Express {
    interface Request {
      requestId?: string
    }
  }
}

function resolveRequestId(req: { headers: Record<string, string | string[] | undefined> }): string {
  const incoming = req.headers['x-request-id']
  return Array.isArray(incoming) ? (incoming[0] || crypto.randomUUID()) : (incoming || crypto.randomUUID())
}

export function requestIdMiddleware(): RequestHandler {
  return (req: any, res, next) => {
    const requestId = resolveRequestId(req)
    req.requestId = requestId
    res.setHeader('x-request-id', requestId)
    next()
  }
}

export function traceLog(level: 'error' | 'warn' | 'info', requestId: string | undefined, ...args: unknown[]) {
  const tag = requestId ? `[req:${requestId}]` : '[req:-]'
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  fn(tag, ...args)
}

export const tracer = {
  info: (requestId: string | undefined, ...args: unknown[]) => traceLog('info', requestId, ...args),
  warn: (requestId: string | undefined, ...args: unknown[]) => traceLog('warn', requestId, ...args),
  error: (requestId: string | undefined, ...args: unknown[]) => traceLog('error', requestId, ...args),
}