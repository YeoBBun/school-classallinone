import { useMemo, useState } from 'react';
import { formatKo, schoolYearOf, schoolYearRange, today } from '../domain/calendar';
import { checklistProgress, pilsaSummary } from '../domain/classroom';
import { summarize } from '../domain/stats';
import { itemKey, matchesQuery, noteCounts, studentTimeline, type TimelineItem } from '../domain/student';
import { KINDS, NOTE_KINDS, STATUSES, type AttendanceRecord, type Note, type NoteKind, type Student } from '../domain/types';
import { useStore } from '../store';
import { Modal, recordTitle } from './common';
import { Icon, type IconName } from './icons';
import { NoteForm } from './NoteForm';
import { RecordForm } from './RecordForm';
import { RecordItem } from './RecordItem';
import { QuickEntry } from './Today';
import { GiveForm } from './PilsaView';
import { Menu, nameOf, PrintSheet } from './ui';

type Filter = 'all' | 'attendance' | NoteKind | 'pilsa' | 'todo';

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

function StudentPage({ studentId }: { studentId: string }) {
  const { state, holidays, warnings } = useStore();
  const student = state.students.find((s) => s.id === studentId)!;
  const [year, setYear] = useState(() => schoolYearOf(today()));
  const [filter, setFilter] = useState<Filter>('all');
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

  const items = useMemo(() => studentTimeline(studentId, state, from, to), [studentId, state, from, to]);
  const summary = useMemo(
    () => summarize([student], state.records, holidays, warnings, from, to, today())[0],
    [student, state.records, holidays, warnings, from, to],
  );
  const notes = noteCounts(items);
  const pilsa = pilsaSummary(state.pilsa, studentId, from, to);
  const planned = items
    .flatMap((it) => (it.type === 'note' && it.note.planned ? [it.note] : []))
    .sort((a, b) => (a.date + (a.time ?? '')).localeCompare(b.date + (b.time ?? '')));
  const missing = state.checklists.filter((c) => !c.closed && checklistProgress(c, [student]).missing.length > 0);
  const times = (st: (typeof STATUSES)[number]) => KINDS.reduce((n, k) => n + summary.counts[st][k], 0);
  const lateEtc = times('지각') + times('조퇴') + times('결과');

  // 요약 한 줄: 0 인 것은 숨기고, 누르면 그것만 거른다
  const chips: { f: Filter; text: string; warn?: boolean }[] = [
    { f: 'attendance', text: `결석 ${summary.absenceDays}일${lateEtc ? ` · 지각·조퇴 ${lateEtc}` : ''}` },
    ...NOTE_KINDS.filter((k) => notes[k] > 0).map((k) => ({ f: k as Filter, text: `${k} ${notes[k]}` })),
    ...(pilsa.pages ? [{ f: 'pilsa' as Filter, text: pilsa.remaining ? `필사 ${pilsa.remaining}장 남음` : `필사 ${pilsa.pages}장`, warn: pilsa.remaining > 0 }] : []),
    ...(notes.todo ? [{ f: 'todo' as Filter, text: `할 일 ${notes.todo}`, warn: true }] : []),
  ];

  const q = (query ?? '').trim();
  const shown = items.filter(
    (it) =>
      matchesQuery(it, q) &&
      (filter === 'all' ||
        it.type === filter ||
        (filter === 'todo' && it.type === 'note' && !!it.note.followUp && !it.note.followUpDone) ||
        (it.type === 'note' && it.note.kind === filter)),
  );

  return (
    <div className={`student-page${hidden ? ' privacy' : ''}`}>
      <header className="page-head">
        <a href="#today" className="icon-btn" aria-label="오늘로">
          <Icon name="left" size={22} />
        </a>
        <h2 className="student-title">
          {student.number}. {student.name}
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

      <div className="summary-line">
        {chips.map((c) => (
          <button key={c.f} className={`chip${filter === c.f ? ' on' : ''}${c.warn ? ' warn' : ''}`} onClick={() => setFilter(filter === c.f ? 'all' : c.f)}>
            {c.text}
          </button>
        ))}
        {filter !== 'all' && (
          <button className="link small" onClick={() => setFilter('all')}>
            전체 보기
          </button>
        )}
      </div>

      {(planned.length > 0 || missing.length > 0 || summary.missingDocCount > 0) && (
        <ul className="heads-up">
          {planned.map((n) => (
            <li key={n.id}>
              <button className="link" onClick={() => setEditingNote(n)}>
                {formatKo(n.date)} {n.time} 학부모 상담{n.date < today() ? ' — 결과를 적어 주세요' : ''}
              </button>
            </li>
          ))}
          {summary.missingDocCount > 0 && <li>받을 출결 서류 {summary.missingDocCount}개</li>}
          {missing.length > 0 && <li>안 낸 제출물: {missing.map((c) => c.title).join(', ')}</li>}
        </ul>
      )}

      {query !== null && <input type="search" className="wide" autoFocus value={query} placeholder="내용 검색" onChange={(e) => setQuery(e.target.value)} />}

      {shown.length === 0 ? (
        <div className="empty">
          <p>{items.length === 0 ? '아직 남긴 것이 없어요. [＋]를 눌러 남겨 보세요.' : '맞는 기록이 없어요.'}</p>
        </div>
      ) : (
        <ul className="records">
          {shown.map((it) => (
            <TimelineRow
              key={itemKey(it)}
              item={it}
              studentId={studentId}
              onEditNote={setEditingNote}
              onEditRecord={setEditingRecord}
            />
          ))}
        </ul>
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
      {adding && NOTE_KINDS.includes(adding as NoteKind) && (
        <NoteForm studentId={studentId} defaultKind={adding as NoteKind} onClose={() => setAdding(null)} />
      )}
      {adding === 'planned' && <NoteForm studentId={studentId} planned onClose={() => setAdding(null)} />}
      {adding === 'attendance' && <QuickEntry studentId={studentId} date={today()} onClose={() => setAdding(null)} />}
      {adding === 'pilsa' && <GiveForm studentId={studentId} onClose={() => setAdding(null)} />}
      {editingNote && <NoteForm initial={editingNote} studentId={studentId} onClose={() => setEditingNote(null)} />}
      {editingRecord && <RecordForm initial={editingRecord} onClose={() => setEditingRecord(null)} />}
      {printing && (
        <PrintSheet onDone={() => setPrinting(false)}>
          <StudentPrint student={student} year={year} items={items} absence={summary.absenceDays} late={times('지각')} early={times('조퇴')} />
        </PrintSheet>
      )}
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
  if (item.type === 'note') return <NoteItem note={item.note} studentId={studentId} onEdit={() => onEditNote(item.note)} />;
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
