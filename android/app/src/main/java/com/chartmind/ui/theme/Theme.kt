package com.chartmind.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val Green = Color(0xFF3DDC97)
private val Red = Color(0xFFFF6B6B)

private val DarkColors = darkColorScheme(
    primary = Green,
    onPrimary = Color(0xFF06120C),
    secondary = Color(0xFF7AA2F7),
    background = Color(0xFF0E1116),
    surface = Color(0xFF161B22),
    surfaceVariant = Color(0xFF1F2630),
    onBackground = Color(0xFFE6EDF3),
    onSurface = Color(0xFFE6EDF3),
    error = Red,
)

private val LightColors = lightColorScheme(
    primary = Color(0xFF0E9C6B),
    background = Color(0xFFF7F8FA),
    surface = Color(0xFFFFFFFF),
    error = Red,
)

@Composable
fun ChartMindTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        typography = Typography(),
        content = content,
    )
}
