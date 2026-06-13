package com.chartmind.agent

import com.chartmind.bridge.BridgeClient
import com.chartmind.llm.LlmClient
import com.chartmind.llm.LlmRequest
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Events emitted as a turn progresses, consumed by the ViewModel to update the UI. */
sealed interface AgentEvent {
    data class AssistantText(val text: String) : AgentEvent
    data class ToolStarted(val id: String, val name: String, val input: JsonObject) : AgentEvent
    data class ToolFinished(
        val id: String,
        val name: String,
        val ok: Boolean,
        val result: JsonElement,
        val screenshotPath: String?,
    ) : AgentEvent
    data object Done : AgentEvent
}

/**
 * Runs the Claude tool-use loop: ask the model, dispatch any tool calls to the
 * tv-bridge, feed results back, repeat until the model stops calling tools.
 */
class AgentEngine(
    private val llm: LlmClient,
    private val bridge: BridgeClient,
    private val model: String,
    private val thinking: Boolean,
    private val tools: JsonArray,
    private val system: String,
) {
    suspend fun runTurn(history: MutableList<JsonObject>, emit: suspend (AgentEvent) -> Unit) {
        var turn = 0
        while (turn++ < MAX_TURNS) {
            val resp = llm.createMessage(
                LlmRequest(
                    model = model,
                    maxTokens = MAX_TOKENS,
                    system = system,
                    thinking = thinking,
                    tools = tools,
                    messages = JsonArray(history.toList()),
                ),
            )

            // Echo the assistant turn back verbatim (preserves thinking/tool_use blocks).
            history.add(assistantMessage(resp.content))

            val toolUses = mutableListOf<JsonObject>()
            for (block in resp.content) {
                val obj = block.jsonObject
                when (obj["type"]?.jsonPrimitive?.content) {
                    "text" -> {
                        val text = obj["text"]?.jsonPrimitive?.content.orEmpty()
                        if (text.isNotBlank()) emit(AgentEvent.AssistantText(text))
                    }
                    "tool_use" -> toolUses.add(obj)
                }
            }

            if (resp.stopReason != "tool_use" || toolUses.isEmpty()) break

            val resultBlocks = mutableListOf<JsonObject>()
            for (tu in toolUses) {
                val id = tu["id"]?.jsonPrimitive?.content ?: continue
                val name = tu["name"]?.jsonPrimitive?.content ?: continue
                val input = tu["input"] as? JsonObject ?: JsonObject(emptyMap())

                emit(AgentEvent.ToolStarted(id, name, input))
                try {
                    val call = bridge.call(name, input)
                    val screenshot = extractScreenshotPath(name, call.result)
                    emit(AgentEvent.ToolFinished(id, name, call.ok, call.result, screenshot))
                    resultBlocks.add(toolResultBlock(id, call.result.toString(), call.isError))
                } catch (e: Exception) {
                    val msg = e.message ?: "tool call failed"
                    emit(
                        AgentEvent.ToolFinished(
                            id, name, false,
                            buildJsonObject { put("success", JsonPrimitive(false)); put("error", JsonPrimitive(msg)) },
                            null,
                        ),
                    )
                    resultBlocks.add(toolResultBlock(id, """{"success":false,"error":${JsonPrimitive(msg)}}""", true))
                }
            }
            history.add(toolResultsMessage(resultBlocks))
        }
        emit(AgentEvent.Done)
    }

    companion object {
        const val MAX_TURNS = 16
        const val MAX_TOKENS = 8192

        fun userMessage(text: String): JsonObject = buildJsonObject {
            put("role", JsonPrimitive("user"))
            put("content", buildJsonArray {
                add(buildJsonObject {
                    put("type", JsonPrimitive("text"))
                    put("text", JsonPrimitive(text))
                })
            })
        }

        private fun assistantMessage(content: JsonArray): JsonObject = buildJsonObject {
            put("role", JsonPrimitive("assistant"))
            put("content", content)
        }

        private fun toolResultBlock(toolUseId: String, text: String, isError: Boolean): JsonObject =
            buildJsonObject {
                put("type", JsonPrimitive("tool_result"))
                put("tool_use_id", JsonPrimitive(toolUseId))
                put("content", JsonPrimitive(text))
                put("is_error", JsonPrimitive(isError))
            }

        private fun toolResultsMessage(blocks: List<JsonObject>): JsonObject = buildJsonObject {
            put("role", JsonPrimitive("user"))
            put("content", JsonArray(blocks))
        }

        /** capture_screenshot returns { success, file_path }. Surface the path for inline display. */
        private fun extractScreenshotPath(name: String, result: JsonElement): String? {
            if (name != "capture_screenshot") return null
            val obj = result as? JsonObject ?: return null
            val success = obj["success"]?.jsonPrimitive?.content == "true"
            val path = obj["file_path"]?.jsonPrimitive?.content
            return if (success && !path.isNullOrBlank()) path else null
        }
    }
}
