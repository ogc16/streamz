import { tracer } from './tracing'

interface GracefulShutdownOptions {
  service: string
  server?: { close: (cb?: (err?: Error) => void) => void }
  shutdown?: () => void | Promise<void>
  timeoutMs?: number
}

const SHUTDOWN_SIGNALS = ['SIGTERM', 'SIGINT'] as const

export function gracefulShutdown(opts: GracefulShutdownOptions): void {
  const timeoutMs = opts.timeoutMs || 10_000

  for (const signal of SHUTDOWN_SIGNALS) {
    process.on(signal, () => {
      tracer.info(undefined, `[${opts.service}] received ${signal}, shutting down gracefully`)

      const forced = setTimeout(() => {
        tracer.error(undefined, `[${opts.service}] shutdown timed out after ${timeoutMs}ms, forcing exit`)
        process.exit(1)
      }, timeoutMs)
      forced.unref()

      const finish = () => {
        clearTimeout(forced)
        process.exit(0)
      }

      ;(async () => {
        try {
          await opts.shutdown?.()
        } catch (error) {
          tracer.error(undefined, `[${opts.service}] shutdown error:`, error)
        }
        if (opts.server) {
          opts.server.close(() => finish())
        } else {
          finish()
        }
      })()
    })
  }
}