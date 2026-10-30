import { useState } from 'react';
import { useStore } from '../store';
import { isGithub, loadSyncConfig, saveSyncConfig, testConnection, type GithubSyncConfig } from '../sync/cloud';

const DEFAULT_REPO = 'YeoBBun/school-attendance-sync';

/**
 * 깃허브로 맞추기 (고급). 휴대폰 위젯은 이 방식에서만 된다.
 * 토큰·잠금 비밀번호는 이 기기에만 저장하고 백업 파일에 넣지 않는다.
 */
export function SyncSettings() {
  const { sync, syncNow, widgetSync } = useStore();
  const current = loadSyncConfig();
  const saved = current && isGithub(current) ? current : null;
  const [repo, setRepo] = useState(saved?.repo ?? DEFAULT_REPO);
  const [token, setToken] = useState(saved?.token ?? '');
  const [pass, setPass] = useState(saved?.passphrase ?? '');
  const [pass2, setPass2] = useState(saved?.passphrase ?? '');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!repo.includes('/') || !token.trim()) return setMsg({ ok: false, text: '저장소와 토큰을 넣어 주세요.' });
    if (pass.length < 8) return setMsg({ ok: false, text: '잠금 비밀번호는 8자 이상으로 정해 주세요.' });
    if (pass !== pass2) return setMsg({ ok: false, text: '잠금 비밀번호 두 칸이 서로 달라요.' });
    if (current && !isGithub(current) && !confirm('지금은 구글 드라이브로 맞추고 있어요. 깃허브로 바꿀까요?')) return;
    const cfg: GithubSyncConfig = { repo: repo.trim(), token: token.trim(), passphrase: pass };
    setBusy(true);
    const problem = await testConnection(cfg);
    setBusy(false);
    if (problem) return setMsg({ ok: false, text: problem });
    saveSyncConfig(cfg);
    setMsg({ ok: true, text: '연결됐어요. 다른 기기에서도 같은 저장소와 잠금 비밀번호로 연결하면 출결이 서로 맞춰져요.' });
    syncNow();
  };

  const off = () => {
    if (!confirm('이 기기의 동기화 설정을 지울까요? (출결 데이터는 지워지지 않아요)')) return;
    saveSyncConfig(null);
    setToken('');
    setPass('');
    setPass2('');
    setMsg({ ok: true, text: '동기화를 껐어요. 이 기기의 출결은 그대로 남아요.' });
    syncNow();
  };

  return (
    <details className="card advanced">
      <summary>고급: 깃허브로 맞추기 (휴대폰 위젯을 쓸 때)</summary>
      <p className="hint">
        휴대폰과 PC에서 같은 저장소·잠금 비밀번호로 연결하면, 어느 쪽에서 입력·수정·삭제해도 다른 쪽에 맞춰져요. 데이터는 잠금 비밀번호로
        잠가서 비공개 깃허브 저장소에 올려요. 토큰과 비밀번호는 <b>이 기기에만</b> 저장되고 백업 파일에는 들어가지 않아요.
      </p>
      {saved && <SyncLine status={sync} onRetry={syncNow} />}
      {saved && widgetSync.kind === 'ok' && <p className="sync-status done">✓ {hhmm(widgetSync.at)} 휴대폰 위젯용 받을 서류 요약 올라가 있음</p>}
      {saved && widgetSync.kind === 'error' && <p className="sync-status error">휴대폰 위젯용 요약을 못 올렸어요: {widgetSync.message}</p>}
      <div className="sync-form">
        <label>
          <span className="field-label">깃허브 저장소</span>
          <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder={DEFAULT_REPO} />
        </label>
        <label>
          <span className="field-label">토큰</span>
          <input type="password" value={token} autoComplete="off" onChange={(e) => setToken(e.target.value)} placeholder="github_pat_…" />
        </label>
        <label>
          <span className="field-label">잠금 비밀번호 (8자 이상)</span>
          <input type="password" value={pass} autoComplete="new-password" onChange={(e) => setPass(e.target.value)} />
        </label>
        <label>
          <span className="field-label">잠금 비밀번호 확인</span>
          <input type="password" value={pass2} autoComplete="new-password" onChange={(e) => setPass2(e.target.value)} />
        </label>
      </div>
      <div className="inline">
        <button className="primary" disabled={busy} onClick={save}>
          {busy ? '확인 중…' : '저장하고 연결 확인'}
        </button>
        {saved && (
          <button className="ghost" onClick={off}>
            연동 끄기
          </button>
        )}
      </div>
      {msg && <p className={msg.ok ? 'info' : 'error'}>{msg.text}</p>}
    </details>
  );
}

function hhmm(iso: string) {
  const d = new Date(iso);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function SyncLine({ status, onRetry }: { status: ReturnType<typeof useStore>['sync']; onRetry: () => void }) {
  if (status.kind === 'off') return null;
  if (status.kind === 'error')
    return (
      <p className="sync-status error">
        동기화 실패: {status.message}{' '}
        <button className="link" onClick={onRetry}>
          다시 시도
        </button>
      </p>
    );
  if (status.kind === 'syncing') return <p className="sync-status">맞추는 중…</p>;
  return <p className="sync-status done">✓ {hhmm(status.at)} 동기화됨</p>;
}
