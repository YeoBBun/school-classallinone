import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyState, type AppState, type Note } from '../domain/types';

// 가짜 구글 드라이브: 파일 하나와 버전
const drive = vi.hoisted(() => ({ file: null as null | { id: string; version: number; data: unknown }, bumpBeforeWrite: 0 }));

vi.mock('../google/google', () => {
  class AuthError extends Error {}
  class GoogleError extends Error {}
  return {
    AuthError,
    GoogleError,
    rootFolder: async () => 'folder',
    findFile: async () => (drive.file ? { id: drive.file.id, version: String(drive.file.version) } : null),
    readJson: async () => drive.file!.data,
    fileVersion: async () => {
      // 다른 기기가 쓰기 직전에 끼어든 것처럼
      if (drive.bumpBeforeWrite > 0) {
        drive.bumpBeforeWrite--;
        drive.file!.version++;
      }
      return String(drive.file!.version);
    },
    writeJson: async ({ data }: { data: unknown }) => {
      drive.file = { id: 'f1', version: (drive.file?.version ?? 0) + 1, data };
      return { id: 'f1', version: String(drive.file.version) };
    },
  };
});

const { syncNow } = await import('./cloud');

const cfg = { kind: 'google' as const, passphrase: '잠금비밀번호' };
const note = (id: string, updatedAt: string): Note => ({ id, studentIds: ['s1'], kind: '관찰', date: '2026-10-30', content: id, updatedAt });
const withNotes = (...notes: Note[]): AppState => ({ ...emptyState(), holidays: [], notes });

beforeEach(() => {
  drive.file = null;
  drive.bumpBeforeWrite = 0;
});

describe('구글 드라이브로 맞추기', () => {
  it('처음 기기는 파일을 만들고, 다음 기기는 받아서 합친다', async () => {
    const pc = withNotes(note('a', '2026-10-30T01:00:00Z'));
    expect(await syncNow(cfg, pc)).toBe(pc); // 바뀐 것 없음
    expect(drive.file?.version).toBe(1);

    const phone = withNotes(note('b', '2026-10-30T02:00:00Z'));
    const merged = await syncNow(cfg, phone);
    expect(merged.notes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(drive.file?.version).toBe(2);

    // PC 가 다시 맞추면 폰 것을 받는다 (올릴 것은 없다)
    const pcAgain = await syncNow(cfg, pc);
    expect(pcAgain.notes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(drive.file?.version).toBe(2);
  });

  it('쓰기 직전에 다른 기기가 올렸으면 다시 받아서 합친다', async () => {
    await syncNow(cfg, withNotes(note('a', '2026-10-30T01:00:00Z')));
    drive.bumpBeforeWrite = 1;
    const merged = await syncNow(cfg, withNotes(note('b', '2026-10-30T02:00:00Z')));
    expect(merged.notes.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('잠금 비밀번호가 다르면 알려 준다', async () => {
    await syncNow(cfg, withNotes(note('a', '1')));
    await expect(syncNow({ ...cfg, passphrase: '다른비밀번호' }, withNotes())).rejects.toThrow('잠금 비밀번호');
  });
});
