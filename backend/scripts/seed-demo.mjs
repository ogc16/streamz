// Seed the database with a demo user and a catalog of sample videos.
// Idempotent: fixed UUIDs + ON CONFLICT upserts, safe to re-run.
//
// Usage:
//   npm run seed:demo
//   DATABASE_URL=postgresql://... node scripts/seed-demo.mjs

import { Client } from 'pg'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'

// DATABASE_URL is required; never fall back to a hardcoded credential.
const connectionString = process.env.DATABASE_URL

const DEMO_USER = {
  email: 'demo@streamz.test',
  name: 'Demo User',
  password: 'demo-password',
}

const DEMO_VIDEOS = [
  {
    id: 'a1000000-0000-4000-8000-000000000001',
    title: 'Midnight Circuit',
    description: 'A synthwave racing thriller from the underground neon garages of Neo-Tokyo 2099.',
    genre: 'Sci-Fi',
    releaseYear: 2025,
    rating: 'PG-13',
    priceCents: 1299,
    rentalPriceCents: 499,
    rentalDurationHours: 48,
    durationSeconds: 7452,
    purchaseType: 'both',
    featured: true,
  },
  {
    id: 'a1000000-0000-4000-8000-000000000002',
    title: 'Harbor Lights',
    description: 'A tender indie drama set along the working docks of a fading coastal town.',
    genre: 'Drama',
    releaseYear: 2024,
    rating: 'PG',
    priceCents: 999,
    rentalPriceCents: 399,
    rentalDurationHours: 72,
    durationSeconds: 6120,
    purchaseType: 'both',
    featured: false,
  },
  {
    id: 'a1000000-0000-4000-8000-000000000003',
    title: 'The Last Cartridge',
    description: 'Retro arcade nostalgia meets a heist gone sideways in this 8-bit comedy.',
    genre: 'Comedy',
    releaseYear: 2023,
    rating: 'R',
    priceCents: 799,
    rentalPriceCents: 299,
    rentalDurationHours: 48,
    durationSeconds: 5400,
    purchaseType: 'both',
    featured: true,
  },
  {
    id: 'a1000000-0000-4000-8000-000000000004',
    title: 'Deep Field',
    description: 'A contemplative space documentary charting galaxies at the edge of the observable universe.',
    genre: 'Documentary',
    releaseYear: 2025,
    rating: 'PG',
    priceCents: 699,
    rentalPriceCents: null,
    rentalDurationHours: null,
    durationSeconds: 4320,
    purchaseType: 'buy',
    featured: false,
  },
  {
    id: 'a1000000-0000-4000-8000-000000000005',
    title: 'Velvet Static',
    description: 'A paranoid audio engineer uncovers a broadcast frequency only she can hear.',
    genre: 'Thriller',
    releaseYear: 2024,
    rating: 'R',
    priceCents: 1099,
    rentalPriceCents: 449,
    rentalDurationHours: 24,
    durationSeconds: 6780,
    purchaseType: 'both',
    featured: true,
  },
  {
    id: 'a1000000-0000-4000-8000-000000000006',
    title: 'Cinder',
    description: 'Urban arson investigator tracks a serial firestarter across three boroughs.',
    genre: 'Crime',
    releaseYear: 2022,
    rating: 'TV-MA',
    priceCents: 899,
    rentalPriceCents: 349,
    rentalDurationHours: 72,
    durationSeconds: 5880,
    purchaseType: 'both',
    featured: false,
  },
  {
    id: 'a1000000-0000-4000-8000-000000000007',
    title: 'Paper Planets',
    description: 'Stop-motion wonderland where a school of origami star-children build a new galaxy.',
    genre: 'Animation',
    releaseYear: 2025,
    rating: 'G',
    priceCents: 599,
    rentalPriceCents: 249,
    rentalDurationHours: 48,
    durationSeconds: 4980,
    purchaseType: 'both',
    featured: false,
  },
  {
    id: 'a1000000-0000-4000-8000-000000000008',
    title: 'Apex Bloom',
    description: 'Elite vineyard rivalries and a century-old family feud ferment into a springtime drama.',
    genre: 'Romance',
    releaseYear: 2023,
    rating: 'PG-13',
    priceCents: 949,
    rentalPriceCents: 399,
    rentalDurationHours: 48,
    durationSeconds: 5610,
    purchaseType: 'both',
    featured: false,
  },
]

async function main() {
  const client = new Client({ connectionString })
  await client.connect()

  const passwordHash = bcrypt.hashSync(DEMO_USER.password, 10)

  await client.query(
    `INSERT INTO auth_service.users (id, email, name, password_hash)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE
       SET name = EXCLUDED.name, updated_at = NOW()`,
    [randomUUID(), DEMO_USER.email, DEMO_USER.name, passwordHash]
  )

  const [{ id: userId }] = (await client.query(
    'SELECT id FROM auth_service.users WHERE email = $1',
    [DEMO_USER.email]
  )).rows

  for (const v of DEMO_VIDEOS) {
    await client.query(
      `INSERT INTO video_service.videos
         (id, title, description, thumbnail_url, duration_seconds, price_cents,
          rental_price_cents, rental_duration_hours, genre, release_year, rating,
          featured, purchase_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (id) DO UPDATE
         SET title = EXCLUDED.title,
             description = EXCLUDED.description,
             price_cents = EXCLUDED.price_cents,
             rental_price_cents = EXCLUDED.rental_price_cents,
             rental_duration_hours = EXCLUDED.rental_duration_hours,
             genre = EXCLUDED.genre,
             featured = EXCLUDED.featured,
             purchase_type = EXCLUDED.purchase_type,
             updated_at = NOW()`,
      [
        v.id,
        v.title,
        v.description,
        `https://image.mux.com/${v.id.slice(0, 12)}/thumbnail.jpg`,
        v.durationSeconds,
        v.priceCents,
        v.rentalPriceCents,
        v.rentalDurationHours,
        v.genre,
        v.releaseYear,
        v.rating,
        v.featured,
        v.purchaseType,
      ]
    )
  }

  // With SEED_PURCHASE=1, grant the demo user access to two titles so the
  // playback flow returns a real signed/public URL (used by load + walkthroughs).
  if (process.env.SEED_PURCHASE === '1') {
    await client.query(
      `INSERT INTO purchase_service.purchases
         (user_id, video_id, stripe_payment_intent_id, type, amount_cents, status, expires_at)
       VALUES
         ($1, $2, 'pi_demo_buy_001',  'buy', 1299, 'completed', NULL),
         ($1, $3, 'pi_demo_rent_001', 'rent', 499, 'completed', NOW() + INTERVAL '48 hours')
       ON CONFLICT (stripe_payment_intent_id) DO NOTHING`,
      [userId, DEMO_VIDEOS[0].id, DEMO_VIDEOS[1].id]
    )
    console.log('  purchase demo user has access to', DEMO_VIDEOS[0].title, '(buy) and', DEMO_VIDEOS[1].title, '(rent)')

    // Give the purchased titles playback IDs so /api/stream/playback returns a URL.
    await client.query(
      `UPDATE video_service.videos SET mux_playback_id = $1 WHERE id = $2`,
      ['demoPlaybackBuy', DEMO_VIDEOS[0].id]
    )
    await client.query(
      `UPDATE video_service.videos SET mux_playback_id = $1 WHERE id = $2`,
      ['demoPlaybackRent', DEMO_VIDEOS[1].id]
    )
  }

  await client.end()

  console.log('Seeded:')
  console.log(`  user   ${DEMO_USER.email} / ${DEMO_USER.password} (id ${userId})`)
  console.log(`  videos ${DEMO_VIDEOS.length}`)
  console.log('\nNext steps:')
  console.log('  npm run dev')
  console.log('  POST /api/auth/login {"email":"demo@streamz.test","password":"demo-password"}')
  console.log('  npm run mock:webhook   # replay a fake Stripe payment -> purchase + outbox')
}

main().catch((error) => {
  console.error('Seed failed:', error.message)
  process.exit(1)
})