import http from 'k6/http'
import { check } from 'k6'

const BASE = __ENV.BASE_URL || 'http://localhost:3000'

export const options = {
  vus: Number(__ENV.VUS || 250),
  duration: __ENV.DURATION || '60s',
  thresholds: {
    http_req_failed: ['rate<0.005'],
    // Strict SLO target; CI passes P95_MAX for a runner-appropriate smoke gate.
    http_req_duration: [`p(95)<${__ENV.P95_MAX || '300'}`],
  },
}

const payload = JSON.stringify({
  email: __ENV.DEMO_EMAIL || 'demo@streamz.test',
  password: __ENV.DEMO_PASSWORD || 'demo-password',
})

export default function () {
  const res = http.post(`${BASE}/api/auth/login`, payload, {
    headers: { 'Content-Type': 'application/json' },
  })
  check(res, { 'login 200': (r) => r.status === 200 })
}