export interface JWTPayload {
  userId: string
  email: string
}

declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload
    }
  }
}

export interface UserDTO {
  id: string
  email: string
  name: string
  stripeCustomerId?: string
  createdAt: string
}

export interface VideoDTO {
  id: string
  title: string
  description: string
  thumbnailUrl: string
  playbackId: string
  durationSeconds: number
  priceCents: number
  rentalPriceCents: number | null
  rentalDurationHours: number | null
  genre: string
  releaseYear: number
  rating: string
  featured: boolean
  purchaseType: 'buy' | 'rent' | 'both'
  createdAt: string
}

export interface PurchaseDTO {
  id: string
  userId: string
  videoId: string
  type: 'buy' | 'rent'
  amountCents: number
  status: 'completed' | 'refunded' | 'expired'
  expiresAt: string | null
  createdAt: string
}

export interface StripeMetadata {
  userId: string
  videoId: string
  purchaseType: 'buy' | 'rent'
  rentalHours?: string
}

export interface ServiceResponse<T> {
  success: boolean
  data?: T
  error?: string
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  limit: number
}
