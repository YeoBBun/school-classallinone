import { beforeAll, describe, expect, it, vi } from 'vitest';

type Google = typeof import('./google');
let g: Google;

beforeAll(async () => {
  // 로그인해 둔 상태로 시작 (google.ts 는 불러올 때 저장된 토큰을 읽는다)
  const store = new Map([['class-google-token', JSON.stringify({ access_token: 'tok', expires_at: Date.now() + 3600_000, scope: '' })]]);
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  g = await import('./google');
});

const saved = { id: 'f1', name: '가정통신문.pdf', mimeType: 'application/pdf', size: '3', modifiedTime: '2026-10-30T05:00:00Z', webViewLink: 'https://x' };

describe('자료 올리기', () => {
  it('이어 올리기 주소를 받아 파일을 보낸다', async () => {
    const calls: [string, RequestInit][] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      if (calls.length === 1) return new Response('', { status: 200, headers: { Location: 'https://upload.example/session1' } });
      return new Response(JSON.stringify(saved), { status: 200 });
    });
    const file = new File(['abc'], '가정통신문.pdf', { type: 'application/pdf' });
    expect(await g.uploadFile('folder1', file)).toEqual(saved);
    expect(calls[0][0]).toContain('uploadType=resumable');
    expect((calls[0][1].headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(calls[0][1].body as string)).toEqual({ name: '가정통신문.pdf', parents: ['folder1'] });
    expect(calls[1]).toEqual(['https://upload.example/session1', { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: file }]);
  });

  it('주소를 못 받으면 작은 파일은 한 번에 올리고, 큰 파일은 안내한다', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      return url.includes('resumable') ? new Response('', { status: 200 }) : new Response(JSON.stringify(saved), { status: 200 });
    });
    await g.uploadFile('folder1', new File(['abc'], 'a.pdf'));
    expect(urls[1]).toContain('uploadType=multipart');
    const big = new File([new Uint8Array(6 * 1024 * 1024)], 'big.mp4');
    await expect(g.uploadFile('folder1', big)).rejects.toThrow('큰 파일');
  });

  it('목록은 여러 쪽이면 다 모은다', async () => {
    vi.stubGlobal('fetch', async (url: string) =>
      new Response(JSON.stringify(url.includes('pageToken=p2') ? { files: [{ ...saved, id: 'f2' }] } : { files: [saved], nextPageToken: 'p2' }), { status: 200 }),
    );
    expect((await g.listFiles('folder1')).map((f) => f.id)).toEqual(['f1', 'f2']);
  });
});

describe('폴더 찾기', () => {
  const reset = () => ['class-google-folder', 'class-google-files-folder'].forEach((k) => localStorage.removeItem(k));

  it('여러 곳에서 동시에 찾아도 폴더는 하나만 만든다', async () => {
    reset();
    let made = 0;
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify({ id: `new${++made}` }), { status: 200 });
      return new Response(JSON.stringify({ files: [] }), { status: 200 });
    });
    const ids = await Promise.all([g.rootFolder(), g.rootFolder(), g.filesFolder(), g.filesFolder()]);
    expect(made).toBe(2);
    expect(ids).toEqual(['new1', 'new1', 'new2', 'new2']);
  });

  it('같은 이름 폴더가 여럿이면 안에 뭔가 든 쪽을 쓴다', async () => {
    reset();
    vi.stubGlobal('fetch', async (url: string) => {
      const query = decodeURIComponent(url);
      if (query.includes("name='학급관리'")) return new Response(JSON.stringify({ files: [{ id: 'empty' }, { id: 'full' }] }), { status: 200 });
      if (query.includes("'full' in parents")) return new Response(JSON.stringify({ files: [{ id: 'state' }] }), { status: 200 });
      return new Response(JSON.stringify({ files: [] }), { status: 200 });
    });
    expect(await g.rootFolder()).toBe('full');
  });
});
