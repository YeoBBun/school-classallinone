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
    expect(sections.map((x) => x.title)).toEqual(['일정', '제출물', '미처리']);
    expect(sections[0].rows.map((r) => r.type)).toEqual(['event', 'consult']);
    expect(sections[2].rows.map((r) => r.type)).toEqual(['unwritten', 'followUp']);

    const w = widgetSummary(s, indexHolidays([]), '2026-10-30');
    expect(w.sections[0].rows).toEqual([
      { title: '체육대회', text: '학급 행사', detail: '10/31(토)', on: '2026-10-31' },
      { title: '김하늘', text: '학부모 상담', detail: '11/2(월) 15:00', on: '2026-11-02' },
    ]);
    expect(w.sections[1].rows[0]).toEqual({ title: '동의서', text: '1명 안 냄', detail: '11/3(화)까지', due: '2026-11-03' });
  });

  it('필사는 덜 낸 학생마다 한 줄, 번호순, 남은 장은 부여를 합친다', () => {
    const s: AppState = {
      ...base(),
      pilsa: [
        { id: 'p2', studentId: 's2', date: '2026-10-21', reason: '지각', pages: 2, submitted: ['2026-10-22', '2026-10-23'] },
        { id: 'p3', studentId: 's2', date: '2026-10-25', reason: '', pages: 1, submitted: [] },
        { id: 'p1', studentId: 's2', date: '2026-10-20', reason: '휴대폰 사용', pages: 3, submitted: ['2026-10-21'] },
        { id: 'p0', studentId: 's1', date: '2026-10-28', reason: '떠듦', pages: 1, submitted: [] },
      ],
    };
    const [pilsa] = planSections(s, indexHolidays([]), '2026-10-30');
    expect(pilsa.title).toBe('필사');
    expect(pilsa.rows.map((r) => (r.type === 'pilsa' ? [r.studentId, r.remaining, r.tasks.map((t) => t.id)] : null))).toEqual([
      ['s1', 1, ['p0']],
      ['s2', 3, ['p1', 'p3']],
    ]);
    expect(widgetSummary(s, indexHolidays([]), '2026-10-30').sections[0].rows[1]).toEqual({
      title: '2. 이바다',
      text: '3장 남음',
      detail: '10/20(화) 휴대폰 사용 외 1건',
    });
  });

  it('기타: 직접 적은 할 일, 기한 가까운 것부터, 기한 없는 것은 뒤에', () => {
    const s: AppState = {
      ...base(),
      todos: [
        { id: 'a', text: '교무회의 자료', createdAt: '2026-10-20' },
        { id: 'b', text: '학급 문고 정리', createdAt: '2026-10-21', due: '2026-11-05' },
        { id: 'c', text: '방과후 명단', createdAt: '2026-10-22', due: '2026-10-31' },
      ],
    };
    const [etc] = planSections(s, indexHolidays([]), '2026-10-30');
    expect(etc.title).toBe('기타');
    expect(etc.rows.map((r) => (r.type === 'todo' ? r.todo.id : null))).toEqual(['c', 'b', 'a']);
    expect(widgetSummary(s, indexHolidays([]), '2026-10-30').sections[0].rows[0]).toEqual({
      title: '방과후 명단',
      text: '',
      detail: '10/31(토)까지',
      due: '2026-10-31',
    });
  });

  it('처리할 것이 없으면 묶음도 없다', () => {
    expect(planSections(base(), indexHolidays([]), '2026-10-30')).toEqual([]);
  });
});
