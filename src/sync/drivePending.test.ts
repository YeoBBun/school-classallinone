import { describe, expect, it, vi } from 'vitest';

// 가짜 구글 드라이브: 이름별 파일
const drive = vi.hoisted(() => ({ files: new Map<string, { id: string; data: unknown }>(), writes: 0 }));

vi.mock('../google/google', () => {
  class AuthError extends Error {}
  class GoogleError extends Error {}
  return {
    AuthError,
    GoogleError,
    rootFolder: async () => 'folder',
    findFile: async (name: string) => {
      const f = drive.files.get(name);
      return f ? { id: f.id, version: '1' } : null;
    },
    writeJson: async ({ fileId, name, data }: { fileId?: string; name: string; data: unknown }) => {
      drive.writes++;
      drive.files.set(name, { id: fileId ?? `id-${name}`, data });
      return { id: fileId ?? `id-${name}`, version: '1' };
    },
  };
});

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

const { decrypt, pushPendingDrive, saveSyncConfig } = await import('./cloud');

describe('위젯용 요약을 드라이브에', () => {
  const cfg = { kind: 'google' as const, passphrase: '잠금비밀번호' };
  const summary = { format: 'attendance-app/pending-v1', className: '2-3', items: [], sections: [{ title: '기타', rows: [{ title: '학급 문고', text: '' }] }] };

  it('잠금 비밀번호로 잠가 class-pending.json 에 올리고, 같으면 다시 올리지 않는다', async () => {
    await pushPendingDrive(cfg, summary);
    const file = drive.files.get('class-pending.json');
    expect(file).toBeTruthy();
    expect(await decrypt(file!.data as never, '잠금비밀번호')).toEqual(summary);

    await pushPendingDrive(cfg, summary);
    expect(drive.writes).toBe(1);

    // 비밀번호를 바꾸면(설정 저장) 다시 올린다 — 같은 파일을 덮어쓴다
    saveSyncConfig({ ...cfg, passphrase: '새비밀번호12' });
    await pushPendingDrive({ ...cfg, passphrase: '새비밀번호12' }, summary);
    expect(drive.writes).toBe(2);
    expect(drive.files.get('class-pending.json')!.id).toBe('id-class-pending.json');
  });
});
