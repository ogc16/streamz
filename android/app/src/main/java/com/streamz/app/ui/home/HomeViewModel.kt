package com.streamz.app.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.streamz.app.data.remote.dto.GenreCount
import com.streamz.app.data.repository.VideoRepository
import com.streamz.app.domain.model.Video
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class HomeUiState(
    val featuredVideos: List<Video> = emptyList(),
    val videos: List<Video> = emptyList(),
    val genres: List<GenreCount> = emptyList(),
    val selectedGenre: String? = null,
    val searchQuery: String = "",
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val error: String? = null,
    val currentPage: Int = 1,
    val hasMore: Boolean = true
)

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val videoRepository: VideoRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(HomeUiState())
    val uiState: StateFlow<HomeUiState> = _uiState.asStateFlow()

    init {
        loadInitialData()
    }

    fun loadInitialData() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            try {
                val featured = videoRepository.getFeaturedVideos()
                val genres = videoRepository.getGenres()
                val result = videoRepository.getVideos(page = 1, limit = 20)
                _uiState.value = _uiState.value.copy(
                    featuredVideos = featured,
                    videos = result.items,
                    genres = genres,
                    currentPage = 1,
                    hasMore = result.items.size >= 20,
                    isLoading = false
                )
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = e.message ?: "Failed to load videos"
                )
            }
        }
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isRefreshing = true, error = null)
            try {
                val featured = videoRepository.getFeaturedVideos()
                val genres = videoRepository.getGenres()
                val result = videoRepository.getVideos(
                    genre = _uiState.value.selectedGenre,
                    search = _uiState.value.searchQuery.ifBlank { null },
                    page = 1,
                    limit = 20
                )
                _uiState.value = _uiState.value.copy(
                    featuredVideos = featured,
                    videos = result.items,
                    genres = genres,
                    currentPage = 1,
                    hasMore = result.items.size >= 20,
                    isRefreshing = false
                )
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    isRefreshing = false,
                    error = e.message ?: "Failed to refresh"
                )
            }
        }
    }

    fun loadMore() {
        val state = _uiState.value
        if (state.isLoading || !state.hasMore) return

        viewModelScope.launch {
            _uiState.value = state.copy(isLoading = true)
            try {
                val nextPage = state.currentPage + 1
                val result = videoRepository.getVideos(
                    genre = state.selectedGenre,
                    search = state.searchQuery.ifBlank { null },
                    page = nextPage,
                    limit = 20
                )
                _uiState.value = _uiState.value.copy(
                    videos = _uiState.value.videos + result.items,
                    currentPage = nextPage,
                    hasMore = result.items.size >= 20,
                    isLoading = false
                )
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = e.message
                )
            }
        }
    }

    fun selectGenre(genre: String?) {
        _uiState.value = _uiState.value.copy(selectedGenre = genre)
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true)
            try {
                val result = videoRepository.getVideos(
                    genre = genre,
                    search = _uiState.value.searchQuery.ifBlank { null },
                    page = 1,
                    limit = 20
                )
                _uiState.value = _uiState.value.copy(
                    videos = result.items,
                    currentPage = 1,
                    hasMore = result.items.size >= 20,
                    isLoading = false
                )
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = e.message
                )
            }
        }
    }

    fun onSearchQueryChange(query: String) {
        _uiState.value = _uiState.value.copy(searchQuery = query)
    }

    fun search() {
        val query = _uiState.value.searchQuery
        if (query.isBlank()) {
            selectGenre(_uiState.value.selectedGenre)
            return
        }
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true)
            try {
                val result = videoRepository.getVideos(
                    genre = _uiState.value.selectedGenre,
                    search = query,
                    page = 1,
                    limit = 20
                )
                _uiState.value = _uiState.value.copy(
                    videos = result.items,
                    currentPage = 1,
                    hasMore = result.items.size >= 20,
                    isLoading = false
                )
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = e.message
                )
            }
        }
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }
}
