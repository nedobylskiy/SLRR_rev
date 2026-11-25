package dev.slrr.standalone

import android.app.AlertDialog
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import android.widget.Toast
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.documentfile.provider.DocumentFile
import java.io.File
import kotlin.concurrent.thread

/**
 * First-run import of the game installation. The Rust resource provider
 * (src-tauri/src/game.rs) reads the game from files/game; Android has no
 * folder the app may read directly, so the player picks the installation
 * with the system folder picker and it is copied into app storage. The
 * provider looks for files/game again on every request, so reloading the
 * page after the copy is enough.
 */
class MainActivity : TauriActivity() {
  private var webView: WebView? = null

  private val pickFolder = registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { tree ->
    if (tree != null) importGame(tree)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Draw under a camera cutout too; the page letterboxes itself to 16:9.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P)
      window.attributes = window.attributes.apply {
        layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
      }
    hideSystemBars()
    if (!isInstallation(gameDir())) askForGame(null)
  }

  /** Immersive full screen: status and navigation bars stay hidden and only
   * reappear briefly on a swipe from the edge. Dialogs and app switches can
   * bring them back, so hide them again whenever the game regains focus. */
  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) hideSystemBars()
  }

  private fun hideSystemBars() {
    WindowCompat.getInsetsController(window, window.decorView).apply {
      systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      hide(WindowInsetsCompat.Type.systemBars())
    }
  }

  /** Set by the page (TouchToolbar) while a car is driven with gear shifting on volume keys. */
  @Volatile private var volumeGears = false

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    webView.addJavascriptInterface(object {
      @JavascriptInterface fun setVolumeGears(enabled: Boolean) { volumeGears = enabled }
    }, "SlrrAndroid")
  }

  /** While driving, volume up/down shift gears (the page presses the game's A/Z
   * keys); otherwise they keep changing the volume. */
  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    val name = when (event.keyCode) {
      KeyEvent.KEYCODE_VOLUME_UP -> "VolumeUp"
      KeyEvent.KEYCODE_VOLUME_DOWN -> "VolumeDown"
      else -> null
    }
    val view = webView
    if (name == null || !volumeGears || view == null) return super.dispatchKeyEvent(event)
    if (event.repeatCount == 0 && (event.action == KeyEvent.ACTION_DOWN || event.action == KeyEvent.ACTION_UP)) {
      val down = event.action == KeyEvent.ACTION_DOWN
      view.evaluateJavascript("window.slrrHardwareKey&&window.slrrHardwareKey('$name',$down)", null)
    }
    return true
  }

  private fun gameDir() = File(filesDir, "game")

  private fun isInstallation(dir: File) = File(dir, "system").isDirectory && File(dir, "sl").isDirectory

  private fun askForGame(problem: String?) {
    val message = (problem?.let { "$it\n\n" } ?: "") +
      "Choose the Street Legal Racing Redline folder on this device (it contains the system and sl folders). " +
      "It is copied into the app once; this can take several minutes."
    AlertDialog.Builder(this)
      .setTitle("SLRR: game files")
      .setMessage(message)
      .setPositiveButton("Choose folder") { _, _ -> pickFolder.launch(null) }
      .setNegativeButton("Later", null)
      .show()
  }

  private fun importGame(tree: Uri) {
    val root = DocumentFile.fromTreeUri(this, tree)
    if (root == null || root.findFile("system")?.isDirectory != true || root.findFile("sl")?.isDirectory != true) {
      askForGame("That folder has no system and sl folders, so it is not a Street Legal Racing Redline installation.")
      return
    }
    val progress = AlertDialog.Builder(this)
      .setTitle("Copying game files")
      .setMessage("Starting…")
      .setCancelable(false)
      .show()
    thread(name = "SLRR game import") {
      val staging = File(filesDir, "game.importing")
      try {
        staging.deleteRecursively()
        var files = 0
        var bytes = 0L
        fun copy(dir: DocumentFile, target: File) {
          target.mkdirs()
          for (child in dir.listFiles()) {
            val name = child.name ?: continue
            if (child.isDirectory) {
              copy(child, File(target, name))
              continue
            }
            contentResolver.openInputStream(child.uri)?.use { input ->
              File(target, name).outputStream().use { output -> bytes += input.copyTo(output, 1 shl 16) }
            }
            files++
            if (files % 25 == 0) {
              val text = "$files files, ${bytes / (1024 * 1024)} MB\n$name"
              runOnUiThread { progress.setMessage(text) }
            }
          }
        }
        copy(root, staging)
        gameDir().deleteRecursively()
        if (!staging.renameTo(gameDir())) throw IllegalStateException("Cannot move the copied files into place")
        runOnUiThread {
          progress.dismiss()
          Toast.makeText(this, "Game files copied: $files files", Toast.LENGTH_LONG).show()
          webView?.reload()
        }
      } catch (error: Exception) {
        staging.deleteRecursively()
        runOnUiThread {
          progress.dismiss()
          askForGame("Copying failed: ${error.message}")
        }
      }
    }
  }
}
