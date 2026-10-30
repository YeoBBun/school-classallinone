import { useEffect, useState } from 'react';
import { BehaviorView } from './components/BehaviorView';
import { ChecklistView } from './components/ChecklistView';
import { Dashboard } from './components/Dashboard';
import { IncidentsView } from './components/IncidentsView';
import { NuggaView } from './components/NuggaView';
import { PilsaView } from './components/PilsaView';
import { SeatingView } from './components/SeatingView';
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

type MoreId = 'checklists' | 'pilsa' | 'incidents' | 'seating' | 'behavior' | 'nuga' | 'records' | 'stats' | 'settings';

/** «더보기» 안의 화면, 묶음별로 */
const MORE_GROUPS: readonly { title: string; items: readonly { id: MoreId; label: string; desc: string; icon: IconName }[] }[] = [
  {
    title: '학급',
    items: [
      { id: 'checklists', label: '제출물 체크', desc: '동의서·가정통신문 회신 걷기, 안 낸 학생 복사', icon: 'check' },
      { id: 'pilsa', label: '명심보감 필사', desc: '필사 부여, 장마다 낸 것 체크', icon: 'doc' },
      { id: 'incidents', label: '사안 관리', desc: '다툼 등 학급 사안의 경과 기록, 인쇄', icon: 'alert' },
      { id: 'seating', label: '자리 배치', desc: '조건 지켜 섞기, 교탁용·게시용 인쇄', icon: 'grid' },
    ],
  },
  {
    title: '나이스 · 생기부',
    items: [
      { id: 'nuga', label: '나이스 누가기록', desc: '관찰·상담 기록을 복사해 누가기록에 넣기', icon: 'upload' },
      { id: 'behavior', label: '행발 쓰기', desc: '1년 기록을 보며 행동특성 및 종합의견 쓰기', icon: 'pen' },
    ],
  },
  {
    title: '출결',
    items: [
      { id: 'records', label: '출결 기록', desc: '목록·달력으로 출결 보기, 나이스 파일', icon: 'list' },
      { id: 'stats', label: '출결 통계', desc: '학생별 결석일수, 체험학습 일수, 엑셀·구글 시트', icon: 'chart' },
    ],
  },
  {
    title: '설정',
    items: [{ id: 'settings', label: '설정', desc: '학생 명단, 휴일, 백업, 구글 연결', icon: 'gear' }],
  },
];
const MORE = MORE_GROUPS.flatMap((g) => g.items);

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
            학
          </span>
          <h1>
            학급관리
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
        {page === 'checklists' && <ChecklistView />}
        {page === 'pilsa' && <PilsaView />}
        {page === 'incidents' && <IncidentsView />}
        {page === 'seating' && <SeatingView />}
        {page === 'nuga' && <NuggaView />}
        {page === 'behavior' && <BehaviorView />}
        {page === 'settings' && <SettingsView />}
      </main>
    </div>
  );
}

function MoreMenu({ needBackup }: { needBackup: boolean }) {
  return (
    <div className="more-menu">
      {MORE_GROUPS.map((g) => (
        <section key={g.title}>
          <h3 className="section-title">{g.title}</h3>
          <ul>
            {g.items.map((m) => (
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
        </section>
      ))}
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
