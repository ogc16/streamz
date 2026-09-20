import http from 'k6/http'
import { check } from 'k6'

const BASE = __ENV.BASE_URL || 'http://localhost:3000'
// Seeded playback ids from seed-demo.mjs (SEED_PURCHASE=1).
const PLAYBACK_ID = __ENV.PLAYBACK_ID || 'demoPlaybackBuy'

export const options = {
  stages: [
    { duration: __ENV.RAMP || '10s', target: Number(__ENV.VUS_INIT || 200) },
    { duration: __ENV.DURATION || '30s', target: Number(__ENV.VUS_MAX || 1000) },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.001'],
    http_req_duration: [`p(95)<${__ENV.P95_MAX || '200'}`],
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
  const res = http.get(`${BASE}/api/stream/playback/${PLAYBACK_ID}`, {
    headers: { Authorization: `Bearer ${data.token}` },
  })
  check(res, { 'playback setup 200': (r) => r.status === 200 })
}