import { describe, expect, it } from 'vitest';
import { indexHolidays } from './calendar';
import { dday, planSections } from './plan';
import { emptyState, type AppState } from './types';
import { widgetSummary } from './widget';

const base = (): AppState => ({
  ...emptyState(),
  holidays: [],
  students: [
    { id: 's1', number: 1, name: '김하늘' },
    { id: 's2', number: 2, name: '이바다' },
  ],
});

describe('처리 예정', () => {
  it('남은 날은 D-0, D-3, 지나면 D+2', () => {
    expect(dday('2026-10-30', '2026-10-30')).toBe('D-0');
    expect(dday('2026-11-02', '2026-10-30')).toBe('D-3');
    expect(dday('2026-10-28', '2026-10-30')).toBe('D+2');
  });

  it('종류별로 묶고, 일정은 상담·학급 일정을 날짜·시각 순으로 섞는다', () => {
    const s: AppState = {
      ...base(),
      notes: [
        { id: 'c1', studentIds: ['s1'], kind: '학부모상담', date: '2026-11-02', time: '15:00', content: '', planned: true },
        { id: 'c0', studentIds: ['s2'], kind: '학부모상담', date: '2026-10-28', content: '', planned: true },
        { id: 'f', studentIds: ['s2'], kind: '관찰', date: '2026-10-20', content: '다툼', followUp: '다시 면담' },
      ],
      events: [{ id: 'e', kind: '학급 행사', title: '체육대회', date: '2026-10-31' }],
      checklists: [{ id: 'k', title: '동의서', createdAt: '2026-10-20', dueDate: '2026-11-03', marks: { s1: '2026-10-21' } }],
    };
    const sections = planSections(s, indexHolidays([]), '2026-10-30');
    expect(sections.map((x) => x.title)).toEqual(['일정', '제출물', '할 일']);
    expect(sections[0].rows.map((r) => r.type)).toEqual(['event', 'consult']);
    expect(sections[2].rows.map((r) => r.type)).toEqual(['unwritten', 'followUp']);

    const w = widgetSummary(s, indexHolidays([]), '2026-10-30');
    expect(w.sections[0].rows).toEqual([
      { title: '체육대회', text: '학급 행사', detail: '10/31(토)', on: '2026-10-31' },
      { title: '김하늘', text: '학부모 상담', detail: '11/2(월) 15:00', on: '2026-11-02' },
    ]);
    expect(w.sections[1].rows[0]).toEqual({ title: '동의서', text: '1명 안 냄', detail: '11/3(화)까지', due: '2026-11-03' });
  });

  it('처리할 것이 없으면 묶음도 없다', () => {
    expect(planSections(base(), indexHolidays([]), '2026-10-30')).toEqual([]);
  });
});
