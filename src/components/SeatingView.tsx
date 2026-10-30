import { useMemo, useState } from 'react';
import { formatKo, today } from '../domain/calendar';
import { FRONT_ROWS, penalty, partnerPairs, resizeSeats, shuffleSeats, viewRows } from '../domain/seating';
import type { SeatingRules, SeatPlan, Student } from '../domain/types';
import { newId, useStore } from '../store';
import { Modal, sortStudents } from './common';
import { PageHead, PrintSheet, StudentChips, toggleIn } from './ui';

/** 저장하지 않은 배치 — 다른 화면에 갔다 와도 남아 있게 (새로 고치면 사라진다) */
let draftSeats: (string | null)[] | null = null;

/** 자리 배치: 섞기(조건 지키기), 두 자리 눌러 바꾸기, 교탁용·게시용 인쇄 */
export function SeatingView() {
  const { state, update } = useStore();
  const rules = state.settings.seating;
  const plans = useMemo(() => [...state.seatPlans].sort((a, b) => a.date.localeCompare(b.date) || (a.updatedAt ?? '').localeCompare(b.updatedAt ?? '')), [state.seatPlans]);
  const last = plans.at(-1) ?? null;
  const [seats, setSeatsState] = useState<(string | null)[]>(() =>
    draftSeats?.length === rules.rows * rules.cols
      ? draftSeats
      : last && last.rows === rules.rows && last.cols === rules.cols
        ? last.seats
        : resizeSeats(last?.seats ?? [], rules.rows, rules.cols),
  );
  const setSeats = (next: (string | null)[]) => {
    draftSeats = next;
    setSeatsState(next);
  };
  const [picked, setPicked] = useState<number | null>(null);
  const [editingRules, setEditingRules] = useState(false);
  const [printing, setPrinting] = useState<'teacher' | 'student' | null>(null);
  const [notice, setNotice] = useState('');

  const byId = new Map(state.students.map((s) => [s.id, s]));
  const seated = new Set(seats.filter(Boolean));
  const unseated = sortStudents(state.students).filter((s) => !seated.has(s.id));
  const saved = !!last && last.rows === rules.rows && last.cols === rules.cols && last.pair === rules.pair && last.seats.join() === seats.join();
  const problems = penalty(seats, rules, new Set());
  // 지금 보이는 배치의 «지난번» (저장했으면 그 앞의 것)
  const previous = saved ? (plans.at(-2) ?? null) : last;

  const setRules = (patch: Partial<SeatingRules>) => {
    const next = { ...rules, ...patch };
    update((s) => ({ ...s, settings: { ...s.settings, seating: next } }));
    if (patch.rows !== undefined || patch.cols !== undefined) setSeats(resizeSeats(seats, next.rows, next.cols));
  };

  const shuffle = () => {
    const ids = sortStudents(state.students).map((s) => s.id);
    if (ids.length > rules.rows * rules.cols) return setNotice(`자리(${rules.rows * rules.cols})가 학생 수(${ids.length})보다 적어요. 줄이나 칸을 늘려 주세요.`);
    // 지금 교실에 앉은 자리(마지막으로 저장한 것)의 짝과 겹치지 않게
    const r = shuffleSeats(ids, rules, last?.seats ?? null);
    setSeats(r.seats);
    setPicked(null);
    setNotice(r.penalty >= 100 ? '조건을 모두 지키는 배치를 못 찾았어요. 조건을 줄이거나 다시 섞어 보세요.' : '');
  };

  const tap = (i: number) => {
    if (picked === null) return setPicked(i);
    if (picked !== i) {
      const next = [...seats];
      [next[picked], next[i]] = [next[i], next[picked]];
      setSeats(next);
    }
    setPicked(null);
  };

  const place = (id: string) => {
    const empty = picked !== null && !seats[picked] ? picked : seats.indexOf(null);
    if (empty < 0) return setNotice('빈자리가 없어요. 줄이나 칸을 늘려 주세요.');
    const next = [...seats];
    next[empty] = id;
    setSeats(next);
    setPicked(null);
  };

  const save = () => {
    const plan: SeatPlan = { id: newId(), date: today(), rows: rules.rows, cols: rules.cols, pair: rules.pair, seats };
    update((s) => ({ ...s, seatPlans: [...s.seatPlans, plan] }));
    setNotice('저장했어요.');
  };

  const load = (id: string) => {
    const p = plans.find((x) => x.id === id);
    if (!p) return;
    setRules({ rows: p.rows, cols: p.cols, pair: p.pair });
    setSeats(p.seats);
  };

  return (
    <div className="module">
      <PageHead title="자리 배치">
        {plans.length > 1 && (
          <select value="" onChange={(e) => load(e.target.value)} aria-label="지난 자리 불러오기">
            <option value="">지난 자리 보기…</option>
            {[...plans].reverse().map((p) => (
              <option key={p.id} value={p.id}>
                {formatKo(p.date)} ({p.rows}×{p.cols})
              </option>
            ))}
          </select>
        )}
      </PageHead>

      <div className="toolbar">
        <label className="inline">
          <input type="number" className="tiny" min={1} max={12} value={rules.rows} onChange={(e) => setRules({ rows: clamp(e.target.value) })} />줄
        </label>
        <label className="inline">
          <input type="number" className="tiny" min={1} max={12} value={rules.cols} onChange={(e) => setRules({ cols: clamp(e.target.value) })} />칸
        </label>
        <label className="check">
          <input type="checkbox" checked={rules.pair} onChange={(e) => setRules({ pair: e.target.checked })} />
          짝
        </label>
        <button className="ghost small" onClick={() => setEditingRules(true)}>
          조건 {rules.front.length + rules.apart.length > 0 ? `(${rules.front.length + rules.apart.length})` : ''}
        </button>
        <span className="spacer" />
        <button className="primary" onClick={shuffle}>
          자리 섞기
        </button>
        <button onClick={save} disabled={saved}>
          {saved ? '저장됨' : '저장'}
        </button>
      </div>

      {notice && <p className="info">{notice}</p>}
      {problems >= 100 && <p className="banner">지금 배치는 조건(앞자리·떨어뜨리기)을 지키지 않아요.</p>}

      <div className="classroom">
        <div className="board">칠판 · 교탁</div>
        <SeatGrid
          seats={seats}
          rules={rules}
          byId={byId}
          picked={picked}
          onTap={tap}
          previousPairs={previous && rules.pair ? partnerPairs(previous.seats, previous.cols) : null}
        />
      </div>
      {picked !== null && <p className="info">바꿀 자리를 누르세요.</p>}

      {unseated.length > 0 && (
        <section className="card">
          <h3>자리 없는 학생 {unseated.length}명</h3>
          <div className="chips">
            {unseated.map((s) => (
              <button key={s.id} className="chip" onClick={() => place(s.id)}>
                {s.number} {s.name}
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="inline print-actions">
        <button onClick={() => setPrinting('teacher')}>교탁용 인쇄 (교사 시점)</button>
        <button onClick={() => setPrinting('student')}>게시용 인쇄 (학생 시점)</button>
      </div>

      {editingRules && <RulesForm onClose={() => setEditingRules(false)} />}
      {printing && (
        <PrintSheet landscape onDone={() => setPrinting(null)}>
          <SeatPrint seats={seats} rules={rules} byId={byId} view={printing} className={state.settings.className} />
        </PrintSheet>
      )}
    </div>
  );
}

const clamp = (v: string) => Math.min(12, Math.max(1, Math.round(Number(v)) || 1));

function SeatGrid({
  seats,
  rules,
  byId,
  picked,
  onTap,
  previousPairs,
}: {
  seats: (string | null)[];
  rules: SeatingRules;
  byId: Map<string, Student>;
  picked: number | null;
  onTap: (i: number) => void;
  previousPairs: Set<string> | null;
}) {
  const partners = rules.pair ? partnerPairs(seats, rules.cols) : new Set<string>();
  return (
    <div className={`seat-grid${rules.pair ? ' paired' : ''}`} style={{ gridTemplateColumns: `repeat(${rules.cols}, minmax(0, 1fr))` }}>
      {seats.map((id, i) => {
        const s = id ? byId.get(id) : undefined;
        const front = !!id && rules.front.includes(id) && Math.floor(i / rules.cols) < FRONT_ROWS;
        const pairKey = id && i % 2 === 0 && seats[i + 1] ? [id, seats[i + 1]!].sort().join('|') : '';
        const repeat = !!pairKey && partners.has(pairKey) && !!previousPairs?.has(pairKey);
        return (
          <button
            key={i}
            className={`seat${s ? '' : ' empty'}${picked === i ? ' picked' : ''}${front ? ' front' : ''}${repeat ? ' repeat' : ''}`}
            style={rules.pair && i % 2 === 1 && i % rules.cols !== rules.cols - 1 ? { marginRight: 14 } : undefined}
            onClick={() => onTap(i)}
            title={repeat ? '지난번에도 짝이었어요' : undefined}
          >
            {s ? (
              <>
                <span className="num">{s.number}</span>
                <span className="nm">{s.name}</span>
              </>
            ) : (
              <span className="muted">빈자리</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function SeatPrint({
  seats,
  rules,
  byId,
  view,
  className,
}: {
  seats: (string | null)[];
  rules: SeatingRules;
  byId: Map<string, Student>;
  view: 'teacher' | 'student';
  className: string;
}) {
  const rows = viewRows(seats, rules.rows, rules.cols, view);
  const board = <div className="print-board">칠판 · 교탁</div>;
  return (
    <article className={`print-doc seat-print ${view}`}>
      <h1>
        {className} 자리 배치 <small>{formatKo(today())} · {view === 'teacher' ? '교탁에서 볼 때' : '학생 자리에서 볼 때'}</small>
      </h1>
      {view === 'student' && board}
      <table className="print-seats">
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((id, c) => {
                const s = id ? byId.get(id) : undefined;
                // 짝 사이 통로: 교사 시점은 좌우가 바뀌어 있으므로 원래 칸 번호로 따진다
                const col = view === 'teacher' ? rules.cols - 1 - c : c;
                const aisle = rules.pair && (view === 'teacher' ? col % 2 === 0 && col > 0 : col % 2 === 1 && col < rules.cols - 1);
                return (
                  <td key={c} className={aisle ? 'aisle' : ''}>
                    {s ? (
                      <>
                        <span className="num">{s.number}</span>
                        {s.name}
                      </>
                    ) : (
                      ''
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {view === 'teacher' && board}
    </article>
  );
}

function RulesForm({ onClose }: { onClose: () => void }) {
  const { state, update } = useStore();
  const rules = state.settings.seating;
  const [front, setFront] = useState(rules.front);
  const [apart, setApart] = useState(rules.apart);
  const [pick, setPick] = useState<string[]>([]);
  const name = (id: string) => state.students.find((s) => s.id === id)?.name ?? '?';
  const save = () => {
    update((s) => ({ ...s, settings: { ...s.settings, seating: { ...s.settings.seating, front, apart } } }));
    onClose();
  };
  return (
    <Modal title="자리 조건" onClose={onClose} wide>
      <div className="form">
        <section>
          <span className="field-label">앞자리에 앉힐 학생 (시력 등)</span>
          <StudentChips students={state.students} selected={front} onToggle={(id) => setFront(toggleIn(front, id))} />
        </section>
        <section>
          <span className="field-label">서로 붙지 않게 할 두 학생 — 두 명을 고르고 [더하기]</span>
          <StudentChips students={state.students} selected={pick} onToggle={(id) => setPick(toggleIn(pick, id).slice(-2))} />
          <div className="inline">
            <button type="button" disabled={pick.length !== 2} onClick={() => (setApart([...apart, [pick[0], pick[1]]]), setPick([]))}>
              더하기
            </button>
          </div>
          {apart.length > 0 && (
            <ul className="chips">
              {apart.map(([a, b], i) => (
                <li key={`${a}${b}`} className="chip on">
                  {name(a)} ↔ {name(b)}{' '}
                  <button type="button" className="link" aria-label="빼기" onClick={() => setApart(apart.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <p className="hint">지난번 짝과는 될 수 있으면 다시 짝이 되지 않게 섞어요.</p>
        <footer className="form-actions">
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            취소
          </button>
          <button type="button" className="primary" onClick={save}>
            저장
          </button>
        </footer>
      </div>
    </Modal>
  );
}
