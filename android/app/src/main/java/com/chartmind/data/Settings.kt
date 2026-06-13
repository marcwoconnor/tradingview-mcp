package com.chartmind.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "chartmind_settings")

/** User-configurable connection + model settings, persisted via DataStore. */
data class Settings(
    val anthropicApiKey: String = "",
    val model: String = DEFAULT_MODEL,
    val bridgeUrl: String = "",
    val bridgeToken: String = "",
    val thinking: Boolean = true,
) {
    val isConfigured: Boolean
        get() = anthropicApiKey.isNotBlank() && bridgeUrl.isNotBlank() && bridgeToken.isNotBlank()

    companion object {
        const val DEFAULT_MODEL = "claude-opus-4-8"
        val MODEL_CHOICES = listOf(
            "claude-opus-4-8",
            "claude-sonnet-4-6",
            "claude-haiku-4-5",
        )
    }
}

class SettingsRepository(private val context: Context) {
    private object Keys {
        val API_KEY = stringPreferencesKey("anthropic_api_key")
        val MODEL = stringPreferencesKey("model")
        val BRIDGE_URL = stringPreferencesKey("bridge_url")
        val BRIDGE_TOKEN = stringPreferencesKey("bridge_token")
        val THINKING = stringPreferencesKey("thinking")
    }

    val settings: Flow<Settings> = context.dataStore.data.map { p ->
        Settings(
            anthropicApiKey = p[Keys.API_KEY] ?: "",
            model = p[Keys.MODEL] ?: Settings.DEFAULT_MODEL,
            bridgeUrl = (p[Keys.BRIDGE_URL] ?: "").trimEnd('/'),
            bridgeToken = p[Keys.BRIDGE_TOKEN] ?: "",
            thinking = (p[Keys.THINKING] ?: "true").toBoolean(),
        )
    }

    suspend fun save(settings: Settings) {
        context.dataStore.edit { p ->
            p[Keys.API_KEY] = settings.anthropicApiKey.trim()
            p[Keys.MODEL] = settings.model
            p[Keys.BRIDGE_URL] = settings.bridgeUrl.trim().trimEnd('/')
            p[Keys.BRIDGE_TOKEN] = settings.bridgeToken.trim()
            p[Keys.THINKING] = settings.thinking.toString()
        }
    }
}
