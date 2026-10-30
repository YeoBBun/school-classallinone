import { useState } from 'react';
import { createSheet, hasToken, isConfigured, signIn } from '../google/google';
import { Icon } from './icons';

/**
 * 표를 구글 시트로 만든다. 연결이 끝났으면 로그인부터 한다.
 * 다 만들면 [시트 열기] 링크를 보인다 (자동으로 새 탭을 열면 팝업 차단에 걸린다).
 */
export function SheetButton({ title, rows }: { title: string; rows: () => string[][] }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [url, setUrl] = useState('');
  if (!isConfigured) return null;
  const run = async () => {
    setBusy(true);
    setError('');
    try {
      if (!hasToken()) await signIn();
      setUrl(await createSheet(title, rows()));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  if (url)
    return (
      <a className="button" href={url} target="_blank" rel="noreferrer" onClick={() => setTimeout(() => setUrl(''), 500)}>
        <Icon name="check" size={15} /> 시트 열기
      </a>
    );
  return (
    <>
      <button type="button" onClick={run} disabled={busy} title="내 구글 드라이브 '학급관리' 폴더에 만들어요">
        <Icon name="grid" size={15} /> {busy ? '만드는 중…' : '구글 시트로'}
      </button>
      {error && <span className="error small">{error}</span>}
    </>
  );
}
