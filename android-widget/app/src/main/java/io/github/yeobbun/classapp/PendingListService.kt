package io.github.yeobbun.classapp

import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import java.time.LocalDate

/** 위젯 목록의 줄들: 묶음 제목(출결 서류·일정…)과 그 아래 줄 */
class PendingListService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory = Factory(applicationContext)

    private sealed interface Entry
    private class Header(val title: String, val count: Int) : Entry
    private class Row(val row: PlanRow) : Entry

    private class Factory(private val ctx: Context) : RemoteViewsFactory {
        private var entries: List<Entry> = emptyList()
        private var today = ""

        override fun onCreate() {}
        override fun onDestroy() {}

        override fun onDataSetChanged() {
            today = LocalDate.now().toString()
            val sections = Prefs(ctx).summary()?.visible(today) ?: emptyList()
            entries = sections.flatMap { s -> listOf<Entry>(Header(s.title, s.rows.size)) + s.rows.map { Row(it) } }
        }

        override fun getCount() = entries.size
        override fun getViewTypeCount() = 2
        override fun hasStableIds() = false
        override fun getItemId(position: Int) = position.toLong()
        override fun getLoadingView(): RemoteViews? = null

        override fun getViewAt(position: Int): RemoteViews = when (val e = entries[position]) {
            is Header -> RemoteViews(ctx.packageName, R.layout.widget_header).apply {
                setTextViewText(R.id.header_title, e.title)
                setTextViewText(R.id.header_count, e.count.toString())
                setOnClickFillInIntent(R.id.header, Intent())
            }
            is Row -> RemoteViews(ctx.packageName, R.layout.widget_item).apply {
                val r = e.row
                val color = when {
                    r.overdue(today) -> R.color.overdue
                    r.isToday(today) -> R.color.accent
                    else -> R.color.muted
                }
                setTextViewText(R.id.dday, r.dday(today))
                setTextColor(R.id.dday, ctx.getColor(color))
                setTextViewText(R.id.who, r.title)
                setTextViewText(R.id.doc, r.text)
                setTextViewText(R.id.detail, r.line2(today))
                setTextColor(R.id.detail, ctx.getColor(if (r.overdue(today)) R.color.overdue else R.color.muted))
                setOnClickFillInIntent(R.id.row, Intent())
            }
        }
    }
}
