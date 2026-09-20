import { tracer } from './tracing'

export interface SecretsResolution {
  env: string | undefined
  jsonMount: string // base64 JSON injected at SECRETS_JSON, e.g. k8s projected secret
  missing: string[]
}

export function loadSecrets(required: string[]): SecretsResolution {
  const resolution: SecretsResolution = { env: process.env.SECRETS_JSON, jsonMount: '', missing: [] }

  // Allow a base64-encoded JSON blob (image/k8s secret-mount pattern) to satisfy
  // required values ahead of the environment, so the same image runs in dev (.env)
  // and in production (Vault -> projected Secret).
  if (resolution.env) {
    try {
      const blob = JSON.parse(Buffer.from(resolution.env, 'base64').toString('utf8'))
      for (const key of required) {
        if (blob[key]) {
          process.env[key] = String(blob[key])
        }
      }
    } catch (error) {
      tracer.error(undefined, '[secrets] SECRETS_JSON is set but could not be parsed:', error)
    }
  }

  for (const key of required) {
    if (!process.env[key]) {
      resolution.missing.push(key)
    }
  }
  return resolution
}

export function requireSecrets(required: string[]): void {
  const { missing } = loadSecrets(required)
  if (missing.length > 0) {
    const err = new Error(`Missing required secrets: ${missing.join(', ')}`)
    tracer.error(undefined, '[secrets]', err.message)
    throw err
  }
}