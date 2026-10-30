import type { DateStr, Holiday } from './types';

// 시간대 문제를 피하려고 날짜 계산은 전부 UTC 자정 기준 Date 로 한다.
export function parseDate(d: DateStr): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

export function formatDate(dt: Date): DateStr {
  return dt.toISOString().slice(0, 10);
}

export function addDays(d: DateStr, n: number): DateStr {
  const dt = parseDate(d);
  dt.setUTCDate(dt.getUTCDate() + n);
  return formatDate(dt);
}

/** 0 = 일요일 … 6 = 토요일 */
export function dayOfWeek(d: DateStr): number {
  return parseDate(d).getUTCDay();
}

export function isWeekend(d: DateStr): boolean {
  const w = dayOfWeek(d);
  return w === 0 || w === 6;
}

/** 브라우저 현지 시간 기준 오늘 */
export function today(): DateStr {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${day}`;
}

export function eachDay(start: DateStr, end: DateStr): DateStr[] {
  const days: DateStr[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  return days;
}

export type HolidayIndex = Map<DateStr, Holiday>;

export function indexHolidays(holidays: Holiday[]): HolidayIndex {
  return new Map(holidays.map((h) => [h.date, h]));
}

/** 수업일 = 토·일요일, 공휴일, 재량휴업일이 아닌 날 */
export function isSchoolDay(d: DateStr, holidays: HolidayIndex): boolean {
  return !isWeekend(d) && !holidays.has(d);
}

export function countSchoolDays(start: DateStr, end: DateStr, holidays: HolidayIndex): number {
  return eachDay(start, end).filter((d) => isSchoolDay(d, holidays)).length;
}

/** d 에서 수업일 기준으로 n 일 이동 (n < 0 이면 이전). d 자신은 세지 않는다. */
export function addSchoolDays(d: DateStr, n: number, holidays: HolidayIndex): DateStr {
  const step = n < 0 ? -1 : 1;
  let remaining = Math.abs(n);
  let cur = d;
  while (remaining > 0) {
    cur = addDays(cur, step);
    if (isSchoolDay(cur, holidays)) remaining--;
  }
  return cur;
}

/** 학년도: 3월 1일 ~ 다음 해 2월 말 */
export function schoolYearOf(d: DateStr): number {
  const [y, m] = d.split('-').map(Number);
  return m >= 3 ? y : y - 1;
}

export function schoolYearRange(year: number): [DateStr, DateStr] {
  return [`${year}-03-01`, addDays(`${year + 1}-03-01`, -1)];
}

export function monthKey(d: DateStr): string {
  return d.slice(0, 7);
}

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

export function formatKo(d: DateStr): string {
  const [, m, day] = d.split('-').map(Number);
  return `${m}/${day}(${WEEKDAY_KO[dayOfWeek(d)]})`;
}

/** 저장 시각(ISO)을 이 기기 시간으로: 2026.10.30 14:32 */
export function formatStamp(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getFullYear()}.${p(t.getMonth() + 1)}.${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`;
}

export function rangesOverlap(aStart: DateStr, aEnd: DateStr, bStart: DateStr, bEnd: DateStr): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}
