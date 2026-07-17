package com.streamz.app.ui.navigation

sealed class Screen(val route: String) {
    data object Login : Screen("login")
    data object Register : Screen("register")
    data object Home : Screen("home")
    data object Detail : Screen("detail/{videoId}") {
        fun createRoute(videoId: String) = "detail/$videoId"
    }
    data object Player : Screen("player/{videoId}/{playbackId}") {
        fun createRoute(videoId: String, playbackId: String) = "player/$videoId/$playbackId"
    }
    data object Purchase : Screen("purchase/{videoId}/{type}") {
        fun createRoute(videoId: String, type: String) = "purchase/$videoId/$type"
    }
    data object Profile : Screen("profile")
}
