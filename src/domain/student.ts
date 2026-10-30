/**
 * 학생 한 명에 대해 여러 곳에 적은 것(출결, 관찰·상담 기록, 필사)을 한데 모은다.
 */
import { formatStamp } from './calendar';
import type { AppState, AttendanceRecord, BehaviorDraft, DateStr, Note, NoteKind, PilsaTask } from './types';

export type TimelineItem =
  | { type: 'attendance'; date: DateStr; record: AttendanceRecord }
  | { type: 'note'; date: DateStr; note: Note }
  | { type: 'pilsa'; date: DateStr; task: PilsaTask };

export type TimelineSource = Pick<AppState, 'records' | 'notes' | 'pilsa'>;

const TYPE_ORDER: Record<TimelineItem['type'], number> = { attendance: 0, note: 1, pilsa: 2 };

export function itemKey(it: TimelineItem): string {
  if (it.type === 'attendance') return 'r' + it.record.id;
  if (it.type === 'note') return 'n' + it.note.id;
  return 'p' + it.task.id;
}

/** 학년도(from~to)에 걸친 그 학생의 기록을 최근 것부터 */
export function studentTimeline(studentId: string, s: TimelineSource, from: DateStr, to: DateStr): TimelineItem[] {
  const items: TimelineItem[] = [
    ...s.records
      .filter((r) => r.studentId === studentId && r.endDate >= from && r.startDate <= to)
      .map((r) => ({ type: 'attendance' as const, date: r.startDate, record: r })),
    ...s.notes
      .filter((n) => n.studentIds.includes(studentId) && n.date >= from && n.date <= to)
      .map((n) => ({ type: 'note' as const, date: n.date, note: n })),
    ...s.pilsa
      .filter((p) => p.studentId === studentId && p.date >= from && p.date <= to)
      .map((p) => ({ type: 'pilsa' as const, date: p.date, task: p })),
  ];
  // 같은 날이면 출결 → 기록 → 필사, 기록끼리는 나중에 적은 것 먼저
  return items.sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      TYPE_ORDER[a.type] - TYPE_ORDER[b.type] ||
      (b.type === 'note' && a.type === 'note' ? (b.note.updatedAt ?? '').localeCompare(a.note.updatedAt ?? '') : 0),
  );
}

export function noteCounts(items: TimelineItem[]): Record<NoteKind, number> & { todo: number } {
  const c = { 관찰: 0, 학생상담: 0, 학부모상담: 0, todo: 0 };
  for (const it of items) {
    if (it.type !== 'note' || it.note.planned) continue; // 아직 안 한 상담은 세지 않는다
    c[it.note.kind]++;
    if (it.note.followUp?.trim() && !it.note.followUpDone) c.todo++;
  }
  return c;
}

/** 검색어가 내용·후속 조치·보호자·출결 메모·필사 사유에 들어 있는가 */
export function matchesQuery(it: TimelineItem, q: string): boolean {
  if (!q) return true;
  const text =
    it.type === 'note'
      ? [it.note.content, it.note.followUp, it.note.parentWho, it.note.kind].join(' ')
      : it.type === 'attendance'
        ? [it.record.memo, it.record.kind, it.record.status, it.record.reason].join(' ')
        : '필사 ' + it.task.reason;
  return text.includes(q);
}

/** 학생 id 를 바꾼다 (두 기기에서 따로 등록한 같은 학생 합치기). 모든 모듈의 학생 참조를 옮긴다 */
export function remapStudents(s: AppState, remap: Map<string, string>): AppState {
  const to = (id: string) => remap.get(id) ?? id;
  const many = (ids: string[]) => [...new Set(ids.map(to))];
  const touched = (ids: string[]) => ids.some((id) => remap.has(id));
  const behavior = new Map<string, BehaviorDraft>();
  for (const b of s.behavior) {
    const moved = remap.has(b.studentId) ? { ...b, studentId: to(b.studentId), id: `${b.year}:${to(b.studentId)}` } : b;
    const prev = behavior.get(moved.id);
    if (!prev || (moved.updatedAt ?? '') > (prev.updatedAt ?? '')) behavior.set(moved.id, moved);
  }
  return {
    ...s,
    students: s.students.filter((st) => !remap.has(st.id)),
    records: s.records.map((r) => (remap.has(r.studentId) ? { ...r, studentId: to(r.studentId) } : r)),
    notes: s.notes.map((n) => (touched(n.studentIds) ? { ...n, studentIds: many(n.studentIds) } : n)),
    pilsa: s.pilsa.map((p) => (remap.has(p.studentId) ? { ...p, studentId: to(p.studentId) } : p)),
    checklists: s.checklists.map((c) =>
      touched(Object.keys(c.marks)) ? { ...c, marks: Object.fromEntries(Object.entries(c.marks).map(([k, v]) => [to(k), v])) } : c,
    ),
    seatPlans: s.seatPlans.map((p) => (p.seats.some((id) => id && remap.has(id)) ? { ...p, seats: p.seats.map((id) => id && to(id)) } : p)),
    behavior: [...behavior.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/** 학생과 그 학생에 대한 기록을 모두 지운다. 여러 학생이 같이 있는 기록은 그 학생만 뺀다 */
export function removeStudentData(s: AppState, id: string): AppState {
  const drop = (ids: string[]) => ids.filter((x) => x !== id);
  return {
    ...s,
    students: s.students.filter((x) => x.id !== id),
    records: s.records.filter((r) => r.studentId !== id),
    notes: s.notes
      .map((n) => (n.studentIds.includes(id) ? { ...n, studentIds: drop(n.studentIds) } : n))
      .filter((n) => n.studentIds.length > 0),
    pilsa: s.pilsa.filter((p) => p.studentId !== id),
    checklists: s.checklists.map((c) => {
      if (!(id in c.marks)) return c;
      const { [id]: _gone, ...marks } = c.marks;
      return { ...c, marks };
    }),
    seatPlans: s.seatPlans.map((p) => (p.seats.includes(id) ? { ...p, seats: p.seats.map((x) => (x === id ? null : x)) } : p)),
    behavior: s.behavior.filter((b) => b.studentId !== id),
    settings:
      s.settings.seating.front.includes(id) || s.settings.seating.apart.some((pair) => pair.includes(id))
        ? {
            ...s.settings,
            seating: {
              ...s.settings.seating,
              front: drop(s.settings.seating.front),
              apart: s.settings.seating.apart.filter((pair) => !pair.includes(id)),
            },
          }
        : s.settings,
  };
}

/** 학생 한 명에 대해 각 모듈에 적은 것의 건수 (학생 삭제 확인에 쓴다) */
export function studentDataCount(s: AppState, id: string): number {
  return (
    s.records.filter((r) => r.studentId === id).length +
    s.notes.filter((n) => n.studentIds.includes(id)).length +
    s.pilsa.filter((p) => p.studentId === id).length +
    s.behavior.filter((b) => b.studentId === id).length
  );
}

/**
 * 기록을 저장할 때 작성·수정 시각을 붙인다. 이미 적힌 기록의 내용이나 날짜가 바뀌면
 * 바뀌기 전 판을 history 에 남긴다 (고쳐도 처음 적은 내용과 시각이 지워지지 않게).
 * 상담 일정(planned)은 아직 기록이 아니라서 시각을 붙이지 않는다.
 */
export function withWriteLog(prev: Note | undefined, next: Note, at: string): Note {
  if (next.planned) return next;
  if (!prev || prev.planned) return { ...next, writtenAt: at };
  const keep: Partial<Note> = {
    ...(prev.writtenAt ? { writtenAt: prev.writtenAt } : {}),
    ...(prev.editedAt ? { editedAt: prev.editedAt } : {}),
    ...(prev.history?.length ? { history: prev.history } : {}),
  };
  if (prev.content === next.content && prev.date === next.date) return { ...next, ...keep };
  const was = prev.editedAt ?? prev.writtenAt ?? prev.updatedAt;
  return {
    ...next,
    ...keep,
    editedAt: at,
    history: [...(prev.history ?? []), { ...(was ? { at: was } : {}), date: prev.date, content: prev.content }],
  };
}

/** 예: 작성 2026.10.30 14:32 · 수정 2026.10.31 09:10. 이 기능 전 기록은 마지막 저장 시각 */
export function stampLine(n: Note): string {
  if (n.writtenAt) return `작성 ${formatStamp(n.writtenAt)}${n.editedAt ? ` · 수정 ${formatStamp(n.editedAt)}` : ''}`;
  if (n.planned || !n.updatedAt) return '';
  return `저장 ${formatStamp(n.updatedAt)}${n.editedAt ? ` · 수정 ${formatStamp(n.editedAt)}` : ''}`;
}
