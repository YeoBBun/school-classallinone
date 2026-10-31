import { describe, expect, it, vi } from 'vitest';

// 휴대폰 '학급관리' 앱 안: 앱이 넣어 주는 ClassApp 과, 끝난 토큰이 남아 있는 상태
const store = new Map([['class-google-token', JSON.stringify({ access_token: 'old', expires_at: Date.now() - 1000, scope: 'drive.file calendar.app.created', email: 'me@example.com' })]]);
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});
const asked: string[] = [];
const reply = (r: object) => setTimeout(() => (globalThis as unknown as { classAppGoogle: (j: string) => void }).classAppGoogle(JSON.stringify(r)), 0);
vi.stubGlobal('ClassApp', {
  googleToken: () => {
    asked.push('token');
    reply({ access_token: 'new', scope: 'https://www.googleapis.com/auth/drive.file', expires_in: 3000 });
  },
  googleSignIn: () => asked.push('signIn'),
  googleSignOut: () => asked.push('signOut'),
});

const g = await import('./google');

describe('휴대폰 앱 안의 구글 로그인', () => {
  it('토큰이 끝나도 연결된 것으로 보고, 필요할 때 앱에서 조용히 새로 받는다', async () => {
    expect(g.isNativeGoogle()).toBe(true);
    expect(g.hasToken()).toBe(true);
    const auth: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      auth.push((init.headers as Record<string, string>).Authorization);
      return new Response(JSON.stringify({ files: [] }), { status: 200 });
    });
    // 동시에 두 번 불러도 앱에는 한 번만 부탁한다
    await Promise.all([g.listFiles('f'), g.listFiles('f')]);
    expect(asked).toEqual(['token']);
    expect(auth).toEqual(['Bearer new', 'Bearer new']);
    expect(g.googleEmail()).toBe('me@example.com');
  });

  it('앱이 로그인이 필요하다고 하면 다시 연결하라는 오류', async () => {
    store.clear();
    (globalThis as unknown as { ClassApp: { googleToken: () => void } }).ClassApp.googleToken = () => reply({ error: 'needs_signin' });
    vi.stubGlobal('fetch', async () => new Response('', { status: 401 }));
    await expect(g.listFiles('f')).rejects.toBeInstanceOf(g.AuthError);
  });
});
