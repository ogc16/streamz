package com.streamz.app.data.remote.dto

import com.google.gson.annotations.SerializedName

data class PaymentIntentRequest(
    val videoId: String,
    val type: String
)

data class PaymentIntentResponse(
    val clientSecret: String,
    val amount: Long
)

data class PurchaseDto(
    val id: String,
    val userId: String,
    val videoId: String,
    val type: String,
    val amountCents: Long,
    val status: String,
    val expiresAt: String?,
    val createdAt: String
)

data class PurchaseWithVideo(
    val purchase: PurchaseDto,
    val video: VideoDto
)

data class AccessCheckResponse(
    val hasAccess: Boolean,
    val type: String?,
    val expiresAt: String?
)
