import http from 'k6/http'
import { check } from 'k6'

const BASE = __ENV.BASE_URL || 'http://localhost:3000'
const VUS_MAX = Number(__ENV.VUS_MAX || 2000)
const VUS_INIT = Number(__ENV.VUS_INIT || VUS_MAX)

export const options = {
  stages: [
    // Stage 1 ramps to the rate-limit gate (VUS_INIT); if unset it defaults to
    // VUS_MAX so we never spike past the gate a CI run is validating. Ramping to
    // a larger VUS_INIT than the configured gate overshoots latency and fails the
    // P95 SLO check on host-limited runners for reasons unrelated to the service.
    { duration: __ENV.RAMP || '10s', target: VUS_INIT },
    { duration: __ENV.DURATION || '30s', target: VUS_MAX },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.001'],
    http_req_duration: [`p(95)<${__ENV.P95_MAX || '100'}`],
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