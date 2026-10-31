package io.github.yeobbun.classapp

import android.app.Activity
import android.os.Bundle
import android.text.format.DateFormat
import android.widget.Button
import android.widget.EditText
import android.widget.TextView

/** 위젯 설정: 연결 정보는 학급관리 앱의 구글 로그인을 따르고, 여기서는 상태 확인과 학급관리 앱 주소만 */
class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        val p = Prefs(this)
        val url = findViewById<EditText>(R.id.appUrl)
        val refresh = findViewById<Button>(R.id.save)
        val result = findViewById<TextView>(R.id.result)

        url.setText(p.appUrl)
        result.text = describe(p)

        refresh.setOnClickListener {
            p.appUrl = url.text.toString().trim().ifEmpty { Prefs.DEFAULT_APP_URL }
            refresh.isEnabled = false
            result.text = "불러오는 중…"
            Thread {
                Refresh.run(this)
                runOnUiThread {
                    refresh.isEnabled = true
                    result.text = describe(p)
                    Refresh.schedule(this)
                    PendingWidget.updateAll(this)
                }
            }.start()
        }
    }

    private fun describe(p: Prefs): String {
        if (!p.configured) return "학급관리 앱을 열어 구글로 로그인하고 잠금 비밀번호를 정하면, 위젯도 같은 계정으로 처리 예정을 받아 와요."
        val head = "구글 계정: ${p.googleEmail.ifBlank { "(학급관리 앱에서 로그인한 계정)" }}"
        p.error?.let { return "$head\n\n⚠ $it" }
        val s = p.summary() ?: return head
        val at = if (p.checkedAt > 0) DateFormat.format("M/d H:mm", p.checkedAt).toString() + " 확인 · " else ""
        val n = s.visible(java.time.LocalDate.now().toString()).sumOf { it.rows.size }
        val body = if (n == 0) "✓ 처리할 것이 없어요." else "처리 예정 ${n}건"
        return "$head\n\n$at$body\n\n홈 화면을 길게 눌러 위젯 → '처리 예정' 을 추가하세요."
    }
}
