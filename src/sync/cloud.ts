/**
 * 기기 간 동기화 (구글 드라이브 경유)
 *
 * 앱 데이터 전체를 선생님이 정한 잠금 비밀번호로 잠가(gzip → PBKDF2-SHA256 → AES-256-GCM)
 * 내 드라이브 '학급관리' 폴더의 class-state.json 하나에 둔다.
 * 각 기기는 받아서 합치고(merge.ts), 달라졌으면 다시 올린다.
 * 잠금 비밀번호는 이 기기에만 저장하고 백업 파일에는 넣지 않는다.
 * (예전 출결관리의 깃허브로 맞추기는 학급관리에서 뺐다 — 구글 로그인 하나로 맞추기·캘린더·자료·위젯을 다 한다)
 */
import type { AppState } from '../domain/types';
import * as google from '../google/google';
import { normalize } from '../storage/db';
import { canonical, mergeStates } from './merge';

/** 구글 드라이브: 로그인은 google.ts 가 맡고, 여기에는 잠금 비밀번호만 */
export interface GoogleSyncConfig {
  kind: 'google';
  passphrase: string;
}

export type SyncConfig = GoogleSyncConfig;

const DRIVE_FILE = 'class-state.json';

// 출결관리 앱과 같은 주소 아래라 이름을 따로 쓴다 (출결관리의 동기화 설정을 덮어쓰거나 가져오지 않게)
const CONFIG_KEY = 'class-sync-config';
/** 이 기기가 마지막으로 올린 요약 — 그대로면 다시 올리지 않는다 */
const PENDING_SENT_KEY = 'class-widget-pending-sent';
const ENC_FORMAT = 'attendance-app/state-enc-v1';
const PBKDF2_ITER = 210_000;

// ─── 이 기기에만 저장 ─────────────────────────────────────

export function loadSyncConfig(): SyncConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    const cfg = raw ? (JSON.parse(raw) as { kind?: string; passphrase?: string }) : null;
    // 예전에 깃허브로 맞추던 설정은 쓰지 않는다 (구글로 다시 연결)
    return cfg?.kind === 'google' && cfg.passphrase ? { kind: 'google', passphrase: cfg.passphrase } : null;
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

export class SyncError extends Error {}

// ─── 구글 드라이브 ───────────────────────────────────────

/** 드라이브 오류를 선생님께 보일 문장으로 */
function driveError(e: unknown): never {
  if (e instanceof google.AuthError) throw new SyncError(e.message);
  if (e instanceof SyncError) throw e;
  if (e instanceof google.GoogleError) throw new SyncError(`구글 드라이브 오류: ${e.message}`);
  throw new SyncError('인터넷에 연결되지 않았거나 이 네트워크에서 구글이 막혀 있어요.');
}

const WRONG_PASS = '잠금 비밀번호가 다른 기기와 달라요.';
/** 휴대폰 위젯이 읽는 처리 예정 요약 (같은 잠금 비밀번호로 잠근다). 위젯 앱 Drive.kt 와 짝 */
const DRIVE_PENDING = 'class-pending.json';

/**
 * 휴대폰 위젯용 처리 예정 요약을 드라이브 '학급관리' 폴더에 올린다. 이 기기가 지난번에 올린 것과 같으면 건너뛴다.
 * (다른 기기가 먼저 올렸어도 덮어쓸 뿐이라 해가 없다)
 */
export async function pushPendingDrive(cfg: GoogleSyncConfig, summary: unknown): Promise<void> {
  const { at: _at, ...content } = summary as { at?: string };
  const sent = `drive\n${JSON.stringify(content)}`;
  try {
    if (localStorage.getItem(PENDING_SENT_KEY) === sent) return;
  } catch {
    /* 저장 공간을 못 쓰면 매번 올린다 */
  }
  try {
    const folder = await google.rootFolder();
    const file = await google.findFile(DRIVE_PENDING, folder);
    await google.writeJson({ fileId: file?.id, name: DRIVE_PENDING, parentId: folder, data: await encrypt(summary, cfg.passphrase) });
  } catch (e) {
    driveError(e);
  }
  try {
    localStorage.setItem(PENDING_SENT_KEY, sent);
  } catch {
    /* 다음에 다시 올린다 */
  }
}

/** 드라이브에 다른 기기가 올린 기록이 있는가 — 처음 로그인할 때 잠금 비밀번호를 새로 정할지 물을지 고른다 */
export async function driveHasState(): Promise<boolean> {
  try {
    return !!(await google.findFile(DRIVE_FILE, await google.rootFolder()));
  } catch (e) {
    driveError(e);
  }
}

/** 잠금 비밀번호가 드라이브의 기록과 맞는가 (기록이 없으면 맞는 것으로) */
export async function drivePassphraseOk(passphrase: string): Promise<boolean> {
  try {
    await pullDrive({ kind: 'google', passphrase });
    return true;
  } catch (e) {
    if (e instanceof SyncError && e.message === WRONG_PASS) return false;
    throw e;
  }
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
      throw new SyncError(WRONG_PASS);
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
  /** 드라이브 파일 version */
  sha: string;
  fileId?: string;
}

const pull = (cfg: SyncConfig) => pullDrive(cfg);
const push = (cfg: SyncConfig, state: AppState, remote: Remote | null) => pushDrive(cfg, state, remote);

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
