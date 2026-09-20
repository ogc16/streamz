import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, ChildProcess } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { Client } from 'pg'
import Redis from 'ioredis'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  PostgreSqlContainer,
  RedisContainer,
  StartedPostgreSqlContainer,
  StartedRedisContainer,
} from 'testcontainers'

const migrationsDir = join(__dirname, '..', '..', 'migrations')
const servicesDir = join(__dirname, '..', '..', 'services')

const WEBHOOK_PORT = 4105
const JWT_SECRET = 'integration-test-jwt-secret'
const WEBHOOK_SECRET = 'whsec_integration_test'

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
  let pg: StartedPostgreSqlContainer
  let redis: StartedRedisContainer
  let dbClient: Client
  let redisClient: Redis
  let webhook: ChildProcess
  let purchase: ChildProcess

  before(async () => {
    pg = await new PostgreSqlContainer('postgres:16-alpine').start()
    redis = await new RedisContainer('redis:7-alpine').start()

    const db = new Client({ connectionString: pg.getConnectionUri() })
    await db.connect()
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
    for (const file of files) {
      await db.query(readFileSync(join(migrationsDir, file), 'utf8'))
    }
    await db.end()

    dbClient = new Client({ connectionString: pg.getConnectionUri() })
    await dbClient.connect()
    redisClient = new Redis(redis.getConnectionUrl())

    const baseEnv = {
      JWT_SECRET,
      REDIS_HOST: '127.0.0.1',
      REDIS_PORT: String(redis.getMappedPort(6379)),
      DATABASE_URL: pg.getConnectionUri(),
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
        },
        stdio: 'pipe',
      }
    )

    purchase = spawn(
      process.execPath,
      ['--import', 'tsx', join(servicesDir, 'purchase', 'src', 'index.ts')],
      {
        env: { ...baseEnv, STRIPE_SECRET_KEY: 'sk_test_integration' },
        stdio: 'pipe',
      }
    )

    await waitForHttp(`http://127.0.0.1:${WEBHOOK_PORT}/webhooks/stripe`)
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
          id: 'pi_integration_001',
          amount: 1999,
          currency: 'usd',
          status: 'succeeded',
          metadata: {
            userId: 'user_it_1',
            videoId: 'video_it_1',
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
    const deadline = Date.now() + 15_000
    let purchaseRow: any = null
    while (Date.now() < deadline) {
      const result = await dbClient.query(
        "SELECT * FROM purchase_service.purchases WHERE stripe_payment_intent_id = 'pi_integration_001'"
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
       WHERE payload->>'paymentIntentId' = 'pi_integration_001'`
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