package io.github.kjubix2201_netizen.meddl.tv

import android.content.res.AssetManager
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * Phone setup without a meddl server: a small web server in the home network
 * that shows the phone form (assets/setup, the apps/tv-setup page) and relays
 * what the phone enters to the TV page. Same routes and rules as the web
 * backend (apps/web-backend tv-setup): sessions live in memory for five
 * minutes, the phone only gets its own token, and only the TV itself
 * (loopback) may open or read a session. The TV page checks the entries
 * (parseSourceDraft / parseSettingsDraft) before saving anything.
 */
class PairingServer(private val assets: AssetManager) {

    private class Session(
        val id: String,
        val tvToken: String,
        val phoneToken: String,
        val expiresAt: Long,
        val purpose: String,
        val defaults: Any?,
    ) {
        @Volatile var status = "waiting"
        @Volatile var entry: Any? = null
    }

    private class Failure(val status: Int, message: String) : Exception(message)

    private val sessions = ConcurrentHashMap<String, Session>()
    private val random = SecureRandom()
    private val workers = Executors.newCachedThreadPool()
    @Volatile private var server: ServerSocket? = null

    /** Starts once; returns the port, or -1 when no port could be opened. */
    @Synchronized
    fun start(): Int {
        server?.let { return it.localPort }
        for (port in PORTS) {
            val socket = runCatching {
                ServerSocket().apply {
                    reuseAddress = true
                    bind(InetSocketAddress(port), 16)
                }
            }.getOrNull() ?: continue
            server = socket
            Thread({ accept(socket) }, "meddl-pairing").apply { isDaemon = true }.start()
            return port
        }
        return -1
    }

    @Synchronized
    fun stop() {
        runCatching { server?.close() }
        server = null
        sessions.clear()
    }

    private fun accept(socket: ServerSocket) {
        while (!socket.isClosed) {
            val client = runCatching { socket.accept() }.getOrNull() ?: break
            workers.execute { serve(client) }
        }
    }

    private fun serve(client: Socket) {
        client.use { socket ->
            runCatching {
                socket.soTimeout = 10_000
                val input = BufferedInputStream(socket.getInputStream())
                val requestLine = readLine(input) ?: return
                val parts = requestLine.split(' ')
                if (parts.size < 2) return
                val method = parts[0]
                val path = parts[1].substringBefore('?')
                val headers = HashMap<String, String>()
                while (true) {
                    val line = readLine(input) ?: return
                    if (line.isEmpty()) break
                    val colon = line.indexOf(':')
                    if (colon > 0) headers[line.substring(0, colon).trim().lowercase()] = line.substring(colon + 1).trim()
                }
                val length = headers["content-length"]?.toIntOrNull() ?: 0
                if (length > MAX_BODY) return respond(socket.getOutputStream(), 413, json("message" to "Too large."), headers)
                val body = ByteArray(length)
                var read = 0
                while (read < length) {
                    val n = input.read(body, read, length - read)
                    if (n < 0) break
                    read += n
                }
                val loopback = socket.inetAddress.isLoopbackAddress
                route(socket.getOutputStream(), method, path, headers, String(body, Charsets.UTF_8), loopback)
            }
        }
    }

    private fun route(
        out: OutputStream,
        method: String,
        path: String,
        headers: Map<String, String>,
        body: String,
        loopback: Boolean,
    ) {
        if (method == "OPTIONS") return respond(out, 204, null, headers)
        try {
            when {
                path == "/tv/connection" && method == "GET" -> respond(
                    out, 200,
                    JSONObject()
                        .put("service", "meddl")
                        .put("protocol", 1)
                        .put("pairing", true)
                        .put("auth", "none")
                        .put("addresses", JSONArray(homeNetworkAddresses())),
                    headers,
                )
                path == "/tv/setup" && method == "GET" -> asset(out, "setup/index.html", "text/html; charset=utf-8")
                path == "/tv/setup.css" && method == "GET" -> asset(out, "setup/setup.css", "text/css; charset=utf-8")
                path == "/tv/setup.js" && method == "GET" -> asset(out, "setup/setup.js", "text/javascript; charset=utf-8")
                path == "/tv/pairing" && method == "POST" -> {
                    if (!loopback) throw Failure(403, "Only the TV can start a setup.")
                    respond(out, 201, create(parse(body)), headers)
                }
                path.startsWith("/tv/pairing/") -> {
                    val rest = path.removePrefix("/tv/pairing/").split('/')
                    if (rest.size != 2) throw Failure(404, "Not found.")
                    val id = java.net.URLDecoder.decode(rest[0], "UTF-8")
                    val token = headers["x-tv-pairing"].orEmpty()
                    when (rest[1] to method) {
                        "tv" to "GET" -> {
                            if (!loopback) throw Failure(403, "This setup link is not valid.")
                            respond(out, 200, read(id, token, tv = true), headers)
                        }
                        "tv" to "POST" -> {
                            if (!loopback) throw Failure(403, "This setup link is not valid.")
                            respond(out, 200, finish(id, token, parse(body).optString("outcome")), headers)
                        }
                        "phone" to "GET" -> respond(out, 200, read(id, token, tv = false), headers)
                        "phone" to "POST" -> respond(out, 200, submit(id, token, body), headers)
                        else -> throw Failure(404, "Not found.")
                    }
                }
                else -> throw Failure(404, "Not found.")
            }
        } catch (failure: Failure) {
            respond(out, failure.status, json("message" to (failure.message ?: "Invalid setup request.")), headers)
        } catch (_: Exception) {
            respond(out, 400, json("message" to "Invalid setup request."), headers)
        }
    }

    private fun create(request: JSONObject): JSONObject {
        sweep()
        val purpose = request.optString("purpose", "source").ifEmpty { "source" }
        if (purpose != "source" && purpose != "settings") throw Failure(400, "Invalid setup purpose.")
        if (sessions.size >= 32) throw Failure(429, "Too many setup attempts. Try again shortly.")
        val defaults = if (purpose == "settings") request.opt("defaults") else null
        val session = Session(token(), token(), token(), System.currentTimeMillis() + TTL_MS, purpose, defaults)
        sessions[session.id] = session
        return JSONObject()
            .put("id", session.id)
            .put("tvToken", session.tvToken)
            .put("phoneToken", session.phoneToken)
            .put("expiresAt", session.expiresAt)
    }

    private fun read(id: String, token: String, tv: Boolean): JSONObject {
        val s = authorize(id, token, tv)
        val result = JSONObject()
            .put("status", s.status)
            .put("purpose", s.purpose)
            .put("expiresAt", s.expiresAt)
        s.defaults?.let { result.put("defaults", it) }
        if (tv) s.entry?.let { result.put(if (s.purpose == "settings") "settings" else "source", it) }
        return result
    }

    private fun submit(id: String, token: String, body: String): JSONObject {
        val s = authorize(id, token, tv = false)
        synchronized(s) {
            if (s.status != "waiting") throw Failure(409, "This link has already been used.")
            s.entry = runCatching { JSONObject(body) }.getOrNull() ?: throw Failure(400, "Invalid source.")
            s.status = "pending"
        }
        return json("status" to s.status)
    }

    private fun finish(id: String, token: String, outcome: String): JSONObject {
        val s = authorize(id, token, tv = true)
        if (outcome !in listOf("saved", "rejected", "cancelled")) throw Failure(400, "Invalid result.")
        synchronized(s) {
            if (s.status == outcome) return json("status" to s.status)
            if ((outcome != "cancelled" && s.status != "pending") || s.status in listOf("saved", "rejected", "cancelled"))
                throw Failure(409, "This setup session is already closed.")
            s.status = outcome
            s.entry = null
        }
        return json("status" to s.status)
    }

    private fun authorize(id: String, token: String, tv: Boolean): Session {
        sweep()
        val s = sessions[id] ?: throw Failure(410, "This setup link expired. Open a new QR code on the TV.")
        val expected = (if (tv) s.tvToken else s.phoneToken).toByteArray()
        if (!MessageDigest.isEqual(expected, token.toByteArray())) throw Failure(403, "This setup link is not valid.")
        return s
    }

    private fun sweep() {
        val now = System.currentTimeMillis()
        // Iterator removal: Collection.removeIf needs API 24.
        val each = sessions.values.iterator()
        while (each.hasNext()) if (each.next().expiresAt <= now) each.remove()
    }

    private fun token(): String {
        val bytes = ByteArray(24)
        random.nextBytes(bytes)
        return Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
    }

    private fun asset(out: OutputStream, name: String, type: String) {
        val bytes = runCatching { assets.open(name).use { it.readBytes() } }.getOrNull()
            ?: return write(out, 404, "text/plain; charset=utf-8", "Not found".toByteArray(), emptyMap())
        write(
            out, 200, type, bytes,
            mapOf(
                "Content-Security-Policy" to "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
                "Referrer-Policy" to "no-referrer",
            ),
        )
    }

    private fun respond(out: OutputStream, status: Int, body: JSONObject?, request: Map<String, String>) {
        // The TV page (https://appassets.androidplatform.net) calls through CORS.
        val cors = mutableMapOf(
            "Access-Control-Allow-Origin" to "*",
            "Access-Control-Allow-Methods" to "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers" to "Content-Type, X-TV-Pairing, Authorization",
            "Access-Control-Max-Age" to "600",
        )
        if (request["access-control-request-private-network"] == "true")
            cors["Access-Control-Allow-Private-Network"] = "true"
        write(out, status, "application/json; charset=utf-8", (body?.toString() ?: "").toByteArray(), cors)
    }

    private fun write(out: OutputStream, status: Int, type: String, body: ByteArray, extra: Map<String, String>) {
        val head = StringBuilder("HTTP/1.1 $status ${REASONS[status] ?: "OK"}\r\n")
            .append("Content-Type: $type\r\n")
            .append("Content-Length: ${body.size}\r\n")
            .append("Cache-Control: no-store\r\n")
            .append("X-Content-Type-Options: nosniff\r\n")
            .append("Connection: close\r\n")
        extra.forEach { (k, v) -> head.append("$k: $v\r\n") }
        head.append("\r\n")
        out.write(head.toString().toByteArray())
        out.write(body)
        out.flush()
    }

    private fun parse(body: String): JSONObject =
        if (body.isBlank()) JSONObject() else runCatching { JSONObject(body) }.getOrNull() ?: throw Failure(400, "Invalid setup request.")

    private fun json(vararg pairs: Pair<String, Any>): JSONObject =
        JSONObject().apply { pairs.forEach { (k, v) -> put(k, v) } }

    private fun readLine(input: InputStream): String? {
        val bytes = ByteArrayOutputStream()
        while (true) {
            val b = input.read()
            if (b < 0) return if (bytes.size() == 0) null else bytes.toString("UTF-8")
            if (b == '\n'.code) return bytes.toString("UTF-8").trimEnd('\r')
            if (bytes.size() > 8192) return null
            bytes.write(b)
        }
    }

    companion object {
        private val PORTS = 3340..3345
        private const val TTL_MS = 5 * 60_000L
        private const val MAX_BODY = 16 * 1024
        private val REASONS = mapOf(
            200 to "OK", 201 to "Created", 204 to "No Content", 400 to "Bad Request", 403 to "Forbidden",
            404 to "Not Found", 409 to "Conflict", 410 to "Gone", 413 to "Payload Too Large", 429 to "Too Many Requests",
        )

        /** This TV's IPv4 addresses in the home network, 192.168.x first. */
        fun homeNetworkAddresses(): List<String> {
            val privateRange = Regex("^(10\\.|192\\.168\\.|172\\.(1[6-9]|2\\d|3[01])\\.)")
            val rank = { a: String -> if (a.startsWith("192.168.")) 0 else if (a.startsWith("10.")) 1 else 2 }
            return runCatching {
                NetworkInterface.getNetworkInterfaces().toList()
                    .filter { it.isUp && !it.isLoopback }
                    .flatMap { it.inetAddresses.toList() }
                    .filterIsInstance<Inet4Address>()
                    .mapNotNull { it.hostAddress }
                    .filter { privateRange.containsMatchIn(it) }
                    .sortedBy(rank)
            }.getOrDefault(emptyList())
        }
    }
}
