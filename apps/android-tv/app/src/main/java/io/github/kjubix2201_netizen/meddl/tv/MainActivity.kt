package io.github.kjubix2201_netizen.meddl.tv

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.FrameLayout
import android.app.UiModeManager
import android.content.res.Configuration
import android.view.inputmethod.InputMethodManager
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import org.json.JSONObject

/**
 * Hosts the meddl TV client (apps/tv, built into assets/www) full screen.
 *
 * The page is served from https://appassets.androidplatform.net so it gets a
 * real, stable origin (IndexedDB, localStorage, CORS against the meddl
 * backend). Remote keys are translated into the key events the TV client
 * already understands from webOS: Back → 461 / "BrowserBack", media keys →
 * 415 play, 19 pause, 413 stop, 412 rewind, 417 fast-forward.
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private val pairing by lazy { PairingServer(assets) }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val assets = WebViewAssetLoader.Builder()
            .setDomain(ASSET_HOST)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            isFocusable = true
            isFocusableInTouchMode = true
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                mediaPlaybackRequiresUserGesture = false
                // Backends on the home network and most IPTV streams are
                // plain http; the page itself is https (asset loader).
                mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                // TVs lay the page out 1280 px wide (see tvIndex), scaled to the screen.
                useWideViewPort = true
                loadWithOverviewMode = true
                allowFileAccess = false
                allowContentAccess = false
                userAgentString = "$userAgentString meddlAndroidTV/${BuildConfig.VERSION_NAME}"
            }
            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClientCompat() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest
                ): WebResourceResponse? =
                    if (request.url.host == ASSET_HOST && request.url.path == DirectFetch.PATH) {
                        DirectFetch.answer(request.url, request.method)
                    } else if (request.url.host == ASSET_HOST && request.url.path == INDEX_PATH && isTelevision()) {
                        tvIndex() ?: assets.shouldInterceptRequest(request.url)
                    } else {
                        assets.shouldInterceptRequest(request.url)
                    }

                // The app never navigates away from its own page.
                override fun shouldOverrideUrlLoading(
                    view: WebView,
                    request: WebResourceRequest
                ): Boolean = request.url.host != ASSET_HOST
            }
            addJavascriptInterface(AndroidBridge(), "MeddlAndroid")
        }
        setContentView(web)
        hideSystemBars()

        // Channel up / down in the native player: the page picks the channel.
        PlayerActivity.onZap = { direction ->
            runOnUiThread { web.evaluateJavascript("window.meddlZap&&window.meddlZap($direction);", null) }
        }

        // The built-in VPN tells the page about every change.
        MeddlVpn.listener = { state ->
            runOnUiThread {
                if (!isDestroyed)
                    web.evaluateJavascript("window.meddlVpnChanged&&window.meddlVpnChanged($state);", null)
            }
        }
        MeddlVpn.autostart(this)

        if (savedInstanceState == null) {
            web.loadUrl(START_URL)
        } else {
            web.restoreState(savedInstanceState)
        }
        web.requestFocus()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
        hideSystemBars()
    }

    override fun onPause() {
        web.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        PlayerActivity.onZap = null
        MeddlVpn.listener = null
        pairing.stop()
        web.destroy()
        super.onDestroy()
    }

    @Deprecated("Activity result API needs androidx.activity; plain Activity keeps the shell small.")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == VPN_REQUEST) {
            if (resultCode == RESULT_OK) MeddlVpn.connect(this) else MeddlVpn.denied(this)
            return
        }
        if (requestCode != NATIVE_PLAYER_REQUEST) return
        val position = data?.getLongExtra(PlayerActivity.EXTRA_POSITION_MS, 0L) ?: 0L
        val duration = data?.getLongExtra(PlayerActivity.EXTRA_DURATION_MS, 0L) ?: 0L
        val next = data?.getBooleanExtra(PlayerActivity.EXTRA_NEXT, false) ?: false
        web.evaluateJavascript(
            "window.meddlNativeClosed&&window.meddlNativeClosed($position,$duration,$next);",
            null
        )
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val script = scriptFor(event.keyCode) ?: return super.dispatchKeyEvent(event)
        if (event.action == KeyEvent.ACTION_DOWN) {
            web.evaluateJavascript(script, null)
        }
        // Swallow DOWN and UP so Android does not also run its default
        // (Back would close the app before the page can go back a screen).
        return true
    }

    private fun scriptFor(keyCode: Int): String? = when (keyCode) {
        KeyEvent.KEYCODE_BACK,
        KeyEvent.KEYCODE_ESCAPE -> pageKey("BrowserBack", 461)
        KeyEvent.KEYCODE_MEDIA_PLAY -> pageKey("MediaPlay", 415)
        KeyEvent.KEYCODE_MEDIA_PAUSE -> pageKey("MediaPause", 19)
        KeyEvent.KEYCODE_MEDIA_STOP -> pageKey("MediaStop", 413)
        KeyEvent.KEYCODE_MEDIA_REWIND -> pageKey("MediaRewind", 412)
        KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> pageKey("MediaFastForward", 417)
        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
        KeyEvent.KEYCODE_HEADSETHOOK -> PLAY_PAUSE_SCRIPT
        else -> null
    }

    @Suppress("DEPRECATION")
    private fun hideSystemBars() {
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            )
    }

    /** Exposed to the page as `window.MeddlAndroid`. */
    inner class AndroidBridge {
        /** Called by the TV client's platformBack() on its root screen. */
        @JavascriptInterface
        fun exitApp() {
            runOnUiThread { finish() }
        }

        @JavascriptInterface
        fun platform(): String = if (isFireTv()) "firetv" else "androidtv"

        @JavascriptInterface
        fun version(): String = BuildConfig.VERSION_NAME

        /**
         * Phone setup by QR code without a meddl server ([PairingServer]).
         * Returns the server's address for the TV page, or "" if no port
         * could be opened.
         */
        @JavascriptInterface
        fun startPairingServer(): String {
            val port = pairing.start()
            return if (port > 0) "http://127.0.0.1:$port" else ""
        }

        /** The page may reach providers through [DirectFetch] (built-in server). */
        @JavascriptInterface
        fun hasDirectFetch(): Boolean = true

        /** Remote-first: text fields open the keyboard only after OK (see focus.ts). */
        @JavascriptInterface
        fun isTelevision(): Boolean = this@MainActivity.isTelevision()

        /**
         * Text entry on a TV: a native field with the system keyboard (the
         * WebView's own field loses the keyboard on many TVs right after
         * it opens). Every change goes to window.meddlTextEntered(text,
         * done), so results update behind the field while typing.
         */
        @JavascriptInterface
        fun editText(value: String, hint: String) {
            runOnUiThread { showTextField(value, hint) }
        }

        /** Built-in VPN (MeddlVpn): state as JSON for the settings page. */
        @JavascriptInterface
        fun vpnState(): String = MeddlVpn.summary(this@MainActivity).toString()

        /** Keeps a WireGuard profile; "" when fine, otherwise the reason. */
        @JavascriptInterface
        fun vpnImport(text: String, name: String): String = MeddlVpn.import(this@MainActivity, text, name)

        @JavascriptInterface
        fun vpnConnect() {
            runOnUiThread {
                val consent = android.net.VpnService.prepare(this@MainActivity)
                if (consent != null) {
                    runCatching { startActivityForResult(consent, VPN_REQUEST) }
                        .onFailure { MeddlVpn.denied(this@MainActivity) }
                } else {
                    MeddlVpn.connect(this@MainActivity)
                }
            }
        }

        @JavascriptInterface
        fun vpnDisconnect() = MeddlVpn.disconnect(this@MainActivity)

        @JavascriptInterface
        fun vpnRemove() = MeddlVpn.remove(this@MainActivity)

        @JavascriptInterface
        fun vpnSetAutostart(on: Boolean) = MeddlVpn.setAutostart(this@MainActivity, on)

        @JavascriptInterface
        fun vpnSetLock(on: Boolean) = MeddlVpn.setLock(this@MainActivity, on)

        @JavascriptInterface
        fun showKeyboard() {
            runOnUiThread {
                web.requestFocus()
                (getSystemService(INPUT_METHOD_SERVICE) as? InputMethodManager)
                    ?.showSoftInput(web, InputMethodManager.SHOW_IMPLICIT)
            }
        }

        /**
         * Plays a stream in the native player (Dolby / DTS sound). The page
         * calls this when its own playback stays silent; `request` is JSON
         * with url, title, startMs, live and userAgent.
         */
        @JavascriptInterface
        fun playNative(request: String) {
            val json = runCatching { JSONObject(request) }.getOrNull() ?: return
            val url = json.optString("url")
            val scheme = Uri.parse(url).scheme?.lowercase()
            if (scheme != "http" && scheme != "https") return
            runOnUiThread {
                val player = Intent(this@MainActivity, PlayerActivity::class.java)
                        .putExtra(PlayerActivity.EXTRA_URL, url)
                        .putExtra(PlayerActivity.EXTRA_TITLE, json.optString("title"))
                        .putExtra(PlayerActivity.EXTRA_START_MS, json.optLong("startMs", 0L))
                        .putExtra(PlayerActivity.EXTRA_LIVE, json.optBoolean("live", false))
                        .putExtra(PlayerActivity.EXTRA_USER_AGENT, json.optString("userAgent"))
                        .putExtra(PlayerActivity.EXTRA_NEXT_TITLE, json.optString("nextTitle"))
                        .putExtra(PlayerActivity.EXTRA_NEXT_LABEL, json.optString("nextLabel"))
                        .putExtra(PlayerActivity.EXTRA_PLAY_NOW_LABEL, json.optString("playNowLabel"))
                        .putExtra(PlayerActivity.EXTRA_CANCEL_LABEL, json.optString("cancelLabel"))
                // Zapping: the open player switches to the next channel in place.
                val open = PlayerActivity.current
                if (open != null && !open.isFinishing) {
                    open.switchTo(player)
                } else {
                    @Suppress("DEPRECATION")
                    startActivityForResult(player, NATIVE_PLAYER_REQUEST)
                }
            }
        }
    }

    private var textField: AlertDialog? = null

    private fun showTextField(value: String, hint: String) {
        textField?.dismiss()
        val field = EditText(this).apply {
            setText(value)
            setSelection(text.length)
            this.hint = hint
            setSingleLine(true)
            inputType = InputType.TYPE_CLASS_TEXT
            imeOptions = EditorInfo.IME_ACTION_SEARCH or EditorInfo.IME_FLAG_NO_EXTRACT_UI
        }
        val pad = (24 * resources.displayMetrics.density).toInt()
        val box = FrameLayout(this).apply {
            setPadding(pad, pad / 2, pad, 0)
            addView(field)
        }
        var sent = value
        fun send(done: Boolean) {
            val text = field.text.toString()
            if (!done && text == sent) return
            sent = text
            web.evaluateJavascript(
                "window.meddlTextEntered&&window.meddlTextEntered(${JSONObject.quote(text)},$done);",
                null
            )
        }
        val dialog = AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
            .setTitle(hint)
            .setView(box)
            .setPositiveButton(android.R.string.ok) { _, _ -> send(true) }
            .setNegativeButton(android.R.string.cancel) { _, _ -> send(true) }
            .create()
        field.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
            override fun afterTextChanged(s: Editable?) = send(false)
        })
        field.setOnEditorActionListener { _, actionId, event ->
            if (actionId == EditorInfo.IME_ACTION_SEARCH || actionId == EditorInfo.IME_ACTION_DONE ||
                event?.keyCode == KeyEvent.KEYCODE_ENTER
            ) {
                send(true)
                dialog.dismiss()
                true
            } else {
                false
            }
        }
        dialog.window?.apply {
            // At the top, so the results stay visible below while typing.
            setGravity(Gravity.TOP)
            setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE)
        }
        dialog.setOnShowListener {
            field.requestFocus()
            (getSystemService(INPUT_METHOD_SERVICE) as? InputMethodManager)
                ?.showSoftInput(field, InputMethodManager.SHOW_IMPLICIT)
        }
        dialog.setOnDismissListener {
            if (textField === dialog) textField = null
            send(true)
            hideSystemBars()
            web.requestFocus()
        }
        textField = dialog
        dialog.show()
    }

    private fun isTelevision(): Boolean =
        isFireTv() ||
            (getSystemService(UI_MODE_SERVICE) as? UiModeManager)?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION ||
            packageManager.hasSystemFeature("android.software.leanback")

    /**
     * The TV interface is designed for a 1280 px wide page. Android TVs report
     * 960 px (1080p at density 2), which made everything a third too large:
     * the page asks for 1280 px and the WebView scales it to the screen.
     */
    private fun tvIndex(): WebResourceResponse? = runCatching {
        val html = assets.open("www/index.html").bufferedReader().use { it.readText() }
            .replace(Regex("<meta name=\"viewport\"[^>]*>"), "<meta name=\"viewport\" content=\"width=1280\" />")
        WebResourceResponse("text/html", "utf-8", html.byteInputStream())
    }.getOrNull()

    private fun isFireTv(): Boolean =
        packageManager.hasSystemFeature("amazon.hardware.fire_tv")

    companion object {
        private const val ASSET_HOST = "appassets.androidplatform.net"
        private const val NATIVE_PLAYER_REQUEST = 41
        private const val VPN_REQUEST = 42
        private const val INDEX_PATH = "/assets/www/index.html"
        private val START_URL = Uri.Builder()
            .scheme("https")
            .authority(ASSET_HOST)
            .path("/assets/www/index.html")
            .build()
            .toString()

        /** Dispatches a keydown the TV client's remote handler understands. */
        private fun pageKey(key: String, code: Int): String =
            "(function(){" + dispatch("'$key'", "$code") + "})();"

        /** Play/Pause toggle: decided in the page from the video state. */
        private val PLAY_PAUSE_SCRIPT =
            "(function(){var v=document.querySelector('video');var play=!v||v.paused;" +
                dispatch("play?'MediaPlay':'MediaPause'", "play?415:19") + "})();"

        private fun dispatch(keyExpr: String, codeExpr: String): String =
            "var c=$codeExpr;var t=document.activeElement||document.body||document;" +
                "var e=new KeyboardEvent('keydown',{key:$keyExpr,bubbles:true,cancelable:true});" +
                "try{Object.defineProperty(e,'keyCode',{get:function(){return c}});" +
                "Object.defineProperty(e,'which',{get:function(){return c}});}catch(x){}" +
                "t.dispatchEvent(e);"
    }
}
