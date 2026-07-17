package com.streamz.app.data.repository

import com.streamz.app.data.remote.ApiService
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class StreamRepository @Inject constructor(
    private val api: ApiService
) {
    suspend fun getPlaybackUrl(playbackId: String): String {
        val response = api.getPlaybackUrl(playbackId)
        return response.playbackUrl
    }
}
