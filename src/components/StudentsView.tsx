import { useMemo, useState, type ReactNode } from 'react';
import { formatKo, schoolYearOf, schoolYearRange, today } from '../domain/calendar';
import { checklistProgress, neisBytes, pilsaSummary } from '../domain/classroom';
import { summarize } from '../domain/stats';
import { matchesQuery, studentTimeline, type TimelineItem } from '../domain/student';
import { KINDS, NOTE_KINDS, STATUSES, type AttendanceRecord, type Note, type NoteKind, type Student } from '../domain/types';
import { useStore } from '../store';
import { Modal, recordDates, recordTitle } from './common';
import { Icon, type IconName } from './icons';
import { NoteForm } from './NoteForm';
import { RecordForm } from './RecordForm';
import { QuickEntry } from './Today';
import { GiveForm } from './PilsaView';
import { Menu, nameOf, PrintSheet } from './ui';

export const NOTE_CLASS: Record<NoteKind, string> = { 관찰: 'n-obs', 학생상담: 'n-counsel', 학부모상담: 'n-parent' };

const PRIVACY_KEY = 'class-privacy';

/** 가림 모드: 전자칠판·화면 공유 중에 상담 내용을 숨긴다 (이 기기에만 기억) */
function usePrivacy(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(PRIVACY_KEY) === '1';
    } catch {
      return false;
    }
  });
  const set = (v: boolean) => {
    setOn(v);
    try {
      localStorage.setItem(PRIVACY_KEY, v ? '1' : '0');
    } catch {
      /* 무시 */
    }
  };
  return [on, set];
}

/** 학생 기록: 오늘 화면에서 학생을 누르고 [학생 기록]을 고르면 열린다. 그 학생에 대해 적은 것을 한 화면에 모아 본다. */
export function StudentsView({ studentId }: { studentId: string }) {
  const { state } = useStore();
  if (!state.students.some((s) => s.id === studentId)) {
    return (
      <div className="empty">
        <p>없는 학생이에요.</p>
        <a className="button primary" href="#today">
          오늘로
        </a>
      </div>
    );
  }
  return <StudentPage studentId={studentId} />;
}

type Adding = NoteKind | 'planned' | 'attendance' | 'pilsa';

/** [＋] 를 누르면 고르는 것 — 학생에 대해 남길 수 있는 모든 것이 여기 한 곳에 */
const ADD_CHOICES: readonly { id: Adding; label: string; icon: IconName }[] = [
  { id: '관찰', label: '관찰', icon: 'eye' },
  { id: '학생상담', label: '학생 상담', icon: 'people' },
  { id: '학부모상담', label: '학부모 상담', icon: 'people' },
  { id: 'planned', label: '상담 일정', icon: 'today' },
  { id: 'attendance', label: '출결', icon: 'check' },
  { id: 'pilsa', label: '필사 부여', icon: 'doc' },
];

/**
 * 학생 기록: 이 학생에 대해 적은 것을 종류별 칸으로 나눠 한 화면에.
 * 출결 → (예정 상담·할 일·안 낸 제출물) → 상담 → 관찰 → 필사 → 행발 순서.
 */
function StudentPage({ studentId }: { studentId: string }) {
  const { state, holidays, warnings, update } = useStore();
  const student = state.students.find((s) => s.id === studentId)!;
  const [year, setYear] = useState(() => schoolYearOf(today()));
  const [query, setQuery] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [adding, setAdding] = useState<Adding | null>(null);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [editingRecord, setEditingRecord] = useState<AttendanceRecord | null>(null);
  const [printing, setPrinting] = useState(false);
  const [hidden, setHidden] = usePrivacy();

  const [from, to] = schoolYearRange(year);
  const years = useMemo(() => {
    const set = new Set([
      schoolYearOf(today()),
      ...state.records.filter((r) => r.studentId === studentId).map((r) => schoolYearOf(r.startDate)),
      ...state.notes.filter((n) => n.studentIds.includes(studentId)).map((n) => schoolYearOf(n.date)),
    ]);
    return [...set].sort((a, b) => b - a);
  }, [state.records, state.notes, studentId]);

  const all = useMemo(() => studentTimeline(studentId, state, from, to), [studentId, state, from, to]);
  const q = (query ?? '').trim();
  const items = q ? all.filter((it) => matchesQuery(it, q)) : all;
  const summary = useMemo(
    () => summarize([student], state.records, holidays, warnings, from, to, today())[0],
    [student, state.records, holidays, warnings, from, to],
  );
  const times = (st: (typeof STATUSES)[number]) => KINDS.reduce((n, k) => n + summary.counts[st][k], 0);
  const pilsa = pilsaSummary(state.pilsa, studentId, from, to);
  const missing = state.checklists.filter((c) => !c.closed && checklistProgress(c, [student]).missing.length > 0);
  const behavior = state.behavior.find((b) => b.id === `${year}:${studentId}`);

  const notes = items.flatMap((it) => (it.type === 'note' ? [it.note] : []));
  const planned = notes.filter((n) => n.planned).sort((a, b) => (a.date + (a.time ?? '')).localeCompare(b.date + (b.time ?? '')));
  const counsel = notes.filter((n) => !n.planned && n.kind !== '관찰');
  const observe = notes.filter((n) => n.kind === '관찰');
  const todos = notes.filter((n) => n.followUp?.trim() && !n.followUpDone);
  const records = items.flatMap((it) => (it.type === 'attendance' ? [it.record] : []));
  const tasks = items.flatMap((it) => (it.type === 'pilsa' ? [it.task] : []));
  const toggleDone = (id: string) => update((s) => ({ ...s, notes: s.notes.map((n) => (n.id === id ? { ...n, followUpDone: !n.followUpDone } : n)) }));
  const parentInfo = (n: Note) => [n.parentWho, n.parentMethod].filter(Boolean).join(' · ');

  return (
    <div className={`student-page profile${hidden ? ' privacy' : ''}`}>
      <header className="page-head">
        <a href="#today" className="icon-btn" aria-label="오늘로">
          <Icon name="left" size={22} />
        </a>
        <h2 className="student-title">
          {student.number}. {student.name}
          {year !== schoolYearOf(today()) && <span className="muted small"> {year}학년도</span>}
        </h2>
        <span className="spacer" />
        <button className="primary add-btn" onClick={() => setChoosing(true)} aria-label="남기기">
          <Icon name="plus" size={22} />
        </button>
        <Menu>
          <button onClick={() => setHidden(!hidden)}>
            <Icon name={hidden ? 'eye' : 'eyeOff'} size={16} /> {hidden ? '가림 끄기' : '가림 (화면 공유할 때)'}
          </button>
          <button onClick={() => setQuery(query === null ? '' : null)}>
            <Icon name="list" size={16} /> {query === null ? '검색' : '검색 닫기'}
          </button>
          <button onClick={() => setPrinting(true)}>
            <Icon name="print" size={16} /> 한 장 요약 인쇄
          </button>
          {years.length > 1 &&
            years.map((y) => (
              <button key={y} className={y === year ? 'on' : ''} onClick={() => setYear(y)}>
                {y}학년도 보기
              </button>
            ))}
        </Menu>
      </header>

      {query !== null && <input type="search" className="wide" autoFocus value={query} placeholder="이 학생 기록에서 찾기" onChange={(e) => setQuery(e.target.value)} />}

      {/* 출결: 숫자 한 줄 + 기록 */}
      <Section title="출결" count={records.length}>
        <div className="stat-line">
          <span>
            결석 <b>{summary.absenceDays}</b>일{summary.approvedAbsenceDays > 0 && <span className="muted"> (출석인정 {summary.approvedAbsenceDays}일)</span>}
          </span>
          <span>
            지각 <b>{times('지각')}</b>
          </span>
          <span>
            조퇴 <b>{times('조퇴')}</b>
          </span>
          <span>
            결과 <b>{times('결과')}</b>
          </span>
          {summary.missingDocCount > 0 && <span className="late">받을 서류 {summary.missingDocCount}</span>}
        </div>
        {records.length > 0 && (
          <ul className="rec-rows">
            {records.map((r) => {
              const need = r.docs.filter((d) => d.required && !d.received);
              return (
                <li key={r.id}>
                  <button className="rec-row" onClick={() => setEditingRecord(r)}>
                    <span className="when">{recordDates(r)}</span>
                    <span className="body">
                      <b>{recordTitle(r)}</b>
                      {r.memo && <span className="muted"> · {r.memo}</span>}
                      {need.length > 0 && <span className="late"> · {need.map((d) => d.label).join(', ')} 안 받음</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {(planned.length > 0 || todos.length > 0 || missing.length > 0) && (
        <Section title="챙겨야 할 것">
          <ul className="rec-rows">
            {planned.map((n) => (
              <li key={n.id}>
                <button className="rec-row" onClick={() => setEditingNote(n)}>
                  <span className="when">{formatKo(n.date)}</span>
                  <span className="body">
                    <b>학부모 상담 {n.time}</b>
                    {parentInfo(n) && <span className="muted"> · {parentInfo(n)}</span>}
                    {n.date < today() && <span className="late"> · 결과 적기</span>}
                  </span>
                </button>
              </li>
            ))}
            {todos.map((n) => (
              <li key={`t${n.id}`}>
                <label className="rec-row check-row">
                  <span className="when">
                    <input type="checkbox" checked={false} onChange={() => toggleDone(n.id)} />
                  </span>
                  <span className="body">
                    할 일: {n.followUp} <span className="muted">({formatKo(n.date)} {n.kind})</span>
                  </span>
                </label>
              </li>
            ))}
            {missing.map((c) => (
              <li key={c.id}>
                <a className="rec-row" href="#checklists">
                  <span className="when">{c.dueDate ? formatKo(c.dueDate) : '제출물'}</span>
                  <span className="body">
                    <b>{c.title}</b> <span className="late">안 냄</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="상담" count={counsel.length} onAdd={() => setAdding('학생상담')}>
        {counsel.length === 0 ? (
          <p className="muted">아직 없어요.</p>
        ) : (
          <ul className="rec-rows">
            {counsel.map((n) => (
              <li key={n.id}>
                <button className="rec-row" onClick={() => setEditingNote(n)}>
                  <span className="when">{formatKo(n.date)}</span>
                  <span className="body">
                    <span className="kind">
                      {n.kind === '학부모상담' ? `학부모${parentInfo(n) ? ` (${parentInfo(n)})` : ''}` : '학생'}
                      {n.studentIds.length > 1 && ` · 같이: ${n.studentIds.filter((id) => id !== studentId).map((id) => nameOf(state.students, id)).join(', ')}`}
                    </span>
                    <span className="text private">{n.content}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="관찰" count={observe.length} onAdd={() => setAdding('관찰')}>
        {observe.length === 0 ? (
          <p className="muted">아직 없어요.</p>
        ) : (
          <ul className="rec-rows">
            {observe.map((n) => (
              <li key={n.id}>
                <button className="rec-row" onClick={() => setEditingNote(n)}>
                  <span className="when">{formatKo(n.date)}</span>
                  <span className="body">
                    {n.studentIds.length > 1 && (
                      <span className="kind">같이: {n.studentIds.filter((id) => id !== studentId).map((id) => nameOf(state.students, id)).join(', ')}</span>
                    )}
                    <span className="text private">{n.content}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {tasks.length > 0 && (
        <Section title="필사" count={tasks.length}>
          <div className="stat-line">
            <span>
              총 <b>{pilsa.pages}</b>장
            </span>
            <span>
              낸 것 <b>{pilsa.submitted}</b>장
            </span>
            {pilsa.remaining > 0 ? <span className="late">{pilsa.remaining}장 남음</span> : <span className="ok">다 냄</span>}
          </div>
          <ul className="rec-rows">
            {tasks.map((t) => {
              const left = t.pages - Math.min(t.submitted.length, t.pages);
              return (
                <li key={t.id}>
                  <a className="rec-row" href="#pilsa">
                    <span className="when">{formatKo(t.date)}</span>
                    <span className="body">
                      <b>{t.pages}장</b>
                      {t.reason && <span className="muted"> · {t.reason}</span>}
                      <span className={left ? 'late' : 'muted'}> · {left ? `${left}장 남음` : '다 냄'}</span>
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {behavior?.text && (
        <Section title="행발 초안">
          <a className="rec-row" href="#behavior">
            <span className="body">
              <span className="text private">{behavior.text}</span>
              <span className="muted small">
                {neisBytes(behavior.text)}바이트{behavior.done ? ' · 다 씀' : ''}
              </span>
            </span>
          </a>
        </Section>
      )}

      {choosing && (
        <Modal title="무엇을 남길까요?" onClose={() => setChoosing(false)}>
          <div className="choice-grid">
            {ADD_CHOICES.map((c) => (
              <button key={c.id} className="choice" onClick={() => (setChoosing(false), setAdding(c.id))}>
                <Icon name={c.icon} size={24} />
                {c.label}
              </button>
            ))}
          </div>
        </Modal>
      )}
      {adding && NOTE_KINDS.includes(adding as NoteKind) && <NoteForm studentId={studentId} defaultKind={adding as NoteKind} onClose={() => setAdding(null)} />}
      {adding === 'planned' && <NoteForm studentId={studentId} planned onClose={() => setAdding(null)} />}
      {adding === 'attendance' && <QuickEntry studentId={studentId} date={today()} onClose={() => setAdding(null)} />}
      {adding === 'pilsa' && <GiveForm studentId={studentId} onClose={() => setAdding(null)} />}
      {editingNote && <NoteForm initial={editingNote} studentId={studentId} onClose={() => setEditingNote(null)} />}
      {editingRecord && <RecordForm initial={editingRecord} onClose={() => setEditingRecord(null)} />}
      {printing && (
        <PrintSheet onDone={() => setPrinting(false)}>
          <StudentPrint student={student} year={year} items={all} absence={summary.absenceDays} late={times('지각')} early={times('조퇴')} />
        </PrintSheet>
      )}
    </div>
  );
}

/** 학생 기록의 한 칸: 제목·건수, (있으면) 바로 남기기 */
function Section({ title, count, onAdd, children }: { title: string; count?: number; onAdd?: () => void; children: ReactNode }) {
  return (
    <section className="card rec-section">
      <div className="card-head">
        <h3>
          {title}
          {count !== undefined && count > 0 && <span className="muted"> {count}</span>}
        </h3>
        {onAdd && (
          <button className="ghost small" onClick={onAdd} aria-label={`${title} 남기기`}>
            <Icon name="plus" size={15} /> 남기기
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

/** 학부모 상담 전에 보는 한 장 요약 */
function StudentPrint({
  student,
  year,
  items,
  absence,
  late,
  early,
}: {
  student: Student;
  year: number;
  items: TimelineItem[];
  absence: number;
  late: number;
  early: number;
}) {
  const { state } = useStore();
  const pilsa = pilsaSummary(state.pilsa, student.id, ...schoolYearRange(year));
  const rows = items
    .filter((it) => !(it.type === 'note' && it.note.planned))
    .map((it) => {
      if (it.type === 'attendance') return [formatKo(it.date), '출결', `${recordTitle(it.record)}${it.record.memo ? ` (${it.record.memo})` : ''}`];
      if (it.type === 'note') return [formatKo(it.date), it.note.kind, it.note.content];
      return [formatKo(it.date), '필사', `${it.task.pages}장${it.task.reason ? ` · ${it.task.reason}` : ''}`];
    })
    .reverse();
  return (
    <article className="print-doc">
      <h1>
        {state.settings.className} {student.number}. {student.name} <small>{year}학년도 기록 요약</small>
      </h1>
      <p>
        결석 {absence}일 · 지각 {late} · 조퇴 {early} · 필사 {pilsa.pages}장 (남은 {pilsa.remaining}장)
      </p>
      <table className="print-table">
        <thead>
          <tr>
            <th style={{ width: '16%' }}>날짜</th>
            <th style={{ width: '12%' }}>구분</th>
            <th>내용</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r[0]}</td>
              <td>{r[1]}</td>
              <td className="pre">{r[2]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="print-sign">출력 {formatKo(today())} · 학생 개인정보가 들어 있으니 보관에 주의하세요.</p>
    </article>
  );
}
