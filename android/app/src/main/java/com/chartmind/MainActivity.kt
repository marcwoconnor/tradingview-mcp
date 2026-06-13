package com.chartmind

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.collectAsState
import androidx.lifecycle.viewmodel.compose.viewModel
import com.chartmind.ui.ChatScreen
import com.chartmind.ui.ChatViewModel
import com.chartmind.ui.SettingsScreen
import com.chartmind.ui.theme.ChartMindTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            ChartMindTheme {
                ChartMindApp()
            }
        }
    }
}

private enum class Screen { CHAT, SETTINGS }

@Composable
private fun ChartMindApp(vm: ChatViewModel = viewModel()) {
    val state by vm.uiState.collectAsState()
    val settings by vm.settings.collectAsState()
    var screen by remember { mutableStateOf(Screen.CHAT) }

    // Probe the bridge once we have configuration (e.g. on first launch / after restore).
    LaunchedEffect(settings.isConfigured) {
        if (settings.isConfigured) vm.checkConnection(settings)
    }

    when (screen) {
        Screen.CHAT -> ChatScreen(
            state = state,
            onSend = vm::send,
            onClear = vm::clearChat,
            onOpenSettings = { screen = Screen.SETTINGS },
            loadScreenshot = vm::loadScreenshot,
        )

        Screen.SETTINGS -> SettingsScreen(
            current = settings,
            connection = state.connection,
            onSave = { vm.saveSettings(it) },
            onTest = { vm.checkConnection(it) },
            onBack = { screen = Screen.CHAT },
        )
    }
}
