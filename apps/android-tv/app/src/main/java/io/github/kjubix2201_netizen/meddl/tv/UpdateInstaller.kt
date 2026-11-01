package io.github.kjubix2201_netizen.meddl.tv

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * "New version available" in the app: downloads the APK from the public
 * update channel (kjubix2201-netizen/meddl-updates) and opens Android's
 * installer with it. Only that channel is accepted as the source, and
 * Android itself installs it over the app only when it carries the same
 * signature. Progress and the outcome go to the page as
 * window.meddlUpdateProgress(percent) and window.meddlUpdateResult(state):
 * "installing", "permission" (allow meddl to install apps, then again) or
 * "failed".
 */
object UpdateInstaller {
    private const val CHANNEL = "https://github.com/kjubix2201-netizen/meddl-updates/releases/download/"

    @Volatile private var running = false

    fun start(activity: Activity, url: String, progress: (Int) -> Unit, result: (String) -> Unit) {
        if (!url.startsWith(CHANNEL) || !url.endsWith(".apk")) {
            result("failed")
            return
        }
        if (running) return
        running = true
        Thread {
            try {
                val file = download(activity, url, progress)
                activity.runOnUiThread { result(install(activity, file)) }
            } catch (_: Exception) {
                activity.runOnUiThread { result("failed") }
            } finally {
                running = false
            }
        }.start()
    }

    private fun target(activity: Activity): File {
        // Android 7+: shared through FileProvider from the app's cache.
        // Android 5/6 (older Fire TV): the installer reads a file:// address,
        // so the APK lies in the app's folder on the shared storage.
        val dir = if (Build.VERSION.SDK_INT >= 24) File(activity.cacheDir, "updates")
        else File(activity.getExternalFilesDir(null) ?: activity.cacheDir, "updates")
        dir.mkdirs()
        return File(dir, "meddl-update.apk")
    }

    private fun download(activity: Activity, url: String, progress: (Int) -> Unit): File {
        val file = target(activity)
        val partial = File(file.parentFile, "meddl-update.part")
        var address = url
        var connection: HttpURLConnection? = null
        for (hop in 0 until 6) {
            val next = URL(address).openConnection() as HttpURLConnection
            next.instanceFollowRedirects = false
            next.connectTimeout = 15_000
            next.readTimeout = 30_000
            next.setRequestProperty("User-Agent", "meddl-tv")
            val code = next.responseCode
            if (code in 300..399) {
                val location = next.getHeaderField("Location") ?: throw IllegalStateException("redirect")
                next.disconnect()
                address = URL(URL(address), location).toString()
                if (!address.startsWith("https://")) throw IllegalStateException("redirect-scheme")
                continue
            }
            if (code != 200) throw IllegalStateException("status $code")
            connection = next
            break
        }
        val open = connection ?: throw IllegalStateException("redirects")
        try {
            val total = open.contentLengthLong
            var done = 0L
            var shown = -1
            open.inputStream.use { input ->
                partial.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        output.write(buffer, 0, read)
                        done += read
                        if (total > 0) {
                            val percent = (done * 100 / total).toInt()
                            if (percent != shown) {
                                shown = percent
                                activity.runOnUiThread { progress(percent) }
                            }
                        }
                    }
                }
            }
            if (total > 0 && done != total) throw IllegalStateException("incomplete")
        } finally {
            open.disconnect()
        }
        file.delete()
        if (!partial.renameTo(file)) throw IllegalStateException("rename")
        if (Build.VERSION.SDK_INT < 24) file.setReadable(true, false)
        return file
    }

    private fun install(activity: Activity, file: File): String {
        if (Build.VERSION.SDK_INT >= 26 && !activity.packageManager.canRequestPackageInstalls()) {
            // Android 8+: meddl needs "Install unknown apps" once.
            try {
                activity.startActivity(
                    Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}"))
                )
            } catch (_: ActivityNotFoundException) {
                try {
                    activity.startActivity(Intent(Settings.ACTION_SECURITY_SETTINGS))
                } catch (_: ActivityNotFoundException) {
                }
            }
            return "permission"
        }
        val uri = if (Build.VERSION.SDK_INT >= 24)
            FileProvider.getUriForFile(activity, "${activity.packageName}.updates", file)
        else Uri.fromFile(file)
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        return try {
            activity.startActivity(intent)
            "installing"
        } catch (_: ActivityNotFoundException) {
            "failed"
        }
    }
}
