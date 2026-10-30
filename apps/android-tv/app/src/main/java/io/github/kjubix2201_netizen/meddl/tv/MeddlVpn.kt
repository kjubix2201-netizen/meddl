package io.github.kjubix2201_netizen.meddl.tv

import android.content.Context
import android.net.VpnService
import com.wireguard.android.backend.BackendException
import com.wireguard.android.backend.GoBackend
import com.wireguard.android.backend.Tunnel
import com.wireguard.config.Config
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.util.concurrent.Executors

/**
 * The built-in VPN: one WireGuard profile the viewer brings from their own
 * provider (Proton VPN, Mullvad, Surfshark …), for meddl's own traffic only
 * (IncludedApplications = this app), so other apps on the TV are untouched.
 *
 * The profile stays in the app's private storage. Its private key is never
 * logged, never sent to the page and never leaves the device.
 */
object MeddlVpn {
    private const val PREFS = "meddl-vpn"
    private const val KEY_CONFIG = "config"
    private const val KEY_NAME = "name"
    private const val KEY_AUTOSTART = "autostart"

    @Volatile private var state = "down"
    @Volatile private var error = ""
    private var backend: GoBackend? = null
    private val worker = Executors.newSingleThreadExecutor()

    /** Called with the state JSON whenever it changes (MainActivity → page). */
    @Volatile var listener: ((String) -> Unit)? = null

    private val tunnel = object : Tunnel {
        override fun getName() = "meddl"
        override fun onStateChange(newState: Tunnel.State) {
            state = if (newState == Tunnel.State.UP) "up" else "down"
            notifyChange(null)
        }
    }

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun backend(context: Context): GoBackend =
        backend ?: GoBackend(context.applicationContext).also { backend = it }

    /** The profile with meddl as the only app in the tunnel. */
    private fun parse(context: Context, text: String): Config {
        val lines = text.replace("\r", "").lines()
            .filterNot { it.trim().lowercase().let { l -> l.startsWith("includedapplications") || l.startsWith("excludedapplications") } }
            .toMutableList()
        val at = lines.indexOfFirst { it.trim().equals("[Interface]", ignoreCase = true) }
        if (at < 0) throw IllegalArgumentException("interface")
        lines.add(at + 1, "IncludedApplications = ${context.packageName}")
        return Config.parse(ByteArrayInputStream(lines.joinToString("\n").toByteArray()))
    }

    fun summary(context: Context): JSONObject {
        val stored = prefs(context)
        val text = stored.getString(KEY_CONFIG, null)
        val result = JSONObject()
            .put("available", true)
            .put("configured", text != null)
            .put("state", state)
            .put("error", error)
            .put("autostart", stored.getBoolean(KEY_AUTOSTART, false))
            .put("name", stored.getString(KEY_NAME, "") ?: "")
        if (text != null) runCatching {
            val endpoint = parse(context, text).peers.firstOrNull()?.endpoint
            if (endpoint != null && endpoint.isPresent) result.put("server", endpoint.get().host)
        }
        return result
    }

    /** Checks and keeps a profile; "" when it is fine, otherwise the reason. */
    fun import(context: Context, text: String, name: String): String {
        val config = runCatching { parse(context, text) }.getOrNull()
            ?: return "invalid"
        if (config.peers.isEmpty()) return "invalid"
        val wasUp = state == "up" || state == "connecting"
        prefs(context).edit()
            .putString(KEY_CONFIG, text.trim())
            .putString(KEY_NAME, name.take(60))
            .apply()
        error = ""
        // A new profile while connected: switch over at once.
        if (wasUp) connect(context) else notifyChange(context)
        return ""
    }

    /** True when Android still has to ask the viewer for permission. */
    fun needsPermission(context: Context) = VpnService.prepare(context) != null

    fun connect(context: Context) {
        val text = prefs(context).getString(KEY_CONFIG, null) ?: return
        state = "connecting"
        error = ""
        notifyChange(context)
        worker.execute {
            try {
                backend(context).setState(tunnel, Tunnel.State.UP, parse(context, text))
                state = "up"
            } catch (failure: BackendException) {
                state = "down"
                error = failure.reason.name.lowercase()
            } catch (failure: Exception) {
                state = "down"
                error = "failed"
            }
            notifyChange(context)
        }
    }

    fun disconnect(context: Context) {
        worker.execute {
            runCatching { backend(context).setState(tunnel, Tunnel.State.DOWN, null) }
            state = "down"
            notifyChange(context)
        }
    }

    fun remove(context: Context) {
        disconnect(context)
        prefs(context).edit().remove(KEY_CONFIG).remove(KEY_NAME).apply()
        worker.execute { notifyChange(context) }
    }

    fun setAutostart(context: Context, on: Boolean) {
        prefs(context).edit().putBoolean(KEY_AUTOSTART, on).apply()
        notifyChange(context)
    }

    /** At app start: connect when the viewer chose so and Android already allowed it. */
    fun autostart(context: Context) {
        val stored = prefs(context)
        if (stored.getBoolean(KEY_AUTOSTART, false) && stored.contains(KEY_CONFIG) && !needsPermission(context))
            connect(context)
    }

    fun denied(context: Context) {
        state = "down"
        error = "vpn_not_authorized"
        notifyChange(context)
    }

    private var lastContext: Context? = null
    private fun notifyChange(context: Context?) {
        if (context != null) lastContext = context.applicationContext
        val ctx = lastContext ?: return
        listener?.invoke(summary(ctx).toString())
    }
}
