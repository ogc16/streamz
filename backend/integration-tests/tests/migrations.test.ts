import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from 'pg'
import { PostgreSqlContainer, StartedPostgreSqlContainer } from 'testcontainers'

const migrationsDir = join(__dirname, '..', '..', 'migrations')

describe('database migrations', () => {
  let pg: StartedPostgreSqlContainer
  let client: Client

  before(async () => {
    pg = await new PostgreSqlContainer('postgres:16-alpine').start()
    client = new Client({ connectionString: pg.getConnectionUri() })
    await client.connect()
  })

  after(async () => {
    await client?.end()
    await pg?.stop()
  })

  it('applies all migration files in order', async () => {
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()

    assert.ok(files.length >= 2, 'expected at least the initial schema + outbox migrations')

    for (const file of files) {
      const sql = readFileSync(join(migrationsDir, file), 'utf8')
      await client.query(sql)
    }
  })

  it('creates the expected tables and schemas', async () => {
    const tables = await client.query(
      `SELECT schemaname, tablename FROM pg_tables
       WHERE schemaname IN ('auth_service', 'video_service', 'purchase_service')`
    )
    const names = tables.rows.map((r) => `${r.schemaname}.${r.tablename}`)
    for (const expected of ['auth_service.users', 'video_service.videos', 'purchase_service.purchases']) {
      assert.ok(names.includes(expected), `missing table ${expected}`)
    }

    const outbox = await client.query(
      `SELECT to_regclass('events.outbox') AS reg`
    )
    assert.ok(outbox.rows[0].reg, 'expected events.outbox table')
  })
})