import { useMemo, useState } from 'react';
import { formatKo, today } from '../domain/calendar';
import { shortTitle } from '../domain/pending';
import { dday, planSections, type PlanRow } from '../domain/plan';
import { DOC_FT_REPORT } from '../domain/rules';
import type { AttendanceRecord, DateStr, Note } from '../domain/types';
import { useStore } from '../store';
import { NoteForm } from './NoteForm';
import { RecordForm } from './RecordForm';
import { nameOf } from './ui';

/** 오늘 화면의 «처리 예정»: 출결 서류 · 일정 · 제출물 · 할 일 · 필사를 종류별로. 일정 추가는 더보기 → 일정 */
export function TodoCard() {
  const { state, update, holidays } = useStore();
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
  const who = (n: Note) => n.studentIds.map((id) => nameOf(state.students, id)).join(', ');
  const day = (d: DateStr) => (d === now ? '오늘' : formatKo(d));
  const badge = (d: DateStr) => <span className={`dday${d < now ? ' over' : d === now ? ' today' : ''}`}>{dday(d, now)}</span>;

  const hasDate = (r: PlanRow) => (r.type === 'doc' && !!r.deadline) || (r.type === 'checklist' && !!r.checklist.dueDate);
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
      case 'pilsa':
        return (
          <li key="pilsa">
            <a className="row-btn" href="#pilsa">
              <span className="detail">
                {r.students}명이 {r.pages}장 덜 냄
              </span>
            </a>
          </li>
        );
    }
  };

  return (
    <section className="card todo-card">
      <div className="card-head">
        <h3>처리 예정</h3>
      </div>
      {sections.length === 0 ? (
        <p className="muted">처리할 것이 없어요.</p>
      ) : (
        sections.map((s) => (
          <div key={s.title} className="plan-group">
            <h4 className="plan-head">
              {s.title} <span>{s.title === '필사' ? '' : s.rows.length}</span>
            </h4>
            <ul className="todo-list">{s.rows.map((r) => row(r, s.rows.some(hasDate)))}</ul>
          </div>
        ))
      )}

      {open && <NoteForm initial={open} studentId={open.studentIds[0]} onClose={() => setOpen(null)} />}
      {record && <RecordForm initial={record} onClose={() => setRecord(null)} />}
    </section>
  );
}
