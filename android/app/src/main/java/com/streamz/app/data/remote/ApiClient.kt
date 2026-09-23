package com.streamz.app.data.remote

import com.streamz.app.BuildConfig
import com.streamz.app.data.local.TokenManager
import com.streamz.app.data.remote.dto.RefreshRequest
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ApiClient @Inject constructor(
    private val tokenManager: TokenManager
) {
    private val apiService: ApiService by lazy {
        createApiService()
    }

    fun getApi(): ApiService = apiService

    fun createApiService(baseUrl: String = BASE_URL): ApiService {
        val loggingInterceptor = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BODY
        }

        val authInterceptor = Interceptor { chain ->
            val token = runBlocking { tokenManager.accessToken.first() }
            val request = if (token != null) {
                chain.request().newBuilder()
                    .addHeader("Authorization", "Bearer $token")
                    .build()
            } else {
                chain.request()
            }
            chain.proceed(request)
        }

        val refreshInterceptor = Interceptor { chain ->
            val originalRequest = chain.request()
            val response = chain.proceed(originalRequest)

            if (response.code == 401) {
                val refreshToken = runBlocking { tokenManager.refreshToken.first() }
                if (refreshToken != null) {
                    synchronized(this) {
                        val currentToken = runBlocking { tokenManager.accessToken.first() }
                        if (originalRequest.header("Authorization") == "Bearer $currentToken") {
                            val retrofit = Retrofit.Builder()
                                .baseUrl(baseUrl)
                                .addConverterFactory(GsonConverterFactory.create())
                                .build()
                            val refreshService = retrofit.create(ApiService::class.java)
                            try {
                                val refreshResponse = runBlocking {
                                    refreshService.refresh(RefreshRequest(refreshToken))
                                }
                                runBlocking {
                                    tokenManager.saveTokens(
                                        refreshResponse.accessToken,
                                        refreshResponse.refreshToken
                                    )
                                }
                                val newRequest = originalRequest.newBuilder()
                                    .header("Authorization", "Bearer ${refreshResponse.accessToken}")
                                    .build()
                                response.close()
                                return@Interceptor chain.proceed(newRequest)
                            } catch (e: Exception) {
                                runBlocking { tokenManager.clearTokens() }
                            }
                        } else {
                            val newToken = runBlocking { tokenManager.accessToken.first() }
                            if (newToken != null) {
                                val newRequest = originalRequest.newBuilder()
                                    .header("Authorization", "Bearer $newToken")
                                    .build()
                                response.close()
                                return@Interceptor chain.proceed(newRequest)
                            }
                        }
                    }
                }
            }
            response
        }

        val client = OkHttpClient.Builder()
            .addInterceptor(authInterceptor)
            .addInterceptor(refreshInterceptor)
            .addInterceptor(loggingInterceptor)
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .build()

        return Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(client)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(ApiService::class.java)
    }

    companion object {
        const val BASE_URL = BuildConfig.API_BASE_URL
    }
}
