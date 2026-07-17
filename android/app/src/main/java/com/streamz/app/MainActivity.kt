package com.streamz.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.*
import androidx.navigation.compose.rememberNavController
import com.streamz.app.data.repository.AuthRepository
import com.streamz.app.ui.navigation.NavGraph
import com.streamz.app.ui.navigation.Screen
import com.streamz.app.ui.theme.StreamzTheme
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject
    lateinit var authRepository: AuthRepository

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        setContent {
            StreamzTheme {
                var startDestination by remember { mutableStateOf<String?>(null) }

                LaunchedEffect(Unit) {
                    val user = authRepository.restoreSession()
                    startDestination = if (user != null) Screen.Home.route else Screen.Login.route
                }

                startDestination?.let { destination ->
                    val navController = rememberNavController()
                    NavGraph(
                        navController = navController,
                        startDestination = destination
                    )
                }
            }
        }
    }
}
