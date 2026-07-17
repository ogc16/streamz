package com.streamz.app.data.repository

import com.streamz.app.data.local.TokenManager
import com.streamz.app.data.remote.ApiService
import com.streamz.app.data.remote.dto.LoginRequest
import com.streamz.app.data.remote.dto.RegisterRequest
import com.streamz.app.data.remote.dto.UserDto
import com.streamz.app.domain.model.User
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthRepository @Inject constructor(
    private val api: ApiService,
    private val tokenManager: TokenManager
) {
    suspend fun login(email: String, password: String): User {
        val response = api.login(LoginRequest(email, password))
        tokenManager.saveTokens(response.accessToken, response.refreshToken)
        return response.user.toDomain()
    }

    suspend fun register(email: String, password: String, name: String): User {
        val response = api.register(RegisterRequest(email, password, name))
        tokenManager.saveTokens(response.accessToken, response.refreshToken)
        return response.user.toDomain()
    }

    suspend fun logout() {
        try {
            api.logout()
        } catch (_: Exception) {
        } finally {
            tokenManager.clearTokens()
        }
    }

    suspend fun getCurrentUser(): User {
        return api.getMe().toDomain()
    }

    suspend fun restoreSession(): User? {
        val token = tokenManager.accessToken.first()
        return if (token != null) {
            try {
                getCurrentUser()
            } catch (_: Exception) {
                tokenManager.clearTokens()
                null
            }
        } else null
    }

    fun isLoggedIn(): Flow<Boolean> {
        return tokenManager.accessToken.map { it != null }
    }

    private fun UserDto.toDomain() = User(
        id = id,
        email = email,
        name = name,
        stripeCustomerId = stripeCustomerId,
        createdAt = createdAt
    )
}
