package io.github.kjubix2201_netizen.meddl.tv

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView

/**
 * Native full-screen player for streams the WebView plays without sound.
 *
 * The page cannot decode Dolby Digital (AC-3), Dolby Digital Plus (E-AC-3),
 * DTS or TrueHD on many boxes. ExoPlayer with the FFmpeg audio decoder
 * (Jellyfin's build of the Media3 extension) decodes all of them in
 * software to stereo PCM, so every TV and box plays the sound. The picture
 * still uses the device's hardware decoder.
 *
 * Started by the page through `MeddlAndroid.playNative`; on Back it returns
 * the position, which MainActivity hands to `window.meddlNativeClosed`.
 */
@OptIn(UnstableApi::class)
class PlayerActivity : Activity() {

    private var player: ExoPlayer? = null
    private lateinit var view: PlayerView
    private var live = false
    private var liveRetries = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        live = intent.getBooleanExtra(EXTRA_LIVE, false)
        view = PlayerView(this).apply {
            setBackgroundColor(android.graphics.Color.BLACK)
            useController = true
            controllerShowTimeoutMs = 4000
            setShowNextButton(false)
            setShowPreviousButton(false)
            keepScreenOn = true
        }
        setContentView(view)
        hideSystemBars()
    }

    override fun onStart() {
        super.onStart()
        if (player == null) startPlayer()
    }

    override fun onStop() {
        releasePlayer()
        super.onStop()
    }

    private fun startPlayer() {
        val url = intent.getStringExtra(EXTRA_URL) ?: return finish()
        val userAgent = intent.getStringExtra(EXTRA_USER_AGENT)?.takeIf { it.isNotBlank() }
            ?: "meddlAndroidTV/${BuildConfig.VERSION_NAME}"
        val http = DefaultHttpDataSource.Factory()
            .setUserAgent(userAgent)
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(20_000)
        // PREFER: the FFmpeg decoder handles every audio format first, so a
        // box whose own decoder silently drops Dolby still plays sound.
        val renderers = DefaultRenderersFactory(this)
            .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER)
            .setEnableDecoderFallback(true)
        val exo = ExoPlayer.Builder(this, renderers)
            .setMediaSourceFactory(DefaultMediaSourceFactory(http))
            .build()
        exo.addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (isPlaying) liveRetries = 0
            }

            override fun onPlayerError(error: PlaybackException) {
                // Live streams often drop briefly: start again from the edge.
                if (live && liveRetries < 3) {
                    liveRetries += 1
                    exo.seekToDefaultPosition()
                    exo.prepare()
                }
            }
        })
        val item = MediaItem.Builder()
            .setUri(Uri.parse(url))
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle(intent.getStringExtra(EXTRA_TITLE) ?: "")
                    .build()
            )
            .build()
        exo.setMediaItem(item, if (live) C.TIME_UNSET else intent.getLongExtra(EXTRA_START_MS, 0L))
        exo.playWhenReady = true
        exo.prepare()
        view.player = exo
        player = exo
    }

    private fun releasePlayer() {
        player?.let {
            reportPosition(it)
            it.release()
        }
        player = null
        view.player = null
    }

    private fun reportPosition(exo: ExoPlayer) {
        val duration = exo.duration.takeIf { it != C.TIME_UNSET } ?: 0L
        setResult(
            RESULT_OK,
            Intent()
                .putExtra(EXTRA_POSITION_MS, if (live) 0L else exo.currentPosition)
                .putExtra(EXTRA_DURATION_MS, duration)
        )
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val exo = player
        if (exo != null && event.action == KeyEvent.ACTION_DOWN) {
            when (event.keyCode) {
                KeyEvent.KEYCODE_BACK, KeyEvent.KEYCODE_ESCAPE -> {
                    if (view.isControllerFullyVisible) {
                        view.hideController()
                        return true
                    }
                    reportPosition(exo)
                    finish()
                    return true
                }
                KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_HEADSETHOOK -> {
                    exo.playWhenReady = !exo.playWhenReady
                    return true
                }
                KeyEvent.KEYCODE_MEDIA_PLAY -> {
                    exo.play()
                    return true
                }
                KeyEvent.KEYCODE_MEDIA_PAUSE -> {
                    exo.pause()
                    return true
                }
                KeyEvent.KEYCODE_MEDIA_STOP -> {
                    reportPosition(exo)
                    finish()
                    return true
                }
            }
        }
        if (event.keyCode == KeyEvent.KEYCODE_BACK || event.keyCode == KeyEvent.KEYCODE_ESCAPE) return true
        // Arrows and OK open the controls, then move within them.
        return view.dispatchKeyEvent(event) || super.dispatchKeyEvent(event)
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

    companion object {
        const val EXTRA_URL = "url"
        const val EXTRA_TITLE = "title"
        const val EXTRA_START_MS = "startMs"
        const val EXTRA_LIVE = "live"
        const val EXTRA_USER_AGENT = "userAgent"
        const val EXTRA_POSITION_MS = "positionMs"
        const val EXTRA_DURATION_MS = "durationMs"
    }
}
