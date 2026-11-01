import { useState } from 'react';
import { signIn, signOut } from '../google/google';
import { CALENDAR_NAME } from '../google/calendarSync';
import { useGoogle } from '../google/useGoogle';
import { calendarWanted } from '../domain/types';
import { useStore } from '../store';
import { loadSyncConfig, saveSyncConfig } from '../sync/cloud';
import { LoginDialog } from './GoogleLogin';
import { SyncLine } from './SyncSettings';

/** 구글 연결: 로그인 하나로 캘린더(일정)·드라이브(자료, 기기 간 맞추기)·시트를 쓴다. 처음 로그인은 LoginDialog 가 맡는다 */
export function GoogleSettings() {
  const g = useGoogle();
  const { state, update, sync, syncNow, calendar, widgetSync } = useStore();
  const driveOn = !!loadSyncConfig();
  const [dialog, setDialog] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!g.configured) return null;

  const reconnect = async () => {
    setBusy(true);
    setError('');
    try {
      await signIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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

  const driveStop = () => {
    if (!confirm('다른 기기와 맞추기를 끌까요? 이 기기의 데이터는 그대로 남아요.')) return;
    saveSyncConfig(null);
    syncNow();
  };

  const calendarOn = calendarWanted(state.settings);
  // 켜면 기본값(넣기)으로 되돌리고, 끌 때만 false 를 남긴다
  const setCalendarOn = (on: boolean) => update((s) => ({ ...s, settings: { ...s.settings, calendarOn: on ? undefined : false } }));

  return (
    <section className="card">
      <h3>구글 연결</h3>
      {!g.connected ? (
        <>
          <p className="hint">
            구글로 로그인하면 일정이 구글 캘린더에 들어가고, 자료가 구글 드라이브에 저장되고, 휴대폰·PC가 같은 기록을 봐요. 앱은 내 드라이브의
            '학급관리' 폴더와 앱이 만든 캘린더에만 접근해요.
          </p>
          {g.expired ? (
            <>
              <p className="banner">구글 연결이 끝났어요 (한 시간쯤 지나면 끝나요). 다시 연결해 주세요.</p>
              <button className="primary big" onClick={reconnect} disabled={busy}>
                {busy ? '연결 중…' : '구글 다시 연결'}
              </button>
            </>
          ) : (
            <button className="primary big" onClick={() => setDialog(true)}>
              구글로 로그인
            </button>
          )}
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
                {widgetSync.kind === 'error' && <p className="error">휴대폰 위젯용 요약을 못 올렸어요: {widgetSync.message}</p>}
                <button className="ghost small" onClick={driveStop}>
                  끄기
                </button>
              </>
            ) : (
              <>
                <p className="hint">기록을 잠금 비밀번호로 잠가 내 드라이브에 두고, 같은 구글 계정으로 로그인한 기기끼리 맞춰요.</p>
                <button className="primary" onClick={() => setDialog(true)}>
                  켜기
                </button>
              </>
            )}
          </div>

          <div className="option">
            <h4>구글 캘린더</h4>
            <label className="check">
              <input type="checkbox" checked={calendarOn} onChange={(e) => setCalendarOn(e.target.checked)} />
              일정(상담·학급 행사)과 제출 마감을 캘린더 '{CALENDAR_NAME}'에 넣기
            </label>
            {calendarOn && !g.calendar && <p className="error">캘린더 권한이 없어요. 연결을 끊고 다시 로그인할 때 캘린더에 체크해 주세요.</p>}
            {calendarOn && calendar.kind === 'error' && <p className="error">캘린더에 넣지 못했어요: {calendar.message}</p>}
            {calendarOn && calendar.kind === 'ok' && (
              <p className="sync-status done">✓ 일정 {state.calendarLinks.length}개가 캘린더에 들어가 있어요</p>
            )}
            <p className="hint">캘린더에는 학생 이름과 일시만 들어가고, 상담 내용은 들어가지 않아요.</p>
          </div>

          <div className="option">
            <h4>구글 드라이브 자료 · 시트</h4>
            <p className="hint">
              더보기 → 자료에 올린 파일은 드라이브 '학급관리/자료' 폴더에 저장돼요. 출결 통계·제출물 화면의 [구글 시트로]는 '학급관리' 폴더에 시트를
              만들어요.
            </p>
          </div>
        </>
      )}
      {error && <p className="error">{error}</p>}
      {dialog && <LoginDialog onClose={() => setDialog(false)} />}
    </section>
  );
}
