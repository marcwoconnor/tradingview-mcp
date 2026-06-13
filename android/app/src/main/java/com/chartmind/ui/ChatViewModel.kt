package com.chartmind.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.chartmind.agent.AgentEngine
import com.chartmind.agent.AgentEvent
import com.chartmind.agent.SYSTEM_PROMPT
import com.chartmind.bridge.BridgeClient
import com.chartmind.data.Settings
import com.chartmind.data.SettingsRepository
import com.chartmind.llm.AnthropicRestClient
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

sealed interface ConnectionState {
    data object Unknown : ConnectionState
    data object Checking : ConnectionState
    data class Ok(val toolCount: Int) : ConnectionState
    data class Error(val message: String) : ConnectionState
}

enum class ToolStatus { RUNNING, OK, ERROR }

sealed interface ChatItem {
    val key: Long

    data class User(override val key: Long, val text: String) : ChatItem
    data class Assistant(override val key: Long, val text: String) : ChatItem
    data class Tool(
        override val key: Long,
        val name: String,
        val argsPreview: String,
        val status: ToolStatus,
        val resultPreview: String = "",
        val screenshotPath: String? = null,
    ) : ChatItem
    data class Note(override val key: Long, val text: String) : ChatItem
}

data class ChatUiState(
    val items: List<ChatItem> = emptyList(),
    val isBusy: Boolean = false,
    val connection: ConnectionState = ConnectionState.Unknown,
)

class ChatViewModel(app: Application) : AndroidViewModel(app) {
    private val repo = SettingsRepository(app)
    private val json = Json { ignoreUnknownKeys = true; prettyPrint = false }

    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(180, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .build()

    val settings: StateFlow<Settings> =
        repo.settings.stateIn(viewModelScope, SharingStarted.Eagerly, Settings())

    private val _uiState = MutableStateFlow(ChatUiState())
    val uiState: StateFlow<ChatUiState> = _uiState.asStateFlow()

    // Conversation history sent to Claude (raw message objects).
    private val history = mutableListOf<JsonObject>()

    // Lazily built per active settings.
    private var engine: AgentEngine? = null
    private var engineSettings: Settings? = null
    private var keyCounter = 0L

    private fun nextKey() = keyCounter++

    fun saveSettings(settings: Settings) {
        viewModelScope.launch {
            repo.save(settings)
            engine = null // force rebuild with new settings/tools
            engineSettings = null
            checkConnection(settings)
        }
    }

    fun checkConnection(settings: Settings = this.settings.value) {
        if (!settings.isConfigured) {
            _uiState.value = _uiState.value.copy(connection = ConnectionState.Unknown)
            return
        }
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(connection = ConnectionState.Checking)
            try {
                val count = bridge(settings).health()
                _uiState.value = _uiState.value.copy(connection = ConnectionState.Ok(count))
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    connection = ConnectionState.Error(e.message ?: "unreachable"),
                )
            }
        }
    }

    fun clearChat() {
        history.clear()
        _uiState.value = _uiState.value.copy(items = emptyList())
    }

    private fun bridge(s: Settings) = BridgeClient(s.bridgeUrl, s.bridgeToken, http, json)

    private suspend fun ensureEngine(s: Settings): AgentEngine {
        val existing = engine
        if (existing != null && engineSettings == s) return existing
        val tools = bridge(s).fetchTools()
        val built = AgentEngine(
            llm = AnthropicRestClient(s.anthropicApiKey, http, json),
            bridge = bridge(s),
            model = s.model,
            thinking = s.thinking,
            tools = tools,
            system = SYSTEM_PROMPT,
        )
        engine = built
        engineSettings = s
        return built
    }

    private fun addItem(item: ChatItem) {
        _uiState.value = _uiState.value.copy(items = _uiState.value.items + item)
    }

    private fun updateTool(id: Long, transform: (ChatItem.Tool) -> ChatItem.Tool) {
        _uiState.value = _uiState.value.copy(
            items = _uiState.value.items.map {
                if (it is ChatItem.Tool && it.key == id) transform(it) else it
            },
        )
    }

    fun send(text: String) {
        val message = text.trim()
        if (message.isEmpty() || _uiState.value.isBusy) return
        val s = settings.value
        if (!s.isConfigured) {
            addItem(ChatItem.Note(nextKey(), "Add your Anthropic key and bridge details in Settings first."))
            return
        }

        addItem(ChatItem.User(nextKey(), message))
        history.add(AgentEngine.userMessage(message))
        _uiState.value = _uiState.value.copy(isBusy = true)

        viewModelScope.launch {
            // Map a tool_use id -> the UI item key so we can update on finish.
            val toolKeys = mutableMapOf<String, Long>()
            try {
                val eng = ensureEngine(s)
                eng.runTurn(history) { event ->
                    when (event) {
                        is AgentEvent.AssistantText ->
                            addItem(ChatItem.Assistant(nextKey(), event.text))

                        is AgentEvent.ToolStarted -> {
                            val key = nextKey()
                            toolKeys[event.id] = key
                            addItem(
                                ChatItem.Tool(
                                    key = key,
                                    name = event.name,
                                    argsPreview = previewJson(event.input),
                                    status = ToolStatus.RUNNING,
                                ),
                            )
                        }

                        is AgentEvent.ToolFinished -> {
                            val key = toolKeys[event.id] ?: return@runTurn
                            updateTool(key) {
                                it.copy(
                                    status = if (event.ok) ToolStatus.OK else ToolStatus.ERROR,
                                    resultPreview = previewJson(event.result),
                                    screenshotPath = event.screenshotPath,
                                )
                            }
                        }

                        AgentEvent.Done -> Unit
                    }
                }
            } catch (e: Exception) {
                addItem(ChatItem.Note(nextKey(), "Error: ${e.message}"))
            } finally {
                _uiState.value = _uiState.value.copy(isBusy = false)
            }
        }
    }

    private fun previewJson(element: JsonElement, max: Int = 600): String {
        val text = element.toString()
        return if (text.length > max) text.take(max) + "…" else text
    }

    /** Load a screenshot's bytes via the bridge (used by the inline image loader). */
    suspend fun loadScreenshot(path: String): ByteArray? = try {
        bridge(settings.value).fetchFile(path)
    } catch (_: Exception) {
        null
    }
}
