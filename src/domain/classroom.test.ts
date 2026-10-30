import { describe, expect, it } from 'vitest';
import { desiredEvents, eventHash, planCalendar } from './calendarEvents';
import { checklistProgress, missingText, neisBytes, newSchoolYear, pilsaSummary, submitPage, suggestedPages, todoSummary, undoPage } from './classroom';
import { adjacent, partnerPairs, penalty, shuffleSeats, viewRows } from './seating';
import { removeStudentData, remapStudents } from './student';
import { emptyState, type AppState, type Checklist, type PilsaTask, type SeatingRules } from './types';

const students = [1, 2, 3, 4].map((n) => ({ id: `s${n}`, number: n, name: `학생${n}` }));
const base = (): AppState => ({ ...emptyState(), holidays: [], students });

describe('제출물', () => {
  it('낸 학생·면제·안 낸 학생', () => {
    const c: Checklist = { id: 'c', title: '동의서', createdAt: '2026-10-01', marks: { s1: '2026-10-02', s3: 'exempt' } };
    const p = checklistProgress(c, students);
    expect([p.done, p.exempt, p.missing.map((s) => s.id)]).toEqual([1, 1, ['s2', 's4']]);
    expect(missingText(c, p.missing)).toBe('[동의서] 아직 안 낸 학생 2명\n2. 학생2\n4. 학생4');
  });
});

describe('필사', () => {
  const task = (id: string, pages: number, submitted: string[] = []): PilsaTask => ({
    id, studentId: 's1', date: '2026-10-01', reason: '', pages, submitted,
  });
  it('부여할 때마다 분량이 늘어난다', () => {
    const settings = { pilsaBase: 1, pilsaStep: 1 };
    expect(suggestedPages([], 's1', settings)).toBe(1);
    expect(suggestedPages([task('a', 1), task('b', 2)], 's1', settings)).toBe(3);
  });
  it('장마다 내고, 다 내면 더 안 늘어난다', () => {
    let t = task('a', 2);
    t = submitPage(submitPage(submitPage(t, 'D1'), 'D2'), 'D3');
    expect(t.submitted).toEqual(['D1', 'D2']);
    expect(undoPage(t).submitted).toEqual(['D1']);
    expect(pilsaSummary([t, task('b', 3)], 's1')).toEqual({ times: 2, pages: 5, submitted: 2, remaining: 3 });
  });
});

describe('나이스 바이트', () => {
  it('한글 3, 영문·숫자·띄어쓰기 1, 줄바꿈 2', () => {
    expect(neisBytes('가나 a1')).toBe(9);
    expect(neisBytes('가\n나')).toBe(8);
    expect(neisBytes('가\r\n나')).toBe(8);
  });
});

describe('자리 배치', () => {
  const rules: SeatingRules = { rows: 2, cols: 4, pair: true, front: [], apart: [] };
  it('옆·앞뒤만 붙은 자리', () => {
    expect(adjacent(0, 1, 4)).toBe(true);
    expect(adjacent(0, 4, 4)).toBe(true);
    expect(adjacent(3, 4, 4)).toBe(false); // 줄 끝과 다음 줄 처음
    expect(adjacent(0, 5, 4)).toBe(false);
  });
  it('짝은 같은 줄의 두 자리씩', () => {
    expect([...partnerPairs(['a', 'b', 'c', null, 'e', 'f', null, null], 4)]).toEqual(['a|b', 'e|f']);
  });
  it('떨어뜨릴 학생·앞자리 학생 조건을 지킨다', () => {
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const r = { ...rules, rows: 3, front: ['s4'], apart: [['s1', 's2']] as [string, string][] };
    const { seats, penalty: p } = shuffleSeats(['s1', 's2', 's3', 's4', 's5', 's6'], r, null, random);
    expect(p).toBe(0);
    expect(penalty(seats, r, new Set())).toBe(0);
    expect(seats.indexOf('s4')).toBeLessThan(8);
    expect(seats.slice(6).every((x) => x === null)).toBe(true); // 빈자리는 뒤쪽
  });
  it('교사 시점은 위아래·좌우가 바뀐다', () => {
    expect(viewRows([1, 2, 3, 4, 5, 6], 2, 3, 'student')).toEqual([[1, 2, 3], [4, 5, 6]]);
    expect(viewRows([1, 2, 3, 4, 5, 6], 2, 3, 'teacher')).toEqual([[6, 5, 4], [3, 2, 1]]);
  });
});

describe('캘린더 일정', () => {
  it('상담 일정과 제출 마감, 바뀐 것만 다시 올리고 없어진 것은 지운다', () => {
    const s: AppState = {
      ...base(),
      notes: [
        { id: 'n1', studentIds: ['s2'], kind: '학부모상담', date: '2026-11-03', time: '15:30', content: '', planned: true, parentWho: '어머니', parentMethod: '대면' },
        { id: 'n2', studentIds: ['s1'], kind: '학부모상담', date: '2026-10-01', content: '진로', planned: false },
        { id: 'n3', studentIds: ['s3'], kind: '학부모상담', date: '2026-10-02', time: '16:00', content: '마침' },
      ],
      checklists: [{ id: 'c1', title: '동의서', createdAt: '2026-10-01', dueDate: '2026-11-05', marks: {} }],
    };
    const desired = desiredEvents(s);
    expect(desired.map((d) => [d.key, d.summary, d.time])).toEqual([
      ['due:c1', '제출 마감: 동의서', undefined],
      ['note:n1', '학부모 상담: 2번 학생2 (어머니 · 대면)', '15:30'],
      ['note:n3', '학부모 상담: 3번 학생3', '16:00'], // 마친 상담도 남는다
    ]);
    const links = [
      { id: 'due:c1', eventId: 'e1', hash: eventHash(desired[0]) },
      { id: 'note:n1', eventId: 'e2', hash: 'old' },
      { id: 'note:n3', eventId: 'e4', hash: eventHash(desired[2]) },
      { id: 'note:gone', eventId: 'e3', hash: 'x' },
    ];
    const plan = planCalendar(desired, links);
    expect(plan.create).toEqual([]);
    expect(plan.update.map((u) => u.link.eventId)).toEqual(['e2']);
    expect(plan.remove.map((l) => l.eventId)).toEqual(['e3']);
  });
});

describe('오늘 챙길 일', () => {
  it('다가오는 상담, 결과 안 적은 상담, 할 일, 덜 걷힌 제출물, 필사', () => {
    const s: AppState = {
      ...base(),
      notes: [
        { id: 'a', studentIds: ['s1'], kind: '학부모상담', date: '2026-10-29', content: '', planned: true },
        { id: 'b', studentIds: ['s1'], kind: '학부모상담', date: '2026-11-02', content: '', planned: true },
        { id: 'c', studentIds: ['s1'], kind: '관찰', date: '2026-10-20', content: 'x', followUp: '면담' },
      ],
      checklists: [{ id: 'k', title: '회신', createdAt: '2026-10-01', marks: { s1: '2026-10-02' } }],
      pilsa: [{ id: 'p', studentId: 's2', date: '2026-10-01', reason: '', pages: 3, submitted: ['2026-10-02'] }],
      incidents: [{ id: 'i', title: '다툼', date: '2026-10-01', studentIds: ['s1'], status: '진행 중', steps: [] }],
    };
    const t = todoSummary(s, '2026-10-30');
    expect(t.upcoming.map((n) => n.id)).toEqual(['b']);
    expect(t.unwritten.map((n) => n.id)).toEqual(['a']);
    expect(t.followUps.map((n) => n.id)).toEqual(['c']);
    expect(t.checklists).toEqual([{ checklist: s.checklists[0], missing: 3 }]);
    expect([t.openIncidents, t.pilsaStudents, t.pilsaPages]).toEqual([1, 1, 2]);
  });
});

describe('새 학년도', () => {
  it('명단과 기록은 비우고 규정·휴일은 남긴다', () => {
    const s: AppState = {
      ...base(),
      holidays: [{ date: '2027-03-01', name: '삼일절', type: '공휴일' }],
      notes: [{ id: 'n', studentIds: ['s1'], kind: '관찰', date: '2026-10-01', content: 'x' }],
      settings: { ...base().settings, className: '2-3', pilsaBase: 2, calendarOn: true, calendarId: 'cal' },
    };
    const n = newSchoolYear(s);
    expect([n.students.length, n.notes.length, n.settings.className]).toEqual([0, 0, '']);
    expect([n.holidays.length, n.settings.pilsaBase, n.settings.calendarId]).toEqual([1, 2, 'cal']);
  });
});

describe('학생 합치기·지우기', () => {
  const full = (): AppState => ({
    ...base(),
    notes: [{ id: 'n', studentIds: ['s1', 's2'], kind: '관찰', date: '2026-10-01', content: '' }],
    pilsa: [{ id: 'p', studentId: 's1', date: '2026-10-01', reason: '', pages: 1, submitted: [] }],
    incidents: [{ id: 'i', title: '', date: '2026-10-01', studentIds: ['s1'], status: '진행 중', steps: [] }],
    checklists: [{ id: 'c', title: '', createdAt: '2026-10-01', marks: { s1: 'exempt' } }],
    seatPlans: [{ id: 'sp', date: '2026-10-01', rows: 1, cols: 2, pair: true, seats: ['s1', 's2'] }],
    behavior: [{ id: '2026:s1', studentId: 's1', year: 2026, text: '성실함' }],
  });
  it('모든 모듈에서 학생 id 를 옮긴다', () => {
    const s = remapStudents(full(), new Map([['s1', 's9']]));
    expect(s.notes[0].studentIds).toEqual(['s9', 's2']);
    expect(s.pilsa[0].studentId).toBe('s9');
    expect(s.incidents[0].studentIds).toEqual(['s9']);
    expect(s.checklists[0].marks).toEqual({ s9: 'exempt' });
    expect(s.seatPlans[0].seats).toEqual(['s9', 's2']);
    expect(s.behavior[0].id).toBe('2026:s9');
  });
  it('지우면 그 학생 것만 빠진다', () => {
    const s = removeStudentData(full(), 's1');
    expect(s.notes[0].studentIds).toEqual(['s2']);
    expect([s.pilsa.length, s.behavior.length]).toEqual([0, 0]);
    expect(s.checklists[0].marks).toEqual({});
    expect(s.seatPlans[0].seats).toEqual([null, 's2']);
  });
});
