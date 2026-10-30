import { useMemo, useState } from 'react';
import { addDays, formatKo, isWeekend, today } from '../domain/calendar';
import { computeWarnings, statusOn, rebuildDocs } from '../domain/rules';
import {
  APPROVED_REASONS,
  KINDS,
  STATUSES,
  type ApprovedReason,
  type AttendanceRecord,
  FAMILY_EVENTS,
  type FamilyEvent,
  type Kind,
  type Status,
} from '../domain/types';
import { newId, useStore } from '../store';
import { dayStatus, kindClass, KIND_SHORT, KindGuide, Modal, PeriodPicker, recordDates, sortStudents, studentLabel } from './common';
import { Icon } from './icons';
import { clean, RecordForm } from './RecordForm';
import { RecordItem } from './RecordItem';
import { TodoCard } from './TodoCard';

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
const PERIODS = [1, 2, 3, 4, 5, 6, 7];
/** 기간·기한 정보가 꼭 필요해서 간편 입력 대신 자세히 입력으로 보내는 사유 */
const NEEDS_DETAIL: ApprovedReason[] = ['체험학습', '법정감염병'];

function bigDate(d: string): { main: string; weekday: string } {
  const [, m, day] = d.split('-').map(Number);
  const [y] = d.split('-').map(Number);
  return { main: `${m}월 ${day}일`, weekday: `${WEEKDAY[new Date(y, m - 1, day).getDay()]}요일` };
}

/** 출결 꼬리표에 쓰는 짧은 표기. 예: 질병 결석, 체험학습 결석 */
function shortTag(r: AttendanceRecord, date: string): string {
  return `${r.kind === '출석인정' && r.reason ? r.reason : KIND_SHORT[r.kind]} ${statusOn(r, date)}`;
}

export function Today() {
  const { state, holidays } = useStore();
  const [date, setDate] = useState(today);
  const [entryFor, setEntryFor] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const now = today();
  const holiday = holidays.get(date);
  const { main, weekday } = bigDate(date);

  const todays = useMemo(() => {
    const map = new Map<string, AttendanceRecord[]>();
    for (const r of state.records) {
      if (r.startDate <= date && date <= r.endDate) {
        const list = map.get(r.studentId) ?? [];
        list.push(r);
        map.set(r.studentId, list);
      }
    }
    return map;
  }, [state.records, date]);

  const sub = holiday ? `${holiday.name} · 쉬는 날` : isWeekend(date) ? '주말' : date === now ? '오늘' : '';

  return (
    <div className="today">
      <header className="date-bar">
        <button className="icon-btn" onClick={() => setDate(addDays(date, -1))} aria-label="전날">
          <Icon name="left" size={22} />
        </button>
        <div className="date-center">
          <h2>
            {main} <span className="weekday">{weekday}</span>
          </h2>
          <p className="date-sub">
            {sub && <span className={holiday || isWeekend(date) ? 'off' : 'is-today'}>{sub}</span>}
            {date !== now && (
              <button className="pill" onClick={() => setDate(now)}>
                오늘로
              </button>
            )}
          </p>
        </div>
        <button className="icon-btn" onClick={() => setDate(addDays(date, 1))} aria-label="다음날">
          <Icon name="right" size={22} />
        </button>
      </header>

      {state.students.length === 0 ? (
        <div className="empty">
          <p>학생 명단이 아직 없어요.</p>
          <a className="button primary" href="#settings/class">
            설정에서 명단 등록하기
          </a>
        </div>
      ) : (
        <div className="today-grid">
          <section className="card roster-card">
            <div className="card-head">
              <h3>학생을 누르세요</h3>
              <span className="muted">{state.students.length}명</span>
            </div>
            <RosterGrid date={date} records={todays} onPick={setPicked} />
          </section>

          <aside className="today-side">
            <DaySummary date={date} records={todays} onOpen={setEntryFor} />
            <TodoCard />
          </aside>
        </div>
      )}

      {picked && (
        <StudentChoice
          studentId={picked}
          onAttendance={() => (setEntryFor(picked), setPicked(null))}
          onClose={() => setPicked(null)}
        />
      )}
      {entryFor && <QuickEntry studentId={entryFor} date={date} onClose={() => setEntryFor(null)} />}
    </div>
  );
}

/** 학생을 눌렀을 때: 출결 입력 / 학생 기록(관찰·상담·필사 등을 모아 보고 남기기) */
function StudentChoice({ studentId, onAttendance, onClose }: { studentId: string; onAttendance: () => void; onClose: () => void }) {
  const { state } = useStore();
  const s = state.students.find((x) => x.id === studentId);
  return (
    <Modal title={studentLabel(s)} onClose={onClose}>
      <div className="choice-grid two">
        <button className="choice" onClick={onAttendance}>
          <Icon name="today" size={28} />
          출결
        </button>
        <a className="choice" href={`#students/${studentId}`} onClick={onClose}>
          <Icon name="people" size={28} />
          학생 기록
        </a>
      </div>
    </Modal>
  );
}

/** 학생 번호판. 그날 출결이 있는 학생은 종류 색으로 표시된다. */
function RosterGrid({
  date,
  records,
  onPick,
}: {
  date: string;
  records: Map<string, AttendanceRecord[]>;
  onPick: (studentId: string) => void;
}) {
  const { state } = useStore();
  return (
    <div className="student-grid">
      {sortStudents(state.students).map((s) => {
        const recs = records.get(s.id) ?? [];
        return (
          <button
            key={s.id}
            className={`student-btn${recs.length ? ` has ${kindClass(recs[0].kind)}` : ''}`}
            onClick={() => onPick(s.id)}
          >
            <span className="num">{s.number}</span>
            <span className="nm">{s.name}</span>
            {recs.map((r) => (
              <span key={r.id} className={`tag ${kindClass(r.kind)}`}>
                {shortTag(r, date)}
              </span>
            ))}
          </button>
        );
      })}
    </div>
  );
}

/** 그날 출결 현황을 "1. 김철수 : 질병결석 (감기)" 형식으로 보여준다. 줄을 누르면 그 학생 기록을 연다. */
function DaySummary({
  date,
  records,
  onOpen,
}: {
  date: string;
  records: Map<string, AttendanceRecord[]>;
  onOpen: (studentId: string) => void;
}) {
  const { state, holidays, warnings, removeRecord } = useStore();
  const [copied, setCopied] = useState(false);
  const isToday = date === today();

  const lines = sortStudents(state.students).flatMap((s) =>
    (records.get(s.id) ?? []).map((r) => {
      const { label, detail } = dayStatus(r, date, holidays);
      return {
        key: r.id,
        record: r,
        studentId: s.id,
        name: `${s.number}. ${s.name}`,
        text: `${s.number}. ${s.name} : ${label}${detail ? ` (${detail})` : ''}`,
        label,
        detail,
        warn: warnings.get(r.id),
      };
    }),
  );
  const all = [...records.values()].flat();
  const counts = STATUSES.map((st) => [st, all.filter((r) => statusOn(r, date) === st).length] as const).filter(([, n]) => n > 0);

  const copy = async () => {
    const text = [`${formatKo(date)} 출결`, ...lines.map((l) => l.text)].join('\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 클립보드 권한이 없는 환경 대비
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <section className="card">
      <div className="card-head">
        <h3>{isToday ? '오늘' : formatKo(date)} 출결</h3>
        {lines.length > 0 && (
          <button className="ghost small" onClick={copy} title="메신저에 붙여넣기 좋게 복사">
            <Icon name={copied ? 'check' : 'copy'} size={15} />
            {copied ? '복사됨' : '복사'}
          </button>
        )}
      </div>
      {counts.length > 0 && (
        <div className="stat-row">
          {counts.map(([st, n]) => (
            <span key={st} className="stat">
              <b>{n}</b>
              {st}
            </span>
          ))}
        </div>
      )}
      {lines.length === 0 ? (
        <p className="all-present">
          <Icon name="check" size={16} /> 모두 출석이에요
        </p>
      ) : (
        <ul className="day-summary">
          {lines.map((l) => (
            <li key={l.key}>
              <button className="row-btn" onClick={() => onOpen(l.studentId)}>
                <span className="who">{l.name}</span>
                <span className={`tag ${kindClass(l.record.kind)}`}>{l.label}</span>
                {l.detail && <span className="muted detail">{l.detail}</span>}
                {l.warn && (
                  <span className="warn-mark" title={l.warn.join('\n')}>
                    ⚠
                  </span>
                )}
              </button>
              <button
                className="del-btn"
                aria-label="삭제"
                onClick={() =>
                  removeRecord(
                    l.record.id,
                    `${l.name} ${l.record.startDate === l.record.endDate ? '' : `${recordDates(l.record)} `}${l.label}`,
                  )
                }
              >
                삭제
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** 학생 한 명의 그날 출결을 몇 번의 터치로 입력한다. */
export function QuickEntry({ studentId, date, onClose }: { studentId: string; date: string; onClose: () => void }) {
  const { state, update, holidays, docContext } = useStore();
  const [status, setStatus] = useState<Status | null>(null);
  const [kind, setKind] = useState<Kind | null>(null);
  const [reason, setReason] = useState<ApprovedReason | null>(null);
  const [periods, setPeriods] = useState<number[]>([]);
  const [memo, setMemo] = useState('');
  const [period, setPeriod] = useState<number | undefined>(undefined);
  const [familyEvent, setFamilyEvent] = useState<FamilyEvent | null>(null);
  const [editing, setEditing] = useState<AttendanceRecord | null>(null);
  const [detail, setDetail] = useState(false);
  const student = state.students.find((s) => s.id === studentId);
  const existing = state.records.filter((r) => r.studentId === studentId && r.startDate <= date && date <= r.endDate);

  const needsPeriod = status === '지각' || status === '조퇴';
  const ready =
    status &&
    kind &&
    (kind !== '출석인정' || reason) &&
    memo.trim() &&
    (!needsPeriod || period !== undefined) &&
    (status !== '결과' || periods.length > 0) &&
    (reason !== '경조사' || kind !== '출석인정' || familyEvent);
  const needsDetail = kind === '출석인정' && reason && NEEDS_DETAIL.includes(reason);

  const draft = useMemo<AttendanceRecord | null>(() => {
    if (!ready) return null;
    const r = reason ?? undefined;
    return clean({
      id: newId(),
      studentId,
      status: status!,
      kind: kind!,
      reason: r,
      startDate: date,
      endDate: date,
      periods: status === '결과' ? periods : undefined,
      lateUntil: status === '지각' ? period : undefined,
      leaveFrom: status === '조퇴' ? period : undefined,
      familyEvent: kind === '출석인정' && reason === '경조사' ? familyEvent ?? undefined : undefined,
      docs: rebuildDocs([], { status: status!, kind: kind!, reason: kind === '출석인정' ? r : undefined, startDate: date, endDate: date }, docContext),
      memo: memo.trim(),
    });
  }, [ready, status, kind, reason, periods, period, memo, familyEvent, studentId, date, docContext]);

  const preview = useMemo(
    () =>
      draft
        ? computeWarnings({ records: [...state.records, draft], holidays, settings: state.settings, today: today() }).get(draft.id) ?? []
        : [],
    [draft, state.records, state.settings, holidays],
  );

  const save = () => {
    if (!draft) return;
    update((s) => ({ ...s, records: [...s.records, draft] }));
    onClose();
  };

  if (detail) {
    return (
      <RecordForm
        defaultStudentId={studentId}
        defaultDate={date}
        prefill={{
          status: status ?? undefined,
          kind: kind ?? undefined,
          reason: reason ?? undefined,
          memo: memo.trim(),
          familyEvent: familyEvent ?? undefined,
          periods: status === '결과' ? periods : undefined,
          lateUntil: status === '지각' ? period : undefined,
          leaveFrom: status === '조퇴' ? period : undefined,
        }}
        onClose={onClose}
      />
    );
  }

  return (
    <Modal title={`${studentLabel(student)} · ${formatKo(date)}`} onClose={onClose}>
      {existing.length > 0 && (
        <section className="quick-existing">
          <ul className="records">
            {existing.map((r) => (
              <RecordItem key={r.id} record={r} onEdit={() => setEditing(r)} />
            ))}
          </ul>
          <p className="hint">기록을 누르면 고치거나 지울 수 있어요. 아래에서 기록을 더 추가할 수 있어요.</p>
        </section>
      )}

      <div className="quick">
        <Choice
          label="상황"
          options={STATUSES}
          value={status}
          onChange={(s) => {
            setStatus(s);
            setPeriod(undefined);
          }}
        />
        {(status === '지각' || status === '조퇴') && <PeriodPicker mode={status} value={period} onChange={setPeriod} />}
        {status === '결과' && (
          <div>
            <span className="field-label">빠진 교시 (여러 개 고를 수 있어요)</span>
            <div className="big-seg">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  className={periods.includes(p) ? 'on' : ''}
                  onClick={() => setPeriods((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p].sort((a, b) => a - b)))}
                >
                  {p}교시
                </button>
              ))}
            </div>
          </div>
        )}
        <Choice
          label="종류"
          options={KINDS}
          tone={kindClass}
          value={kind}
          onChange={(k) => {
            setKind(k);
            if (k !== '출석인정') setReason(null);
          }}
        />
        {kind === '출석인정' && <Choice label="사유" options={APPROVED_REASONS} value={reason} onChange={setReason} />}
        {kind === '출석인정' && reason === '경조사' && (
          <Choice label="경조사 종류" options={FAMILY_EVENTS.map((e) => e.key)} value={familyEvent} onChange={setFamilyEvent} />
        )}
        {kind && <KindGuide kind={kind} status={status} />}

        <div>
          <span className="field-label">상세 사유 (필수)</span>
          <input className="wide" value={memo} placeholder="예: 감기, 생리통, 병원 진료" onChange={(e) => setMemo(e.target.value)} />
        </div>

        {status && kind && !memo.trim() && <p className="hint">상세 사유를 입력하면 저장할 수 있어요.</p>}
        {((needsPeriod && period === undefined) || (status === '결과' && periods.length === 0)) && (
          <p className="hint">{status} 교시를 고르면 저장할 수 있어요.</p>
        )}
        {draft && !needsDetail && draft.docs.some((d) => d.required) && (
          <p className="info">받을 서류: {draft.docs.filter((d) => d.required).map((d) => d.label).join(', ')}</p>
        )}
        {needsDetail && (
          <p className="info">
            {reason === '체험학습'
              ? '체험학습은 신청서를 받은 날 첫 화면의 "+ 체험학습 신청 접수"로 입력해 주세요. 지금 입력하려면 "자세히 입력"을 누르세요.'
              : '법정감염병은 소견서 기간을 함께 입력해야 해요. "자세히 입력"을 눌러 주세요.'}
          </p>
        )}
        {!needsDetail && preview.length > 0 && (
          <ul className="warnings">
            {preview.map((w) => (
              <li key={w}>⚠ {w}</li>
            ))}
          </ul>
        )}

        <footer className="form-actions">
          <button className="ghost" onClick={() => setDetail(true)}>
            자세히 입력 (여러 날 등)
          </button>
          <span className="spacer" />
          <button className="primary big" disabled={!ready || !!needsDetail} onClick={save}>
            저장
          </button>
        </footer>
      </div>

      {editing && <RecordForm initial={editing} onClose={() => setEditing(null)} />}
    </Modal>
  );
}

function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
  tone,
}: {
  label: string;
  options: readonly T[];
  value: T | null;
  onChange: (v: T) => void;
  /** 고른 버튼에 줄 색 (예: 종류별 색) */
  tone?: (v: T) => string;
}) {
  return (
    <div>
      <span className="field-label">{label}</span>
      <div className="big-seg">
        {options.map((o) => (
          <button
            key={o}
            className={value === o ? `on${tone ? ` toned ${tone(o)}` : ''}` : ''}
            onClick={() => onChange(o)}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 아직 받지 않은 필수 서류. 기한 지난 것을 위로. */
