import { useState } from 'react';
import { formatKo, today } from '../domain/calendar';
import { INCIDENT_STATUSES, INCIDENT_STEP_KINDS, type Incident, type IncidentStatus, type IncidentStep } from '../domain/types';
import { newId, useStore } from '../store';
import { Modal, sortStudents } from './common';
import { Icon } from './icons';
import { nameOf, PageHead, PrintSheet, StudentChips, toggleIn } from './ui';

type Show = 'open' | IncidentStatus | 'all';

/** 학급 내 사안: 누가·언제·무엇을 사실 위주로, 경과를 날짜순으로 */
export function IncidentsView() {
  const { state } = useStore();
  const [show, setShow] = useState<Show>('open');
  const [editing, setEditing] = useState<Incident | 'new' | null>(null);
  const list = state.incidents
    .filter((i) => (show === 'all' ? true : show === 'open' ? i.status !== '종결' : i.status === show))
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="module">
      <PageHead title="사안 관리">
        <button className="primary" onClick={() => setEditing('new')}>
          <Icon name="plus" /> 사안 등록
        </button>
      </PageHead>
      <div className="toolbar">
        <div className="seg">
          {(['open', ...INCIDENT_STATUSES, 'all'] as Show[]).map((s) => (
            <button key={s} className={show === s ? 'on' : ''} onClick={() => setShow(s)}>
              {s === 'open' ? '끝나지 않은 것' : s === 'all' ? '전체' : s}
            </button>
          ))}
        </div>
      </div>
      {list.length === 0 ? (
        <p className="empty">{show === 'open' ? '진행 중인 사안이 없어요.' : '해당하는 사안이 없어요.'}</p>
      ) : (
        <ul className="cards">
          {list.map((i) => {
            const last = [...i.steps].sort((a, b) => b.date.localeCompare(a.date))[0];
            return (
              <li key={i.id}>
                <button className="card list-card" onClick={() => setEditing(i)}>
                  <span className="list-card-head">
                    <b>{i.title || '(제목 없음)'}</b>
                    <span className={`tag status-${INCIDENT_STATUSES.indexOf(i.status)}`}>{i.status}</span>
                    {i.violence && <span className="tag warn-tag">학폭 확인</span>}
                    <span className="spacer" />
                    <span className="muted">{formatKo(i.date)}</span>
                  </span>
                  <span>{i.studentIds.map((id) => nameOf(state.students, id)).join(', ')}</span>
                  {last && (
                    <span className="muted small">
                      {formatKo(last.date)} {last.kind}: {last.text}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {editing && <IncidentForm initial={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

export function IncidentForm({ initial, studentId, onClose }: { initial?: Incident; studentId?: string; onClose: () => void }) {
  const { state, update, removeItem } = useStore();
  const isNew = !initial;
  const [draft, setDraft] = useState<Incident>(
    () =>
      initial ?? {
        id: newId(),
        title: '',
        date: today(),
        studentIds: studentId ? [studentId] : [],
        status: '진행 중',
        steps: [{ id: newId(), date: today(), kind: '인지', text: '' }],
      },
  );
  const [error, setError] = useState('');
  const [printing, setPrinting] = useState(false);
  const set = (patch: Partial<Incident>) => setDraft((d) => ({ ...d, ...patch }));
  const setStep = (id: string, patch: Partial<IncidentStep>) => set({ steps: draft.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const steps = [...draft.steps].sort((a, b) => a.date.localeCompare(b.date));

  const save = () => {
    if (!draft.title.trim()) return setError('어떤 사안인지 제목을 적어 주세요.');
    if (!draft.studentIds.length) return setError('관련 학생을 골라 주세요.');
    const clean: Incident = { ...draft, title: draft.title.trim(), steps: draft.steps.filter((s) => s.text.trim()).map((s) => ({ ...s, text: s.text.trim() })) };
    update((s) => ({ ...s, incidents: isNew ? [...s.incidents, clean] : s.incidents.map((i) => (i.id === clean.id ? clean : i)) }));
    onClose();
  };
  const remove = () => {
    removeItem('incidents', draft.id, `사안 '${draft.title || '제목 없음'}'`);
    onClose();
  };

  return (
    <Modal title={isNew ? '사안 등록' : '사안'} onClose={onClose} wide>
      <div className="form">
        <section className="row">
          <div className="grow">
            <label className="field-label">무슨 일 (짧게)</label>
            <input className="wide" value={draft.title} placeholder="예: 쉬는 시간 말다툼" onChange={(e) => (set({ title: e.target.value }), setError(''))} />
          </div>
          <div>
            <label className="field-label">처음 안 날</label>
            <input type="date" value={draft.date} onChange={(e) => e.target.value && set({ date: e.target.value })} />
          </div>
        </section>
        <section>
          <span className="field-label">관련 학생</span>
          <StudentChips students={state.students} selected={draft.studentIds} onToggle={(id) => set({ studentIds: toggleIn(draft.studentIds, id) })} />
        </section>
        <section className="row">
          <div>
            <span className="field-label">상태</span>
            <div className="seg">
              {INCIDENT_STATUSES.map((st) => (
                <button key={st} type="button" className={draft.status === st ? 'on' : ''} onClick={() => set({ status: st })}>
                  {st}
                </button>
              ))}
            </div>
          </div>
          <label className="check">
            <input type="checkbox" checked={!!draft.violence} onChange={(e) => set({ violence: e.target.checked || undefined })} />
            학교폭력으로 이어질 수 있어 따로 챙기기
          </label>
        </section>

        <section>
          <span className="field-label">경과 (사실 위주로: 누가, 언제, 무엇을)</span>
          <ol className="steps">
            {steps.map((st) => (
              <li key={st.id}>
                <div className="row">
                  <input type="date" value={st.date} onChange={(e) => e.target.value && setStep(st.id, { date: e.target.value })} />
                  <select value={st.kind} onChange={(e) => setStep(st.id, { kind: e.target.value as IncidentStep['kind'] })}>
                    {INCIDENT_STEP_KINDS.map((k) => (
                      <option key={k}>{k}</option>
                    ))}
                  </select>
                  <span className="spacer" />
                  <button type="button" className="del-btn" onClick={() => set({ steps: draft.steps.filter((s) => s.id !== st.id) })}>
                    삭제
                  </button>
                </div>
                <textarea rows={2} value={st.text} placeholder="예: 3교시 후 복도에서 A가 B의 필통을 던짐. 두 학생 면담함." onChange={(e) => setStep(st.id, { text: e.target.value })} />
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="link"
            onClick={() => set({ steps: [...draft.steps, { id: newId(), date: today(), kind: draft.steps.length ? '학생 면담' : '인지', text: '' }] })}
          >
            + 경과 더하기
          </button>
        </section>

        {error && <p className="error">{error}</p>}
        <footer className="form-actions">
          {!isNew && (
            <button type="button" className="danger" onClick={remove}>
              지우기
            </button>
          )}
          <span className="spacer" />
          <button type="button" onClick={() => setPrinting(true)}>
            경과 인쇄
          </button>
          <button type="button" onClick={onClose}>
            취소
          </button>
          <button type="button" className="primary" onClick={save}>
            저장
          </button>
        </footer>
      </div>
      {printing && (
        <PrintSheet onDone={() => setPrinting(false)}>
          <IncidentPrint incident={{ ...draft, steps }} />
        </PrintSheet>
      )}
    </Modal>
  );
}

function IncidentPrint({ incident: i }: { incident: Incident }) {
  const { state } = useStore();
  const students = sortStudents(state.students.filter((s) => i.studentIds.includes(s.id)));
  return (
    <article className="print-doc">
      <h1>사안 경과 기록</h1>
      <table className="print-table meta">
        <tbody>
          <tr>
            <th>학급</th>
            <td>{state.settings.className}</td>
            <th>상태</th>
            <td>{i.status}</td>
          </tr>
          <tr>
            <th>사안</th>
            <td colSpan={3}>{i.title}</td>
          </tr>
          <tr>
            <th>관련 학생</th>
            <td colSpan={3}>{students.map((s) => `${s.number}. ${s.name}`).join(', ')}</td>
          </tr>
          <tr>
            <th>처음 안 날</th>
            <td colSpan={3}>{formatKo(i.date)}</td>
          </tr>
        </tbody>
      </table>
      <table className="print-table">
        <thead>
          <tr>
            <th style={{ width: '18%' }}>날짜</th>
            <th style={{ width: '14%' }}>구분</th>
            <th>내용</th>
          </tr>
        </thead>
        <tbody>
          {i.steps.map((s) => (
            <tr key={s.id}>
              <td>{formatKo(s.date)}</td>
              <td>{s.kind}</td>
              <td className="pre">{s.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="print-sign">작성일 {formatKo(today())} &nbsp;&nbsp; 담임 ____________ (서명)</p>
    </article>
  );
}
