/**
 * 기기 간 동기화를 위한 표시(stamp)와 합치기(merge).
 *
 * - 고친 항목에는 updatedAt 을, 지운 항목에는 tombstones 에 지운 시각을 남긴다.
 * - 두 기기의 상태를 합칠 때 같은 항목이면 나중에 고친 쪽을 남기고,
 *   지운 시각이 마지막 수정보다 나중이면 지운 채로 둔다.
 */
import { remapStudents } from '../domain/student';
import type { AppState, Holiday, Stamped } from '../domain/types';

const TOMBSTONE_KEEP_DAYS = 120;

type Keyed = Stamped & object;

const COLLECTIONS = [
  { field: 'records', prefix: 'r:' },
  { field: 'students', prefix: 's:' },
  { field: 'notes', prefix: 'n:' },
  { field: 'checklists', prefix: 'c:' },
  { field: 'pilsa', prefix: 'p:' },
  { field: 'seatPlans', prefix: 'sp:' },
  { field: 'events', prefix: 'e:' },
  { field: 'behavior', prefix: 'b:' },
  { field: 'calendarLinks', prefix: 'cl:' },
  { field: 'todos', prefix: 'td:' },
  { field: 'holidays', prefix: 'h:' },
] as const;

type Field = (typeof COLLECTIONS)[number]['field'];

function keyOf(field: Field, x: unknown): string {
  return field === 'holidays' ? (x as Holiday).date : (x as { id: string }).id;
}

/**
 * prev → next 로 바뀐 항목에 수정 시각을 찍고, 사라진 항목은 지운 것으로 남긴다.
 * 바뀌지 않은 항목은 같은 객체를 그대로 쓰므로 객체가 달라졌으면 바뀐 것으로 본다.
 */
export function stamp(prev: AppState, next: AppState, now = new Date().toISOString()): AppState {
  if (prev === next) return next;
  const tombstones = { ...next.tombstones };
  const out: AppState = { ...next, tombstones };
  for (const { field, prefix } of COLLECTIONS) {
    const before = new Map<string, Keyed>((prev[field] as Keyed[]).map((x) => [keyOf(field, x), x]));
    const after = (next[field] as Keyed[]).map((x) => {
      const k = keyOf(field, x);
      delete tombstones[prefix + k]; // 다시 생긴 항목
      return before.get(k) === x ? x : { ...x, updatedAt: now };
    });
    const alive = new Set((next[field] as Keyed[]).map((x) => keyOf(field, x)));
    for (const k of before.keys()) if (!alive.has(k)) tombstones[prefix + k] = now;
    (out as unknown as Record<string, unknown>)[field] = after;
  }
  if (prev.settings !== next.settings) out.settings = { ...next.settings, updatedAt: now };
  return out;
}

function newer<T extends Stamped>(a: T | undefined, b: T): boolean {
  return !a || (b.updatedAt ?? '') > (a.updatedAt ?? '');
}

/** 두 기기의 상태를 합친다. 순서와 관계없이 같은 결과가 나온다 (local 의 기기 전용 값만 local 것을 쓴다). */
export function mergeStates(local: AppState, remote: AppState, now = new Date()): AppState {
  const cutoff = new Date(now.getTime() - TOMBSTONE_KEEP_DAYS * 86_400_000).toISOString();
  const tombstones: Record<string, string> = {};
  for (const [k, t] of [...Object.entries(remote.tombstones ?? {}), ...Object.entries(local.tombstones ?? {})]) {
    if (t >= cutoff && (!tombstones[k] || t > tombstones[k])) tombstones[k] = t;
  }
  const out = { ...local, tombstones } as AppState;
  for (const { field, prefix } of COLLECTIONS) {
    const map = new Map<string, Keyed>();
    for (const x of [...((remote[field] ?? []) as Keyed[]), ...((local[field] ?? []) as Keyed[])]) {
      const k = keyOf(field, x);
      if (newer(map.get(k), x)) map.set(k, x);
    }
    const merged = [...map.entries()]
      .filter(([k, x]) => !(tombstones[prefix + k] && tombstones[prefix + k] >= (x.updatedAt ?? '')))
      .map(([, x]) => x)
      .sort((a, b) => keyOf(field, a).localeCompare(keyOf(field, b)));
    (out as unknown as Record<string, unknown>)[field] = merged;
  }
  const localWins = newer(remote.settings, local.settings);
  const settings = localWins ? local.settings : remote.settings;
  const other = localWins ? remote.settings : local.settings;
  // 백업 알림은 기기마다 따로 (이 기기에서 백업했는지가 중요하다)
  out.settings = { ...settings, lastBackupAt: local.settings.lastBackupAt, ...mergeCalendar(settings, other) };
  return dedupeStudents(out);
}

/**
 * 구글 캘린더: 다른 설정을 고친 기기가 캘린더 id 를 지우지 않게, 어느 한쪽에라도 있으면 남긴다.
 * 두 기기가 서로 다른 캘린더를 만들었으면 진 쪽을 지울 목록에 넣는다 (calendarSync 가 지운다).
 */
function mergeCalendar(win: AppState['settings'], lose: AppState['settings']): Partial<AppState['settings']> {
  const calendarId = win.calendarId ?? lose.calendarId;
  const retired = new Set([...(win.calendarRetired ?? []), ...(lose.calendarRetired ?? [])]);
  if (lose.calendarId && lose.calendarId !== calendarId) retired.add(lose.calendarId);
  if (calendarId) retired.delete(calendarId);
  return {
    ...(calendarId ? { calendarId } : {}),
    ...(retired.size ? { calendarRetired: [...retired].sort() } : {}),
  };
}

/**
 * 두 기기에서 명단을 따로 등록하면 같은 학생이 다른 id 로 두 번 생긴다.
 * 번호·이름이 같으면 id 가 작은 쪽으로 합치고, 기록도 그 학생으로 옮긴다 (어느 기기에서 해도 같은 결과).
 */
function dedupeStudents(s: AppState): AppState {
  const keep = new Map<string, string>(); // "번호|이름" → 남길 id
  for (const st of [...s.students].sort((a, b) => a.id.localeCompare(b.id))) {
    const k = `${st.number}|${st.name}`;
    if (!keep.has(k)) keep.set(k, st.id);
  }
  const remap = new Map<string, string>();
  for (const st of s.students) {
    const target = keep.get(`${st.number}|${st.name}`)!;
    if (target !== st.id) remap.set(st.id, target);
  }
  return remap.size ? remapStudents(s, remap) : s;
}

/** 비교용: 순서·기기 전용 값과 관계없이 같은 내용이면 같은 문자열 */
export function canonical(s: AppState): string {
  const { lastBackupAt: _ignored, ...settings } = s.settings;
  const out: Record<string, unknown> = { settings, tombstones: Object.fromEntries(Object.entries(s.tombstones ?? {}).sort()) };
  for (const { field } of COLLECTIONS) {
    out[field] = [...((s[field] ?? []) as Keyed[])].sort((a, b) => keyOf(field, a).localeCompare(keyOf(field, b)));
  }
  return JSON.stringify(out);
}
