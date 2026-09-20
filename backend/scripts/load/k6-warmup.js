import http from 'k6/http'

const BASE = __ENV.BASE_URL || 'http://localhost:3000'

export const options = {
  vus: 1,
  duration: '60s',
}

// Warm the stack before measuring: primes connection pools, Redis cache and JIT.
export default function () {
  const res = http.get(`${BASE}/health`)
  if (res.status >= 500) {
    console.error(`warmup: /health -> ${res.status}`)
  }
}