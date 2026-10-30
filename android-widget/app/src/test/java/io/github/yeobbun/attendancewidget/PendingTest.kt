package io.github.yeobbun.attendancewidget

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.InetAddress
import java.net.ServerSocket
import java.util.Base64

/** pending-fixture.json 은 출결 앱의 encrypt() 로 '시험용 비밀번호' 를 써서 잠근 것이다. */
class PendingTest {
    private val fixture = javaClass.getResource("/pending-fixture.json")!!.readText()

    @Test
    fun `출결 앱이 잠근 요약을 푼다`() {
        val s = Pending.parse(Pending.decrypt(fixture, "시험용 비밀번호"))
        assertEquals("2-3", s.className)
        assertEquals(listOf("결석계", "체험학습 보고서", "체험학습 신청서"), s.items.map { it.doc })
        assertEquals("3. 김하늘", s.items[0].who)
        assertEquals(null, s.items[0].deadline)
        assertEquals("2026-10-23", s.items[1].tripEnd)
    }

    @Test
    fun `비밀번호가 다르면 알려준다`() {
        val e = assertThrows(WidgetError::class.java) { Pending.decrypt(fixture, "틀림") }
        assertEquals("잠금 비밀번호가 출결 앱과 달라요.", e.message)
    }

    @Test
    fun `기한 지난 것을 위로, 다녀오기 전 보고서는 표시`() {
        val s = Pending.parse(Pending.decrypt(fixture, "시험용 비밀번호"))
        val sorted = s.sorted("2026-10-30")
        assertEquals("체험학습 신청서", sorted[0].doc)
        assertEquals("10/22(목) 체험학습 · 기한 10/30", s.items[1].detail("2026-10-30"))
        assertEquals("10/22(목) 체험학습 · 다녀온 후 · 기한 10/30", s.items[1].detail("2026-10-22"))
    }

    @Test
    fun `예전 요약(items 만)은 출결 서류 묶음 하나로 보인다`() {
        val s = Pending.parse(Pending.decrypt(fixture, "시험용 비밀번호"))
        assertEquals(listOf("출결 서류"), s.sections.map { it.title })
        assertEquals(3, s.sections[0].rows.size)
        assertEquals("D-0", s.sections[0].rows[1].dday("2026-10-30"))
    }

    @Test
    fun `묶음별 요약: 남은 날, 지난 일정 감추기, 기한 지난 것 위로`() {
        val plain = """
            {"format":"attendance-app/pending-v1","className":"2-3","items":[],"sections":[
              {"title":"일정","rows":[
                {"title":"김하늘","text":"학부모 상담","detail":"10/30(금) 15:00","on":"2026-10-30"},
                {"title":"체육대회","text":"학급 행사","detail":"11/2(월)","on":"2026-11-02"}]},
              {"title":"제출물","rows":[
                {"title":"현장학습 동의서","text":"3명 안 냄","detail":"11/3(화)까지","due":"2026-11-03"},
                {"title":"가정통신문","text":"1명 안 냄","detail":"10/28(수)까지","due":"2026-10-28"}]},
              {"title":"필사","rows":[{"title":"1. 김하늘","text":"3장 남음","detail":"10/20(화) 휴대폰 사용"}]}]}
        """.trimIndent()
        val s = Pending.parse(plain)
        assertEquals(listOf("D-0", "D-3"), s.sections[0].rows.map { it.dday("2026-10-30") })
        val later = s.visible("2026-10-31")
        assertEquals(listOf("체육대회"), later[0].rows.map { it.title })
        assertEquals(listOf("가정통신문", "현장학습 동의서"), later[1].rows.map { it.title })
        assertEquals("D+3", later[1].rows[0].dday("2026-10-31"))
        assertEquals("", later[2].rows[0].dday("2026-10-31"))
        assertTrue(s.visible("2026-11-03").none { it.title == "일정" })
    }

    @Test
    fun `깃허브에서 받고, sha 가 같으면 건너뛴다`() {
        // 깃허브는 base64 를 60자마다 줄바꿈해서 준다
        val b64 = Base64.getMimeEncoder(60, "\n".toByteArray()).encodeToString(fixture.toByteArray())
        val body = """{"sha":"abc","content":"${b64.replace("\n", "\\n")}"}""".toByteArray()
        val requests = mutableListOf<List<String>>()
        // 안드로이드 단위 시험에는 com.sun.net.httpserver 가 없어 소켓으로 직접 답한다
        val server = ServerSocket(0, 0, InetAddress.getLoopbackAddress())
        val thread = Thread {
            repeat(2) {
                server.accept().use { sock ->
                    val reader = sock.getInputStream().bufferedReader()
                    requests += generateSequence { reader.readLine()?.takeIf { it.isNotEmpty() } }.toList()
                    val out = sock.getOutputStream()
                    out.write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n".toByteArray())
                    out.write(body)
                    out.flush()
                }
            }
        }.apply { start() }
        try {
            GitHub.api = "http://127.0.0.1:${server.localPort}"
            val f = GitHub.fetchPending("me/sync", "tok", null)!!
            assertEquals("GET /repos/me/sync/contents/sync/pending.json HTTP/1.1", requests[0][0])
            assertTrue(requests[0].contains("Authorization: Bearer tok"))
            assertEquals("abc", f.sha)
            assertEquals(fixture, f.text)
            assertNull(GitHub.fetchPending("me/sync", "tok", "abc"))
        } finally {
            thread.join(5_000)
            server.close()
        }
    }

    @Test
    fun `저장소 주소를 붙여 넣어도 이름만 남긴다`() {
        assertEquals("me/sync", GitHub.normalizeRepo(" https://github.com/me/sync.git/ "))
        assertEquals("me/sync", GitHub.normalizeRepo("me/sync"))
    }

    @Test
    fun `요약이 없을 때와 저장소가 안 보일 때를 나눠 알린다`() {
        fun serve(repoStatus: Int): String {
            val server = ServerSocket(0, 0, InetAddress.getLoopbackAddress())
            val thread = Thread {
                repeat(2) {
                    server.accept().use { sock ->
                        val first = sock.getInputStream().bufferedReader().let { r ->
                            generateSequence { r.readLine()?.takeIf { it.isNotEmpty() } }.toList()[0]
                        }
                        val status = if (first.startsWith("GET /repos/me/sync HTTP")) repoStatus else 404
                        sock.getOutputStream().write("HTTP/1.1 $status X\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}".toByteArray())
                    }
                }
            }.apply { start() }
            try {
                GitHub.api = "http://127.0.0.1:${server.localPort}"
                return assertThrows(WidgetError::class.java) { GitHub.fetchPending("me/sync", "tok", null) }.message!!
            } finally {
                thread.join(5_000)
                server.close()
            }
        }
        assertTrue(serve(200).startsWith("아직 처리 예정 요약이 없어요"))
        assertTrue(serve(404).startsWith("저장소를 찾지 못했어요"))
    }
}
