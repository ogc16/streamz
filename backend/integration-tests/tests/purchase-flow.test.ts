import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, ChildProcess } from 'node:child_process'
import { createHmac, randomUUID } from 'node:crypto'
import { Client } from 'pg'
import Redis from 'ioredis'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers'

const migrationsDir = join(__dirname, '..', '..', 'migrations')
const servicesDir = join(__dirname, '..', '..', 'services')

const WEBHOOK_PORT = 4105
const JWT_SECRET = 'integration-test-jwt-secret'
const WEBHOOK_SECRET = 'whsec_integration_test'
// Ephemeral per-run password so no credential ever lives in the repo.
const PG_PASSWORD = randomUUID()

const USER_ID = '00000000-0000-4000-8000-000000000001'
const VIDEO_ID = '00000000-0000-4000-8000-000000000002'
const PAYMENT_INTENT_ID = 'pi_integration_001'

function signWebhook(body: string, timestamp: number, secret: string): string {
  const sig = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
  return `t=${timestamp},v1=${sig}`
}

async function waitForHttp(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.status < 500) return
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`timed out waiting for ${url}`)
}

describe('webhook -> purchase pipeline', () => {
  let pg: StartedTestContainer
  let redis: StartedTestContainer
  let dbClient: Client
  let redisClient: Redis
  let webhook: ChildProcess
  let purchase: ChildProcess

  before(async () => {
    pg = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({
        POSTGRES_DB: 'streamz',
        POSTGRES_USER: 'streamz',
        POSTGRES_PASSWORD: PG_PASSWORD,
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('ready to accept connections', 2))
      .start()
    redis = await new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .start()

    const connectionString = `postgresql://streamz:${PG_PASSWORD}@127.0.0.1:${pg.getMappedPort(5432)}/streamz`

    const db = new Client({ connectionString })
    await db.connect()
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
    for (const file of files) {
      await db.query(readFileSync(join(migrationsDir, file), 'utf8'))
    }
    await db.end()

    dbClient = new Client({ connectionString })
    await dbClient.connect()
    redisClient = new Redis({ host: '127.0.0.1', port: redis.getMappedPort(6379) })

    // Seed FK dependencies referenced by the purchase write
    await dbClient.query(
      `INSERT INTO auth_service.users (id, email, name, password_hash)
       VALUES ($1, $2, $3, $4)`,
      [USER_ID, 'integration@example.com', 'Integration User', '$2a$12$not-a-real-hash']
    )
    await dbClient.query(
      `INSERT INTO video_service.videos
         (id, title, description, price_cents, genre, release_year, rating, purchase_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [VIDEO_ID, 'Integration Test Film', 'Test fixture', 1999, 'test', 2026, 'PG', 'both']
    )

    const baseEnv = {
      JWT_SECRET,
      REDIS_HOST: '127.0.0.1',
      REDIS_PORT: String(redis.getMappedPort(6379)),
      DATABASE_URL: connectionString,
    }

    webhook = spawn(
      process.execPath,
      ['--import', 'tsx', join(servicesDir, 'webhook', 'src', 'index.ts')],
      {
        env: {
          ...baseEnv,
          WEBHOOK_SERVICE_PORT: String(WEBHOOK_PORT),
          STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
          MUX_WEBHOOK_SECRET: WEBHOOK_SECRET,
          MUX_TOKEN_ID: 'integration-test-mux-id',
          MUX_TOKEN_SECRET: 'integration-test-mux-secret',
          STRIPE_SECRET_KEY: 'sk_test_integration',
        },
        stdio: 'pipe',
      }
    )
    webhook.stdout?.on('data', (d) => process.stdout.write(`[webhook] ${d}`))
    webhook.stderr?.on('data', (d) => process.stderr.write(`[webhook!] ${d}`))

    purchase = spawn(
      process.execPath,
      ['--import', 'tsx', join(servicesDir, 'purchase', 'src', 'index.ts')],
      {
        env: { ...baseEnv, STRIPE_SECRET_KEY: 'sk_test_integration' },
        stdio: 'pipe',
      }
    )
    purchase.stdout?.on('data', (d) => process.stdout.write(`[purchase] ${d}`))
    purchase.stderr?.on('data', (d) => process.stderr.write(`[purchase!] ${d}`))

    await waitForHttp(`http://127.0.0.1:${WEBHOOK_PORT}/webhooks/stripe`)
    // Purchase must be subscribed before any event is sent, or the first publish
    // is lost (Redis pub/sub has no replay). Await its readiness explicitly.
    await waitForHttp(`http://127.0.0.1:4003/health/live`)
  })

  after(async () => {
    webhook?.kill('SIGTERM')
    purchase?.kill('SIGTERM')
    await redisClient?.quit()
    await dbClient?.end()
    await redis?.stop()
    await pg?.stop()
  })

  it('records a signed payment_intent.succeeded and replays outbox', async () => {
    const body = JSON.stringify({
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: PAYMENT_INTENT_ID,
          amount: 1999,
          currency: 'usd',
          status: 'succeeded',
          metadata: {
            userId: USER_ID,
            videoId: VIDEO_ID,
            purchaseType: 'buy',
          },
        },
      },
    })
    const ts = Math.floor(Date.now() / 1000)
    const header = signWebhook(body, ts, WEBHOOK_SECRET)

    const res = await fetch(`http://127.0.0.1:${WEBHOOK_PORT}/webhooks/stripe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Stripe-Signature': header },
      body,
    })
    assert.equal(res.status, 200)

    // Wait for purchase service to consume the event + write purchase + outbox
    const deadline = Date.now() + 30_000
    let purchaseRow: any = null
    while (Date.now() < deadline) {
      const result = await dbClient.query(
        'SELECT * FROM purchase_service.purchases WHERE stripe_payment_intent_id = $1',
        [PAYMENT_INTENT_ID]
      )
      if (result.rows.length > 0) {
        purchaseRow = result.rows[0]
        break
      }
      await new Promise((r) => setTimeout(r, 500))
    }

    assert.ok(purchaseRow, 'expected purchase row to be recorded')
    assert.equal(purchaseRow.status, 'completed')

    const outbox = await dbClient.query(
      `SELECT channel, published_at FROM events.outbox
       WHERE payload->>'paymentIntentId' = $1`,
      [PAYMENT_INTENT_ID]
    )
    assert.equal(outbox.rows.length, 1, 'expected one outbox entry')
    assert.equal(outbox.rows[0].channel, 'purchase:recorded')
    assert.ok(outbox.rows[0].published_at, 'expected outbox entry to be published')
  })

  it('rejects an invalid signature', async () => {
    const body = JSON.stringify({ type: 'payment_intent.succeeded', data: { object: {} } })
    const ts = Math.floor(Date.now() / 1000)
    const header = `t=${ts},v1=deadbeef`

    const res = await fetch(`http://127.0.0.1:${WEBHOOK_PORT}/webhooks/stripe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Stripe-Signature': header },
      body,
    })
    assert.equal(res.status, 400)
  })
})
