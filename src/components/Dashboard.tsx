import { useMemo, useState } from 'react';
import { addDays, schoolYearOf, schoolYearRange, today } from '../domain/calendar';
import { specialNotes, summarize, type StudentSummary } from '../domain/stats';
import { KINDS, STATUSES } from '../domain/types';
import { downloadBlob } from '../storage/db';
import { useStore } from '../store';
import { KIND_SHORT, Modal, sortStudents } from './common';
import { RecordForm } from './RecordForm';
import { RecordItem } from './RecordItem';
import { SheetButton } from './GoogleButtons';
import type { AttendanceRecord } from '../domain/types';

const MONTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2];

export function Dashboard() {
  const { state, holidays, warnings } = useStore();
  const [year, setYear] = useState(() => schoolYearOf(today()));
  const [month, setMonth] = useState<number | 'all'>('all');
  const [detail, setDetail] = useState<string | null>(null);
  const [breakdown, setBreakdown] = useState(false);

  const [from, to] = useMemo(() => {
    if (month === 'all') return schoolYearRange(year);
    const y = month >= 3 ? year : year + 1;
    const start = `${y}-${String(month).padStart(2, '0')}-01`;
    const nextMonth = month === 12 ? `${y + 1}-01-01` : `${y}-${String(month + 1).padStart(2, '0')}-01`;
    return [start, addDays(nextMonth, -1)];
  }, [year, month]);

  const rows = useMemo(
    () => summarize(sortStudents(state.students), state.records, holidays, warnings, from, to, today()),
    [state.students, state.records, holidays, warnings, from, to],
  );

  const years = useMemo(() => {
    const set = new Set([schoolYearOf(today()), ...state.records.map((r) => schoolYearOf(r.startDate))]);
    return [...set].sort((a, b) => b - a);
  }, [state.records]);

  if (state.students.length === 0) {
    return <p className="empty">설정 탭에서 학생 명단을 먼저 등록하세요.</p>;
  }

  const total = (r: StudentSummary, st: (typeof STATUSES)[number]) => KINDS.reduce((n, k) => n + r.counts[st][k], 0);
  const classTotals = STATUSES.map((st) => [st, rows.reduce((n, r) => n + total(r, st), 0)] as const);
  const missing = rows.reduce((n, r) => n + r.missingDocCount, 0);

  return (
    <div className="stats-page">
      <div className="page-head">
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}학년도
            </option>
          ))}
        </select>
        <select value={month} onChange={(e) => setMonth(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
          <option value="all">학년도 전체</option>
          {MONTHS.map((m) => (
            <option key={m} value={m}>
              {m}월
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={breakdown} onChange={(e) => setBreakdown(e.target.checked)} />
          종류별로 나눠 보기
        </label>
        <span className="spacer" />
        <button onClick={() => exportCsv(rows, `${year}${month === 'all' ? '' : `_${String(month).padStart(2, '0')}`}`)}>엑셀(CSV) 내보내기</button>
        <SheetButton title={`출결 통계 ${year}${month === 'all' ? '학년도' : ` ${month}월`}`} rows={() => summaryRows(rows)} />
      </div>

      <div className="kpis">
        {classTotals.map(([st, n]) => (
          <div key={st} className="kpi">
            <span className="kpi-label">
              {st}
              {st === '결석' ? '(일)' : '(회)'}
            </span>
            <b>{n}</b>
          </div>
        ))}
        <div className={`kpi${missing ? ' bad' : ''}`}>
          <span className="kpi-label">누락 서류</span>
          <b>{missing}</b>
        </div>
      </div>

      <div className="table-wrap">
        <table className="summary">
          <thead>
            <tr>
              <th rowSpan={2}>번호</th>
              <th rowSpan={2}>이름</th>
              {STATUSES.map((s) => (
                <th key={s} colSpan={breakdown ? 4 : 1} rowSpan={breakdown ? 1 : 2} className="group">
                  {s}
                  {s === '결석' ? '(일)' : '(회)'}
                </th>
              ))}
              <th rowSpan={2} title="질병+미인정+기타 결석일수">
                총결석
              </th>
              <th rowSpan={2}>출석인정</th>
              <th rowSpan={2} title="학년도 누적">
                체험학습
              </th>
              <th rowSpan={2}>누락서류</th>
              <th rowSpan={2}>경고</th>
            </tr>
            <tr>
              {breakdown && STATUSES.map((s) =>
                KINDS.map((k) => (
                  <th key={s + k} className={k === '기타' ? 'sub group-end' : 'sub'}>
                    {KIND_SHORT[k]}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.student.id} onClick={() => setDetail(r.student.id)} className="clickable">
                <td>{r.student.number}</td>
                <td className="name">{r.student.name}</td>
                {breakdown
                  ? STATUSES.map((s) =>
                      KINDS.map((k) => (
                        <td key={s + k} className={`num${k === '기타' ? ' group-end' : ''}`}>
                          {r.counts[s][k] || ''}
                        </td>
                      )),
                    )
                  : STATUSES.map((s) => (
                      <td key={s} className="num group-end">
                        {total(r, s) || ''}
                      </td>
                    ))}
                <td className="num strong">{r.absenceDays || ''}</td>
                <td className="num">{r.approvedAbsenceDays || ''}</td>
                <td
                  className={`num${r.fieldTripDays + r.fieldTripPlanned > state.settings.fieldTripYearlyMax ? ' bad' : ''}`}
                  title="사용(+예정)/연간 한도"
                >
                  {r.fieldTripDays || r.fieldTripPlanned
                    ? `${r.fieldTripDays}${r.fieldTripPlanned ? `+${r.fieldTripPlanned}` : ''}/${state.settings.fieldTripYearlyMax}`
                    : ''}
                </td>
                <td className={`num${r.missingDocCount ? ' bad' : ''}`}>{r.missingDocCount || ''}</td>
                <td className={`num${r.warningCount ? ' warn' : ''}`}>{r.warningCount || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        총결석 = 질병·미인정·기타 결석일수 (출석인정 제외). 결석일수는 주말·공휴일·재량휴업일을 뺀 수업일 기준입니다. 체험학습은 학년도
        누적이고, "5+3"은 사용 5일·예정 3일입니다. 출결 통계는 오늘까지만 셉니다.
      </p>

      <TripTotals studentId="" />
      <SpecialNotes year={year} />

      {detail && <StudentDetail studentId={detail} from={from} to={to} onClose={() => setDetail(null)} />}
    </div>
  );
}

/** 나이스 출결 특기사항 입력 대상 (학년도 기준) */
function SpecialNotes({ year }: { year: number }) {
  const { state, holidays } = useStore();
  const [from, to] = schoolYearRange(year);
  const notes = useMemo(
    () => specialNotes(sortStudents(state.students), state.records, holidays, from, to),
    [state.students, state.records, holidays, from, to],
  );
  const groups = (['장기결석', '기타결석', '개근'] as const).map((k) => ({ k, items: notes.filter((n) => n.kind === k) }));
  return (
    <section className="card overview special-notes">
      <h3>
        나이스 출결 특기사항 <span className="muted">{year}학년도</span>
      </h3>
      {groups.map(({ k, items }) => (
        <div key={k}>
          <b className="field-label">
            {k === '장기결석' ? '질병·미인정 연속 10일 이상' : k === '기타결석' ? '기타결석' : '개근 (현재까지)'} {items.length}명
          </b>
          {items.length > 0 && (
            <ul className="overview-list">
              {items.map((n) => (
                <li key={n.student.id + n.text}>
                  <span className="who">
                    {n.student.number}. {n.student.name}
                  </span>
                  <span>{n.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <p className="hint">
        개근은 질병·미인정·기타 결석·지각·조퇴·결과가 하나도 없는 학생이에요 (출석인정은 출석으로 봄). 학년말에 확정되니 그때 다시
        확인하세요. 개인정보 보호가 필요한 질병은 학업성적관리위원회 심의를 거쳐 사유를 입력하지 않아요.
      </p>
    </section>
  );
}

function StudentDetail({ studentId, from, to, onClose }: { studentId: string; from: string; to: string; onClose: () => void }) {
  const { state } = useStore();
  const [editing, setEditing] = useState<AttendanceRecord | 'new' | null>(null);
  const student = state.students.find((s) => s.id === studentId);
  const records = state.records
    .filter((r) => r.studentId === studentId && r.endDate >= from && r.startDate <= to)
    .sort((a, b) => b.startDate.localeCompare(a.startDate));

  return (
    <Modal title={student ? `${student.number}. ${student.name}` : '학생'} onClose={onClose} wide>
      <div className="toolbar">
        <span className="muted">
          {from} ~ {to} · {records.length}건
        </span>
        <span className="spacer" />
        <button className="primary" onClick={() => setEditing('new')}>
          + 기록 추가
        </button>
      </div>
      {records.length === 0 ? (
        <p className="empty">기록이 없습니다.</p>
      ) : (
        <ul className="records">
          {records.map((r) => (
            <RecordItem key={r.id} record={r} onEdit={() => setEditing(r)} />
          ))}
        </ul>
      )}
      {editing && (
        <RecordForm
          initial={editing === 'new' ? undefined : editing}
          defaultStudentId={studentId}
          onClose={() => setEditing(null)}
        />
      )}
    </Modal>
  );
}

function summaryRows(rows: StudentSummary[]): string[][] {
  const header = [
    '번호',
    '이름',
    ...STATUSES.flatMap((s) => KINDS.map((k) => `${s}_${k}`)),
    '총결석일수',
    '출석인정결석일수',
    '체험학습사용일수',
    '체험학습예정일수',
    '체험학습국내(사용)',
    '체험학습국외(사용)',
    '누락서류',
    '경고',
  ];
  const lines = rows.map((r) => [
    r.student.number,
    r.student.name,
    ...STATUSES.flatMap((s) => KINDS.map((k) => r.counts[s][k])),
    r.absenceDays,
    r.approvedAbsenceDays,
    r.fieldTripDays,
    r.fieldTripPlanned,
    r.fieldTripByPlace.국내.used,
    r.fieldTripByPlace.국외.used,
    r.missingDocCount,
    r.warningCount,
  ]);
  return [header, ...lines].map((l) => l.map(String));
}

function exportCsv(rows: StudentSummary[], label: string) {
  const csv = summaryRows(rows).map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  // BOM 을 붙여야 엑셀에서 한글이 깨지지 않는다.
  downloadBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `attendance_summary_${label}.csv`);
}

/** 체험학습 누계 (학년도): 국내·국외별 사용 일수와 예정 일수 */
function TripTotals({ studentId }: { studentId: string }) {
  const { state, holidays, warnings } = useStore();
  const year = schoolYearOf(today());
  const [from, to] = schoolYearRange(year);
  const max = state.settings.fieldTripYearlyMax;
  const rows = useMemo(() => {
    const students = sortStudents(state.students).filter((s) => !studentId || s.id === studentId);
    return summarize(students, state.records, holidays, warnings, from, to, today()).filter(
      (r) => r.fieldTripDays + r.fieldTripPlanned > 0,
    );
  }, [state.students, state.records, holidays, warnings, from, to, studentId]);

  const place = (label: '국내' | '국외', r: StudentSummary) => {
    const p = r.fieldTripByPlace[label];
    if (!p.used && !p.planned) return null;
    return `${label} ${p.used}일${p.planned ? `(+예정 ${p.planned})` : ''}`;
  };

  return (
    <section className="card overview">
      <h3>
        체험학습 누계 <span className="muted">{year}학년도 · 연간 {max}일</span>
      </h3>
      {rows.length === 0 ? (
        <p className="muted">체험학습 기록이 없어요.</p>
      ) : (
        <ul className="overview-list">
          {rows.map((r) => {
            const total = r.fieldTripDays + r.fieldTripPlanned;
            return (
              <li key={r.student.id} className={total > max ? 'over' : ''}>
                <span className="who">
                  {r.student.number}. {r.student.name}
                </span>
                <span>{[place('국내', r), place('국외', r)].filter(Boolean).join(' · ')}</span>
                <b className="total">
                  {total}/{max}일 · 남은 {max - total}일
                </b>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
