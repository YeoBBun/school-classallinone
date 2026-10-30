package io.github.yeobbun.attendancewidget

import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.net.HttpURLConnection
import java.net.URL
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import java.util.Base64
import java.util.zip.GZIPInputStream
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/**
 * 학급관리 앱이 동기화 저장소에 올리는 «처리 예정» 요약 (sync/pending.json).
 * 학급관리 앱 src/domain/widget.ts 의 WidgetSummary 와 같은 모양이다.
 * items 는 받을 서류만 담은 예전 모양, sections 는 종류별 묶음(출결 서류·일정·제출물·할 일·필사)이다.
 * 안드로이드 API 를 쓰지 않아 JVM 에서 바로 시험할 수 있다.
 */
data class PendingItem(
    val who: String,
    val doc: String,
    val what: String,
    /** 체험학습 신청서·보고서 기한 (YYYY-MM-DD) */
    val deadline: String? = null,
    /** 체험학습 보고서: 이 날까지는 '다녀온 후' */
    val tripEnd: String? = null,
) {
    fun overdue(today: String) = deadline != null && deadline < today

    /** 위젯 둘째 줄. 예: 10/22(목) 체험학습 · 다녀온 후 · 기한 10/30 */
    fun detail(today: String): String = buildString {
        append(what)
        if (tripEnd != null && today <= tripEnd) append(" · 다녀온 후")
        if (deadline != null) append(" · 기한 ").append(Pending.shortDate(deadline))
    }
}

/** 묶음 안의 한 줄 (src/domain/widget.ts 의 WidgetRow) */
data class PlanRow(
    val title: String,
    val text: String,
    val detail: String = "",
    /** 일정 날짜: 남은 날을 보이고, 지나면 감춘다 */
    val on: String? = null,
    /** 기한: 남은 날을 보이고, 지나면 빨갛게 */
    val due: String? = null,
    /** 체험학습 보고서: 이 날까지는 '다녀온 후' */
    val tripEnd: String? = null,
) {
    fun hidden(today: String) = on != null && on < today
    fun overdue(today: String) = due != null && due < today
    fun isToday(today: String) = (on ?: due) == today

    /** 예: D-3, 오늘은 D-0, 기한 지나면 D+2. 날짜 없으면 빈 칸 */
    fun dday(today: String): String = (on ?: due)?.let { Pending.dday(it, today) } ?: ""

    fun line2(today: String): String = buildString {
        append(detail)
        if (tripEnd != null && today <= tripEnd) append(" · 다녀온 후")
    }
}

data class PlanSection(val title: String, val rows: List<PlanRow>)

data class PendingSummary(val className: String, val items: List<PendingItem>, val sections: List<PlanSection> = emptyList()) {
    /** 기한 지난 것을 위로 (나머지는 출결 날짜순 그대로) */
    fun sorted(today: String): List<PendingItem> = items.sortedBy { if (it.overdue(today)) 0 else 1 }

    /** 위젯에 보일 묶음: 지난 일정은 빼고, 묶음 안에서 기한 지난 것을 위로. 빈 묶음은 뺀다 */
    fun visible(today: String): List<PlanSection> =
        sections.map { s -> PlanSection(s.title, s.rows.filterNot { it.hidden(today) }.sortedBy { if (it.overdue(today)) 0 else 1 }) }
            .filter { it.rows.isNotEmpty() }
}

class WidgetError(message: String) : Exception(message)

object Pending {
    const val FORMAT = "attendance-app/pending-v1"
    private const val ENC_FORMAT = "attendance-app/state-enc-v1"
    const val PATH = "sync/pending.json"

    /** 출결 앱 src/sync/cloud.ts 의 encrypt 와 짝: gzip → PBKDF2-SHA256 → AES-256-GCM */
    fun decrypt(envelopeJson: String, passphrase: String): String {
        val env = JSONObject(envelopeJson)
        if (env.optString("format") != ENC_FORMAT) throw WidgetError("모르는 파일 형식이에요. 출결 앱을 새로고침해 주세요.")
        val b64 = Base64.getMimeDecoder()
        val spec = PBEKeySpec(passphrase.toCharArray(), b64.decode(env.getString("salt")), env.getInt("iter"), 256)
        val key = SecretKeySpec(SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded, "AES")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, b64.decode(env.getString("iv"))))
        val zipped = try {
            cipher.doFinal(b64.decode(env.getString("ct")))
        } catch (e: javax.crypto.AEADBadTagException) {
            throw WidgetError("잠금 비밀번호가 출결 앱과 달라요.")
        }
        return GZIPInputStream(ByteArrayInputStream(zipped)).use { it.readBytes().toString(Charsets.UTF_8) }
    }

    fun parse(plain: String): PendingSummary {
        val o = JSONObject(plain)
        if (o.optString("format") != FORMAT) throw WidgetError("모르는 요약 형식이에요. 위젯 앱을 새로 받아 주세요.")
        val arr = o.getJSONArray("items")
        val items = (0 until arr.length()).map { i ->
            val it = arr.getJSONObject(i)
            PendingItem(
                who = it.getString("who"),
                doc = it.getString("doc"),
                what = it.getString("what"),
                deadline = it.optString("deadline").ifEmpty { null },
                tripEnd = it.optString("tripEnd").ifEmpty { null },
            )
        }
        val sections = o.optJSONArray("sections")?.let { secs ->
            (0 until secs.length()).map { i ->
                val s = secs.getJSONObject(i)
                val rows = s.getJSONArray("rows")
                PlanSection(
                    s.getString("title"),
                    (0 until rows.length()).map { j ->
                        val r = rows.getJSONObject(j)
                        PlanRow(
                            title = r.getString("title"),
                            text = r.optString("text"),
                            detail = r.optString("detail"),
                            on = r.optString("on").ifEmpty { null },
                            due = r.optString("due").ifEmpty { null },
                            tripEnd = r.optString("tripEnd").ifEmpty { null },
                        )
                    },
                )
            }
        } ?: listOf(PlanSection("출결 서류", items.map { PlanRow(it.who, it.doc, it.what, due = it.deadline, tripEnd = it.tripEnd) }))
        return PendingSummary(o.optString("className"), items, sections)
    }

    /** 남은 날: 오늘 D-0, 사흘 뒤 D-3, 지났으면 D+2 */
    fun dday(date: String, today: String): String {
        val n = ChronoUnit.DAYS.between(LocalDate.parse(today), LocalDate.parse(date))
        return if (n >= 0) "D-$n" else "D+${-n}"
    }

    /** 2026-10-30 → 10/30 */
    fun shortDate(d: String): String {
        val (_, m, day) = d.split("-").map { it.toInt() }
        return "$m/$day"
    }
}

/** 깃허브에서 sync/pending.json 받기. 바뀌지 않았으면(sha 같음) null. */
object GitHub {
    var api = "https://api.github.com"

    class File(val sha: String, val text: String)

    /** 'https://github.com/me/sync.git' 처럼 붙여 넣어도 'me/sync' 로 */
    fun normalizeRepo(input: String): String =
        input.trim().removePrefix("https://").removePrefix("http://").removePrefix("github.com/")
            .trimEnd('/').removeSuffix(".git")

    private fun open(path: String, token: String): HttpURLConnection =
        (URL("$api$path").openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 20_000
            setRequestProperty("Authorization", "Bearer $token")
            setRequestProperty("Accept", "application/vnd.github+json")
            useCaches = false
        }

    fun fetchPending(repo: String, token: String, knownSha: String?): File? {
        val conn = open("/repos/$repo/contents/${Pending.PATH}", token)
        try {
            when (val code = conn.responseCode) {
                200 -> {}
                401 -> throw WidgetError("토큰이 맞지 않거나 만료됐어요.")
                // 깃허브는 토큰에 그 저장소 권한이 없어도 404 를 준다 → 저장소부터 보이는지 확인해서 나눠 알린다
                404 -> throw WidgetError(
                    if (repoVisible(repo, token)) "아직 처리 예정 요약이 없어요. 학급관리 앱을 새로고침해서 열고, 설정 → 동기화에 '위젯용 요약 올라가 있음' 이 뜨는지 봐 주세요."
                    else "저장소를 찾지 못했어요. 저장소 이름이 출결 앱과 같은지, 토큰을 만들 때 그 저장소를 골랐는지 확인해 주세요.",
                )
                else -> throw WidgetError("깃허브 응답 오류 ($code)")
            }
            val o = JSONObject(conn.inputStream.use { it.readBytes().toString(Charsets.UTF_8) })
            val sha = o.getString("sha")
            if (sha == knownSha) return null
            val text = Base64.getMimeDecoder().decode(o.getString("content")).toString(Charsets.UTF_8)
            return File(sha, text)
        } finally {
            conn.disconnect()
        }
    }

    private fun repoVisible(repo: String, token: String): Boolean {
        val conn = open("/repos/$repo", token)
        return try {
            conn.responseCode == 200
        } finally {
            conn.disconnect()
        }
    }
}
