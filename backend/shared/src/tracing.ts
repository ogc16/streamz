import crypto from 'crypto'
import type { RequestHandler } from 'express'
import { trace } from '@opentelemetry/api'

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

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'

let currentService = 'streamz'
let logLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info'
let jsonMode = process.env.LOG_JSON === '1'

export function initLogging(service: string, opts?: { level?: LogLevel; json?: boolean }): void {
  currentService = service
  if (opts?.level) logLevel = opts.level
  if (opts?.json !== undefined) jsonMode = opts.json
}

function fieldsFromArgs(args: unknown[]): unknown {
  const values = args.filter((a) => a !== undefined)
  if (values.length === 1) {
    return values[0]
  }
  if (values.length === 0) {
    return undefined
  }
  const last = values[values.length - 1]
  const nonLast = values.slice(0, -1)
  if (typeof last === 'object' && last !== null && !Array.isArray(last)) {
    return { message: nonLast, ...(last as object) }
  }
  return { message: values }
}

export function traceLog(level: LogLevel, requestId: string | undefined, ...args: unknown[]) {
  const levels: LogLevel[] = ['error', 'warn', 'info', 'debug']
  if (levels.indexOf(level) > levels.indexOf(logLevel)) return

  const rid = requestId || undefined
  const activeSpan = trace.getActiveSpan()
  const traceId = activeSpan?.spanContext().traceId
  const spanId = activeSpan?.spanContext().spanId

  if (jsonMode) {
    const line: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      service: currentService,
      ...(rid && { requestId: rid }),
      ...(traceId && { traceId }),
      ...(spanId && { spanId }),
      message: args,
    }
    const out = JSON.stringify(line)
    if (level === 'error') console.error(out)
    else if (level === 'warn') console.warn(out)
    else console.log(out)
    return
  }

  const tag = rid ? `[req:${rid}]` : '[req:-]'
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  fn(tag, ...args)
}

export function setRequestAttributes(req: any, span: any) {
  if (span) {
    try {
      span.setAttribute('request.id', req.requestId || '')
      span.setAttribute('http.route', req.route?.path || req.path || '')
    } catch {
      // span attributes are best-effort
    }
  }
}

export const tracer = {
  info: (requestId: string | undefined, ...args: unknown[]) => traceLog('info', requestId, ...args),
  warn: (requestId: string | undefined, ...args: unknown[]) => traceLog('warn', requestId, ...args),
  error: (requestId: string | undefined, ...args: unknown[]) => traceLog('error', requestId, ...args),
  debug: (requestId: string | undefined, ...args: unknown[]) => traceLog('debug', requestId, ...args),
}