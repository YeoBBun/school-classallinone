package io.github.yeobbun.classapp

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.text.format.DateFormat
import android.widget.RemoteViews
import androidx.core.widget.RemoteViewsCompat
import java.time.Instant
import java.time.LocalDate

/** 홈 화면 위젯: 처리 예정 (출결 서류·일정·제출물·할 일·필사) */
class PendingWidget : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        render(ctx, mgr, ids)
        Refresh.schedule(ctx)
    }

    override fun onEnabled(ctx: Context) {
        Refresh.schedule(ctx)
        Refresh.now(ctx)
    }

    override fun onDisabled(ctx: Context) = Refresh.cancel(ctx)

    override fun onReceive(ctx: Context, intent: Intent) {
        super.onReceive(ctx, intent)
        if (intent.action == ACTION_REFRESH) {
            // 누른 것이 보이도록 먼저 '확인 중' 으로
            Prefs(ctx).error = null
            updateAll(ctx, checking = true)
            Refresh.now(ctx)
        }
    }

    companion object {
        const val ACTION_REFRESH = "io.github.yeobbun.classapp.REFRESH"

        fun updateAll(ctx: Context, checking: Boolean = false) {
            val mgr = AppWidgetManager.getInstance(ctx)
            val ids = mgr.getAppWidgetIds(ComponentName(ctx, PendingWidget::class.java))
            if (ids.isEmpty()) return
            render(ctx, mgr, ids, checking)
        }

        /** 요약을 만든 시각 → "10:58 요약 · " (모르면 빈 칸) */
        private fun made(at: String?): String =
            at?.let { runCatching { DateFormat.format("H:mm", Instant.parse(it).toEpochMilli()).toString() + " 요약 · " }.getOrNull() } ?: ""

        private fun render(ctx: Context, mgr: AppWidgetManager, ids: IntArray, checking: Boolean = false) {
            val p = Prefs(ctx)
            val summary = p.summary()
            val today = LocalDate.now().toString()
            val sections = summary?.visible(today) ?: emptyList()
            val count = summary?.let { sections.sumOf { it.rows.size } }

            val openApp = PendingIntent.getActivity(
                ctx, 0, Intent(ctx, WebAppActivity::class.java), PendingIntent.FLAG_IMMUTABLE,
            )
            val openSettings = PendingIntent.getActivity(
                ctx, 1, Intent(ctx, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE,
            )
            val refresh = PendingIntent.getBroadcast(
                ctx, 2, Intent(ctx, PendingWidget::class.java).setAction(ACTION_REFRESH), PendingIntent.FLAG_IMMUTABLE,
            )
            // 목록 줄을 누르면 학급관리 앱 — 줄마다 붙이는 fillInIntent 와 합쳐지므로 MUTABLE (안드로이드 14부터는 이 앱 안 화면만 가리킬 수 있다)
            val itemTemplate = PendingIntent.getActivity(
                ctx, 3, Intent(ctx, WebAppActivity::class.java), PendingIntent.FLAG_MUTABLE,
            )

            val status = when {
                checking -> "확인 중…"
                !p.configured -> "구글 로그인 필요"
                p.error != null -> "⚠ ${p.error}"
                // 예: 10:58 요약 · 11:02 확인 — 요약이 최신인지(학급관리에서 고친 뒤인지) 알 수 있게
                p.checkedAt > 0 -> made(summary?.at) + DateFormat.format("H:mm", p.checkedAt).toString() + " 확인"
                else -> ""
            }
            val empty = when {
                !p.configured -> "눌러서 학급관리 앱을 열고 구글로 로그인해 주세요"
                summary == null -> p.error ?: "불러오는 중…"
                else -> "✓ 처리할 것이 없어요"
            }

            for (id in ids) {
                val v = RemoteViews(ctx.packageName, R.layout.widget)
                v.setTextViewText(R.id.count, count?.takeIf { it > 0 }?.toString() ?: "")
                v.setTextViewText(R.id.status, status)
                v.setTextViewText(R.id.empty, empty)
                v.setOnClickPendingIntent(R.id.title, openApp)
                v.setOnClickPendingIntent(R.id.status, openSettings)
                v.setOnClickPendingIntent(R.id.refresh, refresh)
                v.setOnClickPendingIntent(R.id.empty, openApp)

                RemoteViewsCompat.setRemoteAdapter(ctx, v, id, R.id.list, WidgetList.items(ctx, sections, today))
                v.setEmptyView(R.id.list, R.id.empty)
                v.setPendingIntentTemplate(R.id.list, itemTemplate)
                mgr.updateAppWidget(id, v)
            }
        }
    }
}
