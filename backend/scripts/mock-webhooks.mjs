// Mock provider webhook sender for local development.
//
// Signs and posts synthetic Stripe / Mux events to the webhook service so you
// can exercise the full purchase pipeline without real payment infrastructure.
//
// Usage:
//   node scripts/mock-webhooks.mjs --provider stripe --event payment_intent.succeeded --secret whsec_xxx
//   node scripts/mock-webhooks.mjs --provider mux --event video.asset.ready --secret mux_sign_secret
//   node scripts/mock-webhooks.mjs --provider stripe --event charge.refunded --secret whsec_xxx --url http://localhost:4005/webhooks/stripe --print
//
// Flags:
//   --provider  stripe | mux            (default: stripe)
//   --event     event type string
//   --secret    provider webhook signing secret
//   --url       webhook endpoint URL
//   --params    optional JSON string merged into the event's `data` object
//   --print     only print the body + signature header, skip the POST
//
// Signatures use the same scheme as provider production payloads:
//   Stripe:  Stripe-Signature: t=<ts>,v1=<hmac-sha256(timestamp.body)>
//   Mux:     Mux-Signature:    t=<ts>,v1=<hmac-sha256(timestamp.body)>

import { createHmac } from 'node:crypto'

const args = process.argv.slice(2)

function flag(name) {
  const idx = args.indexOf(`--${name}`)
  if (idx === -1) return undefined
  const value = args[idx + 1]
  if (value === undefined || value.startsWith('--')) {
    console.error(`Missing value for --${name}`)
    process.exit(1)
  }
  return value
}

const provider = flag('provider') || 'stripe'
const event = flag('event') || 'payment_intent.succeeded'
const secret = flag('secret')
const url = flag('url')
const extraParams = flag('params')
const shouldPrint = args.includes('--print')

if (!secret) {
  console.error('Missing required flag: --secret <webhook signing secret>')
  process.exit(1)
}

function randomId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

function buildPayload(eventType) {
  const now = Math.floor(Date.now() / 1000)

  if (provider === 'mux') {
    if (eventType === 'video.upload.asset_created') {
      return {
        type: 'video.upload.asset_created',
        created_at: new Date().toISOString(),
        request_id: randomId('req'),
        object: { type: 'event' },
        id: randomId('evt'),
        environment_id: randomId('env'),
        data: {
          id: randomId('upl'),
          status: 'asset_created',
          asset_id: randomId('ast'),
        },
      }
    }
    if (eventType === 'video.asset.ready') {
      return {
        type: 'video.asset.ready',
        created_at: new Date().toISOString(),
        request_id: randomId('req'),
        object: { type: 'event' },
        id: randomId('evt'),
        environment_id: randomId('env'),
        data: {
          id: randomId('ast'),
          duration: 542.31,
          playback_ids: [{ id: randomId('play'), policy: 'public' }],
        },
      }
    }
    throw new Error(`Unsupported mux event: ${eventType}`)
  }

  if (provider === 'stripe') {
    if (eventType === 'payment_intent.succeeded') {
      return {
        id: randomId('evt'),
        object: 'event',
        api_version: '2025-02-24.acacia',
        created: now,
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: randomId('pi'),
            object: 'payment_intent',
            amount: 1999,
            currency: 'usd',
            status: 'succeeded',
            metadata: {
              userId: 'user_demo_0001',
              videoId: 'video_demo_0001',
              purchaseType: 'buy',
              rentalHours: '48',
            },
          },
        },
      }
    }
    if (eventType === 'charge.refunded') {
      return {
        id: randomId('evt'),
        object: 'event',
        api_version: '2025-02-24.acacia',
        created: now,
        type: 'charge.refunded',
        data: {
          object: {
            id: randomId('ch'),
            object: 'charge',
            payment_intent: randomId('pi'),
            status: 'succeeded',
            refunded: true,
            amount: 1999,
            currency: 'usd',
          },
        },
      }
    }
    throw new Error(`Unsupported stripe event: ${eventType}`)
  }

  throw new Error(`Unsupported provider: ${provider}`)
}

const payload = buildPayload(event)

if (extraParams) {
  let data
  try {
    data = JSON.parse(extraParams)
  } catch {
    console.error('--params must be valid JSON')
    process.exit(1)
  }
  Object.assign(payload.data || {}, data)
}

const body = JSON.stringify(payload)
const timestamp = Math.floor(Date.now() / 1000)
const signature = createHmac('sha256', secret)
  .update(`${timestamp}.${body}`)
  .digest('hex')
const signatureHeader = `t=${timestamp},v1=${signature}`
const headerName = provider === 'mux' ? 'Mux-Signature' : 'Stripe-Signature'

if (shouldPrint) {
  console.log(JSON.stringify({ headerName, signatureHeader, body }, null, 2))
  process.exit(0)
}

if (!url) {
  console.error('Missing --url for POST (or use --print)')
  process.exit(1)
}

const response = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    [headerName]: signatureHeader,
  },
  body,
})

const responseBody = await response.text()
console.log(`${response.status} ${response.statusText}`)
if (responseBody) console.log(responseBody)