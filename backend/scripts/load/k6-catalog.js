import http from 'k6/http'
import { check } from 'k6'

const BASE = __ENV.BASE_URL || 'http://localhost:3000'

export const options = {
  stages: [
    { duration: '10s', target: 500 },
    { duration: '30s', target: 2000 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.001'],
    http_req_duration: ['p(95)<100'],
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
  const list = http.get(`${BASE}/api/videos`, { headers })
  check(list, { 'list 200': (r) => r.status === 200 })

  const featured = http.get(`${BASE}/api/videos/featured`, { headers })
  check(featured, { 'featured 200': (r) => r.status === 200 })
}