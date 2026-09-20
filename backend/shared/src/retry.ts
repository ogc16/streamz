import { tracer } from './tracing'

export interface RetryOptions {
  attempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
  jitter?: boolean
  retryable?: (error: unknown) => boolean
  label?: string
}

// Retryable filter for external vendor SDK calls (Stripe/Mux): transient network
// failures plus vendor 429/5xx surfaces, which their SDKs surface in message text.
export const vendorRetryable = (error: unknown): boolean => {
  if (error instanceof Error) {
    const message = error.message || ''
    return (
      message.includes('ECONNRESET') ||
      message.includes('ECONNREFUSED') ||
      message.includes('ETIMEDOUT') ||
      message.includes('socket hang up') ||
      /status code 429/.test(message) ||
      /status code 5\d\d/.test(message)
    )
  }
  return false
}

const DEFAULT_RETRYABLE = (error: unknown) => {
  const code = (error as { code?: string })?.code
  if (typeof code === 'string') {
    // Connection, auth, and transient Postgres errors are retryable.
    if (code.startsWith('08') || code === '57P01' || code === '57P02' || code === '40001') return true
  }
  if (error instanceof Error) {
    return (
      error.message.includes('Connection terminated') ||
      error.message.includes('ECONNRESET') ||
      error.message.includes('socket hang up') ||
      error.message.includes('timeout') && error.message.toLowerCase().includes('idle')
    )
  }
  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3)
  const baseDelayMs = opts.baseDelayMs ?? 100
  const maxDelayMs = opts.maxDelayMs ?? 2000
  const retryable = opts.retryable ?? DEFAULT_RETRYABLE
  const label = opts.label ?? 'operation'

  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt === attempts || !retryable(error)) {
        if (attempt > 1) {
          tracer.error(undefined, `[retry] ${label} gave up after ${attempt} attempts`)
        }
        throw error
      }
      const base = baseDelayMs * 2 ** (attempt - 1)
      const limited = Math.min(base, maxDelayMs)
      const delay = opts.jitter === false ? limited : limited * (0.5 + Math.random() * 0.5)
      tracer.warn(undefined, `[retry] ${label} failed (attempt ${attempt}/${attempts}), retrying in ${Math.round(delay)}ms:`, (error as Error)?.message)
      await sleep(delay)
    }
  }
  throw lastError
}