/**
 * 휴대폰 위젯용 «처리 예정» 요약 (sync/pending.json).
 * 위젯 앱 android-widget/.../Pending.kt 와 같은 모양이다.
 */
import { formatKo, type HolidayIndex } from './calendar';
import { pendingDocs, shortTitle, studentName } from './pending';
import { pilsaDetail, planSections, type PlanRow } from './plan';
import { DOC_FT_REPORT } from './rules';
import type { AppState, DateStr, Note } from './types';

export const WIDGET_FORMAT = 'attendance-app/pending-v1';

/** 예전 위젯 앱이 읽는 받을 서류 한 줄 (새 위젯은 sections 를 읽는다) */
export interface WidgetItem {
  /** 예: 3. 김하늘 */
  who: string;
  /** 예: 결석계 */
  doc: string;
  /** 예: 10/21(화) 질병결석 */
  what: string;
  /** 기한 (체험학습 신청서·보고서). 지나면 위젯에서 빨갛게 위로 올린다 */
  deadline?: DateStr;
  /** 체험학습 보고서: 이 날까지는 '다녀온 후'로 표시 */
  tripEnd?: DateStr;
}

/** 묶음 안의 한 줄. 첫 줄 «title text», 둘째 줄 detail. D-day 는 위젯이 오늘 날짜로 계산한다 */
export interface WidgetRow {
  title: string;
  text: string;
  detail?: string;
  /** 일정 날짜 — 남은 날을 보이고, 지나면 위젯에서 감춘다 */
  on?: DateStr;
  /** 기한 — 남은 날을 보이고, 지나면 빨갛게 */
  due?: DateStr;
  /** 체험학습 보고서: 이 날까지는 '다녀온 후' */
  tripEnd?: DateStr;
}

export interface WidgetSummary {
  format: typeof WIDGET_FORMAT;
  className: string;
  items: WidgetItem[];
  sections: { title: string; rows: WidgetRow[] }[];
}

/**
 * 위젯에 보여줄 요약. 일정은 앞으로 14일 것이 담기고, 날짜에 따라 바뀌는 것(D-day, 기한 지남, 지난 일정)은
 * 위젯이 계산하므로 앱을 며칠 안 열어도 위젯이 틀리지 않는다.
 */
export function widgetSummary(state: AppState, holidays: HolidayIndex, today: DateStr): WidgetSummary {
  const who = (n: Note) => n.studentIds.map((id) => state.students.find((s) => s.id === id)?.name ?? '?').join(', ');
  const at = (d: DateStr, time?: string) => (time ? `${formatKo(d)} ${time}` : formatKo(d));
  const row = (r: PlanRow): WidgetRow => {
    switch (r.type) {
      case 'doc':
        return {
          title: studentName(state, r.record.studentId),
          text: r.doc.label,
          detail: `${formatKo(r.record.startDate)} ${shortTitle(r.record)}`,
          ...(r.deadline ? { due: r.deadline } : {}),
          ...(r.doc.key === DOC_FT_REPORT ? { tripEnd: r.record.endDate } : {}),
        };
      case 'consult':
        return { title: who(r.note), text: `학부모 상담${r.note.parentWho ? ` (${r.note.parentWho})` : ''}`, detail: at(r.note.date, r.note.time), on: r.note.date };
      case 'event':
        return { title: r.event.title, text: r.event.kind, detail: at(r.event.date, r.event.time), on: r.event.date };
      case 'checklist':
        return {
          title: r.checklist.title,
          text: `${r.missing}명 안 냄`,
          ...(r.checklist.dueDate ? { detail: `${formatKo(r.checklist.dueDate)}까지`, due: r.checklist.dueDate } : {}),
        };
      case 'unwritten':
        return { title: who(r.note), text: '상담 결과 적기', detail: `${formatKo(r.note.date)} 학부모 상담` };
      case 'followUp':
        return { title: who(r.note), text: r.note.followUp ?? '', detail: `${formatKo(r.note.date)} ${r.note.kind}` };
      case 'pilsa':
        return { title: studentName(state, r.studentId), text: `${r.remaining}장 남음`, detail: pilsaDetail(r.tasks) };
      case 'todo':
        return { title: r.todo.text, text: '', ...(r.todo.due ? { detail: `${formatKo(r.todo.due)}까지`, due: r.todo.due } : {}) };
    }
  };
  return {
    format: WIDGET_FORMAT,
    className: state.settings.className,
    items: pendingDocs(state, holidays).map(({ record, doc, deadline }) => ({
      who: studentName(state, record.studentId),
      doc: doc.label,
      what: `${formatKo(record.startDate)} ${shortTitle(record)}`,
      ...(deadline ? { deadline } : {}),
      ...(doc.key === DOC_FT_REPORT ? { tripEnd: record.endDate } : {}),
    })),
    sections: planSections(state, holidays, today).map((s) => ({ title: s.title, rows: s.rows.map(row) })),
  };
}
