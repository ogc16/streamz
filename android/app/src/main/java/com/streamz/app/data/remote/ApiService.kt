package com.streamz.app.data.remote

import com.streamz.app.data.remote.dto.*
import retrofit2.http.*

interface ApiService {

    // Auth
    @POST("api/auth/register")
    suspend fun register(@Body request: RegisterRequest): AuthResponse

    @POST("api/auth/login")
    suspend fun login(@Body request: LoginRequest): AuthResponse

    @POST("api/auth/refresh")
    suspend fun refresh(@Body request: RefreshRequest): RefreshResponse

    @POST("api/auth/logout")
    suspend fun logout(): MessageResponse

    @GET("api/auth/me")
    suspend fun getMe(): UserResponse

    // Videos
    @GET("api/videos")
    suspend fun getVideos(
        @Query("genre") genre: String? = null,
        @Query("featured") featured: Boolean? = null,
        @Query("search") search: String? = null,
        @Query("page") page: Int = 1,
        @Query("limit") limit: Int = 20,
        @Query("sort") sort: String = "created_at",
        @Query("order") order: String = "desc"
    ): VideoListResponse

    @GET("api/videos/featured")
    suspend fun getFeaturedVideos(): List<VideoDto>

    @GET("api/videos/genres")
    suspend fun getGenres(): List<GenreCount>

    @GET("api/videos/{id}")
    suspend fun getVideo(@Path("id") videoId: String): VideoDetailResponse

    // Purchases
    @POST("api/purchases/create-payment-intent")
    suspend fun createPaymentIntent(@Body request: PaymentIntentRequest): PaymentIntentResponse

    @GET("api/purchases")
    suspend fun getPurchases(): List<PurchaseWithVideo>

    @GET("api/purchases/check/{videoId}")
    suspend fun checkAccess(@Path("videoId") videoId: String): AccessCheckResponse

    // Streaming
    @GET("api/stream/playback/{playbackId}")
    suspend fun getPlaybackUrl(@Path("playbackId") playbackId: String): PlaybackUrlResponse
}

data class PlaybackUrlResponse(
    val playbackUrl: String,
    val playbackId: String
)
