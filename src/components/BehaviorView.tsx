import { useMemo, useState } from 'react';
import { formatKo, schoolYearOf, schoolYearRange, today } from '../domain/calendar';
import { neisBytes, pilsaSummary } from '../domain/classroom';
import { studentTimeline } from '../domain/student';
import type { BehaviorDraft, Student } from '../domain/types';
import { useStore } from '../store';
import { Modal, recordTitle, sortStudents } from './common';
import { NOTE_CLASS } from './StudentsView';
import { CopyButton, PageHead } from './ui';

/** 행동특성 및 종합의견: 학생마다 1년 동안 적은 것을 보며 초안을 쓴다 */
export function BehaviorView() {
  const { state, update } = useStore();
  const year = schoolYearOf(today());
  const [open, setOpen] = useState<Student | null>(null);
  const drafts = new Map(state.behavior.filter((b) => b.year === year).map((b) => [b.studentId, b]));
  const done = [...drafts.values()].filter((b) => b.done).length;
  const limit = state.settings.behaviorByteLimit;

  return (
    <div className="module">
      <PageHead title={`행발 쓰기 (${year}학년도)`}>
        <label className="inline small">
          한도
          <input
            type="number"
            className="narrow"
            min={100}
            step={100}
            value={limit}
            onChange={(e) => update((s) => ({ ...s, settings: { ...s.settings, behaviorByteLimit: Math.max(100, Number(e.target.value) || 1500) } }))}
          />
          바이트
        </label>
      </PageHead>
      <p className="hint">
        학생을 누르면 1년 동안 적은 관찰·상담·사안 기록을 보며 쓸 수 있어요. 완료 {done}/{state.students.length}명
      </p>
      <div className="student-grid">
        {sortStudents(state.students).map((s) => {
          const d = drafts.get(s.id);
          const bytes = d ? neisBytes(d.text) : 0;
          return (
            <button key={s.id} className={`student-btn${d?.done ? ' got' : d?.text ? ' writing' : ''}`} onClick={() => setOpen(s)}>
              <span className="num">{s.number}</span>
              <span className="nm">{s.name}</span>
              <span className="small">{d?.done ? '✓ 완료' : d?.text ? `${bytes}바이트` : '아직'}</span>
            </button>
          );
        })}
      </div>
      {open && <BehaviorEditor student={open} year={year} onClose={() => setOpen(null)} />}
    </div>
  );
}

function BehaviorEditor({ student, year, onClose }: { student: Student; year: number; onClose: () => void }) {
  const { state, update } = useStore();
  const id = `${year}:${student.id}`;
  const saved = state.behavior.find((b) => b.id === id);
  const [text, setText] = useState(saved?.text ?? '');
  const [done, setDone] = useState(!!saved?.done);
  const [from, to] = schoolYearRange(year);
  const limit = state.settings.behaviorByteLimit;
  const bytes = neisBytes(text);

  const items = useMemo(() => studentTimeline(student.id, state, from, to), [student.id, state, from, to]);
  const notes = items.flatMap((it) => (it.type === 'note' && !it.note.planned && it.note.content ? [it.note] : []));
  const incidents = state.incidents.filter((i) => i.studentIds.includes(student.id) && i.date >= from && i.date <= to);
  const pilsa = pilsaSummary(state.pilsa, student.id, from, to);
  const attendance = items.flatMap((it) => (it.type === 'attendance' ? [it.record] : []));

  const close = () => {
    if (text !== (saved?.text ?? '') || done !== !!saved?.done) {
      const draft: BehaviorDraft = { id, studentId: student.id, year, text, done: done || undefined };
      update((s) => ({ ...s, behavior: saved ? s.behavior.map((b) => (b.id === id ? draft : b)) : [...s.behavior, draft] }));
    }
    onClose();
  };

  return (
    <Modal title={`${student.number}. ${student.name} 행발`} onClose={close} wide>
      <div className="behavior">
        <aside className="behavior-ref">
          <h4>1년 동안 적은 것</h4>
          {notes.length + incidents.length === 0 && <p className="muted">관찰·상담 기록이 없어요.</p>}
          <ul className="ref-list">
            {notes.map((n) => (
              <li key={n.id}>
                <span className={`tag ${NOTE_CLASS[n.kind]}`}>{n.kind}</span> <span className="muted small">{formatKo(n.date)}</span>
                <p>{n.content}</p>
              </li>
            ))}
            {incidents.map((i) => (
              <li key={i.id}>
                <span className="tag">사안</span> <span className="muted small">{formatKo(i.date)}</span>
                <p>
                  {i.title} ({i.status})
                </p>
              </li>
            ))}
          </ul>
          <p className="muted small">
            출결 기록 {attendance.length}건{attendance.length ? ` (${[...new Set(attendance.map(recordTitle))].slice(0, 3).join(', ')})` : ''}
            {pilsa.times > 0 && ` · 필사 ${pilsa.times}회 ${pilsa.pages}장`}
          </p>
        </aside>
        <section className="behavior-edit">
          <textarea rows={14} value={text} placeholder="행동특성 및 종합의견 초안" onChange={(e) => setText(e.target.value)} autoFocus />
          <div className="row">
            <span className={bytes > limit ? 'late' : 'muted'}>
              {bytes} / {limit}바이트{bytes > limit && ` (${bytes - limit} 넘음)`}
            </span>
            <span className="spacer" />
            <CopyButton text={text} className="" />
            <label className="check">
              <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} />다 썼어요
            </label>
          </div>
          <p className="hint">한글 3바이트, 영문·숫자·띄어쓰기 1바이트, 줄바꿈 2바이트로 셉니다. 창을 닫으면 저장돼요.</p>
        </section>
      </div>
      <footer className="form-actions">
        <span className="spacer" />
        <button className="primary" onClick={close}>
          저장하고 닫기
        </button>
      </footer>
    </Modal>
  );
}
