package com.chartmind.bridge

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

class BridgeException(message: String) : Exception(message)

/** Result of a POST /call: the structured tool payload plus error flag. */
data class CallResult(val ok: Boolean, val isError: Boolean, val result: JsonElement)

/**
 * Client for the tv-bridge HTTP server. All calls run on the IO dispatcher.
 *
 * @param baseUrl e.g. "http://192.168.1.20:9333" (no trailing slash)
 * @param token   the TV_BRIDGE_TOKEN shared secret
 */
class BridgeClient(
    private val baseUrl: String,
    private val token: String,
    private val http: OkHttpClient,
    private val json: Json = Json { ignoreUnknownKeys = true },
) {
    private val jsonMedia = "application/json; charset=utf-8".toMediaType()

    private fun authed(builder: Request.Builder) =
        builder.header("Authorization", "Bearer $token")

    /** Quick liveness probe. Returns the reported tool count, or throws. */
    suspend fun health(): Int = withContext(Dispatchers.IO) {
        val req = Request.Builder().url("$baseUrl/health").get().build()
        http.newCall(req).execute().use { resp ->
            val body = resp.body?.string().orEmpty()
            if (!resp.isSuccessful) throw BridgeException("bridge health failed: ${resp.code}")
            val obj = json.parseToJsonElement(body).jsonObject
            (obj["tools"] as? JsonPrimitive)?.content?.toIntOrNull() ?: 0
        }
    }

    /** Fetch the Anthropic-format tool definitions from GET /tools. */
    suspend fun fetchTools(): JsonArray = withContext(Dispatchers.IO) {
        val req = authed(Request.Builder().url("$baseUrl/tools").get()).build()
        http.newCall(req).execute().use { resp ->
            val body = resp.body?.string().orEmpty()
            if (resp.code == 401) throw BridgeException("Bridge rejected the token (401). Check the bridge token in Settings.")
            if (!resp.isSuccessful) throw BridgeException("GET /tools failed: ${resp.code}")
            json.parseToJsonElement(body).jsonObject["tools"]?.jsonArray
                ?: throw BridgeException("malformed /tools response")
        }
    }

    /** Execute a tool via POST /call. */
    suspend fun call(name: String, arguments: JsonObject): CallResult = withContext(Dispatchers.IO) {
        val payload = buildJsonObject {
            put("name", JsonPrimitive(name))
            put("arguments", arguments)
        }
        val req = authed(
            Request.Builder()
                .url("$baseUrl/call")
                .post(payload.toString().toRequestBody(jsonMedia)),
        ).build()

        http.newCall(req).execute().use { resp ->
            val body = resp.body?.string().orEmpty()
            if (resp.code == 401) throw BridgeException("Bridge rejected the token (401).")
            if (resp.code == 404) throw BridgeException("Unknown tool: $name")
            val obj = json.parseToJsonElement(body).jsonObject
            val ok = (obj["ok"] as? JsonPrimitive)?.boolean ?: false
            val isError = (obj["is_error"] as? JsonPrimitive)?.boolean ?: !ok
            val result = obj["result"] ?: buildJsonObject { put("success", JsonPrimitive(false)) }
            CallResult(ok = ok, isError = isError, result = result)
        }
    }

    /** Fetch a screenshot file by absolute path (served only from the screenshot dir). */
    suspend fun fetchFile(path: String): ByteArray = withContext(Dispatchers.IO) {
        val url = "$baseUrl/file".toHttpUrl().newBuilder()
            .addQueryParameter("path", path)
            .build()
        val req = authed(Request.Builder().url(url).get()).build()
        http.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) throw BridgeException("GET /file failed: ${resp.code}")
            resp.body?.bytes() ?: throw BridgeException("empty file response")
        }
    }
}
