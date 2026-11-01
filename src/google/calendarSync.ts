/**
 * 앱의 상담 일정·제출 마감을 구글 캘린더 '학급관리' 에 맞춘다.
 * 이미 넣은 일정은 calendarLinks 에 남겨 두고(기기 간 동기화됨), 바뀐 것만 고친다.
 *
 * 캘린더는 하나만 쓴다: 새로 만들기 전에 이 앱이 만든 '학급관리' 캘린더를 찾아 쓰고, 여럿이면(예전에 기기마다 만든 경우)
 * 하나만 남기고 지운다. 어느 기기든 같은 것을 고르도록 id 가 가장 앞서는 것을 남긴다.
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
  if (!calendarId || !checked.has(calendarId)) {
    const found = await google.findCalendars(CALENDAR_NAME);
    if (found?.length) {
      const keep = found[0];
      for (const extra of found.slice(1)) await google.deleteCalendar(extra);
      if (keep !== calendarId) {
        // 이 기기가 일정을 넣은 캘린더가 아니다 → 들어 있는 사본을 비우고 처음부터 넣는다 (겹치지 않게)
        await google.clearEvents(keep);
        calendarId = keep;
        links = [];
      }
    } else if (!calendarId || found !== null || !(await google.calendarExists(calendarId))) {
      // 앱이 만든 캘린더가 하나도 없다 (목록을 볼 수 없으면 적어 둔 캘린더가 있는지만 본다)
      calendarId = await google.createCalendar(CALENDAR_NAME);
      links = []; // 새 캘린더라 예전 일정은 없다
    }
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
