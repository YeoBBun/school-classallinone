import { useEffect, useState } from 'react';
import { Dashboard } from './components/Dashboard';
import { Icon, type IconName } from './components/icons';
import { RecordList } from './components/RecordList';
import { SettingsView } from './components/SettingsView';
import { StudentsView } from './components/StudentsView';
import { Today } from './components/Today';
import { StoreProvider, useNeedBackup, useStore } from './store';

/** 아래(휴대폰)·위(PC) 메뉴는 셋만 둔다. 나머지는 «더보기» 안에 있다. */
const TABS: readonly { id: 'today' | 'students' | 'more'; label: string; icon: IconName }[] = [
  { id: 'today', label: '오늘', icon: 'today' },
  { id: 'students', label: '학생', icon: 'people' },
  { id: 'more', label: '더보기', icon: 'grid' },
];

/** «더보기» 안의 화면 */
const MORE: readonly { id: 'records' | 'stats' | 'settings'; label: string; desc: string; icon: IconName }[] = [
  { id: 'records', label: '출결 기록', desc: '목록·달력으로 출결 보기, 나이스 파일', icon: 'list' },
  { id: 'stats', label: '출결 통계', desc: '학생별 결석일수, 체험학습 일수, 엑셀 내보내기', icon: 'chart' },
  { id: 'settings', label: '설정', desc: '학생 명단, 휴일, 백업, 다른 기기와 맞추기', icon: 'gear' },
];

type Page = (typeof TABS)[number]['id'] | (typeof MORE)[number]['id'];

/** 예전 주소(#dashboard, #calendar)로 들어와도 맞는 화면을 연다. */
const LEGACY: Record<string, Page> = { dashboard: 'stats', calendar: 'records' };

/** 주소 뒤 #쪽/세부 (예: #students/학생id) */
function readRoute(): { page: Page; sub: string | null } {
  const [h, sub = null] = location.hash.slice(1).split('/');
  if (h in LEGACY) return { page: LEGACY[h], sub: null };
  const known = [...TABS, ...MORE].some((t) => t.id === h);
  return { page: known ? (h as Page) : 'today', sub: known ? sub : null };
}

function Shell() {
  const { state, saveError, sync } = useStore();
  const [route, setRoute] = useState(readRoute);
  const needBackup = useNeedBackup();
  const { page, sub } = route;
  const tab = TABS.some((t) => t.id === page) ? page : 'more';

  useEffect(() => {
    const onHash = () => {
      setRoute(readRoute());
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
            출
          </span>
          <h1>
            출결·서류 관리
            {state.settings.className && <span className="class-name">{state.settings.className}</span>}
          </h1>
          {sync.kind !== 'off' && (
            <a href="#settings" className={`sync-badge ${sync.kind}`} title={sync.kind === 'error' ? sync.message : '휴대폰 ↔ PC 동기화'}>
              {sync.kind === 'error' ? '⚠ 동기화 안 됨' : sync.kind === 'syncing' ? '⟳ 맞추는 중' : '✓ 동기화됨'}
            </a>
          )}
        </div>
        <nav aria-label="메뉴">
          {TABS.map((t) => (
            <a key={t.id} href={`#${t.id}`} className={tab === t.id ? 'on' : ''} aria-current={tab === t.id ? 'page' : undefined}>
              <Icon name={t.icon} />
              <span className="nav-label">{t.label}</span>
              {t.id === 'more' && needBackup && <span className="dot" title="백업할 때가 됐어요" />}
            </a>
          ))}
        </nav>
      </header>
      {saveError && <div className="banner error">{saveError}</div>}
      <main>
        {tab === 'more' && page !== 'more' && (
          <a href="#more" className="button ghost back-link">
            <Icon name="left" /> 더보기
          </a>
        )}
        {page === 'today' && <Today />}
        {page === 'students' && <StudentsView studentId={sub} />}
        {page === 'more' && <MoreMenu needBackup={needBackup} />}
        {page === 'records' && <RecordList initialView={location.hash === '#calendar' ? 'calendar' : 'list'} />}
        {page === 'stats' && <Dashboard />}
        {page === 'settings' && <SettingsView />}
      </main>
    </div>
  );
}

function MoreMenu({ needBackup }: { needBackup: boolean }) {
  return (
    <ul className="more-menu">
      {MORE.map((m) => (
        <li key={m.id}>
          <a href={`#${m.id}`} className="more-item">
            <Icon name={m.icon} size={22} />
            <span>
              <b>{m.label}</b>
              <span className="muted">{m.desc}</span>
            </span>
            {m.id === 'settings' && needBackup && <span className="count-badge">백업</span>}
            <Icon name="right" />
          </a>
        </li>
      ))}
    </ul>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
