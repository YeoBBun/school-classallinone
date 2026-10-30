import { useMemo, useState } from 'react';
import { formatKo, today } from '../domain/calendar';
import { todoSummary } from '../domain/classroom';
import { pendingDocs, shortTitle } from '../domain/pending';
import { DOC_FT_REPORT } from '../domain/rules';
import type { AttendanceRecord, Note } from '../domain/types';
import { useStore } from '../store';
import { Modal, sortStudents } from './common';
import { Icon } from './icons';
import { NoteForm } from './NoteForm';
import { RecordForm } from './RecordForm';
import { nameOf } from './ui';

/** 오늘 화면의 «챙길 일» 하나에 다: 받을 서류, 상담 일정, 할 일, 덜 걷힌 제출물, 필사 */
export function TodoCard() {
  const { state, update, holidays } = useStore();
  const now = today();
  const t = useMemo(() => todoSummary(state, now), [state, now]);
  const docs = useMemo(() => {
    const overdue = (d?: string) => (d && d < now ? 0 : 1);
    return pendingDocs(state, holidays).sort((a, b) => overdue(a.deadline) - overdue(b.deadline));
  }, [state, holidays, now]);
  const [open, setOpen] = useState<Note | null>(null);
  const [record, setRecord] = useState<AttendanceRecord | null>(null);
  const receive = (recordId: string, key: string) =>
    update((s) => ({
      ...s,
      records: s.records.map((r) =>
        r.id === recordId ? { ...r, docs: r.docs.map((d) => (d.key === key ? { ...d, received: true, receivedDate: now } : d)) } : r,
      ),
    }));
  const [planFor, setPlanFor] = useState<string | 'pick' | null>(null);
  const who = (n: Note) => n.studentIds.map((id) => nameOf(state.students, id)).join(', ');
  const empty =
    !docs.length && !t.upcoming.length && !t.unwritten.length && !t.followUps.length && !t.checklists.length && !t.pilsaStudents;

  return (
    <section className="card todo-card">
      <div className="card-head">
        <h3>챙길 일</h3>
        <button className="ghost small" onClick={() => setPlanFor('pick')}>
          <Icon name="plus" size={15} /> 상담 일정
        </button>
      </div>
      {empty ? (
        <p className="muted">챙길 일이 없어요.</p>
      ) : (
        <ul className="todo-list">
          {docs.map(({ record: r, doc, deadline }) => (
            <li key={r.id + doc.key} className={deadline && deadline < now ? 'over' : ''}>
              <button className="row-btn" onClick={() => setRecord(r)}>
                <span className="who">{nameOf(state.students, r.studentId)}</span>
                <span className="detail">
                  {doc.label} 받기 · {formatKo(r.startDate)} {shortTitle(r)}
                  {doc.key === DOC_FT_REPORT && now <= r.endDate && ' · 다녀온 후'}
                  {deadline && ` · ${formatKo(deadline)}까지`}
                </span>
              </button>
              <button className="small" onClick={() => receive(r.id, doc.key)}>
                받음
              </button>
            </li>
          ))}
          {t.unwritten.map((n) => (
            <li key={n.id} className="over">
              <button className="row-btn" onClick={() => setOpen(n)}>
                <span className="who">{who(n)}</span>
                <span className="detail">
                  {formatKo(n.date)} 학부모 상담 — <b>결과 적기</b>
                </span>
              </button>
            </li>
          ))}
          {t.upcoming.map((n) => (
            <li key={n.id}>
              <button className="row-btn" onClick={() => setOpen(n)}>
                <span className="who">{who(n)}</span>
                <span className="detail">
                  📅 {n.date === now ? '오늘' : formatKo(n.date)} {n.time} 학부모 상담{n.parentWho ? ` (${n.parentWho})` : ''}
                </span>
              </button>
            </li>
          ))}
          {t.followUps.map((n) => (
            <li key={n.id}>
              <label className="follow-up">
                <input
                  type="checkbox"
                  onChange={() => update((s) => ({ ...s, notes: s.notes.map((x) => (x.id === n.id ? { ...x, followUpDone: true } : x)) }))}
                />
                <span className="who">{who(n)}</span> {n.followUp}
              </label>
            </li>
          ))}
          {t.checklists.map(({ checklist: c, missing }) => (
            <li key={c.id} className={c.dueDate && c.dueDate < now ? 'over' : ''}>
              <a className="row-btn" href="#checklists">
                <span className="who">{c.title}</span>
                <span className="detail">
                  {missing}명 안 냄{c.dueDate ? ` · ${formatKo(c.dueDate)}까지` : ''}
                </span>
              </a>
            </li>
          ))}
          {t.pilsaStudents > 0 && (
            <li>
              <a className="row-btn" href="#pilsa">
                <span className="who">필사</span>
                <span className="detail">
                  {t.pilsaStudents}명이 {t.pilsaPages}장 덜 냄
                </span>
              </a>
            </li>
          )}
        </ul>
      )}

      {open && <NoteForm initial={open} studentId={open.studentIds[0]} onClose={() => setOpen(null)} />}
      {record && <RecordForm initial={record} onClose={() => setRecord(null)} />}
      {planFor === 'pick' && (
        <Modal title="누구와 상담하나요?" onClose={() => setPlanFor(null)}>
          <div className="student-grid">
            {sortStudents(state.students).map((s) => (
              <button key={s.id} className="student-btn" onClick={() => setPlanFor(s.id)}>
                <span className="num">{s.number}</span>
                <span className="nm">{s.name}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {planFor && planFor !== 'pick' && <NoteForm studentId={planFor} planned onClose={() => setPlanFor(null)} />}
    </section>
  );
}
