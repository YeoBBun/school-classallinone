/**
 * 구글 로그인(Google Identity Services)과 드라이브·캘린더 API.
 *
 * 권한은 좁게: drive.file (이 앱이 만든 파일·폴더만), calendar.app.created (이 앱이 만든 캘린더와 그 일정만).
 * 서버 없이 브라우저에서 바로 부르므로 로그인은 1시간쯤 뒤 끝나고, 그때는 [다시 연결]을 눌러야 한다.
 * 휴대폰 '학급관리' 앱 안에서는 구글이 웹 화면 로그인을 막아서 휴대폰의 구글 로그인을 쓴다 — 끝나면 앱이 조용히 새로 받아 준다.
 */
import { GOOGLE_CLIENT_ID } from './config';

const SCOPE_DRIVE = 'https://www.googleapis.com/auth/drive.file';
const SCOPE_CAL = 'https://www.googleapis.com/auth/calendar.app.created';
const SCOPES = `${SCOPE_DRIVE} ${SCOPE_CAL} email`;
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const CAL = 'https://www.googleapis.com/calendar/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const TOKEN_KEY = 'class-google-token';
/** 내 드라이브에 만드는 폴더 */
export const ROOT_FOLDER = '학급관리';

export const isConfigured = /\.apps\.googleusercontent\.com$/.test(GOOGLE_CLIENT_ID.trim());

export class AuthError extends Error {
  constructor(message = '구글 연결이 끝났어요. [다시 연결]을 눌러 주세요.') {
    super(message);
  }
}

export class GoogleError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

interface Token {
  access_token: string;
  expires_at: number;
  scope: string;
  email?: string;
}

let token: Token | null = null;
const listeners = new Set<() => void>();

function changed() {
  for (const fn of listeners) fn();
}

/** 연결 상태가 바뀌면 부른다. 해제 함수를 돌려준다 */
export function onGoogleChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function saveToken() {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 저장 공간을 못 쓰는 환경 */
  }
  changed();
}

// ─── 휴대폰 '학급관리' 앱 안 (android-widget/ 의 WebAppActivity 와 짝) ───

interface NativeGoogle {
  /** 계정 고르기·권한 창을 띄워 로그인 */
  googleSignIn(): void;
  /** 창 없이 새 토큰 (이미 허락했으면) */
  googleToken(): void;
  googleSignOut(): void;
}

function nativeGoogle(): NativeGoogle | undefined {
  const app = (globalThis as unknown as { ClassApp?: Partial<NativeGoogle> }).ClassApp;
  return typeof app?.googleToken === 'function' ? (app as NativeGoogle) : undefined;
}

/** 휴대폰 앱 안이라 로그인이 끝나도 [다시 연결] 없이 이어지는가 */
export const isNativeGoogle = () => !!nativeGoogle();

let nativeWaiters: { resolve: () => void; reject: (e: Error) => void }[] = [];

// 앱이 결과를 넣어 준다: {access_token, scope, expires_in} 또는 {error}
(globalThis as unknown as { classAppGoogle?: (json: string) => void }).classAppGoogle = (json) => {
  const r = JSON.parse(json) as { access_token?: string; scope?: string; expires_in?: number; error?: string };
  const waiting = nativeWaiters;
  nativeWaiters = [];
  if (!r.access_token) return waiting.forEach((w) => w.reject(r.error === 'needs_signin' ? new AuthError('구글 로그인이 필요해요.') : new Error(r.error || '구글 로그인에 실패했어요.')));
  token = { access_token: r.access_token, expires_at: Date.now() + (r.expires_in ?? 3000) * 1000, scope: r.scope ?? '', email: token?.email };
  saveToken();
  waiting.forEach((w) => w.resolve());
};

/** 앱에 로그인·토큰을 부탁하고 기다린다. 이미 부탁해 둔 것이 있으면 같이 기다린다 */
function nativeRequest(kind: 'signIn' | 'token'): Promise<void> {
  return new Promise((resolve, reject) => {
    const first = nativeWaiters.length === 0;
    nativeWaiters.push({ resolve, reject });
    if (first || kind === 'signIn') {
      const n = nativeGoogle()!;
      if (kind === 'signIn') n.googleSignIn();
      else n.googleToken();
    }
  });
}

// 남은 토큰부터 읽어 둔다 (스크립트를 못 받아도 드라이브는 쓸 수 있게). 앱 안에서는 끝난 토큰도 권한·이메일 표시용으로 둔다
try {
  const t = JSON.parse(localStorage.getItem(TOKEN_KEY) ?? 'null') as Token | null;
  if (t && (t.expires_at > Date.now() + 60_000 || nativeGoogle())) token = t;
} catch {
  /* 무시 */
}

/** 지금 바로 쓸 수 있는 토큰이 있는가 */
const fresh = () => !!token && token.expires_at > Date.now() + 30_000;
/** 연결되어 있는가. 앱 안에서는 한 번 로그인했으면 계속 (토큰은 필요할 때 앱이 새로 준다) */
export const hasToken = () => fresh() || (!!nativeGoogle() && !!token);
export const hasCalendarScope = () => hasToken() && !!token?.scope.includes(SCOPE_CAL);
export const googleEmail = () => token?.email ?? '';

/** 한 번이라도 연결한 적 있는가 (끝난 연결 포함) — «다시 연결» 안내에 쓴다 */
export function wasConnected(): boolean {
  try {
    return !!localStorage.getItem(TOKEN_KEY);
  } catch {
    return false;
  }
}

interface GsiTokenResponse {
  access_token: string;
  expires_in: string | number;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface Gsi {
  accounts: {
    oauth2: {
      initTokenClient(cfg: {
        client_id: string;
        scope: string;
        prompt: string;
        include_granted_scopes: boolean;
        callback: (r: GsiTokenResponse) => void;
        error_callback: (e: { type?: string; message?: string }) => void;
      }): { requestAccessToken(): void };
      hasGrantedAllScopes(r: GsiTokenResponse, scope: string): boolean;
      revoke(token: string, done: () => void): void;
    };
  };
}

const gsi = () => (window as unknown as { google?: Gsi }).google;

function loadScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (gsi()?.accounts?.oauth2) return resolve();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('구글 로그인 창을 불러오지 못했어요. 인터넷 연결이나 학교망 차단을 확인해 주세요.'));
    document.head.append(s);
  });
}

/** 미리 불러 두면 버튼을 눌렀을 때 팝업이 막히지 않는다 */
export function preloadGoogle(): void {
  if (isConfigured) void loadScript().catch(() => {});
}

/** 반드시 버튼 클릭 안에서 부른다 (팝업 차단) */
export async function signIn(): Promise<void> {
  if (nativeGoogle()) {
    await nativeRequest('signIn');
    return afterSignIn();
  }
  await loadScript();
  const g = gsi()!;
  await new Promise<void>((resolve, reject) => {
    const client = g.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID.trim(),
      scope: SCOPES,
      prompt: '',
      include_granted_scopes: true,
      callback: (r) => {
        if (r.error) return reject(new Error(r.error_description || r.error));
        if (!g.accounts.oauth2.hasGrantedAllScopes(r, SCOPE_DRIVE)) {
          return reject(new Error("구글 드라이브 권한이 필요해요. 로그인 창에서 '드라이브' 항목에 체크해 주세요."));
        }
        token = { access_token: r.access_token, expires_at: Date.now() + Number(r.expires_in) * 1000, scope: r.scope ?? '', email: token?.email };
        resolve();
      },
      error_callback: (e) =>
        reject(
          new Error(
            e?.type === 'popup_closed'
              ? '로그인 창이 닫혔어요.'
              : e?.type === 'popup_failed_to_open'
                ? '팝업이 막혔어요. 브라우저 주소창 옆에서 팝업을 허용해 주세요.'
                : e?.message || '구글 로그인에 실패했어요.',
          ),
        ),
    });
    client.requestAccessToken();
  });
  return afterSignIn();
}

async function afterSignIn(): Promise<void> {
  try {
    const r = await api('https://www.googleapis.com/oauth2/v3/userinfo');
    token!.email = ((await r.json()) as { email?: string }).email ?? '';
  } catch {
    /* 이메일은 표시용이라 없어도 된다 */
  }
  saveToken();
}

export function signOut(): void {
  nativeGoogle()?.googleSignOut();
  if (token && !nativeGoogle()) {
    try {
      gsi()?.accounts.oauth2.revoke(token.access_token, () => {});
    } catch {
      /* 무시 */
    }
  }
  token = null;
  try {
    localStorage.removeItem(FOLDER_KEY);
    localStorage.removeItem(FILES_FOLDER_KEY);
  } catch {
    /* 무시 */
  }
  saveToken();
}

async function api(url: string, init: RequestInit = {}, retried = false): Promise<Response> {
  if (!fresh()) {
    if (!nativeGoogle() || !token) throw new AuthError();
    await nativeRequest('token');
  }
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token!.access_token}`, ...(init.headers ?? {}) }, cache: 'no-store' });
  if (res.status === 401 && nativeGoogle() && !retried) {
    token = { ...token!, expires_at: 0 };
    return api(url, init, true);
  }
  if (res.status === 401) {
    token = { ...token!, expires_at: 0 };
    saveToken();
    throw new AuthError();
  }
  if (!res.ok) {
    let msg = `구글 ${url.startsWith(CAL) ? '캘린더' : '드라이브'} 오류 (${res.status})`;
    try {
      msg = ((await res.json()) as { error?: { message?: string } }).error?.message || msg;
    } catch {
      /* 무시 */
    }
    throw new GoogleError(msg, res.status);
  }
  return res;
}

// ─── 드라이브 ───

const FOLDER_KEY = 'class-google-folder';
const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

async function findOne(query: string): Promise<{ id: string; version: string } | null> {
  const r = await api(`${DRIVE}/files?q=${encodeURIComponent(query)}&fields=files(id,version)&spaces=drive&pageSize=5&orderBy=createdTime`);
  return ((await r.json()) as { files: { id: string; version: string }[] }).files[0] ?? null;
}

/** 이 기기에서 쓰던 폴더 id → 이번에 열고 나서 휴지통에 없는 것을 확인했는가 */
const checked = new Set<string>();
/** 지금 찾고 있는 폴더 (저장 키별) — 여러 곳에서 동시에 불러도 한 번만 찾고 만든다 */
const pending = new Map<string, Promise<string>>();

function readKey(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** 아직 쓸 수 있는 폴더인가 (지워졌거나 휴지통이면 아니다). 한 번 확인하면 다시 묻지 않는다 */
async function alive(id: string): Promise<boolean> {
  if (checked.has(id)) return true;
  try {
    const r = await api(`${DRIVE}/files/${id}?fields=trashed`);
    if (((await r.json()) as { trashed?: boolean }).trashed) return false;
  } catch (e) {
    if (e instanceof GoogleError && e.status === 404) return false;
    throw e;
  }
  checked.add(id);
  return true;
}

async function hasChildren(id: string): Promise<boolean> {
  const r = await api(`${DRIVE}/files?q=${encodeURIComponent(`'${q(id)}' in parents and trashed=false`)}&fields=files(id)&pageSize=1`);
  return ((await r.json()) as { files: unknown[] }).files.length > 0;
}

async function findOrMakeFolder(key: string, name: string, parentId?: string): Promise<string> {
  const cached = readKey(key);
  if (cached && (await alive(cached))) return cached;
  const where = `name='${q(name)}' and mimeType='${FOLDER_MIME}' and trashed=false${parentId ? ` and '${q(parentId)}' in parents` : ''}`;
  const r = await api(`${DRIVE}/files?q=${encodeURIComponent(where)}&fields=files(id)&spaces=drive&pageSize=10&orderBy=createdTime`);
  const found = ((await r.json()) as { files: { id: string }[] }).files;
  let id = found[0]?.id;
  // 같은 이름이 여럿이면 (예전에 두 곳에서 동시에 만든 경우) 안에 뭔가 든 쪽을 쓴다
  if (found.length > 1) {
    for (const f of found) {
      if (await hasChildren(f.id)) {
        id = f.id;
        break;
      }
    }
  }
  if (!id) {
    const made = await api(`${DRIVE}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}) }),
    });
    id = ((await made.json()) as { id: string }).id;
  }
  checked.add(id);
  try {
    localStorage.setItem(key, id);
  } catch {
    /* 무시 */
  }
  return id;
}

/** 폴더 찾기 (없으면 만든다). 동시에 여러 번 불러도 같은 약속을 돌려준다 */
function folder(key: string, name: string, parent?: () => Promise<string>): Promise<string> {
  let p = pending.get(key);
  if (!p) {
    p = (async () => findOrMakeFolder(key, name, parent && (await parent())))().finally(() => pending.delete(key));
    pending.set(key, p);
  }
  return p;
}

/** 내 드라이브의 '학급관리' 폴더 (없으면 만든다) */
export function rootFolder(): Promise<string> {
  return folder(FOLDER_KEY, ROOT_FOLDER);
}

export async function findFile(name: string, parentId: string) {
  return findOne(`name='${q(name)}' and '${q(parentId)}' in parents and trashed=false`);
}

export async function fileVersion(fileId: string): Promise<string> {
  const r = await api(`${DRIVE}/files/${fileId}?fields=version,trashed`);
  return ((await r.json()) as { version: string }).version;
}

export async function readJson(fileId: string): Promise<unknown> {
  return (await api(`${DRIVE}/files/${fileId}?alt=media`)).json();
}

function multipart(meta: object, body: Blob | string, type: string): { headers: Record<string, string>; body: Blob } {
  const boundary = `class${Math.random().toString(36).slice(2)}`;
  return {
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
      `--${boundary}\r\nContent-Type: ${type}\r\n\r\n`,
      body,
      `\r\n--${boundary}--`,
    ]),
  };
}

/** JSON 파일 만들기(fileId 없음) 또는 덮어쓰기 */
export async function writeJson(opts: { fileId?: string; name: string; parentId: string; data: unknown }): Promise<{ id: string; version: string }> {
  const meta = opts.fileId ? {} : { name: opts.name, parents: [opts.parentId], mimeType: 'application/json' };
  const part = multipart(meta, JSON.stringify(opts.data), 'application/json; charset=UTF-8');
  const url = opts.fileId ? `${UPLOAD}/files/${opts.fileId}?uploadType=multipart&fields=id,version` : `${UPLOAD}/files?uploadType=multipart&fields=id,version`;
  const r = await api(url, { method: opts.fileId ? 'PATCH' : 'POST', ...part });
  return (await r.json()) as { id: string; version: string };
}

/** 표(행 배열)를 구글 시트로 만들고 주소를 돌려준다 */
export async function createSheet(title: string, rows: string[][]): Promise<string> {
  const csv = '﻿' + rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n');
  const meta = { name: title, parents: [await rootFolder()], mimeType: 'application/vnd.google-apps.spreadsheet' };
  const part = multipart(meta, csv, 'text/csv; charset=UTF-8');
  const r = await api(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', ...part });
  const { id } = (await r.json()) as { id: string };
  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
}

// ─── 자료 (드라이브 '학급관리/자료' 폴더) ───

/** 자료를 올리는 폴더 이름 ('학급관리' 폴더 안) */
export const FILES_FOLDER = '자료';
const FILES_FOLDER_KEY = 'class-google-files-folder';
const FILE_FIELDS = 'id,name,mimeType,size,modifiedTime,webViewLink';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  /** 바이트 (구글 문서·시트에는 없다) */
  size?: string;
  modifiedTime: string;
  webViewLink: string;
}

/** '학급관리/자료' 폴더 (없거나 휴지통에 있으면 새로 만든다) */
export function filesFolder(): Promise<string> {
  return folder(FILES_FOLDER_KEY, FILES_FOLDER, rootFolder);
}

/** 폴더 안 파일 (최근에 고친 것부터). drive.file 권한이라 이 앱으로 올린 파일만 보인다 */
export async function listFiles(folderId: string): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let page = '';
  do {
    const query = encodeURIComponent(`'${q(folderId)}' in parents and trashed=false and mimeType!='${FOLDER_MIME}'`);
    const r = await api(
      `${DRIVE}/files?q=${query}&fields=nextPageToken,files(${FILE_FIELDS})&orderBy=modifiedTime desc&pageSize=200${page ? `&pageToken=${page}` : ''}`,
    );
    const j = (await r.json()) as { files: DriveFile[]; nextPageToken?: string };
    out.push(...j.files);
    page = j.nextPageToken ?? '';
  } while (page);
  return out;
}

/** 파일 하나 올리기. 이어 올리기(resumable) 주소를 받아 한 번에 보낸다 — 큰 파일도 된다 */
export async function uploadFile(folderId: string, file: File): Promise<DriveFile> {
  const type = file.type || 'application/octet-stream';
  const start = await api(`${UPLOAD}/files?uploadType=resumable&fields=${FILE_FIELDS}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': type },
    body: JSON.stringify({ name: file.name, parents: [folderId] }),
  });
  const location = start.headers.get('Location');
  if (!location) {
    // 주소를 못 읽는 환경이면 작은 파일은 한 번에 올린다
    if (file.size > 5 * 1024 * 1024) throw new GoogleError('큰 파일을 올리지 못했어요. 구글 드라이브에서 직접 올려 주세요.', 0);
    const part = multipart({ name: file.name, parents: [folderId] }, file, type);
    return (await (await api(`${UPLOAD}/files?uploadType=multipart&fields=${FILE_FIELDS}`, { method: 'POST', ...part })).json()) as DriveFile;
  }
  const r = await fetch(location, { method: 'PUT', headers: { 'Content-Type': type }, body: file });
  if (!r.ok) throw new GoogleError(`'${file.name}'을 올리지 못했어요 (${r.status})`, r.status);
  return (await r.json()) as DriveFile;
}

/** 드라이브 휴지통으로 (30일 동안 드라이브에서 되살릴 수 있다) */
export async function trashFile(id: string): Promise<void> {
  await api(`${DRIVE}/files/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
}

// ─── 캘린더 ───

export async function createCalendar(summary: string): Promise<string> {
  const r = await api(`${CAL}/calendars`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary, timeZone: 'Asia/Seoul' }),
  });
  return ((await r.json()) as { id: string }).id;
}

/**
 * 이 앱이 만든, 이름이 summary 인 캘린더들 (id 순). calendar.app.created 권한으로는 앱이 만든 캘린더만 보인다.
 * 목록을 볼 수 없는 환경이면 null.
 */
export async function findCalendars(summary: string): Promise<string[] | null> {
  try {
    const r = await api(`${CAL}/users/me/calendarList?minAccessRole=owner&showHidden=true&fields=items(id,summary)`);
    const items = ((await r.json()) as { items?: { id: string; summary?: string }[] }).items ?? [];
    return items
      .filter((c) => c.summary === summary)
      .map((c) => c.id)
      .sort();
  } catch (e) {
    if (e instanceof GoogleError && (e.status === 403 || e.status === 404)) return null;
    throw e;
  }
}

/** 이 앱이 만든 캘린더 지우기 (이미 없으면 그만) */
export async function deleteCalendar(id: string): Promise<void> {
  try {
    await api(`${CAL}/calendars/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (e) {
    if (!(e instanceof GoogleError && (e.status === 404 || e.status === 410))) throw e;
  }
}

/** 캘린더 안 일정을 모두 지운다 (앱이 넣은 사본뿐이라 다시 넣으면 된다) */
export async function clearEvents(calendarId: string): Promise<void> {
  const base = `${CAL}/calendars/${encodeURIComponent(calendarId)}/events`;
  let page = '';
  const ids: string[] = [];
  do {
    const r = await api(`${base}?maxResults=2500&fields=nextPageToken,items(id)${page ? `&pageToken=${page}` : ''}`);
    const j = (await r.json()) as { items?: { id: string }[]; nextPageToken?: string };
    ids.push(...(j.items ?? []).map((x) => x.id));
    page = j.nextPageToken ?? '';
  } while (page);
  for (const id of ids) await deleteEvent(calendarId, id);
}

/** 캘린더가 아직 있는가 (지웠으면 다시 만든다) */
export async function calendarExists(id: string): Promise<boolean> {
  try {
    await api(`${CAL}/calendars/${encodeURIComponent(id)}`);
    return true;
  } catch (e) {
    if (e instanceof GoogleError && (e.status === 404 || e.status === 403)) return false;
    throw e;
  }
}

function nextDay(d: string): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

function addMinutes(date: string, time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const day = total >= 24 * 60 ? nextDay(date) : date;
  const t = total % (24 * 60);
  return `${day}T${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}:00`;
}

export interface EventInput {
  summary: string;
  date: string;
  time?: string;
  minutes?: number;
  description?: string;
}

/** 일정 만들기(eventId 없음) 또는 고치기. 일정 id 를 돌려준다 */
export async function saveEvent(calendarId: string, eventId: string | null, e: EventInput): Promise<string> {
  const when = e.time
    ? {
        start: { dateTime: `${e.date}T${e.time}:00`, timeZone: 'Asia/Seoul' },
        end: { dateTime: addMinutes(e.date, e.time, e.minutes ?? 30), timeZone: 'Asia/Seoul' },
      }
    : { start: { date: e.date }, end: { date: nextDay(e.date) } };
  const body = JSON.stringify({ summary: e.summary, description: e.description ?? '', ...when });
  const base = `${CAL}/calendars/${encodeURIComponent(calendarId)}/events`;
  const headers = { 'Content-Type': 'application/json' };
  try {
    const r = eventId
      ? await api(`${base}/${encodeURIComponent(eventId)}`, { method: 'PUT', headers, body })
      : await api(base, { method: 'POST', headers, body });
    return ((await r.json()) as { id: string }).id;
  } catch (err) {
    // 캘린더에서 직접 지운 일정이면 새로 만든다
    if (eventId && err instanceof GoogleError && (err.status === 404 || err.status === 410)) return saveEvent(calendarId, null, e);
    throw err;
  }
}

export async function deleteEvent(calendarId: string, eventId: string): Promise<void> {
  try {
    await api(`${CAL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
  } catch (err) {
    if (!(err instanceof GoogleError && (err.status === 404 || err.status === 410))) throw err;
  }
}
