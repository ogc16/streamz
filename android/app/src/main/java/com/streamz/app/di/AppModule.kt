package com.streamz.app.di

import com.streamz.app.data.local.TokenManager
import com.streamz.app.data.remote.ApiClient
import com.streamz.app.data.remote.ApiService
import com.streamz.app.data.repository.AuthRepository
import com.streamz.app.data.repository.PurchaseRepository
import com.streamz.app.data.repository.StreamRepository
import com.streamz.app.data.repository.VideoRepository
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    @Provides
    @Singleton
    fun provideApiService(apiClient: ApiClient): ApiService {
        return apiClient.getApi()
    }

    @Provides
    @Singleton
    fun provideAuthRepository(
        apiService: ApiService,
        tokenManager: TokenManager
    ): AuthRepository {
        return AuthRepository(apiService, tokenManager)
    }

    @Provides
    @Singleton
    fun provideVideoRepository(apiService: ApiService): VideoRepository {
        return VideoRepository(apiService)
    }

    @Provides
    @Singleton
    fun providePurchaseRepository(apiService: ApiService): PurchaseRepository {
        return PurchaseRepository(apiService)
    }

    @Provides
    @Singleton
    fun provideStreamRepository(apiService: ApiService): StreamRepository {
        return StreamRepository(apiService)
    }
}
