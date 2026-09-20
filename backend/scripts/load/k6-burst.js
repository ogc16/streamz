import http from 'k6/http'
import { check } from 'k6'

// Burst: hammer from idle to 10k users in 60s and prove p95 stays < 250 ms.
const BASE = __ENV.BASE_URL || 'http://localhost:3000'

export const options = {
  stages: [
    { duration: '10s', target: 1000 },
    { duration: '40s', target: 10000 },
    { duration: '10s', target: 10000 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<250'],
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
  const res = http.get(`${BASE}/api/videos`, { headers })
  check(res, { 'catalog 200 under burst': (r) => r.status === 200 })
}