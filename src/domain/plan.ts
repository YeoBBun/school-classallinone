/**
 * 오늘 화면 «처리 예정»과 휴대폰 위젯이 같이 쓰는 묶음: 출결 서류 · 일정 · 제출물 · 할 일 · 필사.
 * 학생별이 아니라 종류별로 모은다.
 */
import { parseDate, type HolidayIndex } from './calendar';
import { todoSummary } from './classroom';
import { pendingDocs, type PendingRow } from './pending';
import type { AppState, Checklist, ClassEvent, DateStr, Note } from './types';

export type PlanRow =
  | ({ type: 'doc' } & PendingRow)
  | { type: 'consult'; note: Note }
  | { type: 'event'; event: ClassEvent }
  | { type: 'checklist'; checklist: Checklist; missing: number }
  | { type: 'unwritten'; note: Note }
  | { type: 'followUp'; note: Note }
  | { type: 'pilsa'; students: number; pages: number };

export const PLAN_SECTIONS = ['출결 서류', '일정', '제출물', '할 일', '필사'] as const;
export type PlanSectionTitle = (typeof PLAN_SECTIONS)[number];

export interface PlanSection {
  title: PlanSectionTitle;
  rows: PlanRow[];
}

/** 빈 묶음은 뺀다. 일정은 상담과 학급 일정을 날짜·시각 순으로 섞는다. */
export function planSections(s: AppState, holidays: HolidayIndex, today: DateStr): PlanSection[] {
  const t = todoSummary(s, today);
  const overdue = (d?: DateStr) => (d && d < today ? 0 : 1);
  const docs = pendingDocs(s, holidays).sort((a, b) => overdue(a.deadline) - overdue(b.deadline));
  const when = (r: PlanRow) =>
    r.type === 'consult' ? r.note.date + (r.note.time ?? '') : r.type === 'event' ? r.event.date + (r.event.time ?? '') : '';
  const schedule: PlanRow[] = [
    ...t.upcoming.map((note): PlanRow => ({ type: 'consult', note })),
    ...t.events.map((event): PlanRow => ({ type: 'event', event })),
  ].sort((a, b) => when(a).localeCompare(when(b)));
  const sections: PlanSection[] = [
    { title: '출결 서류', rows: docs.map((d) => ({ type: 'doc', ...d })) },
    { title: '일정', rows: schedule },
    { title: '제출물', rows: t.checklists.map((c) => ({ type: 'checklist', ...c })) },
    {
      title: '할 일',
      rows: [...t.unwritten.map((note): PlanRow => ({ type: 'unwritten', note })), ...t.followUps.map((note): PlanRow => ({ type: 'followUp', note }))],
    },
    { title: '필사', rows: t.pilsaStudents ? [{ type: 'pilsa', students: t.pilsaStudents, pages: t.pilsaPages }] : [] },
  ];
  return sections.filter((x) => x.rows.length > 0);
}

/** 남은 날: 오늘 D-0, 사흘 뒤 D-3, 지났으면 D+2 */
export function dday(date: DateStr, today: DateStr): string {
  const n = Math.round((parseDate(date).getTime() - parseDate(today).getTime()) / 86_400_000);
  return n >= 0 ? `D-${n}` : `D+${-n}`;
}
