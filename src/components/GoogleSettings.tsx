import { useState } from 'react';
import { signIn, signOut } from '../google/google';
import { CALENDAR_NAME } from '../google/calendarSync';
import { useGoogle } from '../google/useGoogle';
import { useStore } from '../store';
import { isGithub, loadSyncConfig, saveSyncConfig } from '../sync/cloud';
import { SyncLine } from './SyncSettings';

/** 구글 연결: 로그인 하나로 드라이브(기기 간 맞추기)·캘린더·시트를 쓴다 */
export function GoogleSettings() {
  const g = useGoogle();
  const { state, update, sync, syncNow, calendar } = useStore();
  const cfg = loadSyncConfig();
  const driveOn = !!cfg && !isGithub(cfg);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!g.configured) return null;

  const connect = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await signIn();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const disconnect = () => {
    if (!confirm('구글 연결을 끊을까요? 이 기기의 데이터는 그대로 남아요.')) return;
    signOut();
    if (driveOn) saveSyncConfig(null);
    syncNow();
  };

  const driveStart = () => {
    if (pass.length < 8) return setMsg({ ok: false, text: '잠금 비밀번호는 8자 이상으로 정해 주세요.' });
    if (pass !== pass2) return setMsg({ ok: false, text: '잠금 비밀번호 두 칸이 서로 달라요.' });
    if (cfg && isGithub(cfg) && !confirm('지금은 깃허브로 맞추고 있어요. 구글 드라이브로 바꿀까요?')) return;
    saveSyncConfig({ kind: 'google', passphrase: pass });
    setPass('');
    setPass2('');
    setMsg({ ok: true, text: '켰어요. 다른 기기에서도 같은 구글 계정으로 로그인하고 같은 잠금 비밀번호를 넣으면 서로 맞춰져요.' });
    syncNow();
  };

  const driveStop = () => {
    if (!confirm('다른 기기와 맞추기를 끌까요? 이 기기의 데이터는 그대로 남아요.')) return;
    saveSyncConfig(null);
    syncNow();
  };

  const setCalendarOn = (on: boolean) => update((s) => ({ ...s, settings: { ...s.settings, calendarOn: on || undefined } }));

  return (
    <section className="card">
      <h3>구글 연결</h3>
      {!g.connected ? (
        <>
          <p className="hint">
            구글로 로그인하면 휴대폰·PC를 서로 맞추고, 상담 일정을 구글 캘린더에 넣고, 표를 구글 시트로 만들 수 있어요. 앱은 내 드라이브의
            '학급관리' 폴더와 앱이 만든 캘린더에만 접근해요.
          </p>
          {g.expired && <p className="banner">구글 연결이 끝났어요 (한 시간쯤 지나면 끝나요). 다시 연결해 주세요.</p>}
          <button className="primary big" onClick={connect} disabled={busy}>
            {busy ? '연결 중…' : g.expired ? '구글 다시 연결' : '구글로 로그인'}
          </button>
        </>
      ) : (
        <>
          <p className="sync-status done">
            ✓ {g.email || '구글 계정'} 연결됨{' '}
            <button className="link" onClick={disconnect}>
              연결 끊기
            </button>
          </p>

          <div className="option">
            <h4>다른 기기와 맞추기</h4>
            {driveOn ? (
              <>
                <SyncLine status={sync} onRetry={syncNow} />
                <button className="ghost small" onClick={driveStop}>
                  끄기
                </button>
              </>
            ) : (
              <>
                <p className="hint">
                  데이터를 잠금 비밀번호로 잠가 내 드라이브에 둬요. 다른 기기에서도 <b>같은 잠금 비밀번호</b>를 넣어야 해요. 잊으면 드라이브에 있는
                  것은 열 수 없으니 꼭 적어 두세요 (이 기기의 데이터와 백업 파일은 남아요).
                </p>
                <div className="sync-form">
                  <label>
                    <span className="field-label">잠금 비밀번호 (8자 이상)</span>
                    <input type="password" value={pass} autoComplete="new-password" onChange={(e) => setPass(e.target.value)} />
                  </label>
                  <label>
                    <span className="field-label">한 번 더</span>
                    <input type="password" value={pass2} autoComplete="new-password" onChange={(e) => setPass2(e.target.value)} />
                  </label>
                </div>
                <button className="primary" onClick={driveStart}>
                  켜기
                </button>
              </>
            )}
          </div>

          <div className="option">
            <h4>구글 캘린더</h4>
            <label className="check">
              <input type="checkbox" checked={!!state.settings.calendarOn} onChange={(e) => setCalendarOn(e.target.checked)} />
              학부모 상담 일정과 제출 마감을 캘린더 '{CALENDAR_NAME}'에 넣기
            </label>
            {state.settings.calendarOn && !g.calendar && <p className="error">캘린더 권한이 없어요. 연결을 끊고 다시 로그인할 때 캘린더에 체크해 주세요.</p>}
            {state.settings.calendarOn && calendar.kind === 'error' && <p className="error">캘린더에 넣지 못했어요: {calendar.message}</p>}
            {state.settings.calendarOn && calendar.kind === 'ok' && (
              <p className="sync-status done">✓ 일정 {state.calendarLinks.length}개가 캘린더에 들어가 있어요</p>
            )}
            <p className="hint">캘린더에는 학생 이름과 일시만 들어가고, 상담 내용은 들어가지 않아요.</p>
          </div>

          <div className="option">
            <h4>구글 시트</h4>
            <p className="hint">출결 통계·제출물 화면의 [구글 시트로] 버튼을 누르면 드라이브 '학급관리' 폴더에 시트가 만들어져요.</p>
          </div>
        </>
      )}
      {msg && <p className={msg.ok ? 'info' : 'error'}>{msg.text}</p>}
    </section>
  );
}
