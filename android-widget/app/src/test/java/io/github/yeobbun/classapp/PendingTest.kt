package io.github.yeobbun.classapp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.InetAddress
import java.net.ServerSocket

/** pending-fixture.json 은 학급관리 앱의 encrypt() 로 '시험용 비밀번호' 를 써서 잠근 것이다. */
class PendingTest {
    private val fixture = javaClass.getResource("/pending-fixture.json")!!.readText()

    @Test
    fun `학급관리 앱이 잠근 요약을 푼다`() {
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
        assertEquals("잠금 비밀번호가 학급관리 앱과 달라요.", e.message)
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
    fun `드라이브에서 받고, version 이 같으면 건너뛴다`() {
        val list = """{"files":[{"id":"f1","version":"7"}]}""".toByteArray()
        val content = fixture.toByteArray()
        val requests = mutableListOf<List<String>>()
        // 안드로이드 단위 시험에는 com.sun.net.httpserver 가 없어 소켓으로 직접 답한다
        val server = ServerSocket(0, 0, InetAddress.getLoopbackAddress())
        val thread = Thread {
            repeat(3) {
                server.accept().use { sock ->
                    val reader = sock.getInputStream().bufferedReader()
                    val head = generateSequence { reader.readLine()?.takeIf { it.isNotEmpty() } }.toList()
                    requests += head
                    val body = if (head[0].contains("alt=media")) content else list
                    val out = sock.getOutputStream()
                    out.write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n".toByteArray())
                    out.write(body)
                    out.flush()
                }
            }
        }.apply { start() }
        try {
            Drive.api = "http://127.0.0.1:${server.localPort}"
            val f = Drive.fetchPending("tok", null)!!
            assertTrue(requests[0][0].contains("class-pending.json"))
            assertTrue(requests[0].contains("Authorization: Bearer tok"))
            assertTrue(requests[1][0].startsWith("GET /files/f1?alt=media"))
            assertEquals("7", f.version)
            assertEquals(fixture, f.text)
            assertNull(Drive.fetchPending("tok", "7"))
        } finally {
            thread.join(5_000)
            server.close()
        }
    }

    @Test
    fun `드라이브에 요약이 없으면 알려준다`() {
        val server = ServerSocket(0, 0, InetAddress.getLoopbackAddress())
        val thread = Thread {
            server.accept().use { sock ->
                val reader = sock.getInputStream().bufferedReader()
                generateSequence { reader.readLine()?.takeIf { it.isNotEmpty() } }.toList()
                val body = """{"files":[]}""".toByteArray()
                sock.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n".toByteArray() + body)
            }
        }.apply { start() }
        try {
            Drive.api = "http://127.0.0.1:${server.localPort}"
            val e = assertThrows(WidgetError::class.java) { Drive.fetchPending("tok", null) }
            assertTrue(e.message!!.startsWith("아직 처리 예정 요약이 없어요"))
        } finally {
            thread.join(5_000)
            server.close()
        }
    }
}
