import { describe, expect, it } from 'vitest';
import { indexHolidays } from './calendar';
import { widgetSummary } from './widget';
import { rebuildDocs } from './rules';
import { DEFAULT_SETTINGS, emptyState, type AppState, type AttendanceRecord } from './types';

function rec(p: Partial<AttendanceRecord> & Pick<AttendanceRecord, 'id' | 'startDate'>): AttendanceRecord {
  const status = p.status ?? '결석';
  const kind = p.kind ?? '질병';
  const endDate = p.endDate ?? p.startDate;
  return {
    studentId: 's1',
    status,
    kind,
    endDate,
    memo: '',
    ...p,
    docs: p.docs ?? rebuildDocs([], { status, kind, reason: p.reason, startDate: p.startDate, endDate }),
  };
}

function stateOf(records: AttendanceRecord[]): AppState {
  return {
    ...emptyState(),
    students: [{ id: 's1', number: 3, name: '김하늘' }],
    records,
    holidays: [],
    settings: { ...DEFAULT_SETTINGS, className: '2-3' },
  };
}

describe('위젯 요약', () => {
  it('받을 서류를 날짜순으로, 체험학습은 기한과 다녀온 날까지 담는다', () => {
    const trip = rec({
      id: 't',
      startDate: '2026-10-22',
      endDate: '2026-10-23',
      kind: '출석인정',
      reason: '체험학습',
      fieldTrip: { abroad: false, guardianAccompanied: true },
    });
    const ill = rec({ id: 'i', startDate: '2026-10-20', kind: '미인정' });
    const s = widgetSummary(stateOf([trip, ill]), indexHolidays([]), '2026-10-21');
    expect(s.className).toBe('2-3');
    expect(s.items[0]).toEqual({ who: '3. 김하늘', doc: '출력물 학생 서명', what: '10/20(화) 미인정결석' });
    expect(s.items.slice(1).map((i) => [i.what, i.deadline, i.tripEnd])).toEqual([
      ['10/22(목) 체험학습', '2026-10-20', undefined],
      ['10/22(목) 체험학습', '2026-10-30', '2026-10-23'],
    ]);
  });

  it('받은 서류는 빠진다', () => {
    const r = rec({ id: 'i', startDate: '2026-10-20', kind: '미인정' });
    r.docs = r.docs.map((d) => ({ ...d, received: true }));
    expect(widgetSummary(stateOf([r]), indexHolidays([]), '2026-10-21').items).toEqual([]);
  });
});
