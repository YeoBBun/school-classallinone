/**
 * 앱의 상담 일정·제출 마감을 구글 캘린더 '학급관리' 에 맞춘다.
 * 이미 넣은 일정은 calendarLinks 에 남겨 두고(기기 간 동기화됨), 바뀐 것만 고친다.
 */
import { desiredEvents, eventHash, isEmptyPlan, planCalendar } from '../domain/calendarEvents';
import { calendarWanted, type AppState, type CalendarLink } from '../domain/types';
import * as google from './google';

export const CALENDAR_NAME = '학급관리';

/** 이번에 켠 동안 있는 것을 확인한 캘린더 (매번 묻지 않는다) */
const checked = new Set<string>();

export interface CalendarResult {
  calendarId: string;
  links: CalendarLink[];
}

/** 할 일이 없으면 null. 일부만 성공해도 성공한 만큼은 돌려준다 (다음 번에 나머지를 한다) */
export async function applyCalendar(s: AppState): Promise<CalendarResult | null> {
  if (!calendarWanted(s.settings) || !google.hasCalendarScope()) return null;
  let calendarId = s.settings.calendarId ?? '';
  let links = s.calendarLinks;
  if (!calendarId || (!checked.has(calendarId) && !(await google.calendarExists(calendarId)))) {
    calendarId = await google.createCalendar(CALENDAR_NAME);
    links = []; // 새 캘린더라 예전 일정은 없다
  }
  checked.add(calendarId);
  const plan = planCalendar(desiredEvents(s), links);
  if (isEmptyPlan(plan) && calendarId === s.settings.calendarId) return null;

  const out = new Map(links.map((l) => [l.id, l]));
  try {
    for (const e of plan.create) {
      const eventId = await google.saveEvent(calendarId, null, e);
      out.set(e.key, { id: e.key, eventId, hash: eventHash(e) });
    }
    for (const { event, link } of plan.update) {
      const eventId = await google.saveEvent(calendarId, link.eventId, event);
      out.set(event.key, { ...link, eventId, hash: eventHash(event) });
    }
    for (const link of plan.remove) {
      await google.deleteEvent(calendarId, link.eventId);
      out.delete(link.id);
    }
  } catch (e) {
    if (out.size === links.length && [...out.values()].every((l, i) => l === links[i])) throw e;
    // 한 일까지는 남긴다
  }
  return { calendarId, links: [...out.values()].sort((a, b) => a.id.localeCompare(b.id)) };
}
