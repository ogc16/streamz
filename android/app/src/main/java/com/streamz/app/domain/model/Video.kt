package com.streamz.app.domain.model

data class Video(
    val id: String,
    val title: String,
    val description: String,
    val thumbnailUrl: String,
    val playbackId: String,
    val durationSeconds: Int,
    val priceCents: Long,
    val rentalPriceCents: Long,
    val rentalDurationHours: Int,
    val genre: String,
    val releaseYear: Int,
    val rating: String,
    val featured: Boolean,
    val createdAt: String
) {
    val formattedDuration: String
        get() {
            val minutes = durationSeconds / 60
            val hours = minutes / 60
            val remainingMinutes = minutes % 60
            return if (hours > 0) "${hours}h ${remainingMinutes}m" else "${remainingMinutes}m"
        }

    val formattedBuyPrice: String
        get() = "$${"%.2f".format(priceCents / 100.0)}"

    val formattedRentalPrice: String
        get() = "$${"%.2f".format(rentalPriceCents / 100.0)}"
}
