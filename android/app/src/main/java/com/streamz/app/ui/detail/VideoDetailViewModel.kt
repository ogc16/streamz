package com.streamz.app.ui.detail

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.streamz.app.data.repository.PurchaseRepository
import com.streamz.app.data.repository.VideoRepository
import com.streamz.app.domain.model.Video
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class VideoDetailUiState(
    val video: Video? = null,
    val isPurchased: Boolean = false,
    val purchaseType: String? = null,
    val isLoading: Boolean = false,
    val error: String? = null
)

@HiltViewModel
class VideoDetailViewModel @Inject constructor(
    private val videoRepository: VideoRepository,
    private val purchaseRepository: PurchaseRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(VideoDetailUiState())
    val uiState: StateFlow<VideoDetailUiState> = _uiState.asStateFlow()

    fun loadVideo(videoId: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            try {
                val detail = videoRepository.getVideo(videoId)
                val access = purchaseRepository.checkAccess(videoId)
                _uiState.value = _uiState.value.copy(
                    video = detail.video,
                    isPurchased = access.hasAccess,
                    purchaseType = access.type,
                    isLoading = false
                )
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = e.message ?: "Failed to load video details"
                )
            }
        }
    }
}
