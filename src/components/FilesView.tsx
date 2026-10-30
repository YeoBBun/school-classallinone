import { useCallback, useEffect, useRef, useState } from 'react';
import { formatStamp } from '../domain/calendar';
import { AuthError, filesFolder, listFiles, ROOT_FOLDER, FILES_FOLDER, signIn, trashFile, uploadFile, type DriveFile } from '../google/google';
import { useGoogle } from '../google/useGoogle';
import { LoginDialog } from './GoogleLogin';
import { Icon } from './icons';
import { PageHead } from './ui';

const message = (e: unknown) =>
  e instanceof AuthError ? e.message : e instanceof Error ? e.message : '인터넷에 연결되지 않았거나 이 네트워크에서 구글이 막혀 있어요.';

/** 1234567 → 1.2MB */
function size(bytes?: string): string {
  if (!bytes) return '';
  const n = Number(bytes);
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

/** 이름 끝의 확장자 (구글 문서는 종류 이름) */
function ext(f: DriveFile): string {
  if (f.mimeType.startsWith('application/vnd.google-apps.')) return { document: '문서', spreadsheet: '시트', presentation: '슬라이드' }[f.mimeType.slice(28)] ?? '구글';
  const m = /\.([a-z0-9]{1,5})$/i.exec(f.name);
  return m ? m[1].toUpperCase() : '파일';
}

/**
 * 자료: 올린 파일은 내 구글 드라이브 '학급관리/자료' 폴더로 바로 간다. 목록도 드라이브에서 읽어
 * 같은 구글 계정으로 로그인한 다른 기기에서도 같은 자료가 보인다.
 */
export function FilesView() {
  const g = useGoogle();
  const [files, setFiles] = useState<DriveFile[] | null>(null);
  const [folder, setFolder] = useState('');
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [over, setOver] = useState(false);
  const [query, setQuery] = useState('');
  const [login, setLogin] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const id = await filesFolder();
      setFolder(id);
      setFiles(await listFiles(id));
    } catch (e) {
      setError(message(e));
    }
  }, []);

  useEffect(() => {
    if (g.connected) void load();
  }, [g.connected, load]);

  const upload = async (list: FileList | File[]) => {
    const picked = [...list];
    if (!picked.length) return;
    setError('');
    setUploading({ done: 0, total: picked.length });
    try {
      const id = folder || (await filesFolder());
      for (const [i, f] of picked.entries()) {
        const saved = await uploadFile(id, f);
        setFiles((cur) => [saved, ...(cur ?? []).filter((x) => x.id !== saved.id)]);
        setUploading({ done: i + 1, total: picked.length });
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setUploading(null);
      if (input.current) input.current.value = '';
    }
  };

  const remove = async (f: DriveFile) => {
    if (!confirm(`'${f.name}'을 드라이브 휴지통으로 옮길까요? (30일 안에는 드라이브에서 되살릴 수 있어요)`)) return;
    try {
      await trashFile(f.id);
      setFiles((cur) => (cur ?? []).filter((x) => x.id !== f.id));
    } catch (e) {
      setError(message(e));
    }
  };

  if (!g.configured) {
    return (
      <div className="module">
        <PageHead title="자료" />
        <p className="muted">이 앱에는 구글 연결이 설정되어 있지 않아요.</p>
      </div>
    );
  }

  if (!g.connected) {
    return (
      <div className="module">
        <PageHead title="자료" />
        <section className="card">
          <p>
            자료는 내 구글 드라이브의 '{ROOT_FOLDER}/{FILES_FOLDER}' 폴더에 저장돼요. 구글로 로그인하면 올리고 볼 수 있어요.
          </p>
          {g.expired ? (
            <button className="primary big" onClick={() => signIn().catch((e) => setError(message(e)))}>
              구글 다시 연결
            </button>
          ) : (
            <button className="primary big" onClick={() => setLogin(true)}>
              구글로 로그인
            </button>
          )}
          {error && <p className="error">{error}</p>}
        </section>
        {login && <LoginDialog onClose={() => setLogin(false)} />}
      </div>
    );
  }

  const shown = (files ?? []).filter((f) => !query.trim() || f.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="module">
      <PageHead title="자료">
        {folder && (
          <a className="button ghost small" href={`https://drive.google.com/drive/folders/${folder}`} target="_blank" rel="noopener noreferrer">
            드라이브에서 열기
          </a>
        )}
      </PageHead>

      <section
        className={`card drop-zone${over ? ' over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void upload(e.dataTransfer.files);
        }}
      >
        <Icon name="upload" size={26} />
        <span>파일을 여기로 끌어 놓거나</span>
        <button className="primary" onClick={() => input.current?.click()} disabled={!!uploading}>
          {uploading ? `올리는 중… ${uploading.done}/${uploading.total}` : '파일 올리기'}
        </button>
        <input ref={input} type="file" multiple hidden onChange={(e) => e.target.files && void upload(e.target.files)} />
        <span className="hint">
          내 구글 드라이브 '{ROOT_FOLDER}/{FILES_FOLDER}' 폴더에 저장돼요. 학생 개인정보가 든 파일은 공유 설정에 주의하세요.
        </span>
      </section>

      {error && <p className="error">{error}</p>}

      <section className="card">
        <div className="card-head">
          <h3>올린 자료</h3>
          {files && <span className="muted">{files.length}개</span>}
          <span className="spacer" />
          {(files?.length ?? 0) > 8 && <input className="narrow" value={query} placeholder="이름으로 찾기" onChange={(e) => setQuery(e.target.value)} />}
        </div>
        {files === null ? (
          !error && <p className="muted">드라이브에서 불러오는 중…</p>
        ) : shown.length === 0 ? (
          <p className="muted">{files.length ? '찾는 자료가 없어요.' : '아직 올린 자료가 없어요.'}</p>
        ) : (
          <ul className="file-list">
            {shown.map((f) => (
              <li key={f.id}>
                <span className="ext">{ext(f)}</span>
                <a className="name" href={f.webViewLink} target="_blank" rel="noopener noreferrer">
                  {f.name}
                </a>
                <span className="meta">
                  {formatStamp(f.modifiedTime)}
                  {f.size && ` · ${size(f.size)}`}
                </span>
                <button className="ghost small" title="휴지통으로" aria-label={`${f.name} 지우기`} onClick={() => void remove(f)}>
                  <Icon name="x" size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="hint">이 앱으로 올린 파일만 보여요. 드라이브에서 직접 넣은 파일은 드라이브에서 열어 주세요.</p>
      </section>
    </div>
  );
}
