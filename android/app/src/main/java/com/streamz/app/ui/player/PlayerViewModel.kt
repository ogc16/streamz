package com.streamz.app.ui.player

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.streamz.app.data.repository.StreamRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.inject.Inject

data class PlayerUiState(
    val playbackUrl: String? = null,
    val isLoading: Boolean = false,
    val isBuffering: Boolean = false,
    val error: String? = null
)

@HiltViewModel
class PlayerViewModel @Inject constructor(
    private val streamRepository: StreamRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(PlayerUiState())
    val uiState: StateFlow<PlayerUiState> = _uiState.asStateFlow()

    fun loadPlaybackUrl(playbackId: String) {
        viewModelScope.launch {
            _uiState.value = PlayerUiState(isLoading = true)
            try {
                val url = withContext(Dispatchers.IO) {
                    streamRepository.getPlaybackUrl(playbackId)
                }
                _uiState.value = PlayerUiState(playbackUrl = url)
            } catch (e: Exception) {
                _uiState.value = PlayerUiState(
                    error = e.message ?: "Failed to load video stream"
                )
            }
        }
    }

    fun onBufferingChanged(isBuffering: Boolean) {
        _uiState.value = _uiState.value.copy(isBuffering = isBuffering)
    }
}
