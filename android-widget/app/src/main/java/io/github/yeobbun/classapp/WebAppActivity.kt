package io.github.yeobbun.classapp

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.core.content.FileProvider
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import org.json.JSONObject
import java.io.File

/**
 * 학급관리 앱(웹)을 이 앱 화면 안에서 연다 — 브라우저 없이 앱으로.
 * 데이터는 이 앱 안(WebView 저장 공간)에 따로 저장되므로, 처음 한 번 구글 로그인으로 다른 기기와 맞춘다.
 * 파일 저장·공유·선택, 구글 로그인은 WebView 가 그냥은 못 해서 여기서 맡는다
 * (학급관리 src/platform/android.ts, src/google/google.ts 와 짝).
 */
class WebAppActivity : Activity() {
    private lateinit var web: WebView
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    /** 저장 위치를 고르는 동안 들고 있는 파일 내용 */
    private var pendingSave: ByteArray? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        setContentView(web)
        val home = Uri.parse(Prefs(this).appUrl)

        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.addJavascriptInterface(Bridge(), "ClassApp")
        web.webViewClient = object : WebViewClient() {
            // 학급관리 밖의 링크(구글 드라이브 자료 등)는 브라우저·해당 앱으로
            override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                val u = req.url
                if (u.host == home.host && (u.path ?: "").startsWith(home.path ?: "/")) return false
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, u))
                } catch (e: ActivityNotFoundException) {
                    // 열 앱이 없으면 무시
                }
                return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            // 백업 불러오기 등 <input type="file">
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    @Suppress("DEPRECATION")
                    startActivityForResult(params.createIntent(), REQ_PICK)
                    true
                } catch (e: ActivityNotFoundException) {
                    fileCallback = null
                    false
                }
            }
        }
        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl(home.toString() + pageOf(intent))
    }

    /** 앱이 이미 열려 있을 때 위젯 줄을 누르면 그 화면으로 */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val page = pageOf(intent)
        if (page.isNotEmpty()) web.evaluateJavascript("location.hash = ${JSONObject.quote(page)}", null)
    }

    /** 위젯이 넘긴 화면 주소 (#schedule 같은 것만 받는다) */
    private fun pageOf(intent: Intent?): String =
        intent?.getStringExtra(EXTRA_PAGE)?.takeIf { PAGE.matches(it) } ?: ""

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onPause() {
        super.onPause()
        // 고친 것을 기다리지 않고 바로 올리게 하고(화면이 내려가면 웹이 멈출 수 있어서), 올린 뒤 위젯도 새로 받는다
        web.evaluateJavascript("window.classAppFlush && window.classAppFlush()", null)
        Refresh.later(this, 15)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else @Suppress("DEPRECATION") super.onBackPressed()
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        when (requestCode) {
            REQ_PICK -> {
                fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
                fileCallback = null
            }
            REQ_SAVE -> {
                val bytes = pendingSave
                pendingSave = null
                val uri = data?.data
                if (resultCode != RESULT_OK || bytes == null || uri == null) return
                try {
                    contentResolver.openOutputStream(uri)!!.use { it.write(bytes) }
                    toast("저장했어요.")
                } catch (e: Exception) {
                    toast("저장하지 못했어요: ${e.message}")
                }
            }
            REQ_GOOGLE -> {
                if (resultCode != RESULT_OK) return sendGoogle(JSONObject().put("error", "로그인 창이 닫혔어요."))
                try {
                    val intent = data ?: return sendGoogle(JSONObject().put("error", "로그인 창이 닫혔어요."))
                    onAuthorized(Identity.getAuthorizationClient(this).getAuthorizationResultFromIntent(intent))
                } catch (e: Exception) {
                    sendGoogle(JSONObject().put("error", "구글 로그인에 실패했어요: ${e.message}"))
                }
            }
        }
    }

    /**
     * 구글 권한 받기. interactive 면 계정 고르기·허락 창을 띄우고, 아니면 창 없이 (이미 허락했을 때만).
     * 결과는 웹의 window.classAppGoogle 로 넘긴다.
     */
    private fun authorize(interactive: Boolean) {
        val email = Prefs(this).googleEmail.ifBlank { null }
        Identity.getAuthorizationClient(this).authorize(GoogleAuth.request(if (interactive) null else email))
            .addOnSuccessListener { r ->
                if (!r.hasResolution()) return@addOnSuccessListener onAuthorized(r)
                if (!interactive) return@addOnSuccessListener sendGoogle(JSONObject().put("error", "needs_signin"))
                try {
                    @Suppress("DEPRECATION")
                    startIntentSenderForResult(r.pendingIntent!!.intentSender, REQ_GOOGLE, null, 0, 0, 0)
                } catch (e: Exception) {
                    sendGoogle(JSONObject().put("error", "구글 로그인 창을 열지 못했어요: ${e.message}"))
                }
            }
            .addOnFailureListener { e ->
                sendGoogle(JSONObject().put("error", if (interactive) "구글 로그인에 실패했어요: ${e.message}" else "needs_signin"))
            }
    }

    private fun onAuthorized(r: AuthorizationResult) {
        val token = r.accessToken ?: return sendGoogle(JSONObject().put("error", "구글 토큰을 받지 못했어요."))
        sendGoogle(
            JSONObject()
                .put("access_token", token)
                .put("scope", r.grantedScopes.joinToString(" "))
                // 구글 토큰은 한 시간쯤 간다 — 조금 일찍 새로 받게
                .put("expires_in", 3000),
        )
        // 위젯도 이제 받을 수 있다
        if (Prefs(this).configured) Refresh.now(this)
    }

    private fun sendGoogle(result: JSONObject) {
        runOnUiThread {
            web.evaluateJavascript("window.classAppGoogle && window.classAppGoogle(${JSONObject.quote(result.toString())})", null)
        }
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_LONG).show()

    /** 학급관리(웹)가 부르는 것. 자바스크립트 쪽 스레드에서 불리므로 화면 일은 runOnUiThread 로. */
    private inner class Bridge {
        /** 계정 고르기·허락 창을 띄워 구글 로그인 */
        @JavascriptInterface
        fun googleSignIn() = runOnUiThread { authorize(interactive = true) }

        /** 창 없이 새 토큰 (토큰이 끝났을 때 웹이 부른다) */
        @JavascriptInterface
        fun googleToken() = runOnUiThread { authorize(interactive = false) }

        /** 연결 끊기: 위젯도 멈춘다 */
        @JavascriptInterface
        fun googleSignOut() {
            val p = Prefs(this@WebAppActivity)
            p.googleEmail = ""
            p.passphrase = ""
            p.clearCache()
            PendingWidget.updateAll(this@WebAppActivity)
        }

        @JavascriptInterface
        fun saveFile(name: String, mime: String, base64: String) {
            val bytes = Base64.decode(base64, Base64.DEFAULT)
            runOnUiThread {
                pendingSave = bytes
                val pick = Intent(Intent.ACTION_CREATE_DOCUMENT)
                    .addCategory(Intent.CATEGORY_OPENABLE)
                    .setType(mime)
                    .putExtra(Intent.EXTRA_TITLE, name)
                try {
                    @Suppress("DEPRECATION")
                    startActivityForResult(pick, REQ_SAVE)
                } catch (e: ActivityNotFoundException) {
                    pendingSave = null
                    toast("파일을 저장할 수 없는 휴대폰이에요.")
                }
            }
        }

        @JavascriptInterface
        fun shareFile(name: String, mime: String, base64: String) {
            val dir = File(cacheDir, "share").apply { mkdirs() }
            val file = File(dir, File(name).name) // 경로가 섞여 와도 이름만
            file.writeBytes(Base64.decode(base64, Base64.DEFAULT))
            val uri = FileProvider.getUriForFile(this@WebAppActivity, "$packageName.files", file)
            val send = Intent(Intent.ACTION_SEND)
                .setType(mime)
                .putExtra(Intent.EXTRA_STREAM, uri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            runOnUiThread { startActivity(Intent.createChooser(send, "나이스 입력 파일 보내기")) }
        }

        /**
         * 학급관리의 동기화 설정을 위젯도 쓴다: 구글로 맞출 때의 잠금 비밀번호와 계정.
         * 바뀌었을 때만 받아 둔 것을 버리고 새로 받는다. (깃허브로 맞추면 위젯은 쓰지 않는다)
         */
        @JavascriptInterface
        fun setSyncConfig(json: String) {
            val p = Prefs(this@WebAppActivity)
            val o = if (json.isEmpty()) JSONObject() else JSONObject(json)
            val pass = if (o.optString("kind") == "google") o.optString("passphrase") else ""
            o.optString("email").takeIf { it.isNotBlank() }?.let { p.googleEmail = it }
            if (pass == p.passphrase) return
            p.passphrase = pass
            p.clearCache()
            if (p.configured) Refresh.now(this@WebAppActivity)
            PendingWidget.updateAll(this@WebAppActivity)
        }
    }

    companion object {
        private const val REQ_PICK = 1
        private const val REQ_SAVE = 2
        private const val REQ_GOOGLE = 3
        /** 위젯 줄을 눌렀을 때 열 학급관리 화면 (예: #checklists) */
        const val EXTRA_PAGE = "page"
        private val PAGE = Regex("^#[a-z]+(/[A-Za-z0-9_-]+)?$")
    }
}
