package com.streamz.app.data.remote.dto

data class VideoDto(
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
    val purchaseType: String?,
    val createdAt: String
)

data class VideoListResponse(
    val items: List<VideoDto>,
    val total: Int,
    val page: Int,
    val limit: Int
)

data class GenreCount(
    val genre: String,
    val count: Int
)

data class VideoDetailResponse(
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
    val purchaseType: String?,
    val createdAt: String,
    val purchased: Boolean
)
