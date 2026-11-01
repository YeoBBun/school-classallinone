/**
 * 앱의 상담 일정·제출 마감을 구글 캘린더 '학급관리' 에 맞춘다.
 * 이미 넣은 일정은 calendarLinks 에 남겨 두고(기기 간 동기화됨), 바뀐 것만 고친다.
 *
 * 캘린더는 하나만 쓴다.
 * - 적어 둔 캘린더(settings.calendarId)가 아직 있으면 그대로 쓴다. 없을 때만 앱이 만든 것을 찾아 쓰거나 새로 만든다.
 * - 기기마다 따로 만들어 남은 캘린더는 settings.calendarRetired 에 모아(기기 간 합쳐짐) 지운다.
 *   (calendar.app.created 권한으로는 앱이 만든 캘린더 목록이 비어 오기도 해서, 목록에만 기대지 않는다)
 * - 일정마다 어느 캘린더에 넣었는지(cal) 적어 두어, 캘린더가 바뀌면 새 캘린더에 다시 넣는다.
 */
import { desiredEvents, eventHash, isEmptyPlan, planCalendar } from '../domain/calendarEvents';
import { calendarWanted, type AppState, type CalendarLink } from '../domain/types';
import * as google from './google';

export const CALENDAR_NAME = '학급관리';

/** 이번에 켠 동안 있는 것을 확인한 캘린더 (매번 묻지 않는다) */
const checked = new Set<string>();
/** 이번에 켠 동안 이미 지운 캘린더 */
const deleted = new Set<string>();

export interface CalendarResult {
  calendarId: string;
  /** 지울(지운) 캘린더 */
  retired: string[];
  links: CalendarLink[];
}

/** 할 일이 없으면 null. 일부만 성공해도 성공한 만큼은 돌려준다 (다음 번에 나머지를 한다) */
export async function applyCalendar(s: AppState): Promise<CalendarResult | null> {
  if (!calendarWanted(s.settings) || !google.hasCalendarScope()) return null;
  let calendarId = s.settings.calendarId ?? '';
  const retired = new Set(s.settings.calendarRetired ?? []);
  let links = s.calendarLinks;
  if (!calendarId || !checked.has(calendarId)) {
    const found = (await google.findCalendars(CALENDAR_NAME)) ?? [];
    const alive = !!calendarId && !retired.has(calendarId) && (found.includes(calendarId) || (await google.calendarExists(calendarId)));
    if (!alive) {
      if (calendarId) retired.add(calendarId);
      const reuse = found.find((id) => !retired.has(id));
      if (reuse) await google.clearEvents(reuse); // 이 기기가 넣은 캘린더가 아니다 → 비우고 처음부터 (겹치지 않게)
      calendarId = reuse ?? (await google.createCalendar(CALENDAR_NAME));
      links = [];
    }
    for (const id of found) if (id !== calendarId) retired.add(id);
    for (const id of retired) {
      if (id === calendarId || deleted.has(id)) continue;
      await google.deleteCalendar(id);
      deleted.add(id);
    }
  }
  checked.add(calendarId);
  // 다른 캘린더에 넣었던 일정은 없는 것으로 (새 캘린더에 다시 넣는다). 예전 기록(cal 없음)은 지금 캘린더 것으로 본다
  links = links.filter((l) => (l.cal ?? calendarId) === calendarId);
  const retiredList = [...retired].filter((id) => id !== calendarId).sort();
  const plan = planCalendar(desiredEvents(s), links);
  const sameRetired = retiredList.join() === [...(s.settings.calendarRetired ?? [])].sort().join();
  if (isEmptyPlan(plan) && calendarId === s.settings.calendarId && sameRetired && links.length === s.calendarLinks.length) return null;

  const out = new Map(links.map((l) => [l.id, l]));
  try {
    for (const e of plan.create) {
      const eventId = await google.saveEvent(calendarId, null, e);
      out.set(e.key, { id: e.key, eventId, hash: eventHash(e), cal: calendarId });
    }
    for (const { event, link } of plan.update) {
      const eventId = await google.saveEvent(calendarId, link.eventId, event);
      out.set(event.key, { ...link, eventId, hash: eventHash(event), cal: calendarId });
    }
    for (const link of plan.remove) {
      await google.deleteEvent(calendarId, link.eventId);
      out.delete(link.id);
    }
  } catch (e) {
    if (out.size === links.length && [...out.values()].every((l, i) => l === links[i]) && calendarId === s.settings.calendarId) throw e;
    // 한 일까지는 남긴다
  }
  return { calendarId, retired: retiredList, links: [...out.values()].sort((a, b) => a.id.localeCompare(b.id)) };
}
