package com.streamz.app.data.repository

import com.streamz.app.data.remote.ApiService
import com.streamz.app.data.remote.dto.VideoDto
import com.streamz.app.data.remote.dto.VideoDetailResponse
import com.streamz.app.data.remote.dto.GenreCount
import com.streamz.app.domain.model.Video
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class VideoRepository @Inject constructor(
    private val api: ApiService
) {
    suspend fun getVideos(
        genre: String? = null,
        featured: Boolean? = null,
        search: String? = null,
        page: Int = 1,
        limit: Int = 20,
        sort: String = "created_at",
        order: String = "desc"
    ): VideoListResult {
        val response = api.getVideos(genre, featured, search, page, limit, sort, order)
        return VideoListResult(
            items = response.items.map { it.toDomain() },
            total = response.total,
            page = response.page,
            limit = response.limit
        )
    }

    suspend fun getFeaturedVideos(): List<Video> {
        return api.getFeaturedVideos().map { it.toDomain() }
    }

    suspend fun getGenres(): List<GenreCount> {
        return api.getGenres()
    }

    suspend fun getVideo(id: String): VideoDetailResult {
        val response = api.getVideo(id)
        return VideoDetailResult(
            video = response.toDomain(),
            purchased = response.purchased,
            purchaseType = response.purchaseType
        )
    }
}

data class VideoListResult(
    val items: List<Video>,
    val total: Int,
    val page: Int,
    val limit: Int
)

data class VideoDetailResult(
    val video: Video,
    val purchased: Boolean,
    val purchaseType: String?
)

fun VideoDto.toDomain() = Video(
    id = id,
    title = title,
    description = description,
    thumbnailUrl = thumbnailUrl,
    playbackId = playbackId,
    durationSeconds = durationSeconds,
    priceCents = priceCents,
    rentalPriceCents = rentalPriceCents,
    rentalDurationHours = rentalDurationHours,
    genre = genre,
    releaseYear = releaseYear,
    rating = rating,
    featured = featured,
    createdAt = createdAt
)

fun VideoDetailResponse.toDomain() = Video(
    id = id,
    title = title,
    description = description,
    thumbnailUrl = thumbnailUrl,
    playbackId = playbackId,
    durationSeconds = durationSeconds,
    priceCents = priceCents,
    rentalPriceCents = rentalPriceCents,
    rentalDurationHours = rentalDurationHours,
    genre = genre,
    releaseYear = releaseYear,
    rating = rating,
    featured = featured,
    createdAt = createdAt
)
