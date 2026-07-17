package com.streamz.app.ui.navigation

import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.streamz.app.ui.auth.AuthScreen
import com.streamz.app.ui.detail.VideoDetailScreen
import com.streamz.app.ui.home.HomeScreen
import com.streamz.app.ui.player.PlayerScreen
import com.streamz.app.ui.profile.ProfileScreen
import com.streamz.app.ui.purchase.PurchaseScreen

@Composable
fun NavGraph(
    navController: NavHostController,
    startDestination: String
) {
    NavHost(
        navController = navController,
        startDestination = startDestination
    ) {
        composable(Screen.Login.route) {
            AuthScreen(
                onAuthSuccess = {
                    navController.navigate(Screen.Home.route) {
                        popUpTo(Screen.Login.route) { inclusive = true }
                    }
                }
            )
        }

        composable(Screen.Home.route) {
            HomeScreen(
                onVideoClick = { videoId ->
                    navController.navigate(Screen.Detail.createRoute(videoId))
                },
                onProfileClick = {
                    navController.navigate(Screen.Profile.route)
                }
            )
        }

        composable(
            route = Screen.Detail.route,
            arguments = listOf(navArgument("videoId") { type = NavType.StringType })
        ) { backStackEntry ->
            val videoId = backStackEntry.arguments?.getString("videoId") ?: return@composable
            VideoDetailScreen(
                videoId = videoId,
                onPlayClick = { playbackId ->
                    navController.navigate(Screen.Player.createRoute(videoId, playbackId))
                },
                onBuyClick = { type ->
                    navController.navigate(Screen.Purchase.createRoute(videoId, type))
                },
                onBackClick = { navController.popBackStack() }
            )
        }

        composable(
            route = Screen.Player.route,
            arguments = listOf(
                navArgument("videoId") { type = NavType.StringType },
                navArgument("playbackId") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val videoId = backStackEntry.arguments?.getString("videoId") ?: return@composable
            val playbackId = backStackEntry.arguments?.getString("playbackId") ?: return@composable
            PlayerScreen(
                videoId = videoId,
                playbackId = playbackId,
                onBackClick = { navController.popBackStack() }
            )
        }

        composable(
            route = Screen.Purchase.route,
            arguments = listOf(
                navArgument("videoId") { type = NavType.StringType },
                navArgument("type") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val videoId = backStackEntry.arguments?.getString("videoId") ?: return@composable
            val type = backStackEntry.arguments?.getString("type") ?: return@composable
            PurchaseScreen(
                videoId = videoId,
                purchaseType = type,
                onSuccess = { navController.popBackStack() },
                onBackClick = { navController.popBackStack() }
            )
        }

        composable(Screen.Profile.route) {
            ProfileScreen(
                onLogout = {
                    navController.navigate(Screen.Login.route) {
                        popUpTo(0) { inclusive = true }
                    }
                },
                onVideoClick = { videoId ->
                    navController.navigate(Screen.Detail.createRoute(videoId))
                },
                onBackClick = { navController.popBackStack() }
            )
        }
    }
}
