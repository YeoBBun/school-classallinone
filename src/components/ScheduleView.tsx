import { useMemo, useState } from 'react';
import { addDays, formatKo, today } from '../domain/calendar';
import { calendarWanted, EVENT_KINDS, type ClassEvent, type EventKind, type Note } from '../domain/types';
import { useGoogle } from '../google/useGoogle';
import { newId, useStore } from '../store';
import { Modal, sortStudents } from './common';
import { Icon } from './icons';
import { NoteForm } from './NoteForm';
import { nameOf, PageHead } from './ui';

/** 일정 한 줄: 학부모 상담(관찰·상담 기록의 일정), 학급 일정, 제출 마감을 한데 */
type Row =
  | { type: 'consult'; date: string; time?: string; note: Note }
  | { type: 'event'; date: string; time?: string; event: ClassEvent }
  | { type: 'due'; date: string; time?: undefined; title: string };

/** 일정: 상담·학급 행사 등을 날짜순으로. 구글 캘린더를 켜 두면 캘린더에도 들어간다 */
export function ScheduleView() {
  const { state } = useStore();
  const now = today();
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const [event, setEvent] = useState<ClassEvent | null>(null);

  const rows = useMemo(() => {
    const out: Row[] = [
      ...state.notes.filter((n) => n.kind === '학부모상담' && (n.planned || n.time)).map((n) => ({ type: 'consult' as const, date: n.date, time: n.time, note: n })),
      ...state.events.map((e) => ({ type: 'event' as const, date: e.date, time: e.time, event: e })),
      ...state.checklists.filter((c) => c.dueDate && !c.closed).map((c) => ({ type: 'due' as const, date: c.dueDate!, title: c.title })),
    ];
    return out.sort((a, b) => (a.date + (a.time ?? '')).localeCompare(b.date + (b.time ?? '')));
  }, [state.notes, state.events, state.checklists]);
  const upcoming = rows.filter((r) => r.date >= now);
  const past = rows.filter((r) => r.date < now).reverse();

  const open = (r: Row) => (r.type === 'consult' ? setNote(r.note) : r.type === 'event' ? setEvent(r.event) : (location.hash = '#checklists'));

  return (
    <div className="module">
      <PageHead title="일정">
        <button className="primary" onClick={() => setAdding(true)}>
          <Icon name="plus" /> 일정 추가
        </button>
      </PageHead>
      {upcoming.length === 0 ? (
        <p className="empty">다가오는 일정이 없어요.</p>
      ) : (
        <DayGroups rows={upcoming} onOpen={open} />
      )}
      {past.length > 0 && (
        <details className="closed-list">
          <summary>지난 일정 {past.length}개</summary>
          <DayGroups rows={past} onOpen={open} />
        </details>
      )}
      {adding && <AddSchedule onClose={() => setAdding(false)} />}
      {note && <NoteForm initial={note} studentId={note.studentIds[0]} onClose={() => setNote(null)} />}
      {event && <EventForm initial={event} onClose={() => setEvent(null)} />}
    </div>
  );
}

function DayGroups({ rows, onOpen }: { rows: Row[]; onOpen: (r: Row) => void }) {
  const { state } = useStore();
  const now = today();
  const days = [...new Set(rows.map((r) => r.date))];
  return (
    <ul className="cards">
      {days.map((d) => (
        <li key={d} className="card day-group">
          <h3>
            {formatKo(d)}
            {d === now && <span className="pill">오늘</span>}
            {d === addDays(now, 1) && <span className="muted small"> 내일</span>}
          </h3>
          <ul className="schedule-list">
            {rows
              .filter((r) => r.date === d)
              .map((r) => (
                <li key={r.type === 'consult' ? r.note.id : r.type === 'event' ? r.event.id : r.title}>
                  <button className="row-btn" onClick={() => onOpen(r)}>
                    <span className="time">{r.time ?? '종일'}</span>
                    <span className="what">
                      {r.type === 'consult' && (
                        <>
                          학부모 상담 · {r.note.studentIds.map((id) => nameOf(state.students, id)).join(', ')}
                          {r.note.parentWho && <span className="muted"> ({[r.note.parentWho, r.note.parentMethod].filter(Boolean).join(', ')})</span>}
                          {!r.note.planned && <span className="muted"> · 마침</span>}
                          {r.note.planned && r.date < now && <span className="late"> · 결과 적기</span>}
                        </>
                      )}
                      {r.type === 'event' && (
                        <>
                          {r.event.title}
                          <span className="muted"> · {r.event.kind}</span>
                        </>
                      )}
                      {r.type === 'due' && <>제출 마감 · {r.title}</>}
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/** 일정 추가: 학부모 상담이면 학생을 골라 상담 일정으로, 아니면 학급 일정으로 */
function AddSchedule({ onClose }: { onClose: () => void }) {
  const { state } = useStore();
  const [kind, setKind] = useState<'상담' | EventKind | null>(null);
  const [student, setStudent] = useState<string | null>(null);

  if (kind === '상담' && student) return <NoteForm studentId={student} planned onClose={onClose} />;
  if (kind && kind !== '상담') return <EventForm kind={kind} onClose={onClose} />;

  return (
    <Modal title={kind === '상담' ? '누구와 상담하나요?' : '어떤 일정인가요?'} onClose={onClose}>
      {kind === '상담' ? (
        <div className="student-grid">
          {sortStudents(state.students).map((s) => (
            <button key={s.id} className="student-btn" onClick={() => setStudent(s.id)}>
              <span className="num">{s.number}</span>
              <span className="nm">{s.name}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="choice-grid">
          <button className="choice" onClick={() => setKind('상담')}>
            <Icon name="people" size={24} />
            학부모 상담
          </button>
          {EVENT_KINDS.map((k) => (
            <button key={k} className="choice" onClick={() => setKind(k)}>
              <Icon name={k === '학급 행사' ? 'today' : 'doc'} size={24} />
              {k}
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

function EventForm({ initial, kind, onClose }: { initial?: ClassEvent; kind?: EventKind; onClose: () => void }) {
  const { state, update, removeItem } = useStore();
  const g = useGoogle();
  const isNew = !initial;
  const [draft, setDraft] = useState<ClassEvent>(() => initial ?? { id: newId(), kind: kind ?? '학급 행사', title: '', date: today() });
  const [error, setError] = useState('');
  const set = (patch: Partial<ClassEvent>) => setDraft((d) => ({ ...d, ...patch }));

  const save = () => {
    if (!draft.title.trim()) return setError('무슨 일정인지 적어 주세요.');
    const e: ClassEvent = { ...draft, title: draft.title.trim(), time: draft.time || undefined, memo: draft.memo?.trim() || undefined };
    update((s) => ({ ...s, events: isNew ? [...s.events, e] : s.events.map((x) => (x.id === e.id ? e : x)) }));
    onClose();
  };
  const remove = () => {
    removeItem('events', draft.id, `일정 '${draft.title}'`);
    onClose();
  };

  return (
    <Modal title={isNew ? draft.kind : '일정'} onClose={onClose}>
      <div className="form">
        <section>
          <label className="field-label">무슨 일정</label>
          <input
            className="wide"
            autoFocus
            value={draft.title}
            placeholder={draft.kind === '학급 행사' ? '예: 체육대회, 학급 회의' : '예: 학년 협의회'}
            onChange={(e) => (set({ title: e.target.value }), setError(''))}
          />
        </section>
        <section className="row">
          <div>
            <label className="field-label">날짜</label>
            <input type="date" value={draft.date} onChange={(e) => e.target.value && set({ date: e.target.value })} />
          </div>
          <div>
            <label className="field-label">시각 (없으면 하루 종일)</label>
            <input type="time" value={draft.time ?? ''} step={600} onChange={(e) => set({ time: e.target.value })} />
          </div>
        </section>
        <section>
          <label className="field-label">메모 (선택)</label>
          <textarea rows={2} value={draft.memo ?? ''} onChange={(e) => set({ memo: e.target.value })} />
        </section>
        {g.calendar && calendarWanted(state.settings) && <p className="hint">저장하면 구글 캘린더에도 들어가요.</p>}
        {error && <p className="error">{error}</p>}
        <footer className="form-actions">
          {!isNew && (
            <button type="button" className="danger" onClick={remove}>
              지우기
            </button>
          )}
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
