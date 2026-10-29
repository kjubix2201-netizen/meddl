package io.github.kjubix2201_netizen.meddl.tv

import android.net.Uri
import android.webkit.WebResourceResponse
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * The app's built-in server: the TV client asks
 * `https://appassets.androidplatform.net/__meddl/fetch?u=<url>&h=<headers>&t=<ms>`
 * and this answers by fetching the provider address natively. A web page
 * may not read IPTV provider answers (no CORS headers); the native request
 * has no such limit, so the app needs no meddl server on another computer.
 *
 * Only GET to http/https targets, redirects followed (also http ↔ https),
 * the provider's status and body passed through unchanged. Requests come
 * only from the app's own page: the WebView never loads other sites.
 */
object DirectFetch {
    const val PATH = "/__meddl/fetch"
    private const val MAX_REDIRECTS = 5

    fun answer(request: Uri, method: String): WebResourceResponse {
        if (!method.equals("GET", ignoreCase = true)) return failure(405, "method")
        val target = request.getQueryParameter("u") ?: return failure(400, "url")
        val scheme = Uri.parse(target).scheme?.lowercase()
        if (scheme != "http" && scheme != "https") return failure(400, "scheme")
        val headers = runCatching { JSONObject(request.getQueryParameter("h") ?: "{}") }
            .getOrNull() ?: JSONObject()
        val timeout = (request.getQueryParameter("t")?.toIntOrNull() ?: 30_000).coerceIn(1_000, 300_000)
        // c=1: an image (channel logo) the WebView may keep for a day.
        val cache = if (request.getQueryParameter("c") == "1") "max-age=86400" else "no-store"
        return try {
            fetch(URL(target), headers, timeout, cache)
        } catch (error: IOException) {
            failure(502, error.javaClass.simpleName)
        } catch (error: RuntimeException) {
            failure(502, error.javaClass.simpleName)
        }
    }

    private fun fetch(start: URL, headers: JSONObject, timeout: Int, cache: String): WebResourceResponse {
        var url = start
        repeat(MAX_REDIRECTS + 1) {
            val connection = (url.openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = false
                connectTimeout = 15_000
                readTimeout = timeout
                requestMethod = "GET"
                headers.keys().forEach { key -> setRequestProperty(key, headers.optString(key)) }
            }
            val status = connection.responseCode
            if (status in 300..399) {
                val location = connection.getHeaderField("Location")
                connection.disconnect()
                if (location.isNullOrBlank()) return failure(502, "redirect")
                url = URL(url, location)
                val next = url.protocol.lowercase()
                if (next != "http" && next != "https") return failure(502, "redirect-scheme")
                return@repeat
            }
            val body = (if (status >= 400) connection.errorStream else connection.inputStream)
                ?: ByteArrayInputStream(ByteArray(0))
            val type = connection.contentType?.substringBefore(';')?.trim()?.ifBlank { null }
                ?: "application/octet-stream"
            val code = if (status in 100..299 || status in 400..599) status else 502
            return WebResourceResponse(
                type,
                "utf-8",
                code,
                connection.responseMessage?.ifBlank { null } ?: "OK",
                mapOf("Cache-Control" to if (status in 200..299) cache else "no-store"),
                body
            )
        }
        return failure(502, "redirects")
    }

    private fun failure(status: Int, reason: String) = WebResourceResponse(
        "text/plain",
        "utf-8",
        status,
        "meddl direct fetch",
        mapOf("X-Meddl-Fetch-Error" to reason, "Cache-Control" to "no-store"),
        ByteArrayInputStream(ByteArray(0))
    )
}
