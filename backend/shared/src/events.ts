export const EVENTS = {
  USER_CREATED: 'user:created',
  PURCHASE_COMPLETED: 'purchase:completed',
  PURCHASE_RECORDED: 'purchase:recorded',
  PURCHASE_REFUNDED: 'purchase:refunded',
  RENTAL_CLEANUP: 'rental:cleanup',
  VIDEO_ASSET_CREATED: 'video:asset_created',
  VIDEO_ASSET_READY: 'video:asset.ready',
} as const

export type PurchaseType = 'buy' | 'rent'

export interface PurchaseCompletedEvent {
  userId: string
  videoId: string
  paymentIntentId: string
  purchaseType: 'buy' | 'rent'
  amountCents: number
  expiresAt: string | null
}

export interface PurchaseRecordedEvent extends PurchaseCompletedEvent {
  recordedAt: string
}

export interface PurchaseRefundedEvent {
  paymentIntentId: string
}

export interface RentalCleanupEvent {
  id: string
}

export interface VideoAssetCreatedEvent {
  uploadId: string
  assetId: string
}

export interface VideoAssetReadyEvent {
  assetId: string
  playbackId: string | null
  durationSeconds: number
}