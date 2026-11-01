package io.github.yeobbun.classapp

import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import java.time.LocalDate

/** 위젯 목록의 줄들: 묶음 제목(출결 서류·일정…)과 그 아래 줄 */
class PendingListService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory = Factory(applicationContext)

    private sealed interface Entry
    private class Header(val title: String, val count: Int, val link: String) : Entry
    /** pad: 같은 묶음에 D-day 가 있는 줄이 있으면 날짜 없는 줄도 그만큼 비워 줄을 맞춘다 */
    private class Row(val row: PlanRow, val pad: Boolean, val link: String) : Entry

    private class Factory(private val ctx: Context) : RemoteViewsFactory {
        private var entries: List<Entry> = emptyList()
        private var today = ""

        override fun onCreate() {}
        override fun onDestroy() {}

        override fun onDataSetChanged() {
            today = LocalDate.now().toString()
            val sections = Prefs(ctx).summary()?.visible(today) ?: emptyList()
            entries = sections.flatMap { s ->
                val pad = s.rows.any { it.dday(today).isNotEmpty() }
                listOf<Entry>(Header(s.title, s.rows.size, s.link)) + s.rows.map { Row(it, pad, s.link) }
            }
        }

        override fun getCount() = entries.size
        override fun getViewTypeCount() = 2
        override fun hasStableIds() = false
        override fun getItemId(position: Int) = position.toLong()
        override fun getLoadingView(): RemoteViews? = null

        /** 줄을 누르면 학급관리의 그 화면 (WebAppActivity 가 EXTRA_PAGE 를 읽는다) */
        private fun open(link: String) = Intent().putExtra(WebAppActivity.EXTRA_PAGE, link)

        override fun getViewAt(position: Int): RemoteViews = when (val e = entries[position]) {
            is Header -> RemoteViews(ctx.packageName, R.layout.widget_header).apply {
                setTextViewText(R.id.header_title, e.title)
                setTextViewText(R.id.header_count, e.count.toString())
                setOnClickFillInIntent(R.id.header, open(e.link))
            }
            is Row -> RemoteViews(ctx.packageName, R.layout.widget_item).apply {
                val r = e.row
                val dday = r.dday(today)
                val (color, pill) = when {
                    r.overdue(today) -> R.color.overdue to R.drawable.pill_over
                    r.isToday(today) -> R.color.accent to R.drawable.pill_today
                    else -> R.color.muted to R.drawable.pill_normal
                }
                setTextViewText(R.id.dday, dday)
                setTextColor(R.id.dday, ctx.getColor(color))
                setInt(R.id.dday, "setBackgroundResource", pill)
                setViewVisibility(R.id.dday, if (dday.isNotEmpty()) View.VISIBLE else if (e.pad) View.INVISIBLE else View.GONE)
                setTextViewText(R.id.who, r.title)
                setTextViewText(R.id.doc, r.text)
                val line2 = r.line2(today)
                setTextViewText(R.id.detail, line2)
                setViewVisibility(R.id.detail, if (line2.isEmpty()) View.GONE else View.VISIBLE)
                setTextColor(R.id.detail, ctx.getColor(if (r.overdue(today)) R.color.overdue else R.color.muted))
                setOnClickFillInIntent(R.id.row, open(e.link))
            }
        }
    }
}
