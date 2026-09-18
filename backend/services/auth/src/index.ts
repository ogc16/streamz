import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { Pool } from 'pg'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import Stripe from 'stripe'
import { Redis } from 'ioredis'
import { registerSchema, loginSchema, JWTPayload, UserDTO } from '@streamz/shared'

dotenv.config()

const app = express()
const PORT = process.env.AUTH_SERVICE_PORT || 4001

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
})

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-02-24.acacia',
})

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
})

app.use(cors())
app.use(express.json())

function generateTokens(payload: JWTPayload) {
  const accessToken = jwt.sign(payload, process.env.JWT_SECRET!, {
    expiresIn: '15m',
  })
  const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET!, {
    expiresIn: '7d',
  })
  return { accessToken, refreshToken }
}

function userToDTO(user: any): UserDTO {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    stripeCustomerId: user.stripe_customer_id,
    createdAt: user.created_at.toISOString(),
  }
}

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = registerSchema.parse(req.body)

    const existing = await pool.query(
      'SELECT id FROM auth_service.users WHERE email = $1',
      [email]
    )
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' })
    }

    const passwordHash = await bcrypt.hash(password, 12)

    const stripeCustomer = await stripe.customers.create({
      email,
      name,
      metadata: { service: 'streamz' },
    })

    const result = await pool.query(
      `INSERT INTO auth_service.users (email, name, password_hash, stripe_customer_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [email, name, passwordHash, stripeCustomer.id]
    )

    const user = result.rows[0]
    const tokens = generateTokens({ userId: user.id, email: user.email })

    await redis.setex(
      `session:${user.id}`,
      604800,
      JSON.stringify(tokens)
    )

    await redis.publish('user:created', JSON.stringify({
      userId: user.id,
      email: user.email,
      name: user.name,
    }))

    res.status(201).json({
      user: userToDTO(user),
      ...tokens,
    })
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: error.errors })
    }
    console.error('Registration error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = loginSchema.parse(req.body)

    const result = await pool.query(
      'SELECT * FROM auth_service.users WHERE email = $1',
      [email]
    )

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    const user = result.rows[0]
    const validPassword = await bcrypt.compare(password, user.password_hash)

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    const tokens = generateTokens({ userId: user.id, email: user.email })

    await redis.setex(
      `session:${user.id}`,
      604800,
      JSON.stringify(tokens)
    )

    res.json({
      user: userToDTO(user),
      ...tokens,
    })
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: error.errors })
    }
    console.error('Login error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.post('/api/auth/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required' })
    }

    const decoded = jwt.verify(
      refreshToken,
      process.env.JWT_REFRESH_SECRET!
    ) as JWTPayload

    const tokens = generateTokens({ userId: decoded.userId, email: decoded.email })

    await redis.setex(
      `session:${decoded.userId}`,
      604800,
      JSON.stringify(tokens)
    )

    res.json(tokens)
  } catch (error) {
    res.status(401).json({ error: 'Invalid refresh token' })
  }
})

app.post('/api/auth/logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader) {
      return res.status(401).json({ error: 'No token provided' })
    }

    const token = authHeader.split(' ')[1]
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JWTPayload

    await redis.del(`session:${decoded.userId}`)

    res.json({ message: 'Logged out successfully' })
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' })
  }
})

app.get('/api/auth/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader) {
      return res.status(401).json({ error: 'No token provided' })
    }

    const token = authHeader.split(' ')[1]
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JWTPayload

    const result = await pool.query(
      'SELECT * FROM auth_service.users WHERE id = $1',
      [decoded.userId]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' })
    }

    res.json({ user: userToDTO(result.rows[0]) })
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' })
  }
})

app.listen(PORT, () => {
  console.log(`Auth service running on port ${PORT}`)
})

export { pool, redis }
