// Chaos: drop the Postgres connection pool and assert services degrade to
// 503 readiness (liveness stays up) then recover.
//
// Usage: node scripts/chaos-drop-pg.mjs
//   BASE_PG_URL video service base (http://localhost:4002)
import { pollUntil, compose, sleep, fetchStatus } from './lib/chaos.mjs'

const base = process.env.BASE_PG_URL || 'http://localhost:4002'

await pollUntil(`${base}/health/ready`, (s) => s === 200, { label: 'video ready before drop' })

compose('stop postgres')
await sleep(500)

await pollUntil(`${base}/health/ready`, (s) => s === 503, {
  label: 'video ready reports 503 while postgres down',
  timeoutMs: 30_000,
})
const liveStatus = await fetchStatus(`${base}/health/live`)
if (liveStatus !== 200) {
  throw new Error(`expected liveness to stay 200 while degraded, got ${liveStatus}`)
}
console.log('[chaos] OK liveness stays 200 during db outage')

compose('start postgres')
await pollUntil(`${base}/health/ready`, (s) => s === 200, {
  label: 'video ready recovers after postgres restart',
  timeoutMs: 120_000,
})
console.log('[chaos] PASS chaos-drop-pg (degraded cleanly, recovered)')