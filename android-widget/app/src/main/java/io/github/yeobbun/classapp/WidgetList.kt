package io.github.yeobbun.classapp

import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import androidx.core.widget.RemoteViewsCompat

/**
 * 위젯 목록의 줄들: 묶음 제목(출결 서류·일정…)과 그 아래 줄.
 * 목록을 위젯 갱신 때 통째로 넘긴다 (RemoteCollectionItems) — 예전 목록 서비스처럼 홈 화면이 옛 줄을 붙잡고 있지 않게.
 */
object WidgetList {
    /** 줄을 누르면 학급관리의 그 화면 (WebAppActivity 가 EXTRA_PAGE 를 읽는다) */
    private fun open(link: String) = Intent().putExtra(WebAppActivity.EXTRA_PAGE, link)

    fun items(ctx: Context, sections: List<PlanSection>, today: String): RemoteViewsCompat.RemoteCollectionItems {
        val b = RemoteViewsCompat.RemoteCollectionItems.Builder().setHasStableIds(false).setViewTypeCount(2)
        var n = 0L
        for (s in sections) {
            b.addItem(n++, header(ctx, s))
            // 같은 묶음에 D-day 가 있는 줄이 있으면 날짜 없는 줄도 그만큼 비워 줄을 맞춘다
            val pad = s.rows.any { it.dday(today).isNotEmpty() }
            for (r in s.rows) b.addItem(n++, row(ctx, r, pad, s.link, today))
        }
        return b.build()
    }

    private fun header(ctx: Context, s: PlanSection) = RemoteViews(ctx.packageName, R.layout.widget_header).apply {
        setTextViewText(R.id.header_title, s.title)
        setTextViewText(R.id.header_count, s.rows.size.toString())
        setOnClickFillInIntent(R.id.header, open(s.link))
    }

    private fun row(ctx: Context, r: PlanRow, pad: Boolean, link: String, today: String) =
        RemoteViews(ctx.packageName, R.layout.widget_item).apply {
            val dday = r.dday(today)
            val (color, pill) = when {
                r.overdue(today) -> R.color.overdue to R.drawable.pill_over
                r.isToday(today) -> R.color.accent to R.drawable.pill_today
                else -> R.color.muted to R.drawable.pill_normal
            }
            setTextViewText(R.id.dday, dday)
            setTextColor(R.id.dday, ctx.getColor(color))
            setInt(R.id.dday, "setBackgroundResource", pill)
            setViewVisibility(R.id.dday, if (dday.isNotEmpty()) View.VISIBLE else if (pad) View.INVISIBLE else View.GONE)
            setTextViewText(R.id.who, r.title)
            setTextViewText(R.id.doc, r.text)
            val line2 = r.line2(today)
            setTextViewText(R.id.detail, line2)
            setViewVisibility(R.id.detail, if (line2.isEmpty()) View.GONE else View.VISIBLE)
            setTextColor(R.id.detail, ctx.getColor(if (r.overdue(today)) R.color.overdue else R.color.muted))
            setOnClickFillInIntent(R.id.row, open(link))
        }
}
