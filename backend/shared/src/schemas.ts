import { z } from 'zod'

export const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1, 'Name is required').max(100),
})

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
})

export const createVideoSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  genre: z.string().min(1),
  releaseYear: z.number().int().min(1900).max(2030),
  rating: z.string().min(1),
  priceCents: z.number().int().min(0),
  rentalPriceCents: z.number().int().min(0).optional(),
  rentalDurationHours: z.number().int().min(1).max(720).optional(),
  purchaseType: z.enum(['buy', 'rent', 'both']),
  featured: z.boolean().optional().default(false),
})

export const createPurchaseSchema = z.object({
  videoId: z.string().uuid(),
  type: z.enum(['buy', 'rent']),
})

export const paymentIntentSchema = z.object({
  videoId: z.string().uuid(),
  type: z.enum(['buy', 'rent']),
})
