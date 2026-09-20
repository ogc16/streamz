import http from 'k6/http'
import { check } from 'k6'

// Long soak: 10k concurrent streams (playback setup + catalog reads) with
// < 200 ms p95. Run against the full compose stack, ideally as prod-shaped.
const BASE = __ENV.BASE_URL || 'http://localhost:3000'
const PLAYBACK_ID = __ENV.PLAYBACK_ID || 'demoPlaybackBuy'

export const options = {
  stages: [
    { duration: '1m', target: 2000 },
    { duration: '2m', target: 10000 },
    { duration: '5m', target: 10000 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.001'],
    http_req_duration: ['p(95)<200'],
    http_req_duration: ['p(99)<500'],
  },
}

export function setup() {
  const r = http.post(
    `${BASE}/api/auth/login`,
    JSON.stringify({ email: 'demo@streamz.test', password: 'demo-password' }),
    { headers: { 'Content-Type': 'application/json' } }
  )
  return { token: r.json('accessToken') }
}

export default function (data) {
  const headers = { Authorization: `Bearer ${data.token}` }
  // Playback setup is the min-cost path a real streamer hits; catalog read
  // exercises the Redis-cached list path under the same load.
  const playback = http.get(`${BASE}/api/stream/playback/${PLAYBACK_ID}`, { headers })
  check(playback, { 'playback 200 during soak': (r) => r.status === 200 })

  const catalog = http.get(`${BASE}/api/videos`, { headers })
  check(catalog, { 'catalog 200 during soak': (r) => r.status === 200 })
}