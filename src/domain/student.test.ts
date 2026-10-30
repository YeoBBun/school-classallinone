import { describe, expect, it } from 'vitest';
import type { AttendanceRecord, Note } from './types';
import { itemKey, matchesQuery, noteCounts, studentTimeline, withWriteLog } from './student';

const rec = (id: string, startDate: string, studentId = 's1'): AttendanceRecord => ({
  id, studentId, status: '결석', kind: '질병', startDate, endDate: startDate, docs: [], memo: '감기',
});
const note = (id: string, date: string, p: Partial<Note> = {}): Note => ({
  id, studentIds: ['s1'], kind: '관찰', date, content: '', ...p,
});

const src = (records: AttendanceRecord[], notes: Note[]) => ({ records, notes, pilsa: [] });

describe('학생 한눈에 보기', () => {
  it('필사도 같은 목록에, 같은 날이면 출결 → 기록 → 필사', () => {
    const items = studentTimeline(
      's1',
      {
        records: [rec('r', '2026-10-01')],
        notes: [note('n', '2026-10-01')],
        pilsa: [{ id: 'p', studentId: 's1', date: '2026-10-01', reason: '휴대폰', pages: 2, submitted: [] }],
      },
      '2026-03-01',
      '2027-02-28',
    );
    expect(items.map(itemKey)).toEqual(['rr', 'nn', 'pp']);
    expect(matchesQuery(items[2], '휴대폰')).toBe(true);
  });

  it('출결과 기록을 최근 것부터, 기간 안의 그 학생 것만', () => {
    const items = studentTimeline(
      's1',
      src(
        [rec('r1', '2026-10-01'), rec('r2', '2026-10-05', 's2'), rec('r3', '2026-02-10')],
        [note('n1', '2026-10-01'), note('n2', '2026-10-03', { studentIds: ['s2', 's1'] }), note('n3', '2026-10-04', { studentIds: ['s2'] })],
      ),
      '2026-03-01',
      '2027-02-28',
    );
    expect(items.map(itemKey)).toEqual(['nn2', 'rr1', 'nn1']);
  });

  it('유형별 건수와 끝나지 않은 후속 조치', () => {
    const items = studentTimeline('s1', src([], [
      note('a', '2026-10-01', { kind: '학생상담', followUp: '다음 주 다시 면담' }),
      note('b', '2026-10-02', { kind: '학부모상담', followUp: '전화', followUpDone: true }),
      note('c', '2026-10-03'),
    ]), '2026-03-01', '2027-02-28');
    expect(noteCounts(items)).toEqual({ 관찰: 1, 학생상담: 1, 학부모상담: 1, todo: 1 });
  });

  it('검색은 내용과 출결 메모에서', () => {
    const [n] = studentTimeline('s1', src([], [note('a', '2026-10-01', { content: '진로 고민' })]), '2026-03-01', '2027-02-28');
    const [r] = studentTimeline('s1', src([rec('r', '2026-10-01')], []), '2026-03-01', '2027-02-28');
    expect(matchesQuery(n, '진로')).toBe(true);
    expect(matchesQuery(r, '감기')).toBe(true);
    expect(matchesQuery(r, '진로')).toBe(false);
  });
});

describe('기록 작성 시각', () => {
  const t1 = '2026-10-30T05:32:00.000Z';
  const t2 = '2026-10-31T00:10:00.000Z';
  const t3 = '2026-11-01T01:00:00.000Z';

  it('새 기록에 작성 시각, 상담 일정에는 없음, 일정이 끝난 상담이 되면 그때', () => {
    expect(withWriteLog(undefined, note('a', '2026-10-30', { content: '도움' }), t1).writtenAt).toBe(t1);
    const plan = note('b', '2026-11-02', { kind: '학부모상담', planned: true });
    expect(withWriteLog(undefined, plan, t1).writtenAt).toBeUndefined();
    expect(withWriteLog(plan, { ...plan, planned: undefined, content: '결과' }, t2).writtenAt).toBe(t2);
  });

  it('고치면 수정 시각과 고치기 전 판이 남고, 작성 시각은 그대로', () => {
    const a = withWriteLog(undefined, note('a', '2026-10-30', { content: '처음' }), t1);
    const b = withWriteLog(a, { ...a, content: '고침' }, t2);
    expect(b).toMatchObject({ writtenAt: t1, editedAt: t2, content: '고침' });
    expect(b.history).toEqual([{ at: t1, date: '2026-10-30', content: '처음' }]);
    const c = withWriteLog(b, { ...b, date: '2026-10-29' }, t3);
    expect(c.history).toEqual([
      { at: t1, date: '2026-10-30', content: '처음' },
      { at: t2, date: '2026-10-30', content: '고침' },
    ]);
  });

  it('내용·날짜가 그대로면 (할 일만 바꿔도) 수정으로 치지 않는다', () => {
    const a = withWriteLog(undefined, note('a', '2026-10-30', { content: '처음' }), t1);
    const b = withWriteLog(a, { ...a, followUp: '다시 면담' }, t2);
    expect(b.editedAt).toBeUndefined();
    expect(b.history).toBeUndefined();
  });

  it('고치는 화면이 시각을 지운 채 넘겨도 원래 시각과 이전 판을 지킨다', () => {
    const a = withWriteLog(undefined, note('a', '2026-10-30', { content: '처음' }), t1);
    const b = withWriteLog(a, { ...a, content: '고침' }, t2);
    const c = withWriteLog(b, { ...note('a', '2026-10-30'), content: '또 고침' }, t3);
    expect(c.writtenAt).toBe(t1);
    expect(c.history?.map((v) => v.content)).toEqual(['처음', '고침']);
  });
});
