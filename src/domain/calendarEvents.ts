/**
 * 구글 캘린더에 넣을 일정 계산 (상담 일정, 제출 마감).
 * 앱 상태에서 «있어야 할 일정» 을 만들고, 이미 넣은 일정(calendarLinks)과 비교해 할 일을 정한다.
 */
import type { AppState, CalendarLink, DateStr } from './types';

export interface DesiredEvent {
  /** 'note:기록id' / 'due:제출물id' */
  key: string;
  summary: string;
  date: DateStr;
  /** 'HH:MM' — 없으면 하루 종일 */
  time?: string;
  description: string;
}

/** 상담 시간 기본 길이 (분) */
export const CONSULT_MINUTES = 30;

export function desiredEvents(s: AppState): DesiredEvent[] {
  const name = (id: string) => {
    const st = s.students.find((x) => x.id === id);
    return st ? `${st.number}번 ${st.name}` : '';
  };
  const out: DesiredEvent[] = [];
  for (const n of s.notes) {
    if (!n.planned || n.kind !== '학부모상담') continue;
    const who = n.studentIds.map(name).filter(Boolean).join(', ');
    const how = [n.parentWho, n.parentMethod].filter(Boolean).join(' · ');
    out.push({
      key: `note:${n.id}`,
      summary: `학부모 상담: ${who}${how ? ` (${how})` : ''}`,
      date: n.date,
      time: n.time,
      // 상담 내용은 캘린더에 넣지 않는다 (학급관리 앱에만)
      description: '학급관리 앱에서 넣은 일정',
    });
  }
  for (const c of s.checklists) {
    if (c.closed || !c.dueDate) continue;
    out.push({ key: `due:${c.id}`, summary: `제출 마감: ${c.title}`, date: c.dueDate, description: '학급관리 앱에서 넣은 일정' });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

export function eventHash(e: DesiredEvent): string {
  return JSON.stringify([e.summary, e.date, e.time ?? '', e.description]);
}

export interface CalendarPlan {
  create: DesiredEvent[];
  update: { event: DesiredEvent; link: CalendarLink }[];
  remove: CalendarLink[];
}

export function planCalendar(desired: DesiredEvent[], links: CalendarLink[]): CalendarPlan {
  const byKey = new Map(links.map((l) => [l.id, l]));
  const want = new Set(desired.map((d) => d.key));
  const plan: CalendarPlan = { create: [], update: [], remove: [] };
  for (const d of desired) {
    const link = byKey.get(d.key);
    if (!link) plan.create.push(d);
    else if (link.hash !== eventHash(d)) plan.update.push({ event: d, link });
  }
  for (const l of links) if (!want.has(l.id)) plan.remove.push(l);
  return plan;
}

export function isEmptyPlan(p: CalendarPlan): boolean {
  return !p.create.length && !p.update.length && !p.remove.length;
}
