import { indexHolidays } from '../domain/calendar';
import { rebuildDocs } from '../domain/rules';
import { DEFAULT_SETTINGS, emptyState, type AppState, type Settings } from '../domain/types';
import { androidApp, blobBase64 } from '../platform/android';

// 모든 데이터는 이 브라우저의 IndexedDB 에만 저장한다. 외부 서버로 보내지 않는다.
const DB_NAME = 'attendance-app';
const STORE = 'kv';
const KEY = 'state';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadState(): Promise<AppState> {
  const db = await openDb();
  const raw = await new Promise<unknown>((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return raw ? normalize(raw) : emptyState();
}

export async function saveState(state: AppState): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(state, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/** 브라우저가 저장공간 부족 시 데이터를 임의로 지우지 않도록 요청한다. */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

/** 백업 파일이나 이전 버전 데이터를 현재 형식으로 맞춘다. */
export function normalize(raw: unknown): AppState {
  if (!raw || typeof raw !== 'object') throw new Error('올바른 백업 파일이 아닙니다.');
  // 이전 버전 파일도 받으므로 version 은 숫자로 넓혀 읽는다.
  const s = raw as Partial<Omit<AppState, 'version'>> & { version?: number };
  if (![1, 2, 3, 4, 5, 6].includes(s.version ?? 0) ||!Array.isArray(s.students) || !Array.isArray(s.records) || !Array.isArray(s.holidays)) {
    throw new Error('올바른 백업 파일이 아닙니다.');
  }
  const oldSettings = (s.settings ?? {}) as Partial<Settings> & { abroadMaxDays?: number };
  const { abroadMaxDays, ...restSettings } = oldSettings;
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    ...restSettings,
    // v2 까지는 «국외만 1회 연속 N일» 이었다. 지금은 국내·국외 모두에 적용한다.
    tripMaxConsecutiveDays: oldSettings.tripMaxConsecutiveDays ?? abroadMaxDays ?? DEFAULT_SETTINGS.tripMaxConsecutiveDays,
    examPeriods: oldSettings.examPeriods ?? [],
  };
  let records = s.records;
  if ((s.version ?? 0) < 3) {
    // v3 에서 서류 기준을 교내 출결 기준표에 맞췄다 (질병결석 2일 이하/3일 이상, 기타·미인정 서류 등).
    // 받은 상태는 그대로 두고 필수 여부만 기준표 값으로 맞춘다.
    const ctx = { holidays: indexHolidays(s.holidays), exams: settings.examPeriods };
    records = records.map((r) => ({ ...r, docs: rebuildDocs(r.docs, r, ctx, { resetRequired: true }) }));
  } else if ((s.version ?? 0) < 4) {
    // v4: 체험학습 근거자료(보고서에 첨부)와 질병결석 보호자 확인 항목을 없앴다. 서류 목록만 다시 만든다.
    const ctx = { holidays: indexHolidays(s.holidays), exams: settings.examPeriods };
    records = records.map((r) => ({ ...r, docs: rebuildDocs(r.docs, r, ctx) }));
  }
  // v6: 학급관리 — 관찰·상담 기록, 제출물, 필사, 자리, 행발, 캘린더 연결이 생겼다. 이전 파일에는 없다.
  const list = <T,>(x: T[] | undefined): T[] => (Array.isArray(x) ? x : []);
  return {
    version: 6,
    students: s.students,
    records,
    notes: list(s.notes),
    checklists: list(s.checklists),
    pilsa: list(s.pilsa),
    seatPlans: list(s.seatPlans),
    events: list(s.events),
    behavior: list(s.behavior),
    calendarLinks: list(s.calendarLinks),
    todos: list(s.todos),
    holidays: s.holidays,
    settings: { ...settings, seating: { ...DEFAULT_SETTINGS.seating, ...settings.seating } },
    tombstones: s.tombstones ?? {},
  };
}

export function exportBackup(state: AppState): void {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  // 파일 이름은 영문으로 (한글 이름을 무시하는 브라우저가 있다)
  downloadBlob(blob, `attendance_backup_${stamp}.json`);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const app = androidApp();
  if (app) {
    void blobBase64(blob).then((b64) => app.saveFile(filename, blob.type || 'application/octet-stream', b64));
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  // 문서에 붙여서 눌러야 일부 브라우저가 파일 이름을 지킨다. URL 은 다운로드가 시작된 뒤에 해제한다.
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
