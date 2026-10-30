import { useMemo, useState } from 'react';
import { formatKo, schoolYearOf, schoolYearRange, today } from '../domain/calendar';
import { summarize } from '../domain/stats';
import { matchesQuery, noteCounts, studentTimeline, type TimelineItem } from '../domain/student';
import { KINDS, NOTE_KINDS, STATUSES, type AttendanceRecord, type Note, type NoteKind } from '../domain/types';
import { useStore } from '../store';
import { sortStudents } from './common';
import { Icon } from './icons';
import { NoteForm } from './NoteForm';
import { RecordForm } from './RecordForm';
import { RecordItem } from './RecordItem';
import { QuickEntry } from './Today';

type Filter = 'all' | 'attendance' | NoteKind | 'todo';

export const NOTE_CLASS: Record<NoteKind, string> = { 관찰: 'n-obs', 학생상담: 'n-counsel', 학부모상담: 'n-parent' };

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
      if (n.date < from || n.date > to) continue;
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
  const [writing, setWriting] = useState<{ note?: Note; kind?: NoteKind } | null>(null);
  const [editingRecord, setEditingRecord] = useState<AttendanceRecord | null>(null);
  const [attendance, setAttendance] = useState(false);

  const [from, to] = schoolYearRange(year);
  const years = useMemo(() => {
    const set = new Set([
      schoolYearOf(today()),
      ...state.records.filter((r) => r.studentId === studentId).map((r) => schoolYearOf(r.startDate)),
      ...state.notes.filter((n) => n.studentIds.includes(studentId)).map((n) => schoolYearOf(n.date)),
    ]);
    return [...set].sort((a, b) => b - a);
  }, [state.records, state.notes, studentId]);

  const items = useMemo(
    () => studentTimeline(studentId, state.records, state.notes, from, to),
    [studentId, state.records, state.notes, from, to],
  );
  const summary = useMemo(
    () => summarize([student], state.records, holidays, warnings, from, to, today())[0],
    [student, state.records, holidays, warnings, from, to],
  );
  const notes = noteCounts(items);
  const times = (st: (typeof STATUSES)[number]) => KINDS.reduce((n, k) => n + summary.counts[st][k], 0);

  const shown = items.filter(
    (it) =>
      matchesQuery(it, query.trim()) &&
      (filter === 'all' ||
        (filter === 'attendance' && it.type === 'attendance') ||
        (filter === 'todo' && it.type === 'note' && !!it.note.followUp && !it.note.followUpDone) ||
        (it.type === 'note' && it.note.kind === filter)),
  );
  const pick = (f: Filter) => setFilter((cur) => (cur === f ? 'all' : f));

  return (
    <div className="student-page">
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
      </header>

      <div className="student-actions">
        <button className="primary big" onClick={() => setWriting({})}>
          <Icon name="plus" /> 기록 남기기
        </button>
        <button className="big" onClick={() => setAttendance(true)}>
          <Icon name="today" /> 출결 입력
        </button>
      </div>

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
        {notes.todo > 0 && (
          <button className={`sum-card${filter === 'todo' ? ' on' : ''}`} onClick={() => pick('todo')}>
            <span className="kpi-label">할 일</span>
            <span className="sum-main sum-warn">
              <b>{notes.todo}</b>건 남음
            </span>
          </button>
        )}
      </div>

      <div className="toolbar">
        <div className="seg">
          {(['all', 'attendance', ...NOTE_KINDS] as Filter[]).map((f) => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {f === 'all' ? '전체' : f === 'attendance' ? '출결' : f}
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
              key={it.type === 'note' ? `n${it.note.id}` : `r${it.record.id}`}
              item={it}
              studentId={studentId}
              onEditNote={(note) => setWriting({ note })}
              onEditRecord={setEditingRecord}
            />
          ))}
        </ul>
      )}

      {writing && (
        <NoteForm
          initial={writing.note}
          studentId={studentId}
          defaultKind={writing.kind ?? (NOTE_KINDS.includes(filter as NoteKind) ? (filter as NoteKind) : undefined)}
          onClose={() => setWriting(null)}
        />
      )}
      {editingRecord && <RecordForm initial={editingRecord} onClose={() => setEditingRecord(null)} />}
      {attendance && <QuickEntry studentId={studentId} date={today()} onClose={() => setAttendance(false)} />}
    </div>
  );
}

function TimelineRow({
  item,
  studentId,
  onEditNote,
  onEditRecord,
}: {
  item: TimelineItem;
  studentId: string;
  onEditNote: (n: Note) => void;
  onEditRecord: (r: AttendanceRecord) => void;
}) {
  if (item.type === 'attendance') return <RecordItem record={item.record} onEdit={() => onEditRecord(item.record)} />;
  return <NoteItem note={item.note} studentId={studentId} onEdit={() => onEditNote(item.note)} />;
}

function NoteItem({ note, studentId, onEdit }: { note: Note; studentId: string; onEdit: () => void }) {
  const { state, update, removeNote } = useStore();
  const others = note.studentIds
    .filter((id) => id !== studentId)
    .map((id) => state.students.find((s) => s.id === id)?.name)
    .filter(Boolean);
  const parent = note.kind === '학부모상담' ? [note.parentWho, note.parentMethod].filter(Boolean).join(' · ') : '';
  const toggleDone = () =>
    update((s) => ({ ...s, notes: s.notes.map((n) => (n.id === note.id ? { ...n, followUpDone: !n.followUpDone } : n)) }));

  return (
    <li className="record">
      <div className="record-head">
        <button className="record-main" onClick={onEdit} title="눌러서 고치기">
          <span className="date">{formatKo(note.date)}</span>
          <span className={`tag ${NOTE_CLASS[note.kind]}`}>{note.kind}</span>
          {parent && <span className="memo">{parent}</span>}
          {others.length > 0 && <span className="memo">같이: {others.join(', ')}</span>}
        </button>
        <button className="del-btn" onClick={() => removeNote(note.id, `${formatKo(note.date)} ${note.kind}`)} aria-label="삭제">
          삭제
        </button>
      </div>
      <p className="note-text" onClick={onEdit}>
        {note.content}
      </p>
      {note.followUp && (
        <label className={`follow-up${note.followUpDone ? ' done' : ''}`}>
          <input type="checkbox" checked={!!note.followUpDone} onChange={toggleDone} />
          할 일: {note.followUp}
        </label>
      )}
    </li>
  );
}
