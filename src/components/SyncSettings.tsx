import type { useStore } from '../store';

/** 기기 간 맞추기 상태 한 줄 (설정 → 구글 연결). 맞추기는 구글 드라이브로만 한다 */
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
