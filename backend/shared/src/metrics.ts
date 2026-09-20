import type { RequestHandler } from 'express'

export interface LabelValue {
  [k: string]: string
}

function escapeLabelValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

function labelString(labels: LabelValue, labelNames: string[]): string {
  if (labelNames.length === 0) return ''
  return '{' + labelNames.map((n) => `${n}="${escapeLabelValue(labels[n] || '')}"`).join(',') + '}'
}

class Counter {
  labelNames: string[]
  help: string
  private values = new Map<string, number>()

  constructor(name: string, help: string, labelNames: string[] = []) {
    this.labelNames = labelNames
    this.help = help
    this.name = name
  }
  name: string

  inc(labels: LabelValue = {}, by = 1): void {
    const key = this.labelNames.map((n) => labels[n] || '').join('|')
    this.values.set(key, (this.values.get(key) || 0) + by)
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`]
    for (const [key, value] of this.values) {
      const labelValues = key === '' ? {} : Object.fromEntries(this.labelNames.map((n, i) => [n, key.split('|')[i]]))
      lines.push(`${this.name}${labelString(labelValues, this.labelNames)} ${value}`)
    }
    return lines.join('\n')
  }
}

class Histogram {
  labelNames: string[]
  help: string
  buckets: number[]
  name: string
  private counts = new Map<string, number[]>()
  private sums = new Map<string, number>()

  constructor(name: string, help: string, labelNames: string[] = [], buckets = [0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]) {
    this.name = name
    this.help = help
    this.labelNames = labelNames
    this.buckets = buckets
  }

  observe(labels: LabelValue = {}, value: number): void {
    const key = this.labelNames.map((n) => labels[n] || '').join('|')
    if (!this.counts.has(key)) {
      this.counts.set(key, this.buckets.map(() => 0))
      this.sums.set(key, 0)
    }
    const counts = this.counts.get(key)!
    const sum = this.sums.get(key)!
    this.sums.set(key, sum + value)
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]) counts[i] += 1
    }
  }

  render(): string {
    const lines = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} histogram`,
    ]
    for (const [key, counts] of this.counts) {
      const labelValues = key === '' ? {} : Object.fromEntries(this.labelNames.map((n, i) => [n, key.split('|')[i]]))
      const labels = labelString(labelValues, this.labelNames)
      let cumulative = 0
      for (let i = 0; i < this.buckets.length; i++) {
        cumulative += counts[i]
        lines.push(`${this.name}_bucket${labels}  ${cumulative}`.replace('{', `{le="${this.buckets[i]}",`))
        lines[lines.length - 1] = `${this.name}_bucket{le="${this.buckets[i]}"${Object.keys(labelValues).length ? ',' + Object.entries(labelValues).map(([k, v]) => `${k}="${escapeLabelValue(v)}"`).join(',') : ''}} ${cumulative}`
      }
      lines.push(`${this.name}_bucket{le="+Inf"${Object.keys(labelValues).length ? ',' + Object.entries(labelValues).map(([k, v]) => `${k}="${escapeLabelValue(v)}"`).join(',') : ''}} ${cumulative}`)
      lines.push(`${this.name}_sum${labels} ${this.sums.get(key) || 0}`)
      lines.push(`${this.name}_count${labels} ${cumulative}`)
    }
    return lines.join('\n')
  }
}

export class MetricsRegistry {
  private counters: Counter[] = []
  private histograms: Histogram[] = []

  counter(name: string, help: string, labelNames: string[] = []): Counter {
    const c = new Counter(name, help, labelNames)
    this.counters.push(c)
    return c
  }

  histogram(name: string, help: string, labelNames: string[] = [], buckets?: number[]): Histogram {
    const h = new Histogram(name, help, labelNames, buckets)
    this.histograms.push(h)
    return h
  }

  render(): string {
    return [...this.counters, ...this.histograms].map((m) => m.render()).join('\n') + '\n'
  }
}

export function metricsHandler(registry: MetricsRegistry): RequestHandler {
  return (_req, res) => {
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
    res.send(registry.render())
  }
}

export function httpMetricsMiddleware(registry: MetricsRegistry, service: string) {
  const requests = registry.counter('http_requests_total', 'Total HTTP requests', ['service', 'method', 'route', 'status'])
  const latency = registry.histogram('http_request_duration_seconds', 'HTTP request latency', ['service', 'route', 'method'])

  const active = new Map<string, number>()
  const inflight = registry.counter('http_requests_inflight', 'In-flight HTTP requests', ['service'])

  return (req: any, res: any, next: any) => {
    const route = (req.route?.path as string) || req.path || 'unknown'
    const method = req.method || 'GET'
    inflight.inc({ service }, 1)
    const start = process.hrtime.bigint()
    res.on('finish', () => {
      const status = String(res.statusCode || 500)
      const seconds = Number(process.hrtime.bigint() - start) / 1e9
      requests.inc({ service, method, route, status })
      latency.observe({ service, route, method }, seconds)
      inflight.inc({ service }, -1)
      active.delete(route + method + status)
    })
    next()
  }
}