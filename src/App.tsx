import { useEffect, useState } from 'react';
import { BehaviorView } from './components/BehaviorView';
import { ChecklistView } from './components/ChecklistView';
import { Dashboard } from './components/Dashboard';
import { FieldTripIntake } from './components/FieldTripIntake';
import { NuggaView } from './components/NuggaView';
import { PilsaView } from './components/PilsaView';
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
 * 메뉴는 «오늘»과 «더보기» 둘. 매일 하는 일(출결, 학생 기록)은 오늘 화면에서 학생을 눌러 끝낸다.
 * 설정은 머리글의 톱니바퀴.
 */
const TABS: readonly { id: 'today' | 'more'; label: string; icon: IconName }[] = [
  { id: 'today', label: '오늘', icon: 'today' },
  { id: 'more', label: '더보기', icon: 'grid' },
];

/** «더보기» 안의 화면 (출결·생기부는 안에서 탭으로 나뉜다) */
const MORE: readonly { id: 'checklists' | 'pilsa' | 'seating' | 'nuga' | 'records'; label: string; icon: IconName }[] = [
  { id: 'checklists', label: '제출물', icon: 'check' },
  { id: 'pilsa', label: '필사', icon: 'doc' },
  { id: 'seating', label: '자리', icon: 'grid' },
  { id: 'nuga', label: '생기부', icon: 'pen' },
  { id: 'records', label: '출결', icon: 'list' },
];

/** 한 화면 안의 탭: 주소는 따로 두어 예전 링크도 그대로 열린다 */
const SUBTABS = {
  records: { group: '출결', tabs: [{ id: 'records', label: '기록' }, { id: 'stats', label: '통계' }] },
  stats: { group: '출결', tabs: [{ id: 'records', label: '기록' }, { id: 'stats', label: '통계' }] },
  nuga: { group: '생기부', tabs: [{ id: 'nuga', label: '누가기록' }, { id: 'behavior', label: '행발' }] },
  behavior: { group: '생기부', tabs: [{ id: 'nuga', label: '누가기록' }, { id: 'behavior', label: '행발' }] },
} as const;

type Page = (typeof TABS)[number]['id'] | (typeof MORE)[number]['id'] | 'students' | 'stats' | 'behavior' | 'settings';
const PAGES: readonly string[] = [...TABS.map((t) => t.id), ...MORE.map((m) => m.id), 'students', 'stats', 'behavior', 'settings'];

/** 예전 주소(#dashboard, #calendar)로 들어와도 맞는 화면을 연다. */
const LEGACY: Record<string, Page> = { dashboard: 'stats', calendar: 'records' };

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
  const needBackup = useNeedBackup();
  const { page, sub } = route;
  // 학생 기록은 오늘 화면에서 열리므로 «오늘»이 켜진 채로 둔다
  const tab = page === 'today' || page === 'students' ? 'today' : page === 'settings' ? null : 'more';

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
          <a href="#settings" className={`icon-btn settings-btn${page === 'settings' ? ' on' : ''}`} aria-label="설정" title="설정">
            <Icon name="gear" size={20} />
            {needBackup && <span className="dot" title="백업할 때가 됐어요" />}
          </a>
        </div>
        <nav aria-label="메뉴">
          {TABS.map((t) => (
            <a key={t.id} href={`#${t.id}`} className={tab === t.id ? 'on' : ''} aria-current={tab === t.id ? 'page' : undefined}>
              <Icon name={t.icon} />
              <span className="nav-label">{t.label}</span>
            </a>
          ))}
        </nav>
      </header>
      {saveError && <div className="banner error">{saveError}</div>}
      <main>
        {tab === 'more' && page !== 'more' && <SubHead page={page} />}
        {(page === 'today' || (page === 'students' && !sub)) && <Today />}
        {page === 'students' && sub && <StudentsView studentId={sub} />}
        {page === 'more' && <MoreMenu />}
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

/** «더보기» 안 화면 위: 뒤로 가기와 (있으면) 그 묶음의 탭 */
function SubHead({ page }: { page: Page }) {
  const sub = SUBTABS[page as keyof typeof SUBTABS];
  const [trip, setTrip] = useState(false);
  return (
    <div className="sub-head">
      <a href="#more" className="button ghost back-link">
        <Icon name="left" /> 더보기
      </a>
      {sub && (
        <>
          <div className="seg">
            {sub.tabs.map((t) => (
              <a key={t.id} href={`#${t.id}`} className={`seg-link${t.id === page ? ' on' : ''}`}>
                {t.label}
              </a>
            ))}
          </div>
          {sub.group === '출결' && (
            <>
              <span className="spacer" />
              <button className="small" onClick={() => setTrip(true)}>
                <Icon name="plane" size={15} /> 체험학습 접수
              </button>
            </>
          )}
        </>
      )}
      {trip && <FieldTripIntake onClose={() => setTrip(false)} />}
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

function MoreMenu() {
  return (
    <ul className="more-grid">
      {MORE.map((m) => (
        <li key={m.id}>
          <a href={`#${m.id}`} className="more-tile">
            <Icon name={m.icon} size={26} />
            <b>{m.label}</b>
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
