package com.chartmind.llm

import kotlinx.serialization.json.JsonArray

/**
 * Abstraction over the LLM backend so the agent loop doesn't depend on a
 * specific transport. The default implementation talks to the Anthropic
 * Messages API over HTTPS (see [AnthropicRestClient]); a future SDK-backed
 * implementation can drop in behind this interface without touching the loop.
 */
interface LlmClient {
    suspend fun createMessage(request: LlmRequest): LlmResponse
}

data class LlmRequest(
    val model: String,
    val maxTokens: Int,
    val system: String?,
    val thinking: Boolean,
    /** Anthropic-format tool definitions ([{name, description, input_schema}]). */
    val tools: JsonArray,
    /** Full conversation: array of {role, content} message objects. */
    val messages: JsonArray,
)

data class LlmResponse(
    /** "end_turn", "tool_use", "max_tokens", "refusal", ... */
    val stopReason: String?,
    /** Raw assistant content blocks, echoed back verbatim on the next turn. */
    val content: JsonArray,
)
