import http from 'k6/http'
import { check } from 'k6'

const BASE = __ENV.BASE_URL || 'http://localhost:3000'
// Seeded purchased video id from seed-demo.mjs (SEED_PURCHASE=1).
const VIDEO_ID = __ENV.VIDEO_ID || 'a1000000-0000-4000-8000-000000000001'

export const options = {
  vus: Number(__ENV.VUS || 250),
  duration: __ENV.DURATION || '60s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: [`p(95)<${__ENV.P95_MAX || '400'}`],
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
  const check = http.get(`${BASE}/api/purchases/check/${VIDEO_ID}`, { headers })
  const ok = check.status >= 200 && check.status < 500
  if (ok && check.status !== 200) {
    console.error(`purchase check unexpected status ${check.status}`)
  }
  if (!ok) {
    check(`${BASE}/api/purchases/check/${VIDEO_ID}`, { 'valid response': (r) => r.status < 500 })
  }
}