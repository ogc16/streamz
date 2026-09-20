import { tracer } from './tracing'
import type { MetricsRegistry } from './metrics'

export type CircuitState = 'closed' | 'open' | 'half-open'

export class CircuitOpenError extends Error {
  constructor(public readonly breaker: string) {
    super(`Circuit '${breaker}' is open; request rejected without calling the dependency`)
    this.name = 'CircuitOpenError'
  }
}

export interface CircuitBreakerOptions {
  failureThreshold?: number
  resetTimeoutMs?: number
  halfOpenSuccesses?: number
  registry?: MetricsRegistry
}

interface BreakerMetrics {
  calls: ReturnType<MetricsRegistry['counter']>
  transitions: ReturnType<MetricsRegistry['counter']>
  state: ReturnType<MetricsRegistry['gauge']>
}

const STATE_CODE: Record<CircuitState, number> = { closed: 0, 'half-open': 1, open: 2 }

// Fails fast when a dependency (Stripe/Mux) is degraded instead of letting every
// concurrent request pile onto it. Metrics + tracer make break states observable.
export class CircuitBreaker {
  readonly name: string
  private state: CircuitState = 'closed'
  private consecutiveFailures = 0
  private halfOpenSuccesses = 0
  private openedAt = 0
  private readonly failureThreshold: number
  private readonly resetTimeoutMs: number
  private readonly halfOpenSuccessesNeeded: number
  private readonly metrics: BreakerMetrics | null

  constructor(name: string, opts: CircuitBreakerOptions = {}) {
    this.name = name
    this.failureThreshold = opts.failureThreshold ?? 5
    this.resetTimeoutMs = opts.resetTimeoutMs ?? 30_000
    this.halfOpenSuccessesNeeded = opts.halfOpenSuccesses ?? 2
    this.metrics = opts.registry
      ? {
          calls: opts.registry.counter(
            'streamz_circuit_breaker_calls_total',
            'Circuit breaker execution attempts by breaker and outcome',
            ['breaker', 'outcome']
          ),
          transitions: opts.registry.counter(
            'streamz_circuit_breaker_state_changes_total',
            'Circuit breaker state transitions',
            ['breaker', 'to']
          ),
          state: opts.registry.gauge(
            'streamz_circuit_breaker_state',
            'Circuit breaker current state (0=closed, 1=half-open, 2=open)',
            ['breaker']
          ),
        }
      : null
  }

  getState(): CircuitState {
    return this.state
  }

  private setState(next: CircuitState): void {
    if (next === this.state) return
    this.state = next
    if (next === 'open') {
      this.openedAt = Date.now()
      this.consecutiveFailures = 0
      this.halfOpenSuccesses = 0
      tracer.warn(undefined, `[circuit] ${this.name} OPEN \u2014 failing fast until reset`)
    }
    this.metrics?.state.set({ breaker: this.name }, STATE_CODE[next])
    this.metrics?.transitions.inc({ breaker: this.name, to: next })
    if (next === 'half-open') {
      tracer.info(undefined, `[circuit] ${this.name} half-open \u2014 allowing probe`)
    } else if (next === 'closed') {
      tracer.info(undefined, `[circuit] ${this.name} CLOSED \u2014 dependency recovered`)
    }
  }

  private recordOutcome(outcome: 'success' | 'failure' | 'rejected'): void {
    this.metrics?.calls.inc({ breaker: this.name, outcome })
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.openedAt < this.resetTimeoutMs) {
        this.recordOutcome('rejected')
        throw new CircuitOpenError(this.name)
      }
      this.setState('half-open')
    }

    try {
      const result = await fn()
      if (this.state === 'half-open') {
        this.halfOpenSuccesses += 1
        if (this.halfOpenSuccesses >= this.halfOpenSuccessesNeeded) {
          this.setState('closed')
        }
      } else {
        this.consecutiveFailures = 0
      }
      this.recordOutcome('success')
      return result
    } catch (error) {
      if (error instanceof CircuitOpenError) {
        this.recordOutcome('rejected')
        throw error
      }
      if (this.state === 'half-open') {
        this.setState('open')
      } else {
        this.consecutiveFailures += 1
        if (this.consecutiveFailures >= this.failureThreshold) {
          this.setState('open')
        }
      }
      this.recordOutcome('failure')
      throw error
    }
  }
}