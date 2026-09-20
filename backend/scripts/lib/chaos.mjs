import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// scripts/lib -> scripts -> backend/
const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// Node on Windows sometimes fails to resolve programs on PATH for shell-less
// spawn. Prefer DOCKER, else the on-PATH runner, else the Docker Desktop path.
let dockerPath = null
export function docker() {
  if (dockerPath) return dockerPath
  const candidates = process.env.DOCKER ? [process.env.DOCKER] : []
  if (process.platform === 'win32') {
    candidates.push('C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe')
  }
  candidates.push('docker')
  for (const c of candidates) {
    try {
      const res = execFileSync(c, ['version', '--format', '{{.Server.Version}}'], {
        encoding: 'utf8',
        timeout: 30_000,
      })
      if (res) {
        dockerPath = c
        return c
      }
    } catch {
      // try next candidate
    }
  }
  throw new Error('[chaos] docker not resolvable; install Docker Desktop or point DOCKER at the binary')
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

export async function fetchStatus(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
    return res.status
  } catch {
    return 0
  }
}

// Poll `url` until `predicate(status)` is true or timeout. Returns final status.
export async function pollUntil(url, predicate, { timeoutMs = 30_000, label = url, stepMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs
  let last = 0
  while (Date.now() < deadline) {
    last = await fetchStatus(url)
    if (predicate(last)) {
      console.log(`[chaos] OK ${label} -> ${last}`)
      return last
    }
    await sleep(stepMs)
  }
  throw new Error(`[chaos] TIMEOUT waiting for "${label}" to satisfy predicate (last=${last})`)
}

export function compose(cmd, { cwd = backendDir, env = {} } = {}) {
  // docker, not cmd: keeps the helper working on both Windows dev boxes and Linux CI.
  execFileSync(docker(), ['compose', ...cmd.split(' ')], {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  })
}

export async function loginToken(base = 'http://localhost:3000') {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: process.env.DEMO_EMAIL || 'demo@streamz.test',
      password: process.env.DEMO_PASSWORD || 'demo-password',
    }),
    signal: AbortSignal.timeout(5000),
  })
  if (res.status !== 200) {
    throw new Error(`login failed (${res.status}): ${res.statusText}`)
  }
  const body = await res.json()
  return body.accessToken
}