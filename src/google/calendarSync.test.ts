import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mergeStates } from '../sync/merge';
import { emptyState, type AppState } from '../domain/types';

// 가짜 구글 캘린더 (시험마다 캘린더 id 를 다르게 쓴다 — 한 번 확인·삭제한 캘린더는 다시 묻지 않으므로)
const cal = vi.hoisted(() => ({
  listed: [] as string[] | null, // 앱이 만든 캘린더 목록 (null = 볼 수 없음)
  existing: new Set<string>(),
  made: 0,
  deleted: [] as string[],
  cleared: [] as string[],
  saved: [] as string[],
}));

vi.mock('./google', () => ({
  hasCalendarScope: () => true,
  findCalendars: async () => (cal.listed ? [...cal.listed].sort() : null),
  deleteCalendar: async (id: string) => void cal.deleted.push(id),
  clearEvents: async (id: string) => void cal.cleared.push(id),
  calendarExists: async (id: string) => cal.existing.has(id),
  createCalendar: async () => `new${++cal.made}`,
  saveEvent: async (calendarId: string) => {
    cal.saved.push(calendarId);
    return `ev${cal.saved.length}`;
  },
  deleteEvent: async () => {},
}));

const { applyCalendar } = await import('./calendarSync');

const state = (settings: Partial<AppState['settings']> = {}, links: AppState['calendarLinks'] = []): AppState => ({
  ...emptyState(),
  holidays: [],
  events: [{ id: 'e1', kind: '학급 행사', title: '체육대회', date: '2026-11-02' }],
  calendarLinks: links,
  settings: { ...emptyState().settings, ...settings },
});

beforeEach(() => {
  Object.assign(cal, { listed: [], existing: new Set(), made: 0, deleted: [], cleared: [], saved: [] });
});

describe('학급관리 캘린더는 하나만', () => {
  it('적어 둔 캘린더가 있으면 목록이 비어 와도 새로 만들지 않는다', async () => {
    cal.existing.add('cal-1');
    const r = await applyCalendar(state({ calendarId: 'cal-1' }));
    expect(cal.made).toBe(0);
    expect(r?.calendarId).toBe('cal-1');
    expect(cal.saved).toEqual(['cal-1']);
  });

  it('적어 둔 캘린더도, 앱이 만든 캘린더도 없을 때만 새로 만든다', async () => {
    const r = await applyCalendar(state());
    expect(r?.calendarId).toBe('new1');
  });

  it('적어 둔 캘린더가 지워졌으면 새로 만들고, 일정은 새 캘린더에 다시 넣는다', async () => {
    const r = await applyCalendar(state({ calendarId: 'cal-gone' }, [{ id: 'event:e1', eventId: 'old', hash: 'x', cal: 'cal-gone' }]));
    expect(r?.calendarId).toBe('new1');
    expect(r?.retired).toEqual(['cal-gone']);
    expect(r?.links).toEqual([expect.objectContaining({ id: 'event:e1', cal: 'new1' })]);
  });

  it('지울 목록의 캘린더와, 목록에 보이는 다른 학급관리 캘린더는 지운다', async () => {
    cal.existing.add('cal-2');
    cal.listed = ['cal-2', 'cal-3'];
    const r = await applyCalendar(state({ calendarId: 'cal-2', calendarRetired: ['cal-4'] }));
    expect(cal.deleted.sort()).toEqual(['cal-3', 'cal-4']);
    expect(r?.calendarId).toBe('cal-2');
    expect(r?.retired).toEqual(['cal-3', 'cal-4']);
  });

  it('다른 캘린더에 넣었던 일정은 지금 캘린더에 다시 넣는다', async () => {
    cal.existing.add('cal-5');
    const r = await applyCalendar(state({ calendarId: 'cal-5' }, [{ id: 'event:e1', eventId: 'x', hash: 'h', cal: 'cal-other' }]));
    expect(cal.saved).toEqual(['cal-5']);
    expect(r?.links[0].cal).toBe('cal-5');
  });
});

describe('기기 간 합칠 때 캘린더 설정', () => {
  const at = (iso: string, settings: Partial<AppState['settings']>): AppState => ({
    ...emptyState(),
    settings: { ...emptyState().settings, ...settings, updatedAt: iso },
  });

  it('다른 설정을 나중에 고친 기기가 캘린더 id 를 지우지 않는다', () => {
    const pc = at('2026-11-01T01:00:00Z', { calendarId: 'cal-a' });
    const phone = at('2026-11-01T02:00:00Z', { className: '2-3' });
    expect(mergeStates(pc, phone).settings).toMatchObject({ className: '2-3', calendarId: 'cal-a' });
  });

  it('두 기기가 서로 다른 캘린더를 만들었으면 진 쪽을 지울 목록에 넣는다', () => {
    const pc = at('2026-11-01T01:00:00Z', { calendarId: 'cal-a' });
    const phone = at('2026-11-01T02:00:00Z', { calendarId: 'cal-b', calendarRetired: ['cal-old'] });
    const s = mergeStates(pc, phone).settings;
    expect(s.calendarId).toBe('cal-b');
    expect(s.calendarRetired).toEqual(['cal-a', 'cal-old']);
  });
});
