import { useMemo, useState } from 'react';
import { formatKo, schoolYearOf, schoolYearRange, today } from '../domain/calendar';
import { checklistProgress, pilsaSummary } from '../domain/classroom';
import { summarize } from '../domain/stats';
import { itemKey, matchesQuery, noteCounts, studentTimeline, type TimelineItem } from '../domain/student';
import { KINDS, NOTE_KINDS, STATUSES, type AttendanceRecord, type Incident, type Note, type NoteKind, type Student } from '../domain/types';
import { useStore } from '../store';
import { recordTitle, sortStudents } from './common';
import { Icon } from './icons';
import { IncidentForm } from './IncidentsView';
import { NoteForm } from './NoteForm';
import { RecordForm } from './RecordForm';
import { RecordItem } from './RecordItem';
import { QuickEntry } from './Today';
import { nameOf, PrintSheet } from './ui';

type Filter = 'all' | 'attendance' | NoteKind | 'pilsa' | 'incident' | 'todo';

export const NOTE_CLASS: Record<NoteKind, string> = { 관찰: 'n-obs', 학생상담: 'n-counsel', 학부모상담: 'n-parent' };

const PRIVACY_KEY = 'class-privacy';

/** 가림 모드: 전자칠판·화면 공유 중에 상담·사안 내용을 숨긴다 (이 기기에만 기억) */
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

/** 학생 탭: 명단 → 학생을 누르면 그 학생에 대해 적은 것을 한 화면에 모아 본다. */
export function StudentsView({ studentId }: { studentId: string | null }) {
  const { state } = useStore();
  const student = studentId ? state.students.find((s) => s.id === studentId) : undefined;
  if (student) return <StudentPage studentId={student.id} />;

  if (state.students.length === 0) {
    return (
      <div className="empty">
        <p>학생 명단이 아직 없어요.</p>
        <a className="button primary" href="#settings">
          설정에서 명단 등록하기
        </a>
      </div>
    );
  }

  return <Roster />;
}

function Roster() {
  const { state } = useStore();
  const counts = useMemo(() => {
    const [from, to] = schoolYearRange(schoolYearOf(today()));
    const map = new Map<string, number>();
    for (const n of state.notes) {
      if (n.date < from || n.date > to || n.planned) continue;
      for (const id of n.studentIds) map.set(id, (map.get(id) ?? 0) + 1);
    }
    return map;
  }, [state.notes]);

  return (
    <section className="card">
      <div className="card-head">
        <h3>학생을 누르면 그 학생 기록을 모아 봐요</h3>
        <span className="muted">{state.students.length}명</span>
      </div>
      <div className="student-grid">
        {sortStudents(state.students).map((s) => (
          <a key={s.id} className="student-btn" href={`#students/${s.id}`}>
            <span className="num">{s.number}</span>
            <span className="nm">{s.name}</span>
            {(counts.get(s.id) ?? 0) > 0 && <span className="muted small">기록 {counts.get(s.id)}</span>}
          </a>
        ))}
      </div>
    </section>
  );
}

function StudentPage({ studentId }: { studentId: string }) {
  const { state, holidays, warnings } = useStore();
  const student = state.students.find((s) => s.id === studentId)!;
  const [year, setYear] = useState(() => schoolYearOf(today()));
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [writing, setWriting] = useState<{ note?: Note; planned?: boolean } | null>(null);
  const [editingRecord, setEditingRecord] = useState<AttendanceRecord | null>(null);
  const [incident, setIncident] = useState<Incident | 'new' | null>(null);
  const [attendance, setAttendance] = useState(false);
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

  const items = useMemo(() => studentTimeline(studentId, state, from, to), [studentId, state, from, to]);
  const summary = useMemo(
    () => summarize([student], state.records, holidays, warnings, from, to, today())[0],
    [student, state.records, holidays, warnings, from, to],
  );
  const notes = noteCounts(items);
  const pilsa = pilsaSummary(state.pilsa, studentId, from, to);
  const incidents = items.flatMap((it) => (it.type === 'incident' ? [it.incident] : []));
  const openIncidents = incidents.filter((i) => i.status !== '종결').length;
  const planned = items
    .flatMap((it) => (it.type === 'note' && it.note.planned ? [it.note] : []))
    .sort((a, b) => (a.date + (a.time ?? '')).localeCompare(b.date + (b.time ?? '')));
  const missing = state.checklists.filter((c) => !c.closed && checklistProgress(c, [student]).missing.length > 0);
  const times = (st: (typeof STATUSES)[number]) => KINDS.reduce((n, k) => n + summary.counts[st][k], 0);

  const shown = items.filter(
    (it) =>
      matchesQuery(it, query.trim()) &&
      (filter === 'all' ||
        it.type === filter ||
        (filter === 'todo' && it.type === 'note' && !!it.note.followUp && !it.note.followUpDone) ||
        (it.type === 'note' && it.note.kind === filter)),
  );
  const pick = (f: Filter) => setFilter((cur) => (cur === f ? 'all' : f));

  return (
    <div className={`student-page${hidden ? ' privacy' : ''}`}>
      <header className="page-head">
        <a href="#students" className="button ghost">
          <Icon name="left" /> 학생 목록
        </a>
        <h2 className="student-title">
          {student.number}. {student.name}
        </h2>
        <span className="spacer" />
        {years.length > 1 && (
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="학년도">
            {years.map((y) => (
              <option key={y} value={y}>
                {y}학년도
              </option>
            ))}
          </select>
        )}
        <button className="ghost small" onClick={() => setHidden(!hidden)} title="전자칠판·화면 공유 중에 상담·사안 내용을 숨겨요">
          <Icon name={hidden ? 'eyeOff' : 'eye'} size={16} /> {hidden ? '가림 켜짐' : '가림'}
        </button>
        <button className="ghost small" onClick={() => setPrinting(true)}>
          <Icon name="print" size={16} /> 인쇄
        </button>
      </header>

      <div className="student-actions">
        <button className="primary big" onClick={() => setWriting({})}>
          <Icon name="plus" /> 기록 남기기
        </button>
        <button className="big" onClick={() => setAttendance(true)}>
          <Icon name="today" /> 출결 입력
        </button>
        <div className="minor-actions">
          <button className="small" onClick={() => setWriting({ planned: true })}>
            상담 일정
          </button>
          <a className="button small" href="#pilsa">
            필사
          </a>
          <button className="small" onClick={() => setIncident('new')}>
            사안 등록
          </button>
        </div>
      </div>

      {(planned.length > 0 || missing.length > 0 || notes.todo > 0) && (
        <ul className="heads-up">
          {planned.map((n) => (
            <li key={n.id}>
              <button className="link" onClick={() => setWriting({ note: n })}>
                📅 {formatKo(n.date)} {n.time} 학부모 상담{n.date < today() ? ' — 결과를 적어 주세요' : ''}
              </button>
            </li>
          ))}
          {notes.todo > 0 && (
            <li>
              <button className="link" onClick={() => pick('todo')}>
                할 일 {notes.todo}건 남음
              </button>
            </li>
          )}
          {missing.length > 0 && <li>안 낸 제출물: {missing.map((c) => c.title).join(', ')}</li>}
        </ul>
      )}

      <div className="summary-cards">
        <button className={`sum-card${filter === 'attendance' ? ' on' : ''}`} onClick={() => pick('attendance')}>
          <span className="kpi-label">출결</span>
          <span className="sum-main">
            결석 <b>{summary.absenceDays}</b>일
            {summary.approvedAbsenceDays > 0 && <span className="muted"> (+인정 {summary.approvedAbsenceDays}일)</span>}
          </span>
          <span className="muted">
            지각 {times('지각')} · 조퇴 {times('조퇴')} · 결과 {times('결과')}
          </span>
          {summary.missingDocCount > 0 && <span className="sum-warn">받을 서류 {summary.missingDocCount}</span>}
        </button>
        {NOTE_KINDS.map((k) => (
          <button key={k} className={`sum-card ${NOTE_CLASS[k]}${filter === k ? ' on' : ''}`} onClick={() => pick(k)}>
            <span className="kpi-label">{k}</span>
            <span className="sum-main">
              <b>{notes[k]}</b>건
            </span>
          </button>
        ))}
        <button className={`sum-card k-pilsa${filter === 'pilsa' ? ' on' : ''}`} onClick={() => pick('pilsa')}>
          <span className="kpi-label">필사</span>
          <span className="sum-main">
            <b>{pilsa.pages}</b>장
          </span>
          {pilsa.remaining > 0 ? <span className="sum-warn">{pilsa.remaining}장 남음</span> : pilsa.pages > 0 && <span className="muted">다 냄</span>}
        </button>
        <button className={`sum-card k-incident${filter === 'incident' ? ' on' : ''}`} onClick={() => pick('incident')}>
          <span className="kpi-label">사안</span>
          <span className="sum-main">
            <b>{incidents.length}</b>건
          </span>
          {openIncidents > 0 && <span className="sum-warn">진행 {openIncidents}</span>}
        </button>
      </div>

      <div className="toolbar">
        <div className="seg scroll">
          {(['all', 'attendance', ...NOTE_KINDS, 'pilsa', 'incident'] as Filter[]).map((f) => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {FILTER_LABEL[f] ?? f}
            </button>
          ))}
        </div>
        <input type="search" value={query} placeholder="내용 검색" onChange={(e) => setQuery(e.target.value)} />
      </div>

      {shown.length === 0 ? (
        <div className="empty">
          <p>{items.length === 0 ? `${year}학년도에 적은 기록이 아직 없어요.` : '조건에 맞는 기록이 없어요.'}</p>
          {items.length === 0 && (
            <button className="primary" onClick={() => setWriting({})}>
              첫 기록 남기기
            </button>
          )}
        </div>
      ) : (
        <ul className="records">
          {shown.map((it) => (
            <TimelineRow
              key={itemKey(it)}
              item={it}
              studentId={studentId}
              onEditNote={(note) => setWriting({ note })}
              onEditRecord={setEditingRecord}
              onEditIncident={setIncident}
            />
          ))}
        </ul>
      )}

      {writing && (
        <NoteForm
          initial={writing.note}
          studentId={studentId}
          planned={writing.planned}
          defaultKind={NOTE_KINDS.includes(filter as NoteKind) ? (filter as NoteKind) : undefined}
          onClose={() => setWriting(null)}
        />
      )}
      {editingRecord && <RecordForm initial={editingRecord} onClose={() => setEditingRecord(null)} />}
      {attendance && <QuickEntry studentId={studentId} date={today()} onClose={() => setAttendance(false)} />}
      {incident && <IncidentForm initial={incident === 'new' ? undefined : incident} studentId={studentId} onClose={() => setIncident(null)} />}
      {printing && (
        <PrintSheet onDone={() => setPrinting(false)}>
          <StudentPrint student={student} year={year} items={items} absence={summary.absenceDays} late={times('지각')} early={times('조퇴')} />
        </PrintSheet>
      )}
    </div>
  );
}

const FILTER_LABEL: Partial<Record<Filter, string>> = { all: '전체', attendance: '출결', pilsa: '필사', incident: '사안' };

function TimelineRow({
  item,
  studentId,
  onEditNote,
  onEditRecord,
  onEditIncident,
}: {
  item: TimelineItem;
  studentId: string;
  onEditNote: (n: Note) => void;
  onEditRecord: (r: AttendanceRecord) => void;
  onEditIncident: (i: Incident) => void;
}) {
  const { state } = useStore();
  if (item.type === 'attendance') return <RecordItem record={item.record} onEdit={() => onEditRecord(item.record)} />;
  if (item.type === 'note') return <NoteItem note={item.note} studentId={studentId} onEdit={() => onEditNote(item.note)} />;
  if (item.type === 'pilsa') {
    const t = item.task;
    const left = t.pages - Math.min(t.submitted.length, t.pages);
    return (
      <li className="record">
        <a className="record-main" href="#pilsa">
          <span className="date">{formatKo(t.date)}</span>
          <span className="tag k-pilsa">필사 {t.pages}장</span>
          {t.reason && <span className="memo">{t.reason}</span>}
          <span className={left ? 'late small' : 'muted small'}>{left ? `${left}장 남음` : '다 냄'}</span>
        </a>
      </li>
    );
  }
  const i = item.incident;
  const others = i.studentIds.filter((id) => id !== studentId).map((id) => nameOf(state.students, id));
  return (
    <li className="record">
      <button className="record-main" onClick={() => onEditIncident(i)} title="눌러서 보기">
        <span className="date">{formatKo(i.date)}</span>
        <span className="tag k-incident">사안 · {i.status}</span>
        <span className="private">{i.title}</span>
        {others.length > 0 && <span className="memo">같이: {others.join(', ')}</span>}
      </button>
    </li>
  );
}

function NoteItem({ note, studentId, onEdit }: { note: Note; studentId: string; onEdit: () => void }) {
  const { state, update, removeNote } = useStore();
  const others = note.studentIds.filter((id) => id !== studentId).map((id) => nameOf(state.students, id));
  const parent = note.kind === '학부모상담' ? [note.parentWho, note.parentMethod].filter(Boolean).join(' · ') : '';
  const toggleDone = () =>
    update((s) => ({ ...s, notes: s.notes.map((n) => (n.id === note.id ? { ...n, followUpDone: !n.followUpDone } : n)) }));

  return (
    <li className={`record${note.planned ? ' planned' : ''}`}>
      <div className="record-head">
        <button className="record-main" onClick={onEdit} title="눌러서 고치기">
          <span className="date">{formatKo(note.date)}</span>
          <span className={`tag ${NOTE_CLASS[note.kind]}`}>{note.planned ? `상담 예정 ${note.time ?? ''}` : note.kind}</span>
          {parent && <span className="memo">{parent}</span>}
          {others.length > 0 && <span className="memo">같이: {others.join(', ')}</span>}
          {note.neisDone && <span className="memo">나이스 ✓</span>}
        </button>
        <button className="del-btn" onClick={() => removeNote(note.id, `${formatKo(note.date)} ${note.kind}`)} aria-label="삭제">
          삭제
        </button>
      </div>
      {note.content && (
        <p className="note-text private" onClick={onEdit}>
          {note.content}
        </p>
      )}
      {note.followUp && (
        <label className={`follow-up${note.followUpDone ? ' done' : ''}`}>
          <input type="checkbox" checked={!!note.followUpDone} onChange={toggleDone} />
          할 일: {note.followUp}
        </label>
      )}
    </li>
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
      if (it.type === 'pilsa') return [formatKo(it.date), '필사', `${it.task.pages}장${it.task.reason ? ` · ${it.task.reason}` : ''}`];
      return [formatKo(it.date), '사안', `${it.incident.title} (${it.incident.status})`];
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
