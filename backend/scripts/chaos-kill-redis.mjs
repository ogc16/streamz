// Chaos: kill Redis mid-flight, assert graceful degradation + recovery.
//
// Usage: node scripts/chaos-kill-redis.mjs
//   BASE_URL  gateway base (http://localhost:3000)
import { pollUntil, compose, sleep, fetchStatus } from './lib/chaos.mjs'

const base = process.env.BASE_URL || 'http://localhost:3000'

await pollUntil(`${base}/health/ready`, (s) => s === 200, { label: 'ready before kill' })

compose('stop redis')
await sleep(500)

await pollUntil(`${base}/health/ready`, (s) => s === 503, {
  label: 'ready reports 503 while redis down',
  timeoutMs: 30_000,
})
const liveStatus = await fetchStatus(`${base}/health/live`)
if (liveStatus !== 200) {
  throw new Error(`expected liveness to stay 200 while degraded, got ${liveStatus}`)
}
console.log('[chaos] OK liveness stays 200 during redis outage')

compose('start redis')
await pollUntil(`${base}/health/ready`, (s) => s === 200, {
  label: 'ready recovers after redis restart',
  timeoutMs: 60_000,
})
console.log('[chaos] PASS chaos-kill-redis (degraded cleanly, recovered)')