// Chaos: ensure the playback path never hangs when the signing/upstream path
// is unavailable. With signing unconfigured the streaming service must serve
// the public playback URL; with signing configured but Mux unreachable the
// request must fail fast (clear 5xx), not hang.
//
// Usage: node scripts/chaos-mux-down.mjs
//   BASE_URL  gateway base (http://localhost:3000)
import { loginToken } from './lib/chaos.mjs'

const base = process.env.BASE_URL || 'http://localhost:3000'
const playbackId = process.env.PLAYBACK_ID || 'demoPlaybackBuy'

const token = await loginToken(base)

const started = Date.now()
let res
try {
  res = await fetch(`${base}/api/stream/playback/${playbackId}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  })
} catch (error) {
  throw new Error(`playback request hung or crashed: ${error.message}`)
}
const elapsedMs = Date.now() - started

if (elapsedMs > 2000) {
  throw new Error(`playback setup took ${elapsedMs}ms (>2s) — server not degraded fast`)
}
if (res.status >= 500) {
  throw new Error(`playback setup returned 5xx with signing off: ${res.status}`)
}
console.log(`[chaos] OK playback setup in ${elapsedMs}ms -> ${res.status}`)
console.log('[chaos] PASS chaos-mux-down (fails fast / serves public URL, no hang)')