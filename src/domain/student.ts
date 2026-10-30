/**
 * 학생 한 명에 대해 여러 곳에 적은 것(출결, 관찰·상담 기록)을 한데 모은다.
 */
import type { AttendanceRecord, DateStr, Note, NoteKind } from './types';

export type TimelineItem =
  | { type: 'attendance'; date: DateStr; record: AttendanceRecord }
  | { type: 'note'; date: DateStr; note: Note };

/** 학년도(from~to)에 걸친 그 학생의 기록을 최근 것부터 */
export function studentTimeline(
  studentId: string,
  records: AttendanceRecord[],
  notes: Note[],
  from: DateStr,
  to: DateStr,
): TimelineItem[] {
  const items: TimelineItem[] = [
    ...records
      .filter((r) => r.studentId === studentId && r.endDate >= from && r.startDate <= to)
      .map((r) => ({ type: 'attendance' as const, date: r.startDate, record: r })),
    ...notes
      .filter((n) => n.studentIds.includes(studentId) && n.date >= from && n.date <= to)
      .map((n) => ({ type: 'note' as const, date: n.date, note: n })),
  ];
  // 같은 날이면 출결을 먼저, 그다음 나중에 적은 기록
  return items.sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      (a.type === b.type ? 0 : a.type === 'attendance' ? -1 : 1) ||
      (b.type === 'note' && a.type === 'note' ? (b.note.updatedAt ?? '').localeCompare(a.note.updatedAt ?? '') : 0),
  );
}

export function noteCounts(items: TimelineItem[]): Record<NoteKind, number> & { todo: number } {
  const c = { 관찰: 0, 학생상담: 0, 학부모상담: 0, todo: 0 };
  for (const it of items) {
    if (it.type !== 'note') continue;
    c[it.note.kind]++;
    if (it.note.followUp?.trim() && !it.note.followUpDone) c.todo++;
  }
  return c;
}

/** 검색어가 내용·후속 조치·보호자·출결 메모에 들어 있는가 */
export function matchesQuery(it: TimelineItem, q: string): boolean {
  if (!q) return true;
  const text =
    it.type === 'note'
      ? [it.note.content, it.note.followUp, it.note.parentWho, it.note.kind].join(' ')
      : [it.record.memo, it.record.kind, it.record.status, it.record.reason].join(' ');
  return text.includes(q);
}
