package io.github.yeobbun.classapp

import android.accounts.Account
import android.content.Context
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.Scope
import com.google.android.gms.tasks.Tasks
import java.util.concurrent.TimeUnit

/**
 * 휴대폰의 구글 로그인 (Google Play 서비스). 구글이 앱 안 웹 화면에서의 로그인을 막아서 앱이 대신 한다.
 * 한 번 허락하면 그 뒤로는 창 없이 새 토큰을 받는다 — 웹처럼 한 시간마다 다시 로그인하지 않는다.
 *
 * 구글 클라우드 콘솔의 학급관리 프로젝트에 '안드로이드' 클라이언트(이 앱의 패키지 이름 + 서명 SHA-1)가 있어야 한다.
 * 웹 클라이언트와 같은 프로젝트라서 웹이 드라이브에 만든 파일(drive.file)을 이 앱도 읽는다.
 */
object GoogleAuth {
    /** 웹(src/google/google.ts)과 같은 권한 */
    private val SCOPES = listOf(
        "https://www.googleapis.com/auth/drive.file",
        "https://www.googleapis.com/auth/calendar.app.created",
        "email",
    )

    /** email 을 알면 그 계정으로 (위젯이 창 없이 받으려면 필요). email 은 학급관리(웹)가 setSyncConfig 로 넘겨준다 */
    fun request(email: String?): AuthorizationRequest {
        val b = AuthorizationRequest.builder().setRequestedScopes(SCOPES.map { Scope(it) })
        if (!email.isNullOrBlank()) b.setAccount(Account(email, "com.google"))
        return b.build()
    }

    /**
     * 창 없이 토큰 받기 — 위젯·백그라운드용이라 메인 스레드에서 부르면 안 된다.
     * 사용자가 계정을 고르거나 다시 허락해야 하면 null.
     */
    fun silentToken(ctx: Context, email: String?): String? {
        val r = Tasks.await(Identity.getAuthorizationClient(ctx).authorize(request(email)), 30, TimeUnit.SECONDS)
        return if (r.hasResolution()) null else r.accessToken
    }
}
