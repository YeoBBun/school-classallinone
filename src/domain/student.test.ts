import { describe, expect, it } from 'vitest';
import type { AttendanceRecord, Note } from './types';
import { matchesQuery, noteCounts, studentTimeline } from './student';

const rec = (id: string, startDate: string, studentId = 's1'): AttendanceRecord => ({
  id, studentId, status: '결석', kind: '질병', startDate, endDate: startDate, docs: [], memo: '감기',
});
const note = (id: string, date: string, p: Partial<Note> = {}): Note => ({
  id, studentIds: ['s1'], kind: '관찰', date, content: '', ...p,
});

describe('학생 한눈에 보기', () => {
  it('출결과 기록을 최근 것부터, 기간 안의 그 학생 것만', () => {
    const items = studentTimeline(
      's1',
      [rec('r1', '2026-10-01'), rec('r2', '2026-10-05', 's2'), rec('r3', '2026-02-10')],
      [note('n1', '2026-10-01'), note('n2', '2026-10-03', { studentIds: ['s2', 's1'] }), note('n3', '2026-10-04', { studentIds: ['s2'] })],
      '2026-03-01',
      '2027-02-28',
    );
    expect(items.map((it) => (it.type === 'note' ? it.note.id : it.record.id))).toEqual(['n2', 'r1', 'n1']);
  });

  it('유형별 건수와 끝나지 않은 후속 조치', () => {
    const items = studentTimeline('s1', [], [
      note('a', '2026-10-01', { kind: '학생상담', followUp: '다음 주 다시 면담' }),
      note('b', '2026-10-02', { kind: '학부모상담', followUp: '전화', followUpDone: true }),
      note('c', '2026-10-03'),
    ], '2026-03-01', '2027-02-28');
    expect(noteCounts(items)).toEqual({ 관찰: 1, 학생상담: 1, 학부모상담: 1, todo: 1 });
  });

  it('검색은 내용과 출결 메모에서', () => {
    const [n] = studentTimeline('s1', [], [note('a', '2026-10-01', { content: '진로 고민' })], '2026-03-01', '2027-02-28');
    const [r] = studentTimeline('s1', [rec('r', '2026-10-01')], [], '2026-03-01', '2027-02-28');
    expect(matchesQuery(n, '진로')).toBe(true);
    expect(matchesQuery(r, '감기')).toBe(true);
    expect(matchesQuery(r, '진로')).toBe(false);
  });
});
