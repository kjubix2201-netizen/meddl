package io.github.kjubix2201_netizen.meddl.tv

import android.annotation.SuppressLint
import android.app.Activity
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
                allowFileAccess = false
                allowContentAccess = false
                userAgentString = "$userAgentString meddlAndroidTV/${BuildConfig.VERSION_NAME}"
            }
            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClientCompat() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest
                ): WebResourceResponse? = assets.shouldInterceptRequest(request.url)

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
        web.destroy()
        super.onDestroy()
    }

    @Deprecated("Activity result API needs androidx.activity; plain Activity keeps the shell small.")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != NATIVE_PLAYER_REQUEST) return
        val position = data?.getLongExtra(PlayerActivity.EXTRA_POSITION_MS, 0L) ?: 0L
        val duration = data?.getLongExtra(PlayerActivity.EXTRA_DURATION_MS, 0L) ?: 0L
        web.evaluateJavascript(
            "window.meddlNativeClosed&&window.meddlNativeClosed($position,$duration);",
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
                @Suppress("DEPRECATION")
                startActivityForResult(
                    Intent(this@MainActivity, PlayerActivity::class.java)
                        .putExtra(PlayerActivity.EXTRA_URL, url)
                        .putExtra(PlayerActivity.EXTRA_TITLE, json.optString("title"))
                        .putExtra(PlayerActivity.EXTRA_START_MS, json.optLong("startMs", 0L))
                        .putExtra(PlayerActivity.EXTRA_LIVE, json.optBoolean("live", false))
                        .putExtra(PlayerActivity.EXTRA_USER_AGENT, json.optString("userAgent")),
                    NATIVE_PLAYER_REQUEST
                )
            }
        }
    }

    private fun isFireTv(): Boolean =
        packageManager.hasSystemFeature("amazon.hardware.fire_tv")

    companion object {
        private const val ASSET_HOST = "appassets.androidplatform.net"
        private const val NATIVE_PLAYER_REQUEST = 41
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
