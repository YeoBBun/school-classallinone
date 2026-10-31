package io.github.yeobbun.classapp

import android.content.Context

/** 연결 정보(구글 계정·잠금 비밀번호)와 마지막으로 받은 목록. 이 앱 안에만 저장된다. */
class Prefs(ctx: Context) {
    private val sp = ctx.getSharedPreferences("widget", Context.MODE_PRIVATE)

    /** 로그인한 구글 계정 — 위젯이 창 없이 토큰을 받을 때 쓴다 */
    var googleEmail: String
        get() = sp.getString("googleEmail", "") ?: ""
        set(v) = sp.edit().putString("googleEmail", v).apply()
    /** 학급관리 앱의 잠금 비밀번호 (드라이브의 요약을 푼다) */
    var passphrase: String
        get() = sp.getString("passphrase", "") ?: ""
        set(v) = sp.edit().putString("passphrase", v).apply()
    var appUrl: String
        get() = sp.getString("appUrl", DEFAULT_APP_URL) ?: DEFAULT_APP_URL
        set(v) = sp.edit().putString("appUrl", v).apply()

    val configured get() = passphrase.isNotBlank()

    /** 받은 요약 원문(푼 것)과 그 파일의 드라이브 version */
    var summaryJson: String?
        get() = sp.getString("summary", null)
        set(v) = sp.edit().putString("summary", v).apply()
    var sha: String?
        get() = sp.getString("sha", null)
        set(v) = sp.edit().putString("sha", v).apply()
    /** 마지막으로 확인에 성공한 시각 (ms) */
    var checkedAt: Long
        get() = sp.getLong("checkedAt", 0)
        set(v) = sp.edit().putLong("checkedAt", v).apply()
    var error: String?
        get() = sp.getString("error", null)
        set(v) = sp.edit().putString("error", v).apply()

    fun summary(): PendingSummary? = summaryJson?.let { runCatching { Pending.parse(it) }.getOrNull() }

    /** 연결 정보가 바뀌면 받아 둔 것을 버린다 */
    fun clearCache() = sp.edit().remove("summary").remove("sha").remove("checkedAt").remove("error").apply()

    companion object {
        const val DEFAULT_APP_URL = "https://yeobbun.github.io/school-classallinone/"
    }
}
