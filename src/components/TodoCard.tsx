import { useMemo, useState } from 'react';
import { formatKo, today } from '../domain/calendar';
import { shortTitle } from '../domain/pending';
import { submitPage } from '../domain/classroom';
import { dday, pilsaDetail, planSections, type PlanRow } from '../domain/plan';
import { DOC_FT_REPORT } from '../domain/rules';
import type { AttendanceRecord, DateStr, Note, Todo } from '../domain/types';
import { newId, useStore } from '../store';
import { Icon } from './icons';
import { NoteForm } from './NoteForm';
import { RecordForm } from './RecordForm';
import { nameOf } from './ui';

/**
 * 오늘 화면의 «처리 예정»: 출결 서류 · 일정 · 제출물 · 미처리 · 필사 · 기타를 종류별로.
 * 일정 추가는 더보기 → 일정, «기타»는 [＋ 할 일]로 직접 적는다.
 */
export function TodoCard() {
  const { state, update, holidays, removeItem } = useStore();
  /** 기타 할 일 적기: 'new' 새로, Todo 고치기 */
  const [writing, setWriting] = useState<'new' | Todo | null>(null);
  const now = today();
  const sections = useMemo(() => planSections(state, holidays, now), [state, holidays, now]);
  const [open, setOpen] = useState<Note | null>(null);
  const [record, setRecord] = useState<AttendanceRecord | null>(null);
  const receive = (recordId: string, key: string) =>
    update((s) => ({
      ...s,
      records: s.records.map((r) =>
        r.id === recordId ? { ...r, docs: r.docs.map((d) => (d.key === key ? { ...d, received: true, receivedDate: now } : d)) } : r,
      ),
    }));
  const givePage = (taskId: string) =>
    update((s) => ({ ...s, pilsa: s.pilsa.map((p) => (p.id === taskId ? submitPage(p, now) : p)) }));
  const who = (n: Note) => n.studentIds.map((id) => nameOf(state.students, id)).join(', ');
  const day = (d: DateStr) => (d === now ? '오늘' : formatKo(d));
  const badge = (d: DateStr) => <span className={`dday${d < now ? ' over' : d === now ? ' today' : ''}`}>{dday(d, now)}</span>;

  const hasDate = (r: PlanRow) =>
    (r.type === 'doc' && !!r.deadline) || (r.type === 'checklist' && !!r.checklist.dueDate) || (r.type === 'todo' && !!r.todo.due);
  /** pad: 같은 묶음에 D-day 가 있는 줄이 있으면 날짜 없는 줄도 그만큼 비워 줄을 맞춘다 */
  const row = (r: PlanRow, pad: boolean) => {
    switch (r.type) {
      case 'doc': {
        const over = !!r.deadline && r.deadline < now;
        return (
          <li key={r.record.id + r.doc.key} className={over ? 'over' : ''}>
            {r.deadline ? badge(r.deadline) : pad && <span className="dday none" />}
            <button className="row-btn" onClick={() => setRecord(r.record)}>
              <span className="who">{nameOf(state.students, r.record.studentId)}</span>
              <span className="detail">
                {r.doc.label} · {formatKo(r.record.startDate)} {shortTitle(r.record)}
                {r.doc.key === DOC_FT_REPORT && now <= r.record.endDate && ' · 다녀온 후'}
                {r.deadline && ` · ${formatKo(r.deadline)}까지`}
              </span>
            </button>
            <button className="small" onClick={() => receive(r.record.id, r.doc.key)}>
              받음
            </button>
          </li>
        );
      }
      case 'consult':
        return (
          <li key={r.note.id}>
            {badge(r.note.date)}
            <button className="row-btn" onClick={() => setOpen(r.note)}>
              <span className="who">{who(r.note)}</span>
              <span className="detail">
                학부모 상담{r.note.parentWho ? ` (${r.note.parentWho})` : ''} · {day(r.note.date)} {r.note.time}
              </span>
            </button>
          </li>
        );
      case 'event':
        return (
          <li key={r.event.id}>
            {badge(r.event.date)}
            <a className="row-btn" href="#schedule">
              <span className="who">{r.event.title}</span>
              <span className="detail">
                {r.event.kind} · {day(r.event.date)} {r.event.time}
              </span>
            </a>
          </li>
        );
      case 'checklist': {
        const due = r.checklist.dueDate;
        return (
          <li key={r.checklist.id} className={due && due < now ? 'over' : ''}>
            {due ? badge(due) : pad && <span className="dday none" />}
            <a className="row-btn" href="#checklists">
              <span className="who">{r.checklist.title}</span>
              <span className="detail">
                {r.missing}명 안 냄{due ? ` · ${formatKo(due)}까지` : ''}
              </span>
            </a>
          </li>
        );
      }
      case 'unwritten':
        return (
          <li key={r.note.id} className="over">
            <button className="row-btn" onClick={() => setOpen(r.note)}>
              <span className="who">{who(r.note)}</span>
              <span className="detail">
                {formatKo(r.note.date)} 학부모 상담 — <b>결과 적기</b>
              </span>
            </button>
          </li>
        );
      case 'followUp':
        return (
          <li key={`f${r.note.id}`}>
            <label className="follow-up">
              <input
                type="checkbox"
                onChange={() => update((s) => ({ ...s, notes: s.notes.map((x) => (x.id === r.note.id ? { ...x, followUpDone: true } : x)) }))}
              />
              <span className="who">{who(r.note)}</span> {r.note.followUp}
            </label>
          </li>
        );
      case 'todo':
        if (writing !== 'new' && writing?.id === r.todo.id) return <TodoForm key={r.todo.id} initial={r.todo} onClose={() => setWriting(null)} />;
        return (
          <li key={r.todo.id} className={r.todo.due && r.todo.due < now ? 'over' : ''}>
            {r.todo.due ? badge(r.todo.due) : pad && <span className="dday none" />}
            <label className="follow-up">
              <input type="checkbox" onChange={() => removeItem('todos', r.todo.id, `'${r.todo.text}'`, '처리했어요')} />
            </label>
            <button className="row-btn" onClick={() => setWriting(r.todo)}>
              <span className="detail todo-text">
                {r.todo.text}
                {r.todo.due && ` · ${formatKo(r.todo.due)}까지`}
              </span>
            </button>
          </li>
        );
      case 'pilsa':
        return (
          <li key={`p${r.studentId}`}>
            <a className="row-btn" href="#pilsa">
              <span className="who">{nameOf(state.students, r.studentId)}</span>
              <span className="detail">
                {r.remaining}장 남음 · {pilsaDetail(r.tasks)}
              </span>
            </a>
            <button className="small" onClick={() => givePage(r.tasks[0].id)}>
              1장 받음
            </button>
          </li>
        );
    }
  };

  return (
    <section className="card todo-card">
      <div className="card-head">
        <h3>처리 예정</h3>
        <span className="spacer" />
        <button className="ghost small" onClick={() => setWriting('new')}>
          <Icon name="plus" size={15} /> 할 일
        </button>
      </div>
      {sections.length === 0 && writing !== 'new' ? (
        <p className="muted">처리할 것이 없어요.</p>
      ) : (
        sections.map((s) => (
          <div key={s.title} className="plan-group">
            <h4 className="plan-head">
              {s.title} <span>{s.rows.length}</span>
            </h4>
            <ul className="todo-list">
              {s.rows.map((r) => row(r, s.rows.some(hasDate)))}
              {s.title === '기타' && writing === 'new' && <TodoForm onClose={() => setWriting(null)} />}
            </ul>
          </div>
        ))
      )}
      {writing === 'new' && !sections.some((s) => s.title === '기타') && (
        <div className="plan-group">
          <h4 className="plan-head">기타</h4>
          <ul className="todo-list">
            <TodoForm onClose={() => setWriting(null)} />
          </ul>
        </div>
      )}

      {open && <NoteForm initial={open} studentId={open.studentIds[0]} onClose={() => setOpen(null)} />}
      {record && <RecordForm initial={record} onClose={() => setRecord(null)} />}
    </section>
  );
}

/** 기타 할 일 한 줄 적기 (새로 / 고치기). Enter 로 저장, Esc 로 닫기 */
function TodoForm({ initial, onClose }: { initial?: Todo; onClose: () => void }) {
  const { update, removeItem } = useStore();
  const [text, setText] = useState(initial?.text ?? '');
  const [due, setDue] = useState(initial?.due ?? '');
  const save = () => {
    const t = text.trim();
    if (!t) return onClose();
    const todo: Todo = { ...(initial ?? { id: newId(), createdAt: today() }), text: t, due: due || undefined };
    update((s) => ({ ...s, todos: initial ? s.todos.map((x) => (x.id === todo.id ? todo : x)) : [...s.todos, todo] }));
    onClose();
  };
  return (
    <li className="todo-form">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <input autoFocus value={text} placeholder="예: 학급 문고 정리" aria-label="할 일" onChange={(e) => setText(e.target.value)} />
        <input type="date" value={due} aria-label="기한 (선택)" title="기한 (선택)" onChange={(e) => setDue(e.target.value)} />
        <button type="submit" className="primary small">
          {initial ? '저장' : '추가'}
        </button>
        {initial ? (
          <button
            type="button"
            className="small danger"
            onClick={() => {
              removeItem('todos', initial.id, `'${initial.text}'`);
              onClose();
            }}
          >
            삭제
          </button>
        ) : (
          <button type="button" className="small" onClick={onClose}>
            취소
          </button>
        )}
      </form>
    </li>
  );
}
