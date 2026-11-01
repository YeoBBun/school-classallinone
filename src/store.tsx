import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { indexHolidays, today, type HolidayIndex } from './domain/calendar';
import { computeWarnings, type DocContext } from './domain/rules';
import { calendarWanted, type AppState } from './domain/types';
import { androidApp } from './platform/android';
import { loadState, requestPersistence, saveState } from './storage/db';
import { widgetSummary } from './domain/widget';
import { applyCalendar } from './google/calendarSync';
import { googleEmail, onGoogleChange } from './google/google';
import { loadSyncConfig, pushPendingDrive, syncNow } from './sync/cloud';
import { mergeStates, stamp } from './sync/merge';

interface Store {
  state: AppState;
  update: (fn: (s: AppState) => AppState) => void;
  replace: (s: AppState) => void;
  holidays: HolidayIndex;
  /** 서류 규칙(질병결석 일수·시험 기간)에 쓰는 정보 */
  docContext: DocContext;
  warnings: Map<string, string[]>;
  saveError: string | null;
  /** 기록을 바로 지우고, 잠깐 동안 '되돌리기'를 보여준다. label 은 안내에 쓰는 설명 */
  removeRecord: (id: string, label: string) => void;
  /** 어느 목록에서든 항목을 바로 지우고, 잠깐 동안 '되돌리기'를 보여준다 */
  removeItem: (field: UndoField, id: string, label: string, verb?: string) => void;
  /** 관찰·상담 기록을 바로 지우고, 잠깐 동안 '되돌리기'를 보여준다 */
  removeNote: (id: string, label: string) => void;
  /** 휴대폰 ↔ PC 동기화 상태 */
  sync: SyncStatus;
  /** 지금 바로 맞추기 (설정을 바꾼 뒤 등) */
  syncNow: () => void;
  /** 휴대폰 위젯용 처리 예정 요약을 올린 결과 */
  widgetSync: WidgetSyncStatus;
  /** 구글 캘린더에 일정을 맞춘 결과 */
  calendar: WidgetSyncStatus;
}

export type WidgetSyncStatus = { kind: 'none' } | { kind: 'ok'; at: string } | { kind: 'error'; message: string };

export type SyncStatus =
  | { kind: 'off' }
  | { kind: 'syncing'; at?: string }
  | { kind: 'ok'; at: string }
  | { kind: 'error'; message: string; at?: string };

const SYNC_DEBOUNCE_MS = 4000;
const SYNC_INTERVAL_MS = 60_000;

/** 지우고 되돌릴 수 있는 목록 */
export type UndoField = 'records' | 'notes' | 'checklists' | 'pilsa' | 'seatPlans' | 'events' | 'todos';

interface Undo {
  field: UndoField;
  item: { id: string };
  index: number;
  label: string;
  /** 알림 문구 끝. 기본 '삭제했어요' */
  verb: string;
}

const UNDO_MS = 8000;

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const loaded = useRef(false);
  const stateRef = useRef<AppState | null>(null);
  stateRef.current = state;
  const [undo, setUndo] = useState<Undo | null>(null);
  // 이 기기에서 고친 횟수 — 바뀔 때마다 잠시 뒤 동기화한다 (다른 기기에서 받은 변경은 세지 않는다)
  const [localEdits, setLocalEdits] = useState(0);

  /** 이 기기에서 고친 것: 바뀐 항목에 시각을 찍고, 지운 항목을 남긴다 (동기화용). */
  const commit = useCallback((fn: (s: AppState) => AppState) => {
    setState((s) => (s ? stamp(s, fn(s)) : s));
    setLocalEdits((n) => n + 1);
  }, []);

  const removeItem = useCallback(
    (field: UndoField, id: string, label: string, verb = '삭제했어요') => {
      const s = stateRef.current;
      const list = (s?.[field] ?? []) as { id: string }[];
      const index = list.findIndex((x) => x.id === id);
      if (!s || index < 0) return;
      commit((cur) => ({ ...cur, [field]: (cur[field] as { id: string }[]).filter((x) => x.id !== id) }));
      setUndo({ field, item: list[index], index, label, verb });
    },
    [commit],
  );
  const removeRecord = useCallback((id: string, label: string) => removeItem('records', id, label), [removeItem]);
  const removeNote = useCallback((id: string, label: string) => removeItem('notes', id, label), [removeItem]);

  const restore = () => {
    if (!undo) return;
    const { field, item, index } = undo;
    commit((s) => {
      const list = s[field] as { id: string }[];
      return list.some((x) => x.id === item.id) ? s : { ...s, [field]: [...list.slice(0, index), item, ...list.slice(index)] };
    });
    setUndo(null);
  };

  // ─── 휴대폰 ↔ PC 동기화 ───
  const [sync, setSync] = useState<SyncStatus>(() => (loadSyncConfig() ? { kind: 'syncing' } : { kind: 'off' }));
  const syncing = useRef(false);
  const again = useRef(false);
  const [widgetSync, setWidgetSync] = useState<WidgetSyncStatus>({ kind: 'none' });

  // ─── 구글 캘린더 ───
  const [calendar, setCalendar] = useState<WidgetSyncStatus>({ kind: 'none' });
  const calBusy = useRef(false);
  const runCalendar = useCallback(async () => {
    const s = stateRef.current;
    if (!s || !calendarWanted(s.settings) || calBusy.current) return;
    calBusy.current = true;
    try {
      const r = await applyCalendar(s);
      if (r) {
        commit((cur) => ({
          ...cur,
          calendarLinks: r.links,
          settings: r.calendarId !== cur.settings.calendarId ? { ...cur.settings, calendarId: r.calendarId } : cur.settings,
        }));
      }
      setCalendar({ kind: 'ok', at: new Date().toISOString() });
    } catch (e) {
      setCalendar({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      calBusy.current = false;
    }
  }, [commit]);

  const runSync = useCallback(async () => {
    const cfg = loadSyncConfig();
    // 휴대폰 '학급관리' 앱 안이면 위젯도 같은 설정(구글 계정·잠금 비밀번호)을 쓰게 넘긴다 (바뀌었을 때만 앱이 반영)
    androidApp()?.setSyncConfig?.(cfg ? JSON.stringify({ ...cfg, email: googleEmail() }) : '');
    if (!cfg) {
      setSync({ kind: 'off' });
      return runCalendar();
    }
    if (syncing.current) {
      again.current = true;
      return;
    }
    const base = stateRef.current;
    if (!base) return;
    syncing.current = true;
    setSync((s) => ({ kind: 'syncing', at: 'at' in s ? s.at : undefined }));
    try {
      const merged = await syncNow(cfg, base);
      if (merged !== base) {
        // 받는 동안 이 기기에서 또 고쳤으면 그것까지 합치고 다시 올린다
        setState((cur) => (!cur || cur === base ? merged : mergeStates(cur, merged)));
      }
      if (stateRef.current !== base) again.current = true;
      setSync({ kind: 'ok', at: new Date().toISOString() });
      // 다른 기기가 넣은 일정까지 받은 뒤에 캘린더를 맞춘다 (같은 일정을 두 번 넣지 않게)
      setTimeout(() => void runCalendar(), 300);
      // 휴대폰 위젯용 요약 — 실패해도 출결 동기화는 된 것이라 다음 동기화 때 다시 올린다
      const summary = widgetSummary(merged, indexHolidays(merged.holidays), today());
      pushPendingDrive(cfg, summary)
        .then(() => setWidgetSync({ kind: 'ok', at: new Date().toISOString() }))
        .catch((e) => setWidgetSync({ kind: 'error', message: e instanceof Error ? e.message : String(e) }));
    } catch (e) {
      setSync((s) => ({ kind: 'error', message: e instanceof Error ? e.message : String(e), at: 'at' in s ? s.at : undefined }));
    } finally {
      syncing.current = false;
      if (again.current) {
        again.current = false;
        setTimeout(() => void runSync(), 500);
      }
    }
  }, [runCalendar]);

  // 구글에 (다시) 연결되면 바로 맞춘다
  useEffect(() => onGoogleChange(() => void runSync()), [runSync]);

  // 이 기기에서 고치면 잠시 뒤 올린다
  useEffect(() => {
    if (!localEdits) return;
    const t = setTimeout(() => void runSync(), SYNC_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [localEdits, runSync]);

  // 앱을 열 때, 다시 볼 때, 켜 둔 동안 1분마다 받는다
  useEffect(() => {
    if (!state) return;
    void runSync();
    const onVisible = () => document.visibilityState === 'visible' && void runSync();
    document.addEventListener('visibilitychange', onVisible);
    const t = setInterval(() => document.visibilityState === 'visible' && void runSync(), SYNC_INTERVAL_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(t);
    };
    // 처음 불러온 뒤 한 번만 건다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!state, runSync]);

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(t);
  }, [undo]);

  useEffect(() => {
    loadState()
      .then((s) => {
        loaded.current = true;
        setState(s);
      })
      .catch((e) => setLoadError(String(e)));
    void requestPersistence();
  }, []);

  useEffect(() => {
    if (!state || !loaded.current) return;
    saveState(state)
      .then(() => setSaveError(null))
      .catch((e) => setSaveError(`저장 실패: ${e}`));
  }, [state]);

  const update = commit;
  // 백업 불러오기·전체 삭제: 통째로 바꾼다. 다른 기기에도 그대로 퍼진다 (없어진 항목은 지운 것으로).
  const replace = useCallback((next: AppState) => commit(() => next), [commit]);

  const holidays = useMemo(() => indexHolidays(state?.holidays ?? []), [state?.holidays]);
  const docContext = useMemo(
    () => ({ holidays, exams: state?.settings.examPeriods ?? [] }),
    [holidays, state?.settings.examPeriods],
  );
  const warnings = useMemo(
    () =>
      state
        ? computeWarnings({ records: state.records, holidays, settings: state.settings, today: today() })
        : new Map<string, string[]>(),
    [state, holidays],
  );

  if (loadError) return <div className="fatal">데이터를 불러오지 못했습니다: {loadError}</div>;
  if (!state) return <div className="fatal">불러오는 중…</div>;

  return (
    <StoreContext.Provider value={{ state, update, replace, holidays, docContext, warnings, saveError, removeRecord, removeNote, removeItem, sync, syncNow: () => void runSync(), widgetSync, calendar }}>
      {children}
      {undo && (
        <div className="toast" role="status">
          <span>
            {undo.label} {undo.verb}
          </span>
          <button onClick={restore}>되돌리기</button>
        </div>
      )}
    </StoreContext.Provider>
  );
}

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error('StoreProvider 밖에서 사용됨');
  return s;
}

export function newId(): string {
  // randomUUID 는 https/localhost 에서만 있으므로 대체 경로를 둔다.
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const BACKUP_REMIND_DAYS = 7;

/** 기록이 있는데 마지막 백업 후 BACKUP_REMIND_DAYS 일이 지났는가 */
export function useNeedBackup(): boolean {
  const { state } = useStore();
  const last = state.settings.lastBackupAt ? Date.parse(state.settings.lastBackupAt) : 0;
  return state.records.length + state.notes.length > 0 && Date.now() - last > BACKUP_REMIND_DAYS * 86_400_000;
}
