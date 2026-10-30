/**
 * 학급 운영 모듈의 계산: 제출물, 필사, 사안, 행발 글자 수, 오늘 챙길 일.
 * 화면과 떨어뜨려 두고 테스트한다.
 */
import { addDays } from './calendar';
import type { AppState, Checklist, DateStr, Note, PilsaTask, Settings, Student } from './types';

// ─── 제출물 ───

export interface ChecklistProgress {
  done: number;
  exempt: number;
  /** 아직 안 낸 학생 (번호순) */
  missing: Student[];
  total: number;
}

export function checklistProgress(c: Checklist, students: Student[]): ChecklistProgress {
  const sorted = [...students].sort((a, b) => a.number - b.number);
  let done = 0;
  let exempt = 0;
  const missing: Student[] = [];
  for (const s of sorted) {
    const m = c.marks[s.id];
    if (m === 'exempt') exempt++;
    else if (m) done++;
    else missing.push(s);
  }
  return { done, exempt, missing, total: sorted.length };
}

/** 알림장·메시지에 붙여 넣을 미제출 명단 */
export function missingText(c: Checklist, missing: Student[]): string {
  return `[${c.title}] 아직 안 낸 학생 ${missing.length}명\n${missing.map((s) => `${s.number}. ${s.name}`).join('\n')}`;
}

// ─── 필사 ───

/** 다음에 부여할 분량: 기본 분량 + (그 학생이 지금까지 받은 횟수 × 늘어나는 분량) */
export function suggestedPages(pilsa: PilsaTask[], studentId: string, settings: Pick<Settings, 'pilsaBase' | 'pilsaStep'>): number {
  const count = pilsa.filter((p) => p.studentId === studentId).length;
  return Math.max(1, settings.pilsaBase + settings.pilsaStep * count);
}

export interface PilsaSummary {
  times: number;
  pages: number;
  submitted: number;
  remaining: number;
}

export function pilsaSummary(pilsa: PilsaTask[], studentId: string, from?: DateStr, to?: DateStr): PilsaSummary {
  const mine = pilsa.filter((p) => p.studentId === studentId && (!from || p.date >= from) && (!to || p.date <= to));
  const pages = mine.reduce((n, p) => n + p.pages, 0);
  const submitted = mine.reduce((n, p) => n + Math.min(p.submitted.length, p.pages), 0);
  return { times: mine.length, pages, submitted, remaining: pages - submitted };
}

/** 한 장 내기(앞에서부터 채운다) / 마지막으로 낸 장 취소 */
export function submitPage(p: PilsaTask, date: DateStr): PilsaTask {
  return p.submitted.length >= p.pages ? p : { ...p, submitted: [...p.submitted, date] };
}
export function undoPage(p: PilsaTask): PilsaTask {
  return p.submitted.length ? { ...p, submitted: p.submitted.slice(0, -1) } : p;
}

// ─── 나이스 바이트 ───

/** 나이스 글자 수 계산: 한글 등 3바이트, 영문·숫자·기호·띄어쓰기 1바이트, 줄바꿈 2바이트 */
export function neisBytes(text: string): number {
  let n = 0;
  for (const ch of text.replace(/\r\n?/g, '\n')) {
    if (ch === '\n') n += 2;
    else n += ch.codePointAt(0)! < 0x80 ? 1 : 3;
  }
  return n;
}

// ─── 새 학년도 ───

/**
 * 새 학년도: 학생 명단과 학생에 대한 기록을 모두 비우고, 규정·휴일·캘린더 설정은 남긴다.
 * (캘린더에 넣은 지난 상담 일정은 지우지 않고 남겨 둔다 — 연결 기록만 비운다)
 */
export function newSchoolYear(s: AppState): AppState {
  return {
    ...s,
    students: [],
    records: [],
    notes: [],
    checklists: [],
    pilsa: [],
    incidents: [],
    seatPlans: [],
    behavior: [],
    calendarLinks: [],
    settings: {
      ...s.settings,
      className: '',
      lastNeisExportTo: undefined,
      seating: { ...s.settings.seating, front: [], apart: [] },
    },
  };
}

// ─── 오늘 챙길 일 ───

export interface TodoSummary {
  /** 앞으로 14일 안의 상담 일정 (가까운 순) */
  upcoming: Note[];
  /** 날짜가 지났는데 결과를 안 적은 상담 */
  unwritten: Note[];
  /** 끝나지 않은 할 일(후속 조치) */
  followUps: Note[];
  /** 아직 다 안 걷힌 제출물 (마감 가까운 순) */
  checklists: { checklist: Checklist; missing: number }[];
  openIncidents: number;
  /** 필사를 다 안 낸 학생 수와 남은 장 수 */
  pilsaStudents: number;
  pilsaPages: number;
}

export function todoSummary(s: AppState, today: DateStr): TodoSummary {
  const soon = addDays(today, 14);
  const planned = s.notes.filter((n) => n.planned);
  const byWhen = (a: Note, b: Note) => (a.date + (a.time ?? '')).localeCompare(b.date + (b.time ?? ''));
  const checklists = s.checklists
    .filter((c) => !c.closed)
    .map((c) => ({ checklist: c, missing: checklistProgress(c, s.students).missing.length }))
    .filter((x) => x.missing > 0)
    .sort((a, b) => (a.checklist.dueDate ?? '9999').localeCompare(b.checklist.dueDate ?? '9999'));
  const remaining = new Map<string, number>();
  for (const p of s.pilsa) {
    const left = p.pages - Math.min(p.submitted.length, p.pages);
    if (left > 0) remaining.set(p.studentId, (remaining.get(p.studentId) ?? 0) + left);
  }
  return {
    upcoming: planned.filter((n) => n.date >= today && n.date <= soon).sort(byWhen),
    unwritten: planned.filter((n) => n.date < today).sort(byWhen),
    followUps: s.notes.filter((n) => n.followUp?.trim() && !n.followUpDone).sort((a, b) => a.date.localeCompare(b.date)),
    checklists,
    openIncidents: s.incidents.filter((i) => i.status !== '종결').length,
    pilsaStudents: remaining.size,
    pilsaPages: [...remaining.values()].reduce((a, b) => a + b, 0),
  };
}
