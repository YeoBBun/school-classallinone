package io.github.yeobbun.classapp

import org.json.JSONObject
import java.io.ByteArrayInputStream
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
 * 학급관리 앱이 구글 드라이브에 올리는 «처리 예정» 요약 (class-pending.json, Drive.kt).
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

/** link: 누르면 열 학급관리 화면 (예: #checklists). 예전 요약에는 없다 */
data class PlanSection(val title: String, val rows: List<PlanRow>, val link: String = "")

/** at: 학급관리가 이 요약을 만든 시각 (ISO). 예전 요약에는 없다 */
data class PendingSummary(
    val className: String,
    val items: List<PendingItem>,
    val sections: List<PlanSection> = emptyList(),
    val at: String? = null,
) {
    /** 기한 지난 것을 위로 (나머지는 출결 날짜순 그대로) */
    fun sorted(today: String): List<PendingItem> = items.sortedBy { if (it.overdue(today)) 0 else 1 }

    /** 위젯에 보일 묶음: 지난 일정은 빼고, 묶음 안에서 기한 지난 것을 위로. 빈 묶음은 뺀다 */
    fun visible(today: String): List<PlanSection> =
        sections.map { s -> s.copy(rows = s.rows.filterNot { it.hidden(today) }.sortedBy { if (it.overdue(today)) 0 else 1 }) }
            .filter { it.rows.isNotEmpty() }
}

class WidgetError(message: String) : Exception(message)

object Pending {
    const val FORMAT = "attendance-app/pending-v1"
    private const val ENC_FORMAT = "attendance-app/state-enc-v1"

    /** 학급관리 앱 src/sync/cloud.ts 의 encrypt 와 짝: gzip → PBKDF2-SHA256 → AES-256-GCM */
    fun decrypt(envelopeJson: String, passphrase: String): String {
        val env = JSONObject(envelopeJson)
        if (env.optString("format") != ENC_FORMAT) throw WidgetError("모르는 파일 형식이에요. 학급관리 앱을 새로고침해 주세요.")
        val b64 = Base64.getMimeDecoder()
        val spec = PBEKeySpec(passphrase.toCharArray(), b64.decode(env.getString("salt")), env.getInt("iter"), 256)
        val key = SecretKeySpec(SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded, "AES")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, b64.decode(env.getString("iv"))))
        val zipped = try {
            cipher.doFinal(b64.decode(env.getString("ct")))
        } catch (e: javax.crypto.AEADBadTagException) {
            throw WidgetError("잠금 비밀번호가 학급관리 앱과 달라요.")
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
                    s.optString("link"),
                )
            }
        } ?: listOf(PlanSection("출결 서류", items.map { PlanRow(it.who, it.doc, it.what, due = it.deadline, tripEnd = it.tripEnd) }))
        return PendingSummary(o.optString("className"), items, sections, o.optString("at").ifEmpty { null })
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
