package com.coraiworker.android.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val AppDarkColorScheme = darkColorScheme(
    primary = Color(0xFF6366F1),          // accent 紫
    onPrimary = Color.White,
    primaryContainer = Color(0xFF3730A3),
    secondary = Color(0xFF818CF8),
    background = Color(0xFF0F0F0F),
    surface = Color(0xFF1A1A1A),
    surfaceVariant = Color(0xFF262626),
    onBackground = Color(0xFFE5E5E5),
    onSurface = Color(0xFFE5E5E5),
    onSurfaceVariant = Color(0xFF9CA3AF),
    outline = Color(0xFF374151),
    error = Color(0xFFEF4444),
)

@Composable
fun CorAiWorkerTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = AppDarkColorScheme,
        typography = Typography,
        content = content
    )
}
