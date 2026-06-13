package com.chartmind.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.chartmind.data.Settings

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    current: Settings,
    connection: ConnectionState,
    onSave: (Settings) -> Unit,
    onTest: (Settings) -> Unit,
    onBack: () -> Unit,
) {
    var apiKey by remember(current) { mutableStateOf(current.anthropicApiKey) }
    var model by remember(current) { mutableStateOf(current.model) }
    var bridgeUrl by remember(current) { mutableStateOf(current.bridgeUrl) }
    var bridgeToken by remember(current) { mutableStateOf(current.bridgeToken) }
    var thinking by remember(current) { mutableStateOf(current.thinking) }
    var modelMenuOpen by remember { mutableStateOf(false) }

    fun draft() = Settings(apiKey, model, bridgeUrl, bridgeToken, thinking)

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Settings") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back")
                    }
                },
            )
        },
    ) { pad ->
        Column(
            Modifier
                .padding(pad)
                .padding(16.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            Text("Anthropic", style = MaterialTheme.typography.titleSmall)
            OutlinedTextField(
                value = apiKey,
                onValueChange = { apiKey = it },
                label = { Text("API key (sk-ant-…)") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(8.dp))
            ExposedDropdownMenuBox(
                expanded = modelMenuOpen,
                onExpandedChange = { modelMenuOpen = it },
            ) {
                OutlinedTextField(
                    value = model,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("Model") },
                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(modelMenuOpen) },
                    modifier = Modifier.fillMaxWidth().menuAnchor(MenuAnchorType.PrimaryNotEditable),
                )
                ExposedDropdownMenu(
                    expanded = modelMenuOpen,
                    onDismissRequest = { modelMenuOpen = false },
                ) {
                    Settings.MODEL_CHOICES.forEach { choice ->
                        DropdownMenuItem(
                            text = { Text(choice) },
                            onClick = { model = choice; modelMenuOpen = false },
                        )
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Switch(checked = thinking, onCheckedChange = { thinking = it })
                Spacer(Modifier.width(8.dp))
                Text("Adaptive thinking (deeper analysis, a bit slower)")
            }

            Spacer(Modifier.height(20.dp))
            Text("Bridge (your computer)", style = MaterialTheme.typography.titleSmall)
            OutlinedTextField(
                value = bridgeUrl,
                onValueChange = { bridgeUrl = it },
                label = { Text("Bridge URL (http://192.168.x.x:9333)") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = bridgeToken,
                onValueChange = { bridgeToken = it },
                label = { Text("Bridge token (TV_BRIDGE_TOKEN)") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(Modifier.height(16.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Button(onClick = { onSave(draft()) }) { Text("Save") }
                Spacer(Modifier.width(12.dp))
                OutlinedButton(onClick = { onSave(draft()); onTest(draft()) }) { Text("Save & test") }
            }
            Spacer(Modifier.height(12.dp))
            ConnectionLine(connection)
        }
    }
}

@Composable
fun ConnectionLine(connection: ConnectionState) {
    val (text, color) = when (connection) {
        is ConnectionState.Unknown -> "Not connected — enter details and test." to MaterialTheme.colorScheme.onSurface
        is ConnectionState.Checking -> "Checking bridge…" to MaterialTheme.colorScheme.onSurface
        is ConnectionState.Ok -> "Connected • ${connection.toolCount} tools available" to MaterialTheme.colorScheme.primary
        is ConnectionState.Error -> "Bridge unreachable: ${connection.message}" to MaterialTheme.colorScheme.error
    }
    Text(text, color = color, style = MaterialTheme.typography.bodySmall)
}
