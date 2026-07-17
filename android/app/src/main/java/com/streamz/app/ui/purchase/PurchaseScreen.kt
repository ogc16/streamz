package com.streamz.app.ui.purchase

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.stripe.android.PaymentConfiguration
import com.stripe.android.paymentsheet.PaymentSheet
import com.stripe.android.paymentsheet.PaymentSheetResult
import com.streamz.app.data.repository.PurchaseRepository
import com.streamz.app.ui.theme.*
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class PurchaseUiState(
    val clientSecret: String? = null,
    val amount: Long = 0,
    val isLoading: Boolean = false,
    val isComplete: Boolean = false,
    val error: String? = null
)

@HiltViewModel
class PurchaseViewModel @Inject constructor(
    private val purchaseRepository: PurchaseRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(PurchaseUiState())
    val uiState: StateFlow<PurchaseUiState> = _uiState.asStateFlow()

    fun initialize(videoId: String, type: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            try {
                val response = purchaseRepository.createPaymentIntent(videoId, type)
                _uiState.value = _uiState.value.copy(
                    clientSecret = response.clientSecret,
                    amount = response.amount,
                    isLoading = false
                )
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = e.message ?: "Failed to initialize payment"
                )
            }
        }
    }

    fun onPaymentResult(result: PaymentSheetResult, onSuccess: () -> Unit) {
        when (result) {
            is PaymentSheetResult.Completed -> {
                _uiState.value = _uiState.value.copy(isComplete = true)
                onSuccess()
            }
            is PaymentSheetResult.Canceled -> {
                _uiState.value = _uiState.value.copy(error = "Payment cancelled")
            }
            is PaymentSheetResult.Failed -> {
                _uiState.value = _uiState.value.copy(
                    error = result.error.message ?: "Payment failed"
                )
            }
        }
    }
}

@Composable
fun PurchaseScreen(
    videoId: String,
    purchaseType: String,
    onSuccess: () -> Unit,
    onBackClick: () -> Unit,
    viewModel: PurchaseViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val context = LocalContext.current

    LaunchedEffect(videoId, purchaseType) {
        viewModel.initialize(videoId, purchaseType)
    }

    var paymentSheet by remember { mutableStateOf<PaymentSheet?>(null) }

    LaunchedEffect(uiState.clientSecret) {
        val secret = uiState.clientSecret ?: return@LaunchedEffect
        if (uiState.isLoading) return@LaunchedEffect

        PaymentConfiguration.init(context, "pk_test_stripe_key")
        val sheet = PaymentSheet(
            activity = context as android.app.Activity,
            paymentSheetResultCallback = { result ->
                viewModel.onPaymentResult(result, onSuccess)
            }
        )
        paymentSheet = sheet
        sheet.presentWithPaymentIntent(secret)
    }

    Scaffold(
        containerColor = Black
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            when {
                uiState.isLoading -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            CircularProgressIndicator(color = StreamzRed)
                            Spacer(modifier = Modifier.height(16.dp))
                            Text(
                                text = "Preparing payment...",
                                style = MaterialTheme.typography.bodyLarge,
                                color = LightGray
                            )
                        }
                    }
                }

                uiState.isComplete -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(
                                Icons.Default.CheckCircle,
                                contentDescription = null,
                                tint = SuccessGreen,
                                modifier = Modifier.size(80.dp)
                            )
                            Spacer(modifier = Modifier.height(16.dp))
                            Text(
                                text = "Purchase Complete!",
                                style = MaterialTheme.typography.headlineMedium,
                                fontWeight = FontWeight.Bold,
                                color = Color.White
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text = "You now have access to this content.",
                                style = MaterialTheme.typography.bodyLarge,
                                color = LightGray,
                                textAlign = TextAlign.Center
                            )
                        }
                    }
                }

                uiState.error != null -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(
                                text = uiState.error!!,
                                style = MaterialTheme.typography.bodyLarge,
                                color = ErrorRed,
                                textAlign = TextAlign.Center,
                                modifier = Modifier.padding(32.dp)
                            )
                            Spacer(modifier = Modifier.height(16.dp))
                            Button(
                                onClick = {
                                    viewModel.initialize(videoId, purchaseType)
                                },
                                colors = ButtonDefaults.buttonColors(containerColor = StreamzRed)
                            ) {
                                Text("Try Again")
                            }
                            Spacer(modifier = Modifier.height(8.dp))
                            TextButton(onClick = onBackClick) {
                                Text("Go Back", color = LightGray)
                            }
                        }
                    }
                }
            }
        }
    }
}
