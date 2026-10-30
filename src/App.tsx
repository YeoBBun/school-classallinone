import { useEffect, useState } from 'react';
import { BehaviorView } from './components/BehaviorView';
import { ChecklistView } from './components/ChecklistView';
import { Dashboard } from './components/Dashboard';
import { NuggaView } from './components/NuggaView';
import { PilsaView } from './components/PilsaView';
import { ScheduleView } from './components/ScheduleView';
import { SeatingView } from './components/SeatingView';
import { Icon, type IconName } from './components/icons';
import { RecordList } from './components/RecordList';
import { SettingsView } from './components/SettingsView';
import { StudentsView } from './components/StudentsView';
import { Today } from './components/Today';
import { signIn } from './google/google';
import { useGoogle } from './google/useGoogle';
import { StoreProvider, useNeedBackup, useStore } from './store';
import { isGithub, loadSyncConfig } from './sync/cloud';

/**
 * 메뉴는 오늘 / 더보기 / 설정. 매일 하는 일(출결, 학생 기록)은 오늘 화면에서 학생을 눌러 끝낸다.
 * «더보기» 는 화면을 넘기지 않고 그 자리에서 작은 창으로 연다 (어느 화면에서든 한 번에 이동).
 */
const MORE: readonly { id: 'schedule' | 'checklists' | 'pilsa' | 'seating' | 'nuga' | 'records'; label: string; icon: IconName }[] = [
  { id: 'schedule', label: '일정', icon: 'today' },
  { id: 'checklists', label: '제출물', icon: 'check' },
  { id: 'pilsa', label: '필사', icon: 'doc' },
  { id: 'seating', label: '자리', icon: 'grid' },
  { id: 'nuga', label: '생기부', icon: 'pen' },
  { id: 'records', label: '출결', icon: 'list' },
];

/** 한 화면 안의 탭: 주소는 따로 두어 예전 링크도 그대로 열린다 */
const SUBTABS = {
  records: [{ id: 'records', label: '기록' }, { id: 'stats', label: '통계' }],
  stats: [{ id: 'records', label: '기록' }, { id: 'stats', label: '통계' }],
  nuga: [{ id: 'nuga', label: '누가기록' }, { id: 'behavior', label: '행발' }],
  behavior: [{ id: 'nuga', label: '누가기록' }, { id: 'behavior', label: '행발' }],
} as const;

type Page = 'today' | (typeof MORE)[number]['id'] | 'students' | 'stats' | 'behavior' | 'settings';
const PAGES: readonly string[] = ['today', ...MORE.map((m) => m.id), 'students', 'stats', 'behavior', 'settings'];

/** 예전 주소(#dashboard, #calendar, #more)로 들어와도 맞는 화면을 연다. */
const LEGACY: Record<string, Page> = { dashboard: 'stats', calendar: 'records', more: 'today' };

/** 주소 뒤 #쪽/세부 (예: #students/학생id) */
function readRoute(): { page: Page; sub: string | null } {
  const [h, sub = null] = location.hash.slice(1).split('/');
  if (h in LEGACY) return { page: LEGACY[h], sub: null };
  const known = PAGES.includes(h);
  return { page: known ? (h as Page) : 'today', sub: known ? sub : null };
}

function Shell() {
  const { state, saveError, sync } = useStore();
  const [route, setRoute] = useState(readRoute);
  const [moreOpen, setMoreOpen] = useState(false);
  const needBackup = useNeedBackup();
  const { page, sub } = route;
  // 학생 기록은 오늘 화면에서 열리므로 «오늘»이 켜진 채로 둔다
  const tab = page === 'today' || page === 'students' ? 'today' : page === 'settings' ? 'settings' : 'more';

  useEffect(() => {
    const onHash = () => {
      setRoute(readRoute());
      setMoreOpen(false);
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden>
            학
          </span>
          <h1>
            학급관리
            {state.settings.className && <span className="class-name">{state.settings.className}</span>}
          </h1>
          <GoogleReconnect />
          {sync.kind === 'error' && (
            <a href="#settings/google" className="sync-badge error" title={sync.message}>
              ⚠ 동기화 안 됨
            </a>
          )}
        </div>
        <nav aria-label="메뉴">
          <a href="#today" className={tab === 'today' ? 'on' : ''} aria-current={tab === 'today' ? 'page' : undefined}>
            <Icon name="today" />
            <span className="nav-label">오늘</span>
          </a>
          <button
            className={`nav-btn${tab === 'more' || moreOpen ? ' on' : ''}`}
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(!moreOpen)}
          >
            <Icon name="grid" />
            <span className="nav-label">더보기</span>
          </button>
          <a href="#settings" className={tab === 'settings' ? 'on' : ''} aria-current={tab === 'settings' ? 'page' : undefined}>
            <Icon name="gear" />
            <span className="nav-label">설정</span>
            {needBackup && <span className="dot" title="백업할 때가 됐어요" />}
          </a>
        </nav>
      </header>
      {moreOpen && <MorePopup current={page} onClose={() => setMoreOpen(false)} />}
      {saveError && <div className="banner error">{saveError}</div>}
      <main>
        {page in SUBTABS && <SubTabs page={page as keyof typeof SUBTABS} />}
        {(page === 'today' || (page === 'students' && !sub)) && <Today />}
        {page === 'students' && sub && <StudentsView studentId={sub} />}
        {page === 'schedule' && <ScheduleView />}
        {page === 'records' && <RecordList initialView={location.hash === '#calendar' ? 'calendar' : 'list'} />}
        {page === 'stats' && <Dashboard />}
        {page === 'checklists' && <ChecklistView />}
        {page === 'pilsa' && <PilsaView />}
        {page === 'seating' && <SeatingView />}
        {page === 'nuga' && <NuggaView />}
        {page === 'behavior' && <BehaviorView />}
        {page === 'settings' && <SettingsView section={sub} />}
      </main>
    </div>
  );
}

/** 출결(기록·통계), 생기부(누가기록·행발) 안의 탭 */
function SubTabs({ page }: { page: keyof typeof SUBTABS }) {
  return (
    <div className="sub-head">
      <div className="seg">
        {SUBTABS[page].map((t) => (
          <a key={t.id} href={`#${t.id}`} className={`seg-link${t.id === page ? ' on' : ''}`}>
            {t.label}
          </a>
        ))}
      </div>
    </div>
  );
}

/** «더보기»: 화면을 넘기지 않고 작은 창으로 연다. 바깥을 누르거나 Esc 로 닫는다 */
function MorePopup({ current, onClose }: { current: Page; onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const group = (id: Page) => (id === 'stats' ? 'records' : id === 'behavior' ? 'nuga' : id);
  return (
    <div className="more-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="more-pop" role="dialog" aria-label="더보기">
        <ul className="more-grid">
          {MORE.map((m) => (
            <li key={m.id}>
              <a href={`#${m.id}`} className={`more-tile${group(current) === m.id ? ' on' : ''}`} onClick={onClose}>
                <Icon name={m.icon} size={26} />
                <b>{m.label}</b>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** 구글 연결이 끝났는데 드라이브·캘린더를 쓰고 있으면 머리글에 크게 띄운다 */
function GoogleReconnect() {
  const g = useGoogle();
  const { state } = useStore();
  const [error, setError] = useState('');
  const cfg = loadSyncConfig();
  const uses = (!!cfg && !isGithub(cfg)) || !!state.settings.calendarOn;
  if (!g.configured || g.connected || !uses) return null;
  return (
    <button
      className="primary small reconnect"
      title={error || '한 시간쯤 지나면 구글 연결이 끝나요. 눌러서 다시 연결하세요.'}
      onClick={() => signIn().then(() => setError(''), (e) => setError(e instanceof Error ? e.message : String(e)))}
    >
      구글 다시 연결
    </button>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
