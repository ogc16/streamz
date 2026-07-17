package com.streamz.app.data.repository

import com.streamz.app.data.remote.ApiService
import com.streamz.app.data.remote.dto.PaymentIntentRequest
import com.streamz.app.data.remote.dto.PaymentIntentResponse
import com.streamz.app.data.remote.dto.AccessCheckResponse
import com.streamz.app.data.remote.dto.PurchaseWithVideo
import com.streamz.app.data.remote.dto.PurchaseDto
import com.streamz.app.domain.model.Purchase
import com.streamz.app.domain.model.Video
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class PurchaseRepository @Inject constructor(
    private val api: ApiService
) {
    suspend fun createPaymentIntent(videoId: String, type: String): PaymentIntentResponse {
        return api.createPaymentIntent(PaymentIntentRequest(videoId, type))
    }

    suspend fun getPurchases(): List<PurchaseWithVideo> {
        return api.getPurchases()
    }

    suspend fun checkAccess(videoId: String): AccessCheckResponse {
        return api.checkAccess(videoId)
    }

    fun PurchaseWithVideo.toPurchase(): Purchase {
        return Purchase(
            id = purchase.id,
            userId = purchase.userId,
            videoId = purchase.videoId,
            type = purchase.type,
            amountCents = purchase.amountCents,
            status = purchase.status,
            expiresAt = purchase.expiresAt,
            createdAt = purchase.createdAt,
            videoTitle = video.title,
            videoThumbnailUrl = video.thumbnailUrl,
            videoGenre = video.genre
        )
    }
}
