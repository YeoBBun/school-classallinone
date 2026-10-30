import { useState } from 'react';
import { formatKo, today } from '../domain/calendar';
import { checklistProgress, missingText } from '../domain/classroom';
import type { Checklist } from '../domain/types';
import { newId, useStore } from '../store';
import { Modal, sortStudents } from './common';
import { SheetButton } from './GoogleButtons';
import { CopyButton, PageHead } from './ui';

/** 제출물·회신 체크: 항목을 만들면 학생별 체크 표가 생긴다 */
export function ChecklistView() {
  const { state, update } = useStore();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const lists = [...state.checklists].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const active = lists.filter((c) => !c.closed);
  const closed = lists.filter((c) => c.closed);

  const add = () => {
    if (!title.trim()) return;
    const c: Checklist = { id: newId(), title: title.trim(), createdAt: today(), dueDate: due || undefined, marks: {} };
    update((s) => ({ ...s, checklists: [...s.checklists, c] }));
    setTitle('');
    setDue('');
    setOpen(c.id);
  };

  return (
    <div className="module">
      <PageHead title="제출물 체크" />
      <section className="card add-row">
        <input
          className="wide"
          value={title}
          placeholder="걷을 것 (예: 수학여행 동의서)"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <label className="inline">
          마감 <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <button className="primary" onClick={add} disabled={!title.trim()}>
          만들기
        </button>
      </section>

      {active.length === 0 ? (
        <p className="empty">걷을 것이 없어요. 위에 적고 [만들기]를 누르세요.</p>
      ) : (
        <ul className="cards">
          {active.map((c) => (
            <ChecklistCard key={c.id} checklist={c} onOpen={() => setOpen(c.id)} />
          ))}
        </ul>
      )}

      {closed.length > 0 && (
        <details className="closed-list">
          <summary>다 걷은 항목 {closed.length}개</summary>
          <ul className="cards">
            {closed.map((c) => (
              <ChecklistCard key={c.id} checklist={c} onOpen={() => setOpen(c.id)} />
            ))}
          </ul>
        </details>
      )}

      {open && <ChecklistDetail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function dueLabel(c: Checklist): { text: string; late: boolean } | null {
  if (!c.dueDate) return null;
  const late = !c.closed && c.dueDate < today();
  return { text: `${formatKo(c.dueDate)}까지`, late };
}

function ChecklistCard({ checklist: c, onOpen }: { checklist: Checklist; onOpen: () => void }) {
  const { state } = useStore();
  const p = checklistProgress(c, state.students);
  const due = dueLabel(c);
  const got = p.done + p.exempt;
  return (
    <li>
      <button className="card list-card" onClick={onOpen}>
        <span className="list-card-head">
          <b>{c.title}</b>
          {due && <span className={due.late && p.missing.length ? 'late' : 'muted'}>{due.text}</span>}
        </span>
        <span className="progress" aria-label={`${got}/${p.total}명`}>
          <span style={{ width: `${p.total ? (got / p.total) * 100 : 0}%` }} />
        </span>
        <span className="muted">
          {p.missing.length === 0
            ? '모두 냈어요'
            : `안 낸 학생 ${p.missing.length}명: ${p.missing.slice(0, 6).map((s) => s.name).join(', ')}${p.missing.length > 6 ? ' …' : ''}`}
        </span>
      </button>
    </li>
  );
}

function ChecklistDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { state, update } = useStore();
  const c = state.checklists.find((x) => x.id === id);
  const [mode, setMode] = useState<'done' | 'exempt'>('done');
  if (!c) return null;
  const p = checklistProgress(c, state.students);
  const set = (patch: Partial<Checklist>) => update((s) => ({ ...s, checklists: s.checklists.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  const toggle = (sid: string) => {
    const cur = c.marks[sid];
    const next = { ...c.marks };
    if (mode === 'exempt') {
      if (cur === 'exempt') delete next[sid];
      else next[sid] = 'exempt';
    } else if (cur) delete next[sid];
    else next[sid] = today();
    set({ marks: next });
  };
  const remove = () => {
    if (!confirm(`'${c.title}' 항목을 지울까요?`)) return;
    update((s) => ({ ...s, checklists: s.checklists.filter((x) => x.id !== id) }));
    onClose();
  };
  const rows = () => [
    ['번호', '이름', c.title],
    ...sortStudents(state.students).map((s) => {
      const m = c.marks[s.id];
      return [String(s.number), s.name, m === 'exempt' ? '면제' : m ? `냄 (${m})` : '안 냄'];
    }),
  ];

  return (
    <Modal title={c.title} onClose={onClose} wide>
      <div className="form">
        <section className="row">
          <div>
            <label className="field-label">이름</label>
            <input value={c.title} onChange={(e) => set({ title: e.target.value })} />
          </div>
          <div>
            <label className="field-label">마감</label>
            <input type="date" value={c.dueDate ?? ''} onChange={(e) => set({ dueDate: e.target.value || undefined })} />
          </div>
        </section>

        <div className="toolbar">
          <span className="muted">
            {p.done}명 냄{p.exempt ? ` · 면제 ${p.exempt}` : ''} · <b className={p.missing.length ? 'late' : ''}>안 낸 학생 {p.missing.length}명</b>
          </span>
          <span className="spacer" />
          <div className="seg" aria-label="누르면">
            <button className={mode === 'done' ? 'on' : ''} onClick={() => setMode('done')}>
              누르면 냄
            </button>
            <button className={mode === 'exempt' ? 'on' : ''} onClick={() => setMode('exempt')}>
              누르면 면제
            </button>
          </div>
        </div>

        <div className="student-grid">
          {sortStudents(state.students).map((s) => {
            const m = c.marks[s.id];
            return (
              <button key={s.id} className={`student-btn${m === 'exempt' ? ' exempt' : m ? ' got' : ''}`} onClick={() => toggle(s.id)}>
                <span className="num">{s.number}</span>
                <span className="nm">{s.name}</span>
                <span className="small">{m === 'exempt' ? '면제' : m ? `✓ ${formatKo(m)}` : ''}</span>
              </button>
            );
          })}
        </div>

        <footer className="form-actions">
          <button type="button" className="danger" onClick={remove}>
            지우기
          </button>
          <span className="spacer" />
          {p.missing.length > 0 && <CopyButton text={() => missingText(c, p.missing)} label="안 낸 학생 복사" className="" />}
          <SheetButton title={`제출물 - ${c.title}`} rows={rows} />
          <button type="button" className="primary" onClick={() => (set({ closed: !c.closed }), onClose())}>
            {c.closed ? '다시 걷기' : '다 걷었어요'}
          </button>
        </footer>
      </div>
    </Modal>
  );
}
