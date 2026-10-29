package io.github.kjubix2201_netizen.meddl.tv

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.DefaultTimeBar
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
 * With a next episode (EXTRA_NEXT_TITLE) the controls show a Next button and
 * the end of the episode counts down, then returns with EXTRA_NEXT so the
 * page starts the next episode, which comes back here.
 */
@OptIn(UnstableApi::class)
class PlayerActivity : Activity() {

    private var player: ExoPlayer? = null
    private lateinit var view: PlayerView
    private var live = false
    private var liveRetries = 0
    private var nextTitle = ""
    private lateinit var channelBanner: TextView
    private val hideBanner = Runnable { channelBanner.visibility = View.GONE }
    private var lastZapAt = 0L
    private var userAgentInUse = ""
    private lateinit var nextBanner: LinearLayout
    private lateinit var nextText: TextView
    private lateinit var nextNow: Button
    private val countdown = Handler(Looper.getMainLooper())
    private var secondsLeft = 0
    private val tick = object : Runnable {
        override fun run() {
            if (secondsLeft <= 0) return goNext()
            nextText.text = label(EXTRA_NEXT_LABEL, "Next episode in {seconds} s: {title}")
                .replace("{seconds}", secondsLeft.toString())
                .replace("{title}", nextTitle)
            secondsLeft -= 1
            countdown.postDelayed(this, 1000)
        }
    }

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
        if (live) {
            // Live has nothing to seek in: no timeline, times or skip buttons.
            view.setShowRewindButton(false)
            view.setShowFastForwardButton(false)
            for (id in listOf(
                androidx.media3.ui.R.id.exo_progress,
                androidx.media3.ui.R.id.exo_position,
                androidx.media3.ui.R.id.exo_duration,
                androidx.media3.ui.R.id.exo_time,
            )) view.findViewById<View>(id)?.visibility = View.GONE
        } else {
            // Left / Right on the timeline: 10 s steps, also while held.
            (view.findViewById<View>(androidx.media3.ui.R.id.exo_progress) as? DefaultTimeBar)
                ?.setKeyTimeIncrement(SEEK_STEP_MS)
        }
        nextTitle = intent.getStringExtra(EXTRA_NEXT_TITLE).orEmpty()
        val root = FrameLayout(this)
        root.addView(view, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        root.addView(buildNextBanner(), FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM or Gravity.END,
        ).apply { setMargins(0, 0, dp(48), dp(48)) })
        channelBanner = TextView(this).apply {
            setTextColor(Color.WHITE)
            textSize = 22f
            setPadding(dp(22), dp(12), dp(22), dp(12))
            background = GradientDrawable().apply {
                cornerRadius = dp(12).toFloat()
                setColor(0xE61F1D2B.toInt())
            }
            visibility = View.GONE
        }
        root.addView(channelBanner, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.TOP or Gravity.START,
        ).apply { setMargins(dp(48), dp(40), 0, 0) })
        setContentView(root)
        hideSystemBars()
        current = this
        if (live) showBanner(intent.getStringExtra(EXTRA_TITLE).orEmpty())
    }

    private fun showBanner(text: String) {
        if (text.isEmpty()) return
        channelBanner.text = text
        channelBanner.visibility = View.VISIBLE
        countdown.removeCallbacks(hideBanner)
        countdown.postDelayed(hideBanner, 3500)
    }

    /** The page chose another channel (zapping): play it here without closing. */
    fun switchTo(next: Intent) {
        setIntent(next)
        live = next.getBooleanExtra(EXTRA_LIVE, false)
        nextTitle = next.getStringExtra(EXTRA_NEXT_TITLE).orEmpty()
        liveRetries = 0
        cancelNext()
        showBanner(next.getStringExtra(EXTRA_TITLE).orEmpty())
        val exo = player
        val url = next.getStringExtra(EXTRA_URL)
        // Same provider login: keep the player and its decoders, only the
        // stream changes, which makes switching channels quick.
        if (exo != null && url != null && next.getStringExtra(EXTRA_USER_AGENT).orEmpty() == userAgentInUse) {
            exo.setMediaItem(
                MediaItem.Builder()
                    .setUri(Uri.parse(url))
                    .setMediaMetadata(MediaMetadata.Builder().setTitle(next.getStringExtra(EXTRA_TITLE) ?: "").build())
                    .build(),
                if (live) C.TIME_UNSET else next.getLongExtra(EXTRA_START_MS, 0L),
            )
            exo.prepare()
            exo.playWhenReady = true
            return
        }
        player?.release()
        player = null
        view.player = null
        startPlayer()
    }

    /** Channel up / down: asks the page for the neighbouring channel. */
    private fun zap(direction: Int) {
        val now = System.currentTimeMillis()
        if (now - lastZapAt < 250) return
        lastZapAt = now
        showBanner("…")
        onZap?.invoke(direction)
    }

    override fun onDestroy() {
        if (current === this) current = null
        countdown.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    private fun label(extra: String, fallback: String) =
        intent.getStringExtra(extra)?.takeIf { it.isNotBlank() } ?: fallback

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    /** "Next episode in 8 s: …" with Play now / Cancel, shown at the end. */
    private fun buildNextBanner(): LinearLayout {
        nextText = TextView(this).apply {
            setTextColor(Color.WHITE)
            textSize = 18f
            setPadding(0, 0, dp(20), 0)
        }
        fun button(text: String, primary: Boolean, action: () -> Unit) = Button(this).apply {
            this.text = text
            isAllCaps = false
            textSize = 16f
            setTextColor(if (primary) Color.BLACK else Color.WHITE)
            background = GradientDrawable().apply {
                cornerRadius = dp(10).toFloat()
                setColor(if (primary) Color.WHITE else 0x33FFFFFF)
            }
            setPadding(dp(20), dp(8), dp(20), dp(8))
            isFocusable = true
            setOnFocusChangeListener { v, focused -> v.alpha = if (focused) 1f else 0.75f }
            setOnClickListener { action() }
        }
        nextNow = button(label(EXTRA_PLAY_NOW_LABEL, "Play now"), true) { goNext() }
        val cancel = button(label(EXTRA_CANCEL_LABEL, "Cancel"), false) { cancelNext() }
        nextBanner = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(24), dp(16), dp(16), dp(16))
            background = GradientDrawable().apply {
                cornerRadius = dp(14).toFloat()
                setColor(0xE61F1D2B.toInt())
            }
            visibility = View.GONE
            addView(nextText)
            addView(nextNow)
            addView(cancel, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply { marginStart = dp(12) })
        }
        return nextBanner
    }

    private fun startCountdown() {
        if (nextTitle.isEmpty() || nextBanner.visibility == View.VISIBLE) return
        view.hideController()
        nextBanner.visibility = View.VISIBLE
        nextNow.requestFocus()
        secondsLeft = AUTOPLAY_SECONDS
        countdown.removeCallbacks(tick)
        tick.run()
    }

    private fun cancelNext() {
        countdown.removeCallbacks(tick)
        nextBanner.visibility = View.GONE
    }

    /** Back to the page, which starts the next episode. */
    private fun goNext() {
        countdown.removeCallbacks(tick)
        val exo = player
        if (exo != null) reportPosition(exo, next = true)
        else setResult(RESULT_OK, Intent().putExtra(EXTRA_NEXT, true))
        finish()
    }

    override fun onStart() {
        super.onStart()
        if (player == null) startPlayer()
    }

    override fun onStop() {
        countdown.removeCallbacks(tick)
        releasePlayer()
        super.onStop()
    }

    private fun startPlayer() {
        val url = intent.getStringExtra(EXTRA_URL) ?: return finish()
        val userAgent = intent.getStringExtra(EXTRA_USER_AGENT)?.takeIf { it.isNotBlank() }
            ?: "meddlAndroidTV/${BuildConfig.VERSION_NAME}"
        userAgentInUse = intent.getStringExtra(EXTRA_USER_AGENT).orEmpty()
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
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_ENDED && !live) {
                    if (nextTitle.isNotEmpty()) startCountdown()
                    else {
                        reportPosition(exo)
                        finish()
                    }
                }
            }

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
        // The Next button of the controls starts the next episode.
        view.setShowNextButton(nextTitle.isNotEmpty() && !live)
        view.player = if (nextTitle.isEmpty() || live) exo else object : ForwardingPlayer(exo) {
            override fun isCommandAvailable(command: Int) =
                command == Player.COMMAND_SEEK_TO_NEXT || command == Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM ||
                    super.isCommandAvailable(command)

            override fun getAvailableCommands(): Player.Commands = super.getAvailableCommands().buildUpon()
                .add(Player.COMMAND_SEEK_TO_NEXT)
                .add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
                .build()

            override fun seekToNext() = goNext()
            override fun seekToNextMediaItem() = goNext()
        }
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

    private fun reportPosition(exo: ExoPlayer, next: Boolean = false) {
        val duration = exo.duration.takeIf { it != C.TIME_UNSET } ?: 0L
        setResult(
            RESULT_OK,
            Intent()
                .putExtra(EXTRA_POSITION_MS, if (live) 0L else exo.currentPosition)
                .putExtra(EXTRA_DURATION_MS, duration)
                .putExtra(EXTRA_NEXT, next)
        )
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val exo = player
        // The countdown banner has the focus: OK and arrows work on its buttons.
        if (nextBanner.visibility == View.VISIBLE) {
            if (event.keyCode == KeyEvent.KEYCODE_BACK || event.keyCode == KeyEvent.KEYCODE_ESCAPE) {
                if (event.action == KeyEvent.ACTION_DOWN) cancelNext()
                return true
            }
            return super.dispatchKeyEvent(event)
        }
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
                KeyEvent.KEYCODE_CHANNEL_UP, KeyEvent.KEYCODE_PAGE_UP -> if (live) {
                    zap(1)
                    return true
                }
                KeyEvent.KEYCODE_CHANNEL_DOWN, KeyEvent.KEYCODE_PAGE_DOWN -> if (live) {
                    zap(-1)
                    return true
                }
                // Up / Down with the controls hidden switch channels, like a TV.
                KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN -> if (live && !view.isControllerFullyVisible) {
                    zap(if (event.keyCode == KeyEvent.KEYCODE_DPAD_DOWN) 1 else -1)
                    return true
                }
                KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT -> if (!live && seeksHere()) {
                    steadySeek(exo, if (event.keyCode == KeyEvent.KEYCODE_DPAD_RIGHT) 1 else -1, event.repeatCount > 0)
                    return true
                }
                KeyEvent.KEYCODE_MEDIA_REWIND -> if (!live) {
                    steadySeek(exo, -1, event.repeatCount > 0)
                    return true
                }
                KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> if (!live) {
                    steadySeek(exo, 1, event.repeatCount > 0)
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

    private var seekTarget = -1L
    private var lastSeekAt = 0L
    private val seekDone = Runnable { seekTarget = -1L }

    /** Left / Right seek while the controls are hidden or the timeline has the focus. */
    private fun seeksHere(): Boolean {
        if (!view.isControllerFullyVisible) return true
        return currentFocus?.id == androidx.media3.ui.R.id.exo_progress
    }

    /**
     * 10 s per press. Held down, the steps keep coming at an even pace
     * (one every 120 ms, 80 s of film per second) instead of following the
     * remote's key repeat, and the picture follows the target position.
     */
    private fun steadySeek(exo: ExoPlayer, direction: Int, repeat: Boolean) {
        val now = System.currentTimeMillis()
        if (repeat && now - lastSeekAt < SEEK_REPEAT_MS) return
        lastSeekAt = now
        val duration = exo.duration.takeIf { it != C.TIME_UNSET && it > 0 } ?: Long.MAX_VALUE
        val from = if (seekTarget >= 0) seekTarget else exo.currentPosition
        seekTarget = (from + direction * SEEK_STEP_MS).coerceIn(0L, duration)
        exo.seekTo(seekTarget)
        view.showController()
        countdown.removeCallbacks(seekDone)
        countdown.postDelayed(seekDone, 800)
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
        const val EXTRA_NEXT = "next"

        /** The open player, so a zap can switch it in place (MainActivity.playNative). */
        @Volatile var current: PlayerActivity? = null

        /** Set by MainActivity: asks the page for the channel before (-1) or after (1). */
        @Volatile var onZap: ((Int) -> Unit)? = null
        const val EXTRA_NEXT_TITLE = "nextTitle"
        const val EXTRA_NEXT_LABEL = "nextLabel"
        const val EXTRA_PLAY_NOW_LABEL = "playNowLabel"
        const val EXTRA_CANCEL_LABEL = "cancelLabel"
        private const val AUTOPLAY_SECONDS = 8
        private const val SEEK_STEP_MS = 10_000L
        private const val SEEK_REPEAT_MS = 120L
    }
}
