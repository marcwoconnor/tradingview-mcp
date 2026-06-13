package com.chartmind.llm

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

class LlmException(message: String) : Exception(message)

/**
 * Anthropic Messages API client (raw HTTPS via OkHttp + kotlinx.serialization).
 *
 * Conversation content is kept as raw JSON so that assistant blocks — including
 * `thinking` blocks produced by adaptive thinking — round-trip back to the API
 * unmodified, as required for multi-turn tool use.
 */
class AnthropicRestClient(
    private val apiKey: String,
    private val http: OkHttpClient,
    private val json: Json = Json { ignoreUnknownKeys = true },
    private val baseUrl: String = "https://api.anthropic.com/v1/messages",
) : LlmClient {

    private val jsonMedia = "application/json; charset=utf-8".toMediaType()

    override suspend fun createMessage(request: LlmRequest): LlmResponse = withContext(Dispatchers.IO) {
        val body = buildJsonObject {
            put("model", JsonPrimitive(request.model))
            put("max_tokens", JsonPrimitive(request.maxTokens))
            if (!request.system.isNullOrBlank()) put("system", JsonPrimitive(request.system))
            if (request.thinking) {
                put("thinking", buildJsonObject { put("type", JsonPrimitive("adaptive")) })
            }
            if (request.tools.isNotEmpty()) put("tools", request.tools)
            put("messages", request.messages)
        }

        val httpReq = Request.Builder()
            .url(baseUrl)
            .header("x-api-key", apiKey)
            .header("anthropic-version", "2023-06-01")
            .post(body.toString().toRequestBody(jsonMedia))
            .build()

        http.newCall(httpReq).execute().use { resp ->
            val text = resp.body?.string().orEmpty()
            if (!resp.isSuccessful) throw LlmException(parseError(text, resp.code))
            val obj = json.parseToJsonElement(text).jsonObject
            val stop = (obj["stop_reason"] as? JsonPrimitive)?.content
            val content = obj["content"]?.jsonArray ?: JsonArray(emptyList())
            LlmResponse(stopReason = stop, content = content)
        }
    }

    private fun parseError(text: String, code: Int): String = try {
        val err = json.parseToJsonElement(text).jsonObject["error"]?.jsonObject
        val message = (err?.get("message") as? JsonPrimitive)?.content
        "Anthropic API error $code: ${message ?: text.take(200)}"
    } catch (_: Exception) {
        "Anthropic API error $code: ${text.take(200)}"
    }
}
