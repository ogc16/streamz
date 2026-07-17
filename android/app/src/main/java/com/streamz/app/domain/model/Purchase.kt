package com.streamz.app.domain.model

data class Purchase(
    val id: String,
    val userId: String,
    val videoId: String,
    val type: String,
    val amountCents: Long,
    val status: String,
    val expiresAt: String?,
    val createdAt: String,
    val videoTitle: String,
    val videoThumbnailUrl: String,
    val videoGenre: String
) {
    val formattedAmount: String
        get() = "$${"%.2f".format(amountCents / 100.0)}"

    val isRental: Boolean
        get() = type == "rental"

    val isPurchase: Boolean
        get() = type == "buy"
}
