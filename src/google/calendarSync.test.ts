import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyState, type AppState } from '../domain/types';

// 가짜 구글 캘린더
const cal = vi.hoisted(() => ({
  calendars: [] as string[] | null, // null = 목록을 볼 수 없음
  exists: true,
  made: 0,
  deleted: [] as string[],
  cleared: [] as string[],
  saved: [] as string[],
}));

vi.mock('./google', () => ({
  hasCalendarScope: () => true,
  findCalendars: async () => (cal.calendars ? [...cal.calendars].sort() : null),
  deleteCalendar: async (id: string) => void cal.deleted.push(id),
  clearEvents: async (id: string) => void cal.cleared.push(id),
  calendarExists: async () => cal.exists,
  createCalendar: async () => `new${++cal.made}`,
  saveEvent: async (calendarId: string) => {
    cal.saved.push(calendarId);
    return `ev${cal.saved.length}`;
  },
  deleteEvent: async () => {},
}));

const { applyCalendar } = await import('./calendarSync');

const withEvent = (calendarId?: string, links: AppState['calendarLinks'] = []): AppState => ({
  ...emptyState(),
  holidays: [],
  events: [{ id: 'e1', kind: '학급 행사', title: '체육대회', date: '2026-11-02' }],
  calendarLinks: links,
  settings: { ...emptyState().settings, calendarId },
});

beforeEach(() => {
  Object.assign(cal, { calendars: [], exists: true, made: 0, deleted: [], cleared: [], saved: [] });
});

describe('학급관리 캘린더는 하나만', () => {
  it('앱이 만든 캘린더가 없으면 하나 만든다', async () => {
    const r = await applyCalendar(withEvent());
    expect(r?.calendarId).toBe('new1');
    expect(cal.saved).toEqual(['new1']);
  });

  it('여럿이면 id 가 앞서는 하나만 남기고 지운 뒤, 비우고 처음부터 넣는다', async () => {
    cal.calendars = ['cal-c', 'cal-a', 'cal-b'];
    const r = await applyCalendar(withEvent('x-missing'));
    expect(r?.calendarId).toBe('cal-a');
    expect(cal.deleted).toEqual(['cal-b', 'cal-c']);
    expect(cal.cleared).toEqual(['cal-a']);
    expect(cal.made).toBe(0);
    expect(r?.links.map((l) => l.id)).toEqual(['event:e1']);
  });

  it('이 기기가 쓰던 캘린더가 남는 것이면 넣어 둔 일정은 그대로 두고 남은 것만 지운다', async () => {
    // (앞 시험에서 이미 확인한 캘린더는 다시 묻지 않으므로 다른 id)
    cal.calendars = ['cal-0', 'cal-z'];
    const state = withEvent('cal-0');
    const first = await applyCalendar(state);
    expect(cal.cleared).toEqual([]);
    expect(cal.deleted).toEqual(['cal-z']);
    expect(first?.calendarId).toBe('cal-0');
  });

  it('목록을 볼 수 없으면 적어 둔 캘린더가 있을 때 그대로 쓴다', async () => {
    cal.calendars = null;
    const r = await applyCalendar(withEvent('cal-kept'));
    expect(r?.calendarId).toBe('cal-kept');
    expect(cal.made).toBe(0);
  });
});
