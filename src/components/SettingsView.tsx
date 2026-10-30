import { useRef, useState } from 'react';
import { SyncSettings } from './SyncSettings';
import { formatKo, indexHolidays } from '../domain/calendar';
import { rebuildDocs } from '../domain/rules';
import { mergePublicHolidays } from '../domain/publicHolidays';
import type { DeadlineBasis, HolidayType, Settings, Student } from '../domain/types';
import { emptyState } from '../domain/types';
import { exportBackup, normalize } from '../storage/db';
import { BACKUP_REMIND_DAYS, newId, useNeedBackup, useStore } from '../store';
import { sortStudents } from './common';

/** "1 홍길동", "1<TAB>홍길동", "홍길동" 형식의 줄을 읽는다. 번호가 없으면 순서대로 붙인다. */
export function parseRoster(text: string, startNumber: number): { number: number; name: string }[] {
  let next = startNumber;
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(\d+)[\s.,\t]+(.+)$/);
      if (m) {
        next = Number(m[1]) + 1;
        return { number: Number(m[1]), name: m[2].trim() };
      }
      return { number: next++, name: line };
    });
}

export function SettingsView() {
  // 백업할 때가 됐으면 백업 칸을 맨 위로 올린다.
  const needBackup = useNeedBackup();
  return (
    <div className="settings">
      {needBackup && <BackupSettings />}
      <ClassSettings />
      <RosterSettings />
      <HolidaySettings />
      <ExamSettings />
      <RuleSettings />
      <SyncSettings />
      {!needBackup && <BackupSettings />}
    </div>
  );
}

function ClassSettings() {
  const { state, update } = useStore();
  return (
    <section className="card">
      <h3>학급</h3>
      <input
        value={state.settings.className}
        placeholder="예: 2학년 3반"
        onChange={(e) => update((s) => ({ ...s, settings: { ...s.settings, className: e.target.value } }))}
      />
    </section>
  );
}

function RosterSettings() {
  const { state, update } = useStore();
  const [text, setText] = useState('');
  const students = sortStudents(state.students);

  const apply = () => {
    const parsed = parseRoster(text, (students.at(-1)?.number ?? 0) + 1);
    update((s) => {
      const list: Student[] = s.students.map((st) => ({ ...st }));
      for (const p of parsed) {
        const existing = list.find((st) => st.number === p.number);
        if (existing) existing.name = p.name;
        else list.push({ id: newId(), ...p });
      }
      return { ...s, students: list };
    });
    setText('');
  };

  const rename = (id: string, patch: Partial<Student>) =>
    update((s) => ({ ...s, students: s.students.map((st) => (st.id === id ? { ...st, ...patch } : st)) }));

  const remove = (st: Student) => {
    const count = state.records.filter((r) => r.studentId === st.id).length;
    const noteCount = state.notes.filter((n) => n.studentIds.includes(st.id)).length;
    const parts = [count && `출결 기록 ${count}건`, noteCount && `관찰·상담 기록 ${noteCount}건`].filter(Boolean);
    const msg = parts.length ? `${st.name} 학생과 ${parts.join(', ')}을 모두 삭제할까요?` : `${st.name} 학생을 삭제할까요?`;
    if (!confirm(msg)) return;
    update((s) => ({
      ...s,
      students: s.students.filter((x) => x.id !== st.id),
      records: s.records.filter((r) => r.studentId !== st.id),
      // 여러 학생이 같이 있는 기록은 그 학생만 빼고 남긴다
      notes: s.notes
        .map((n) => (n.studentIds.includes(st.id) ? { ...n, studentIds: n.studentIds.filter((id) => id !== st.id) } : n))
        .filter((n) => n.studentIds.length > 0),
    }));
  };

  return (
    <section className="card">
      <h3>학생 명단 ({students.length}명)</h3>
      <p className="hint">
        엑셀에서 번호·이름 두 열을 복사해 붙여넣거나, 한 줄에 한 명씩 "번호 이름"으로 입력하세요. 같은 번호가 있으면 이름을 고칩니다.
      </p>
      <textarea rows={5} value={text} placeholder={'1 김민준\n2 이서연\n3 박지호'} onChange={(e) => setText(e.target.value)} />
      <button className="primary" disabled={!text.trim()} onClick={apply}>
        명단에 반영
      </button>
      {students.length > 0 && (
        <table className="plain">
          <thead>
            <tr>
              <th>번호</th>
              <th>이름</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {students.map((st) => (
              <tr key={st.id}>
                <td>
                  <input
                    type="number"
                    className="narrow"
                    value={st.number}
                    onChange={(e) => rename(st.id, { number: Number(e.target.value) })}
                  />
                </td>
                <td>
                  <input value={st.name} onChange={(e) => rename(st.id, { name: e.target.value })} />
                </td>
                <td>
                  <button className="ghost small" onClick={() => remove(st)}>
                    삭제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function HolidaySettings() {
  const { state, update } = useStore();
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<HolidayType>('재량휴업일');
  const [bulk, setBulk] = useState('');

  const add = (items: { date: string; name: string; type: HolidayType }[]) =>
    update((s) => {
      const dates = new Set(items.map((i) => i.date));
      return {
        ...s,
        holidays: [...s.holidays.filter((h) => !dates.has(h.date)), ...items].sort((a, b) => a.date.localeCompare(b.date)),
      };
    });

  const applyBulk = () => {
    const items = bulk
      .split(/\r?\n/)
      .map((l) => l.trim().match(/^(\d{4}-\d{2}-\d{2})\s*(.*)$/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => ({ date: m[1], name: m[2].trim() || '공휴일', type: '공휴일' as const }));
    add(items);
    setBulk('');
  };

  return (
    <section className="card">
      <h3>휴일 (공휴일·재량휴업일)</h3>
      <p className="hint">
        토·일요일은 자동으로 제외됩니다. 2026·2027년 공휴일(대체공휴일 포함)은 기본으로 들어 있고, 재량휴업일과 임시공휴일은 직접
        등록하세요. 달력 탭에서 날짜를 눌러 바로 지정·해제할 수도 있습니다. 휴일은 결석일수와 체험학습 일수 계산에서 빠집니다.
      </p>
      <button className="small" onClick={() => update((s) => ({ ...s, holidays: mergePublicHolidays(s.holidays) }))}>
        2026·2027년 기본 공휴일 다시 넣기
      </button>
      <div className="inline">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <input value={name} placeholder="이름" onChange={(e) => setName(e.target.value)} />
        <select value={type} onChange={(e) => setType(e.target.value as HolidayType)}>
          <option>재량휴업일</option>
          <option>공휴일</option>
        </select>
        <button
          disabled={!date}
          onClick={() => {
            add([{ date, name: name.trim() || type, type }]);
            setDate('');
            setName('');
          }}
        >
          추가
        </button>
      </div>
      <details>
        <summary>공휴일 여러 개 한 번에 붙여넣기</summary>
        <textarea rows={5} value={bulk} placeholder={'2026-10-03 개천절\n2026-10-05 대체공휴일\n2026-10-09 한글날'} onChange={(e) => setBulk(e.target.value)} />
        <button disabled={!bulk.trim()} onClick={applyBulk}>
          공휴일로 추가
        </button>
      </details>
      {state.holidays.length > 0 && (
        <ul className="holiday-list">
          {state.holidays.map((h) => (
            <li key={h.date}>
              <span>{h.date.slice(0, 4)} {formatKo(h.date)}</span>
              <span className={`holiday ${h.type === '재량휴업일' ? 'disc' : ''}`}>{h.type}</span>
              <span>{h.name}</span>
              <button
                className="ghost small"
                onClick={() => update((s) => ({ ...s, holidays: s.holidays.filter((x) => x.date !== h.date) }))}
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

/** 시험 기간: 이 기간의 질병결석은 하루여도 진료확인서·처방전 등이 필요하다. */
function ExamSettings() {
  const { state, update } = useStore();
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [name, setName] = useState('');
  const exams = state.settings.examPeriods;

  // 시험 기간이 바뀌면 이미 입력한 질병결석의 필요서류도 다시 계산한다.
  const setExams = (list: typeof exams) =>
    update((s) => {
      const examPeriods = [...list].sort((a, b) => a.start.localeCompare(b.start));
      const ctx = { holidays: indexHolidays(s.holidays), exams: examPeriods };
      return {
        ...s,
        settings: { ...s.settings, examPeriods },
        records: s.records.map((r) =>
          r.kind === '질병' && r.status === '결석' ? { ...r, docs: rebuildDocs(r.docs, r, ctx, { resetRequired: true }) } : r,
        ),
      };
    });

  return (
    <section className="card">
      <h3>시험 기간</h3>
      <p className="hint">시험 기간에 걸친 질병결석은 2일 이하여도 진료확인서·처방전 등 근거 서류가 필요해요.</p>
      <div className="inline">
        <input value={name} placeholder="이름 (예: 2학기 기말고사)" onChange={(e) => setName(e.target.value)} />
        <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />~
        <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
        <button
          disabled={!start}
          onClick={() => {
            setExams([...exams, { start, end: end && end >= start ? end : start, name: name.trim() || '시험' }]);
            setStart('');
            setEnd('');
            setName('');
          }}
        >
          추가
        </button>
      </div>
      {exams.length > 0 && (
        <ul className="holiday-list">
          {exams.map((e, i) => (
            <li key={`${e.start}-${i}`}>
              <span>
                {formatKo(e.start)}~{formatKo(e.end)}
              </span>
              <span>{e.name}</span>
              <button className="ghost small" onClick={() => setExams(exams.filter((_, j) => j !== i))}>
                삭제
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RuleSettings() {
  const { state, update } = useStore();
  const s = state.settings;
  const set = (patch: Partial<Settings>) => update((st) => ({ ...st, settings: { ...st.settings, ...patch } }));
  const basis = (value: DeadlineBasis, onChange: (b: DeadlineBasis) => void) => (
    <select value={value} onChange={(e) => onChange(e.target.value as DeadlineBasis)}>
      <option value="school">수업일 기준</option>
      <option value="calendar">달력 날짜 기준</option>
    </select>
  );
  const num = (value: number, onChange: (n: number) => void) => (
    <input type="number" className="narrow" min={0} value={value} onChange={(e) => onChange(Number(e.target.value))} />
  );

  return (
    <section className="card">
      <h3>체험학습 규정</h3>
      <div className="rule-grid">
        <span>신청서 제출</span>
        <span className="inline">
          실시 {num(s.applicationDaysBefore, (n) => set({ applicationDaysBefore: n }))}일 전까지{' '}
          {basis(s.applicationBasis, (b) => set({ applicationBasis: b }))}
        </span>
        <span>보고서 제출</span>
        <span className="inline">
          종료 후 {num(s.reportDaysAfter, (n) => set({ reportDaysAfter: n }))}일 이내{' '}
          {basis(s.reportBasis, (b) => set({ reportBasis: b }))}
        </span>
        <span>1회 신청</span>
        <span className="inline">
          국내·국외 연속 {num(s.tripMaxConsecutiveDays, (n) => set({ tripMaxConsecutiveDays: n }))}일 이내 (수업일 기준)
        </span>
        <span>연간 합계</span>
        <span className="inline">{num(s.fieldTripYearlyMax, (n) => set({ fieldTripYearlyMax: n }))}일 (국내+국외)</span>
      </div>
      <p className="hint">수업일 기준: 토·일요일, 공휴일, 재량휴업일을 빼고 셉니다. 예) 월요일 체험학습, 2일 전까지 → 수업일 기준 목요일, 달력 기준 토요일.</p>
    </section>
  );
}

function BackupSettings() {
  const { state, replace, update } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');
  const needBackup = useNeedBackup();

  const doExport = () => {
    const at = new Date().toISOString();
    exportBackup({ ...state, settings: { ...state.settings, lastBackupAt: at } });
    update((s) => ({ ...s, settings: { ...s.settings, lastBackupAt: at } }));
  };

  const doImport = async (file: File) => {
    try {
      const data = normalize(JSON.parse(await file.text()));
      if (!confirm(`백업 파일로 현재 데이터를 모두 바꿉니다. (학생 ${data.students.length}명, 기록 ${data.records.length}건) 계속할까요?`)) return;
      replace(data);
      setMsg('백업을 불러왔습니다.');
    } catch (e) {
      setMsg(`불러오기 실패: ${e instanceof Error ? e.message : e}`);
    }
  };

  return (
    <section className={`card${needBackup ? ' attention' : ''}`}>
      <h3>백업</h3>
      {needBackup && (
        <p className="attention-note">
          {state.settings.lastBackupAt
            ? `마지막 백업 후 ${BACKUP_REMIND_DAYS}일이 지났어요. 지금 백업 파일을 저장해 두세요.`
            : '아직 백업한 적이 없어요. 백업 파일을 저장해 두세요.'}
        </p>
      )}
      <p className="hint">
        데이터는 이 컴퓨터의 이 브라우저 안에만 저장되고 외부로 전송되지 않습니다. 브라우저 데이터를 지우거나 다른 컴퓨터에서 쓰려면 백업
        파일이 필요합니다. 정기적으로 백업하세요.
        {state.settings.lastBackupAt && ` 마지막 백업: ${new Date(state.settings.lastBackupAt).toLocaleString('ko-KR')}`}
      </p>
      <div className="inline">
        <button className="primary" onClick={doExport}>
          백업 파일 저장
        </button>
        <button onClick={() => fileRef.current?.click()}>백업 파일 불러오기</button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void doImport(f);
            e.target.value = '';
          }}
        />
        <span className="spacer" />
        <button
          className="danger"
          onClick={() => confirm('모든 학생·출결·관찰·상담·휴일 데이터를 삭제할까요? 되돌릴 수 없습니다.') && replace(emptyState())}
        >
          전체 삭제
        </button>
      </div>
      {msg && <p className="info">{msg}</p>}
    </section>
  );
}
