package com.streamz.app.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.ExperimentalMaterialApi
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.pullrefresh.PullRefreshIndicator
import androidx.compose.material.pullrefresh.pullRefresh
import androidx.compose.material.pullrefresh.rememberPullRefreshState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import coil.compose.AsyncImage
import com.streamz.app.domain.model.Video
import com.streamz.app.ui.theme.*

@OptIn(ExperimentalMaterialApi::class)
@Composable
fun HomeScreen(
    onVideoClick: (String) -> Unit,
    onProfileClick: () -> Unit,
    viewModel: HomeViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    var showSearch by remember { mutableStateOf(false) }

    val pullRefreshState = rememberPullRefreshState(
        refreshing = uiState.isRefreshing,
        onRefresh = { viewModel.refresh() }
    )

    Scaffold(
        containerColor = Black
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .pullRefresh(pullRefreshState)
        ) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(bottom = 16.dp)
            ) {
                // Top bar with search
                item {
                    TopBar(
                        showSearch = showSearch,
                        searchQuery = uiState.searchQuery,
                        onSearchQueryChange = { viewModel.onSearchQueryChange(it) },
                        onSearchToggle = { showSearch = !showSearch },
                        onSearchSubmit = { viewModel.search() },
                        onProfileClick = onProfileClick
                    )
                }

                // Featured hero carousel
                if (uiState.featuredVideos.isNotEmpty()) {
                    item {
                        FeaturedHeroCarousel(
                            videos = uiState.featuredVideos,
                            onClick = onVideoClick
                        )
                    }
                }

                // Genre filter chips
                if (uiState.genres.isNotEmpty()) {
                    item {
                        GenreFilterRow(
                            genres = uiState.genres.map { it.genre },
                            selectedGenre = uiState.selectedGenre,
                            onGenreSelected = { genre ->
                                viewModel.selectGenre(genre)
                            }
                        )
                    }
                }

                // Section header
                item {
                    Text(
                        text = if (uiState.selectedGenre != null) uiState.selectedGenre!!
                        else if (uiState.searchQuery.isNotBlank()) "Search Results"
                        else "Trending Now",
                        style = MaterialTheme.typography.headlineMedium,
                        color = Color.White,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp)
                    )
                }

                // Video grid
                val chunked = uiState.videos.chunked(3)
                items(chunked) { rowVideos ->
                    VideoGridRow(
                        videos = rowVideos,
                        onClick = onVideoClick
                    )
                }

                // Loading more indicator
                if (uiState.isLoading && uiState.videos.isNotEmpty()) {
                    item {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(16.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            CircularProgressIndicator(
                                color = StreamzRed,
                                modifier = Modifier.size(32.dp),
                                strokeWidth = 3.dp
                            )
                        }
                    }
                }

                // Load more trigger
                if (uiState.hasMore && uiState.videos.isNotEmpty() && !uiState.isLoading) {
                    item {
                        LaunchedEffect(Unit) {
                            viewModel.loadMore()
                        }
                    }
                }
            }

            PullRefreshIndicator(
                refreshing = uiState.isRefreshing,
                state = pullRefreshState,
                modifier = Modifier.align(Alignment.TopCenter),
                contentColor = StreamzRed,
                backgroundColor = DarkGray
            )

            // Error snackbar
            if (uiState.error != null) {
                Snackbar(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(16.dp),
                    containerColor = DarkGray,
                    contentColor = Color.White
                ) {
                    Text(text = uiState.error!!)
                }
            }
        }
    }
}

@Composable
private fun TopBar(
    showSearch: Boolean,
    searchQuery: String,
    onSearchQueryChange: (String) -> Unit,
    onSearchToggle: () -> Unit,
    onSearchSubmit: () -> Unit,
    onProfileClick: () -> Unit
) {
    Surface(
        color = Black,
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "STREAMZ",
                style = MaterialTheme.typography.displayMedium.copy(
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 4.sp
                ),
                color = StreamzRed,
                modifier = Modifier.weight(1f)
            )

            if (showSearch) {
                OutlinedTextField(
                    value = searchQuery,
                    onValueChange = onSearchQueryChange,
                    placeholder = { Text("Search...", color = LightGray) },
                    singleLine = true,
                    modifier = Modifier
                        .weight(1f)
                        .height(48.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = StreamzRed,
                        unfocusedBorderColor = MediumGray,
                        cursorColor = StreamzRed,
                        focusedTextColor = Color.White,
                        unfocusedTextColor = Color.White
                    ),
                    shape = RoundedCornerShape(8.dp),
                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
                        imeAction = androidx.compose.ui.text.input.ImeAction.Search
                    ),
                    keyboardActions = androidx.compose.foundation.text.KeyboardActions(
                        onSearch = { onSearchSubmit() }
                    )
                )
            }

            if (showSearch) {
                IconButton(onClick = onSearchToggle) {
                    Icon(
                        Icons.Default.Search,
                        contentDescription = "Close search",
                        tint = Color.White
                    )
                }
            } else {
                IconButton(onClick = onSearchToggle) {
                    Icon(
                        Icons.Default.Search,
                        contentDescription = "Search",
                        tint = Color.White
                    )
                }
            }

            IconButton(onClick = onProfileClick) {
                Icon(
                    Icons.Default.Person,
                    contentDescription = "Profile",
                    tint = Color.White
                )
            }
        }
    }
}

@Composable
private fun FeaturedHeroCarousel(
    videos: List<Video>,
    onClick: (String) -> Unit
) {
    LazyRow(
        modifier = Modifier.fillMaxWidth(),
        contentPadding = PaddingValues(horizontal = 0.dp)
    ) {
        items(videos.take(5)) { video ->
            FeaturedHeroCard(video = video, onClick = { onClick(video.id) })
        }
    }
}

@Composable
private fun FeaturedHeroCard(
    video: Video,
    onClick: () -> Unit
) {
    Box(
        modifier = Modifier
            .width(340.dp)
            .height(200.dp)
            .padding(horizontal = 4.dp)
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
    ) {
        AsyncImage(
            model = video.thumbnailUrl,
            contentDescription = video.title,
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize()
        )

        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    brush = Brush.verticalGradient(
                        colors = listOf(
                            Color.Transparent,
                            Color.Black.copy(alpha = 0.9f)
                        ),
                        startY = 100f
                    )
                )
        )

        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(16.dp),
            contentAlignment = Alignment.BottomStart
        ) {
            Column {
                Text(
                    text = video.title,
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                    color = Color.White,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(modifier = Modifier.height(4.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = video.rating,
                        style = MaterialTheme.typography.bodySmall,
                        color = SuccessGreen
                    )
                    Text(
                        text = "  \u2022  ${video.releaseYear}  \u2022  ${video.formattedDuration}",
                        style = MaterialTheme.typography.bodySmall,
                        color = LightGray
                    )
                }
            }
        }
    }

    Spacer(modifier = Modifier.width(8.dp))
}

@Composable
private fun GenreFilterRow(
    genres: List<String>,
    selectedGenre: String?,
    onGenreSelected: (String?) -> Unit
) {
    LazyRow(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp),
        contentPadding = PaddingValues(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        item {
            FilterChip(
                selected = selectedGenre == null,
                onClick = { onGenreSelected(null) },
                label = { Text("All") },
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = StreamzRed,
                    selectedLabelColor = Color.White,
                    containerColor = DarkGray,
                    labelColor = LightGray
                )
            )
        }
        items(genres) { genre ->
            FilterChip(
                selected = selectedGenre == genre,
                onClick = { onGenreSelected(if (selectedGenre == genre) null else genre) },
                label = { Text(genre) },
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = StreamzRed,
                    selectedLabelColor = Color.White,
                    containerColor = DarkGray,
                    labelColor = LightGray
                )
            )
        }
    }
}

@Composable
private fun VideoGridRow(
    videos: List<Video>,
    onClick: (String) -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        videos.forEach { video ->
            VideoCard(
                video = video,
                onClick = { onClick(video.id) },
                modifier = Modifier.weight(1f)
            )
        }
        // Fill remaining space if less than 3 items
        repeat(3 - videos.size) {
            Spacer(modifier = Modifier.weight(1f))
        }
    }
}
