import { useMemo, useState } from 'react';
import { formatKo, schoolYearOf, schoolYearRange, today } from '../domain/calendar';
import { pilsaSummary, submitPage, suggestedPages, undoPage } from '../domain/classroom';
import type { PilsaTask } from '../domain/types';
import { newId, useStore } from '../store';
import { Modal, sortStudents } from './common';
import { Icon } from './icons';
import { PageHead } from './ui';

/** 명심보감 필사: 학생별로 부여한 장 수와 낸 장을 칸으로 보여준다. 칸을 누르면 한 장 낸 것 */
export function PilsaView() {
  const { state } = useStore();
  const [giving, setGiving] = useState<string | 'pick' | null>(null);
  const [rules, setRules] = useState(false);
  const [from, to] = schoolYearRange(schoolYearOf(today()));

  const rows = useMemo(() => {
    const mine = state.pilsa.filter((p) => p.date >= from && p.date <= to);
    return sortStudents(state.students)
      .map((s) => ({ student: s, tasks: mine.filter((p) => p.studentId === s.id).sort((a, b) => a.date.localeCompare(b.date)), sum: pilsaSummary(mine, s.id) }))
      .filter((r) => r.tasks.length > 0)
      .sort((a, b) => b.sum.remaining - a.sum.remaining || a.student.number - b.student.number);
  }, [state.pilsa, state.students, from, to]);

  return (
    <div className="module">
      <PageHead title="명심보감 필사">
        <button className="ghost small" onClick={() => setRules(true)}>
          분량 규칙
        </button>
        <button className="primary" onClick={() => setGiving('pick')}>
          <Icon name="plus" /> 필사 부여
        </button>
      </PageHead>

      {rows.length === 0 ? (
        <p className="empty">부여한 필사가 없어요. 칸 하나가 한 장이고, 누르면 낸 것으로 표시돼요.</p>
      ) : (
        <ul className="cards">
          {rows.map((r) => (
            <li key={r.student.id} className="card pilsa-row">
              <div className="list-card-head">
                <b>
                  {r.student.number}. {r.student.name}
                </b>
                <span className={r.sum.remaining ? 'late' : 'ok'}>
                  {r.sum.remaining ? `${r.sum.remaining}장 남음` : '다 냈어요'}
                </span>
                <span className="muted small">
                  {r.sum.times}회 · {r.sum.submitted}/{r.sum.pages}장
                </span>
                <span className="spacer" />
                <button className="small" onClick={() => setGiving(r.student.id)}>
                  + 부여
                </button>
              </div>
              <ul className="pilsa-tasks">
                {r.tasks.map((t) => (
                  <PilsaTaskRow key={t.id} task={t} />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {giving && <GiveForm studentId={giving === 'pick' ? null : giving} onClose={() => setGiving(null)} />}
      {rules && <RulesForm onClose={() => setRules(false)} />}
    </div>
  );
}

function PilsaTaskRow({ task }: { task: PilsaTask }) {
  const { update, removeItem } = useStore();
  const set = (fn: (t: PilsaTask) => PilsaTask) => update((s) => ({ ...s, pilsa: s.pilsa.map((p) => (p.id === task.id ? fn(p) : p)) }));
  const remove = () => removeItem('pilsa', task.id, `${formatKo(task.date)} 필사 ${task.pages}장`);
  return (
    <li>
      <span className="muted small pilsa-when">
        {formatKo(task.date)}
        {task.reason && ` · ${task.reason}`}
      </span>
      <span className="pilsa-cells">
        {Array.from({ length: task.pages }, (_, i) => {
          const done = i < task.submitted.length;
          return (
            <button
              key={i}
              className={`cell${done ? ' done' : ''}`}
              title={done ? `${formatKo(task.submitted[i])} 냄 (누르면 취소)` : '누르면 한 장 낸 것'}
              aria-label={done ? `${i + 1}장 냄` : `${i + 1}장 안 냄`}
              onClick={() => set((t) => (done ? undoPage(t) : submitPage(t, today())))}
            />
          );
        })}
      </span>
      <button className="del-btn" onClick={remove}>
        삭제
      </button>
    </li>
  );
}

export function GiveForm({ studentId, onClose }: { studentId: string | null; onClose: () => void }) {
  const { state, update } = useStore();
  const [who, setWho] = useState<string | null>(studentId);
  const [reason, setReason] = useState('');
  const [pages, setPages] = useState<number | null>(null);
  const suggested = who ? suggestedPages(state.pilsa, who, state.settings) : 1;
  const n = pages ?? suggested;
  const student = state.students.find((s) => s.id === who);

  const save = () => {
    if (!who) return;
    const task: PilsaTask = { id: newId(), studentId: who, date: today(), reason: reason.trim(), pages: n, submitted: [] };
    update((s) => ({ ...s, pilsa: [...s.pilsa, task] }));
    onClose();
  };

  return (
    <Modal title={student ? `${student.number}. ${student.name} 필사 부여` : '필사 부여'} onClose={onClose}>
      <div className="form">
        {!studentId && (
          <section>
            <span className="field-label">누구에게</span>
            <div className="chips">
              {sortStudents(state.students).map((s) => (
                <button key={s.id} type="button" className={`chip${who === s.id ? ' on' : ''}`} onClick={() => (setWho(s.id), setPages(null))}>
                  {s.number} {s.name}
                </button>
              ))}
            </div>
          </section>
        )}
        <section>
          <label className="field-label">사유</label>
          <input className="wide" value={reason} placeholder="예: 수업 중 휴대폰" onChange={(e) => setReason(e.target.value)} />
        </section>
        <section>
          <span className="field-label">분량 {who && pages === null && <span className="muted">(규칙대로 {suggested}장)</span>}</span>
          <div className="stepper">
            <button type="button" onClick={() => setPages(Math.max(1, n - 1))} aria-label="한 장 줄이기">
              −
            </button>
            <b>{n}장</b>
            <button type="button" onClick={() => setPages(n + 1)} aria-label="한 장 늘리기">
              +
            </button>
          </div>
        </section>
        <footer className="form-actions">
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            취소
          </button>
          <button type="button" className="primary" onClick={save} disabled={!who}>
            부여
          </button>
        </footer>
      </div>
    </Modal>
  );
}

function RulesForm({ onClose }: { onClose: () => void }) {
  const { state, update } = useStore();
  const [base, setBase] = useState(state.settings.pilsaBase);
  const [step, setStep] = useState(state.settings.pilsaStep);
  const save = () => {
    update((s) => ({ ...s, settings: { ...s.settings, pilsaBase: Math.max(1, base), pilsaStep: Math.max(0, step) } }));
    onClose();
  };
  return (
    <Modal title="필사 분량 규칙" onClose={onClose}>
      <div className="form">
        <section className="row">
          <div>
            <label className="field-label">처음 부여할 때 (장)</label>
            <input type="number" className="narrow" min={1} value={base} onChange={(e) => setBase(Number(e.target.value))} />
          </div>
          <div>
            <label className="field-label">부여할 때마다 늘리기 (장)</label>
            <input type="number" className="narrow" min={0} value={step} onChange={(e) => setStep(Number(e.target.value))} />
          </div>
        </section>
        <p className="hint">
          예: 처음 {base}장, 두 번째 {base + step}장, 세 번째 {base + step * 2}장
        </p>
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
