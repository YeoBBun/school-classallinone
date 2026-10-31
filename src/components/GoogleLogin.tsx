import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { hasCalendarScope, isNativeGoogle, signIn } from '../google/google';
import { CALENDAR_NAME } from '../google/calendarSync';
import { useGoogle } from '../google/useGoogle';
import { useStore } from '../store';
import { driveHasState, drivePassphraseOk, isGithub, loadSyncConfig, saveSyncConfig } from '../sync/cloud';
import { Modal } from './common';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * 구글 로그인 한 번으로: 일정 → 구글 캘린더 자동, 자료 → 구글 드라이브, 기기 간 맞추기(잠금 비밀번호).
 * 드라이브에 다른 기기의 데이터가 있으면 그 기기에서 정한 잠금 비밀번호를 묻고, 없으면 새로 정한다.
 */
export function LoginDialog({ onClose }: { onClose: () => void }) {
  const g = useGoogle();
  const { update, syncNow } = useStore();
  const driveOn = () => {
    const cfg = loadSyncConfig();
    return !!cfg && !isGithub(cfg);
  };
  const [step, setStep] = useState<'login' | 'lock' | 'done'>(() => (!g.connected ? 'login' : driveOn() ? 'done' : 'lock'));
  /** 드라이브에 다른 기기가 올린 데이터가 있는가 (모르면 null) */
  const [existing, setExisting] = useState<boolean | null>(null);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const github = (() => {
    const cfg = loadSyncConfig();
    return !!cfg && isGithub(cfg);
  })();

  useEffect(() => {
    if (step !== 'lock' || existing !== null) return;
    driveHasState().then(setExisting, (e) => setError(message(e)));
  }, [step, existing]);

  const login = async () => {
    setBusy(true);
    setError('');
    try {
      await signIn();
      if (hasCalendarScope()) update((s) => ({ ...s, settings: { ...s.settings, calendarOn: true } }));
      if (driveOn()) {
        syncNow();
        setStep('done');
      } else setStep('lock');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const lock = async () => {
    setError('');
    if (existing) {
      if (!pass) return setError('잠금 비밀번호를 넣어 주세요.');
      setBusy(true);
      try {
        if (!(await drivePassphraseOk(pass))) return setError('잠금 비밀번호가 다른 기기와 달라요.');
      } catch (e) {
        return setError(message(e));
      } finally {
        setBusy(false);
      }
    } else {
      if (pass.length < 8) return setError('잠금 비밀번호는 8자 이상으로 정해 주세요.');
      if (pass !== pass2) return setError('잠금 비밀번호 두 칸이 서로 달라요.');
    }
    saveSyncConfig({ kind: 'google', passphrase: pass });
    syncNow();
    setStep('done');
  };

  return (
    <Modal title="구글 로그인" onClose={onClose}>
      <div className="form login-dialog">
        {step === 'login' && (
          <>
            <ul className="login-points">
              <li>
                <b>일정</b>에 넣은 상담·학급 행사가 구글 캘린더에 저절로 들어가요.
              </li>
              <li>
                <b>자료</b>에 올린 파일이 구글 드라이브에 저장돼요.
              </li>
              <li>휴대폰·PC 어디서 열어도 같은 기록을 봐요.</li>
            </ul>
            <p className="hint">앱은 내 드라이브의 '학급관리' 폴더와 앱이 만든 캘린더 '{CALENDAR_NAME}'에만 접근해요.</p>
            <button className="primary big" onClick={login} disabled={busy}>
              {busy ? '연결 중…' : g.expired ? '구글 다시 연결' : '구글로 로그인'}
            </button>
          </>
        )}

        {step === 'lock' && (
          <>
            <p className="sync-status done">✓ {g.email || '구글 계정'} 로그인됨</p>
            <h4>기록 잠금 비밀번호</h4>
            {existing === null && !error && <p className="muted">드라이브를 확인하는 중…</p>}
            {existing === true && (
              <>
                <p className="hint">이 구글 계정에 다른 기기에서 쓰던 기록이 있어요. 그 기기에서 정한 잠금 비밀번호를 넣으면 기록을 받아 와요.</p>
                <label>
                  <span className="field-label">잠금 비밀번호</span>
                  <input type="password" value={pass} autoFocus autoComplete="current-password" onChange={(e) => setPass(e.target.value)} />
                </label>
              </>
            )}
            {existing === false && (
              <>
                <p className="hint">
                  학생 기록은 이 비밀번호로 잠가서 드라이브에 둬요. 다른 기기에서 로그인할 때도 같은 비밀번호를 넣어요.{' '}
                  <b>잊으면 드라이브의 기록은 열 수 없으니 꼭 적어 두세요.</b>
                </p>
                <div className="sync-form">
                  <label>
                    <span className="field-label">잠금 비밀번호 (8자 이상)</span>
                    <input type="password" value={pass} autoFocus autoComplete="new-password" onChange={(e) => setPass(e.target.value)} />
                  </label>
                  <label>
                    <span className="field-label">한 번 더</span>
                    <input type="password" value={pass2} autoComplete="new-password" onChange={(e) => setPass2(e.target.value)} />
                  </label>
                </div>
              </>
            )}
            {github && existing !== null && <p className="hint">지금은 깃허브로 맞추고 있어요. 시작하면 구글 드라이브로 바꿔 맞춰요.</p>}
            <footer className="form-actions">
              <button type="button" onClick={() => setStep('done')}>
                나중에
              </button>
              <span className="spacer" />
              <button type="button" className="primary" onClick={lock} disabled={busy || existing === null}>
                {busy ? '확인 중…' : '시작'}
              </button>
            </footer>
          </>
        )}

        {step === 'done' && (
          <>
            <p className="sync-status done">✓ {g.email || '구글 계정'} 로그인됨</p>
            <ul className="login-points">
              <li>일정 → 구글 캘린더 '{CALENDAR_NAME}'</li>
              <li>자료 → 구글 드라이브 '학급관리/자료'</li>
              <li>{driveOn() ? '다른 기기와 맞추기 켜짐' : '다른 기기와 맞추기는 꺼져 있어요 (설정 → 구글 연결에서 켜요)'}</li>
            </ul>
            {!isNativeGoogle() && <p className="hint">로그인은 한 시간쯤 지나면 끝나요. 그때 위에 뜨는 [구글 다시 연결]을 한 번 누르면 돼요.</p>}
            <footer className="form-actions">
              <span className="spacer" />
              <button type="button" className="primary" onClick={onClose}>
                닫기
              </button>
            </footer>
          </>
        )}

        {error && <p className="error">{error}</p>}
      </div>
    </Modal>
  );
}

/**
 * 머리글의 구글 단추: 로그인 전 [구글 로그인], 연결이 끝났으면 [구글 다시 연결], 연결 중이면 작은 표시.
 */
export function GoogleHeaderButton() {
  const g = useGoogle();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  if (!g.configured) return null;
  if (g.connected)
    return (
      <a href="#settings/google" className="sync-badge g-on" title={g.email}>
        ● 구글
      </a>
    );
  return (
    <>
      {g.expired ? (
        <button
          className="primary small reconnect"
          title={error || '한 시간쯤 지나면 구글 연결이 끝나요. 눌러서 다시 연결하세요.'}
          onClick={() => signIn().then(() => setError(''), (e) => setError(message(e)))}
        >
          구글 다시 연결
        </button>
      ) : (
        <button className="ghost small reconnect" onClick={() => setOpen(true)}>
          구글 로그인
        </button>
      )}
      {/* 머리글(고정·흐림 효과) 안에 두면 창이 잘려서 body 에 그린다 */}
      {open && createPortal(<LoginDialog onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}
