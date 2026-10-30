/**
 * 기기 간 동기화 (구글 드라이브 또는 깃허브 비공개 저장소 경유)
 *
 * 앱 데이터 전체를 선생님이 정한 잠금 비밀번호로 잠가(gzip → PBKDF2-SHA256 → AES-256-GCM)
 * 파일 하나에 둔다 (드라이브: 내 드라이브 '학급관리' 폴더의 class-state.json, 깃허브: sync/state.json).
 * 각 기기는 받아서 합치고(merge.ts), 달라졌으면 다시 올린다.
 * 연동 설정(토큰·비밀번호)은 이 기기에만 저장하고 백업 파일에는 넣지 않는다.
 */
import type { AppState } from '../domain/types';
import * as google from '../google/google';
import { normalize } from '../storage/db';
import { canonical, mergeStates } from './merge';

export interface GithubSyncConfig {
  kind?: 'github';
  /** 예: YeoBBun/school-attendance-sync */
  repo: string;
  token: string;
  passphrase: string;
}

/** 구글 드라이브: 로그인은 google.ts 가 맡고, 여기에는 잠금 비밀번호만 */
export interface GoogleSyncConfig {
  kind: 'google';
  passphrase: string;
}

export type SyncConfig = GithubSyncConfig | GoogleSyncConfig;

export const isGithub = (cfg: SyncConfig): cfg is GithubSyncConfig => cfg.kind !== 'google';

const DRIVE_FILE = 'class-state.json';

const CONFIG_KEY = 'neis-sync-config';
const STATE_PATH = 'sync/state.json';
/** 휴대폰 위젯이 읽는 받을 서류 요약 (같은 비밀번호로 잠근다) */
const PENDING_PATH = 'sync/pending.json';
/** 이 기기가 마지막으로 올린 요약 — 그대로면 다시 올리지 않는다 */
const PENDING_SENT_KEY = 'widget-pending-sent';
const ENC_FORMAT = 'attendance-app/state-enc-v1';
const PBKDF2_ITER = 210_000;

let API = (() => {
  try {
    return localStorage.getItem('neis-sync-api') ?? 'https://api.github.com'; // 시험용으로만 바꾼다
  } catch {
    return 'https://api.github.com';
  }
})();

/** 시험용 */
export function setApiBase(url: string) {
  API = url;
}

// ─── 이 기기에만 저장 ─────────────────────────────────────

export function loadSyncConfig(): SyncConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? (JSON.parse(raw) as SyncConfig) : null;
  } catch {
    return null;
  }
}

export function saveSyncConfig(cfg: SyncConfig | null) {
  try {
    if (cfg) localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
    else localStorage.removeItem(CONFIG_KEY);
    localStorage.removeItem(PENDING_SENT_KEY); // 저장소·비밀번호가 바뀌었을 수 있다
  } catch {
    /* 저장 공간을 못 쓰는 환경 */
  }
}

// ─── 잠그기 ───────────────────────────────────────────────

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromB64(b64: string): Uint8Array {
  const s = atob(b64.replace(/\s/g, ''));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function gzip(data: Uint8Array, mode: 'gzip' | 'gunzip'): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(mode === 'gzip' ? new CompressionStream('gzip') : new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function deriveKey(passphrase: string, salt: Uint8Array, iter: number) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

interface Envelope {
  format: typeof ENC_FORMAT;
  iter: number;
  salt: string;
  iv: string;
  ct: string;
}

export async function encrypt(obj: unknown, passphrase: string): Promise<Envelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITER);
  const plain = await gzip(new TextEncoder().encode(JSON.stringify(obj)), 'gzip');
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  return { format: ENC_FORMAT, iter: PBKDF2_ITER, salt: toB64(salt), iv: toB64(iv), ct: toB64(ct) };
}

export async function decrypt(env: Envelope, passphrase: string): Promise<unknown> {
  const key = await deriveKey(passphrase, fromB64(env.salt), env.iter);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(env.iv) }, key, fromB64(env.ct));
  return JSON.parse(new TextDecoder().decode(await gzip(new Uint8Array(plain), 'gunzip')));
}

// ─── 깃허브 ──────────────────────────────────────────────

async function gh(cfg: GithubSyncConfig, method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${API}/repos/${cfg.repo}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
}

/** 연결 확인. 문제가 없으면 null, 있으면 선생님께 보여줄 문장. */
export async function testConnection(cfg: GithubSyncConfig): Promise<string | null> {
  try {
    const r = await gh(cfg, 'GET', '');
    if (r.status === 200) {
      const repo = (await r.json()) as { private?: boolean; permissions?: { push?: boolean } };
      if (!repo.private) return '저장소가 공개(Public)로 되어 있어요. 깃허브에서 Private 으로 바꿔 주세요.';
      if (repo.permissions && !repo.permissions.push) return '토큰에 쓰기 권한이 없어요. Contents 를 Read and write 로 만들어 주세요.';
      return null;
    }
    if (r.status === 401) return '토큰이 맞지 않거나 만료됐어요.';
    if (r.status === 404) return '저장소를 찾지 못했어요. 이름과 토큰의 저장소 선택을 확인해 주세요.';
    return `깃허브 응답 오류 (${r.status})`;
  } catch {
    return '인터넷에 연결되지 않았거나 이 네트워크에서 깃허브가 막혀 있어요.';
  }
}

export class SyncError extends Error {}

async function pullGithub(cfg: GithubSyncConfig): Promise<Remote | null> {
  const r = await gh(cfg, 'GET', `/contents/${STATE_PATH}`);
  if (r.status === 404) return null;
  if (r.status === 401) throw new SyncError('토큰이 맞지 않거나 만료됐어요.');
  if (!r.ok) throw new SyncError(`받아오지 못했어요 (깃허브 ${r.status})`);
  const data = (await r.json()) as { content?: string; sha: string; download_url?: string };
  // 1MB 넘는 파일은 content 가 비어 온다 → 원본 그대로 다시 받는다
  const text = data.content
    ? new TextDecoder().decode(fromB64(data.content))
    : await (await fetch(`${API}/repos/${cfg.repo}/contents/${STATE_PATH}`, {
        headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github.raw+json' },
        cache: 'no-store',
      })).text();
  let plain: unknown;
  try {
    plain = await decrypt(JSON.parse(text) as Envelope, cfg.passphrase);
  } catch {
    throw new SyncError('잠금 비밀번호가 다른 기기와 달라요.');
  }
  return { state: normalize(plain), sha: data.sha };
}

async function pushGithub(cfg: GithubSyncConfig, state: AppState, sha?: string): Promise<'ok' | 'conflict'> {
  const body = { message: '동기화', content: btoa(JSON.stringify(await encrypt(state, cfg.passphrase))), ...(sha ? { sha } : {}) };
  const r = await gh(cfg, 'PUT', `/contents/${STATE_PATH}`, body);
  if (r.ok) return 'ok';
  if (r.status === 409 || r.status === 422) return 'conflict'; // 그 사이 다른 기기가 올렸다
  if (r.status === 401) throw new SyncError('토큰이 맞지 않거나 만료됐어요.');
  if (r.status === 403) throw new SyncError('올리기가 막혔어요 (토큰 권한 또는 학교망 차단).');
  throw new SyncError(`올리지 못했어요 (깃허브 ${r.status})`);
}

// ─── 구글 드라이브 ───────────────────────────────────────

/** 드라이브 오류를 선생님께 보일 문장으로 */
function driveError(e: unknown): never {
  if (e instanceof google.AuthError) throw new SyncError(e.message);
  if (e instanceof SyncError) throw e;
  if (e instanceof google.GoogleError) throw new SyncError(`구글 드라이브 오류: ${e.message}`);
  throw new SyncError('인터넷에 연결되지 않았거나 이 네트워크에서 구글이 막혀 있어요.');
}

async function pullDrive(cfg: GoogleSyncConfig): Promise<Remote | null> {
  try {
    const folder = await google.rootFolder();
    const file = await google.findFile(DRIVE_FILE, folder);
    if (!file) return null;
    const env = (await google.readJson(file.id)) as Envelope;
    let plain: unknown;
    try {
      plain = await decrypt(env, cfg.passphrase);
    } catch {
      throw new SyncError('잠금 비밀번호가 다른 기기와 달라요.');
    }
    return { state: normalize(plain), sha: file.version, fileId: file.id };
  } catch (e) {
    driveError(e);
  }
}

/**
 * 드라이브는 «바뀌지 않았으면 쓰기» 를 못 해서, 쓰기 직전에 버전을 다시 보고 그 사이 바뀌었으면 다시 받아 합친다.
 * (그 짧은 틈에 두 기기가 동시에 쓰면 한쪽이 덮이지만, 다음 동기화 때 그 기기가 다시 합쳐 올린다.)
 */
async function pushDrive(cfg: GoogleSyncConfig, state: AppState, remote: Remote | null): Promise<'ok' | 'conflict'> {
  try {
    const folder = await google.rootFolder();
    if (remote?.fileId) {
      if ((await google.fileVersion(remote.fileId)) !== remote.sha) return 'conflict';
    } else if (await google.findFile(DRIVE_FILE, folder)) {
      return 'conflict'; // 다른 기기가 막 처음 만들었다
    }
    await google.writeJson({ fileId: remote?.fileId, name: DRIVE_FILE, parentId: folder, data: await encrypt(state, cfg.passphrase) });
    return 'ok';
  } catch (e) {
    driveError(e);
  }
}

interface Remote {
  state: AppState;
  /** 깃허브 sha 또는 드라이브 version */
  sha: string;
  fileId?: string;
}

const pull = (cfg: SyncConfig) => (isGithub(cfg) ? pullGithub(cfg) : pullDrive(cfg));
const push = (cfg: SyncConfig, state: AppState, remote: Remote | null) =>
  isGithub(cfg) ? pushGithub(cfg, state, remote?.sha) : pushDrive(cfg, state, remote);

/**
 * 받아서 합치고, 달라졌으면 올린다. 합친 상태를 돌려준다 (로컬과 같으면 같은 객체).
 * 그 사이 다른 기기가 올렸으면 한 번 더 받아서 합친다.
 */
export async function syncNow(cfg: SyncConfig, local: AppState): Promise<AppState> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const remote = await pull(cfg);
    const merged = remote ? mergeStates(local, remote.state) : local;
    if (remote && canonical(merged) === canonical(remote.state)) {
      return canonical(merged) === canonical(local) ? local : merged;
    }
    if ((await push(cfg, merged, remote)) === 'ok') return canonical(merged) === canonical(local) ? local : merged;
  }
  throw new SyncError('다른 기기와 동시에 고치는 중이에요. 잠시 뒤 다시 맞춥니다.');
}

/**
 * 휴대폰 위젯용 받을 서류 요약을 올린다. 이 기기가 지난번에 올린 것과 같으면 건너뛴다.
 * 다른 기기가 같은 내용을 먼저 올렸어도 덮어쓸 뿐이라 해가 없다.
 */
export async function pushPending(cfg: GithubSyncConfig, summary: unknown): Promise<void> {
  const text = JSON.stringify(summary);
  const sent = `${cfg.repo}\n${text}`;
  try {
    if (localStorage.getItem(PENDING_SENT_KEY) === sent) return;
  } catch {
    /* 저장 공간을 못 쓰면 매번 올린다 */
  }
  const content = btoa(JSON.stringify(await encrypt(summary, cfg.passphrase)));
  for (let attempt = 0; attempt < 2; attempt++) {
    const cur = await gh(cfg, 'GET', `/contents/${PENDING_PATH}`);
    if (!cur.ok && cur.status !== 404) throw new SyncError(`위젯 요약을 확인하지 못했어요 (깃허브 ${cur.status})`);
    const sha = cur.ok ? ((await cur.json()) as { sha: string }).sha : undefined;
    const r = await gh(cfg, 'PUT', `/contents/${PENDING_PATH}`, { message: '위젯 요약', content, ...(sha ? { sha } : {}) });
    if (r.ok) {
      try {
        localStorage.setItem(PENDING_SENT_KEY, sent);
      } catch {
        /* 다음에 다시 올린다 */
      }
      return;
    }
    if (r.status !== 409 && r.status !== 422) throw new SyncError(`위젯 요약을 올리지 못했어요 (깃허브 ${r.status})`);
  }
}
