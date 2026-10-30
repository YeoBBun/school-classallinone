import { describe, expect, it } from 'vitest';
import { addSchoolDays, countSchoolDays, dayOfWeek, indexHolidays, schoolYearRange } from './calendar';
import {
  computeWarnings,
  DOC_FT_APPLICATION,
  DOC_FT_REPORT,
  fieldTripCumulative,
  fieldTripDays,
  missingDocs,
  rebuildDocs,
  statusOn,
} from './rules';
import { PUBLIC_HOLIDAYS } from './publicHolidays';
import { specialNotes, summarize } from './stats';
import { DEFAULT_SETTINGS, type AttendanceRecord, type Holiday } from './types';

const HOLIDAYS: Holiday[] = [{ date: '2026-10-09', name: '한글날', type: '공휴일' }];
const hol = indexHolidays(HOLIDAYS);
const ctx = { holidays: hol, exams: [] };

let seq = 0;
function rec(p: Partial<AttendanceRecord>): AttendanceRecord {
  const status = p.status ?? '결석';
  const kind = p.kind ?? '질병';
  const startDate = p.startDate ?? '2026-10-13';
  return {
    id: p.id ?? `r${++seq}`,
    studentId: 's1',
    status,
    kind,
    startDate,
    endDate: p.endDate ?? startDate,
    memo: '',
    ...p,
    docs: p.docs ?? rebuildDocs([], { status, kind, reason: p.reason, startDate, endDate: p.endDate ?? startDate }),
  };
}


/** 하루짜리 기록의 기본 서류 */
function docsFor(status: AttendanceRecord['status'], kind: AttendanceRecord['kind'], reason?: AttendanceRecord['reason']) {
  return rebuildDocs([], { status, kind, reason, startDate: '2026-10-13', endDate: '2026-10-13' });
}

function warningsFor(records: AttendanceRecord[], today = '2026-10-14') {
  return computeWarnings({ records, holidays: hol, settings: DEFAULT_SETTINGS, today });
}

describe('calendar', () => {
  it('2026-10-19 는 월요일', () => {
    expect(dayOfWeek('2026-10-19')).toBe(1);
  });

  it('수업일 기준으로 이전 날짜를 센다 (주말 건너뜀)', () => {
    expect(addSchoolDays('2026-10-19', -2, hol)).toBe('2026-10-15');
  });

  it('공휴일도 건너뛴다', () => {
    expect(addSchoolDays('2026-10-12', -2, hol)).toBe('2026-10-07');
  });

  it('수업일 수 계산에서 주말·공휴일 제외', () => {
    // 10/5(월) ~ 10/16(금): 10일 중 한글날 1일 제외
    expect(countSchoolDays('2026-10-05', '2026-10-16', hol)).toBe(9);
  });

  it('학년도는 3월 1일 ~ 다음 해 2월 말', () => {
    expect(schoolYearRange(2027)).toEqual(['2027-03-01', '2028-02-29']);
  });
});

describe('필요서류', () => {
  it('출석인정 체험학습: 결석계 없이 신청서 + 보고서(근거자료 첨부)', () => {
    const docs = docsFor('결석', '출석인정', '체험학습');
    expect(docs.map((d) => d.key)).toEqual([DOC_FT_APPLICATION, DOC_FT_REPORT]);
    expect(docs.every((d) => d.required)).toBe(true);
  });

  it('질병결석 2일 이하: 결석계만 필수, 진료확인서는 선택', () => {
    const docs = rebuildDocs([], { status: '결석', kind: '질병', startDate: '2026-10-12', endDate: '2026-10-13' }, ctx);
    expect(docs.map((d) => [d.label, d.required])).toEqual([
      ['결석계', true],
      ['진료확인서·처방전 등', false],
    ]);
  });

  it('질병결석 3일 이상: 결석계 + 진료확인서 필수 (주말·공휴일 빼고 셈)', () => {
    // 10/8(목)~10/12(월): 10/9 한글날·주말 빼면 2일 → 진료확인서 선택
    expect(
      rebuildDocs([], { status: '결석', kind: '질병', startDate: '2026-10-08', endDate: '2026-10-12' }, ctx).find((d) => d.key === 'evidence:medical')
        ?.required,
    ).toBe(false);
    const docs = rebuildDocs([], { status: '결석', kind: '질병', startDate: '2026-10-12', endDate: '2026-10-14' }, ctx);
    expect(docs.map((d) => [d.label, d.required])).toEqual([
      ['결석계', true],
      ['진료확인서·처방전 등', true],
    ]);
  });

  it('시험 기간 질병결석은 하루여도 진료확인서 필수', () => {
    const exam = { ...ctx, exams: [{ start: '2026-10-13', end: '2026-10-15', name: '2학기 중간고사' }] };
    const docs = rebuildDocs([], { status: '결석', kind: '질병', startDate: '2026-10-14', endDate: '2026-10-14' }, exam);
    expect(docs.find((d) => d.key === 'evidence:medical')?.required).toBe(true);
  });

  it('질병 지각은 결석계 없이 선택 증빙만', () => {
    expect(docsFor('지각', '질병').map((d) => d.required)).toEqual([false]);
  });

  it('기타는 근거 서류, 미인정은 출력물 학생 서명', () => {
    expect(docsFor('결석', '기타').map((d) => d.label)).toEqual(['근거 서류']);
    expect(docsFor('결석', '미인정').map((d) => d.label)).toEqual(['출력물 학생 서명']);
  });

  it('종류를 바꿔도 받은 서류 상태와 직접 추가한 서류는 유지', () => {
    const before = docsFor('결석', '질병').map((d) => ({ ...d, received: true, receivedDate: '2026-10-14' }));
    const custom = { key: 'custom:x', label: '기타', required: true, received: false };
    const after = rebuildDocs([...before, custom], { status: '결석', kind: '출석인정', reason: '공문', startDate: '2026-10-13', endDate: '2026-10-13' });
    expect(after.find((d) => d.key === 'absence-note')?.received).toBe(true);
    expect(after.find((d) => d.key === 'evidence:official')?.received).toBe(false);
    expect(after.find((d) => d.key === 'custom:x')).toBeTruthy();
    expect(after.find((d) => d.key === 'evidence:medical')).toBeUndefined();
  });
});

describe('경고', () => {
  it('생리는 상황과 관계없이 같은 달 두 번째부터 경고', () => {
    const a = rec({ id: 'a', status: '조퇴', kind: '출석인정', reason: '생리', startDate: '2026-10-02' });
    const b = rec({ id: 'b', status: '결석', kind: '출석인정', reason: '생리', startDate: '2026-10-20' });
    const c = rec({ id: 'c', status: '결석', kind: '출석인정', reason: '생리', startDate: '2026-11-02' });
    const w = warningsFor([a, b, c]);
    expect(w.get('a')).toBeUndefined();
    expect(w.get('b')?.[0]).toContain('이미 사용');
    expect(w.get('c')).toBeUndefined();
  });

  it('법정감염병은 소견서 기간 밖이면 경고', () => {
    const r = rec({
      id: 'x',
      kind: '출석인정',
      reason: '법정감염병',
      startDate: '2026-10-12',
      endDate: '2026-10-16',
      illness: { disease: '독감', certStart: '2026-10-12', certEnd: '2026-10-15' },
    });
    expect(warningsFor([r]).get('x')?.[0]).toContain('소견서 기간');
  });

  it('체험학습: 보호자 미동반은 경고, 국외 10 수업일은 허용', () => {
    const r = rec({
      id: 'x',
      kind: '출석인정',
      reason: '체험학습',
      startDate: '2026-11-02',
      endDate: '2026-11-13',
      fieldTrip: { abroad: true, guardianAccompanied: false },
    });
    expect(warningsFor([r], '2026-10-01').get('x')).toEqual(['보호자를 동반하지 않는 교외체험학습은 불가합니다.']);
  });

  it('체험학습: 국외 11 수업일이면 경고', () => {
    const r = rec({
      id: 'x',
      kind: '출석인정',
      reason: '체험학습',
      startDate: '2026-11-02',
      endDate: '2026-11-16',
      fieldTrip: { abroad: true, guardianAccompanied: true },
    });
    expect(warningsFor([r], '2026-10-01').get('x')?.[0]).toContain('국내·국외 모두 1회 연속 10일 이내입니다 (현재 11일)');
  });

  it('체험학습 신청서 기한(수업일 2일 전)이 지나면 경고', () => {
    const r = rec({
      id: 'x',
      kind: '출석인정',
      reason: '체험학습',
      startDate: '2026-10-19',
      fieldTrip: { abroad: false, guardianAccompanied: true },
    });
    expect(warningsFor([r], '2026-10-15').get('x')).toBeUndefined();
    expect(warningsFor([r], '2026-10-16').get('x')?.[0]).toContain('신청서 기한');
  });

  it('체험학습 연간 20일 초과 시 경고 (반일 0.5일 포함)', () => {
    const trips = [
      rec({ startDate: '2026-04-06', endDate: '2026-04-17' }), // 10일
      rec({ startDate: '2026-05-11', endDate: '2026-05-22' }), // 10일
      rec({ id: 'half', status: '조퇴', startDate: '2026-06-01' }), // 0.5일
    ].map((r) => ({ ...r, kind: '출석인정' as const, reason: '체험학습' as const, fieldTrip: { abroad: false, guardianAccompanied: true } }));
    const trips2 = trips.map((r) => ({ ...r, docs: rebuildDocs([], r).map((d) => ({ ...d, received: true })) }));
    expect(fieldTripCumulative(trips2, hol).get('half')).toBe(20.5);
    expect(warningsFor(trips2).get('half')?.[0]).toContain('연간 체험학습 20일을 초과합니다 (누적 20.5일)');
  });

  it('결석이 다른 기록과 겹치면 경고, 지각·조퇴끼리는 괜찮음', () => {
    const a = rec({ id: 'a', status: '지각', startDate: '2026-10-13' });
    const b = rec({ id: 'b', status: '조퇴', startDate: '2026-10-13' });
    expect(warningsFor([a, b]).size).toBe(0);
    const c = rec({ id: 'c', status: '결석', startDate: '2026-10-12', endDate: '2026-10-14' });
    expect(warningsFor([a, c]).get('c')?.[0]).toContain('겹칩니다');
  });
});

describe('요약', () => {
  it('출석인정 결석일수는 총결석일수와 따로 센다', () => {
    const records = [
      rec({ kind: '질병', startDate: '2026-10-05', endDate: '2026-10-06' }),
      rec({ kind: '미인정', startDate: '2026-10-07' }),
      rec({ kind: '출석인정', reason: '공문', startDate: '2026-10-08', endDate: '2026-10-12' }), // 10/9 공휴일, 주말 제외 → 2일
      rec({ kind: '질병', status: '지각', startDate: '2026-10-13' }),
    ];
    const [s] = summarize([{ id: 's1', number: 1, name: '가' }], records, hol, new Map(), '2026-03-01', '2027-02-28', '2027-02-28');
    expect(s.absenceDays).toBe(3);
    expect(s.approvedAbsenceDays).toBe(2);
    expect(s.counts['지각']['질병']).toBe(1);
    expect(s.missingDocCount).toBe(4); // 질병결석 결석계 + 미인정 학생서명 + 출석인정 결석계·공문 (질병지각 증빙은 선택)
  });
});

describe('기본 공휴일', () => {
  it('2027년 목록이 월력요항 총계와 맞는다 (공휴일 24일, 일요일 겹침 4일, 토요일 겹침 5일)', () => {
    const y2027 = PUBLIC_HOLIDAYS.filter((h) => h.date.startsWith('2027'));
    expect(y2027).toHaveLength(76 - 52);
    expect(y2027.filter((h) => dayOfWeek(h.date) === 0)).toHaveLength(76 - 72);
    expect(y2027.filter((h) => dayOfWeek(h.date) === 6)).toHaveLength(124 - 119);
  });

  it('대체공휴일은 모두 평일', () => {
    for (const h of PUBLIC_HOLIDAYS.filter((h) => h.name.startsWith('대체'))) {
      expect([0, 6]).not.toContain(dayOfWeek(h.date));
    }
  });
});

describe('저장 데이터 변환', () => {
  it('이전 버전 데이터의 서류 필수 여부를 기준표에 맞추고 설정을 옮긴다', async () => {
    const { normalize } = await import('../storage/db');
    const medical = { key: 'evidence:medical', label: '증빙', required: true, received: false };
    const v2 = {
      version: 2,
      students: [],
      holidays: HOLIDAYS,
      settings: { abroadMaxDays: 7 },
      records: [
        rec({ id: 'a', kind: '질병', status: '결석', startDate: '2026-10-13', docs: [medical] }),
        rec({ id: 'b', kind: '질병', status: '결석', startDate: '2026-10-12', endDate: '2026-10-14', docs: [{ ...medical, received: true }] }),
      ],
    };
    const s = normalize(v2);
    expect(s.version).toBe(6);
    expect(s.settings.tripMaxConsecutiveDays).toBe(7);
    expect(s.records[0].docs.find((d) => d.key === 'evidence:medical')?.required).toBe(false);
    expect(s.records[1].docs.find((d) => d.key === 'evidence:medical')).toMatchObject({ required: true, received: true });
  });
});

describe('체험학습 사전 입력', () => {
  const trip = (p: Partial<AttendanceRecord>) =>
    rec({ kind: '출석인정', reason: '체험학습', fieldTrip: { abroad: false, guardianAccompanied: true }, ...p });

  it('미래 날짜는 통계에 넣지 않고 체험학습 예정 일수로 따로 센다', () => {
    // 10/13(화)~10/16(금) 중 오늘이 10/14 → 사용 2일, 예정 2일
    const r = trip({ startDate: '2026-10-13', endDate: '2026-10-16' });
    const [s] = summarize([{ id: 's1', number: 1, name: '가' }], [r], hol, new Map(), '2026-03-01', '2027-02-28', '2026-10-14');
    expect(s.fieldTripDays).toBe(2);
    expect(s.fieldTripPlanned).toBe(2);
    expect(s.fieldTripByPlace).toEqual({ 국내: { used: 2, planned: 2 }, 국외: { used: 0, planned: 0 } });
    expect(s.approvedAbsenceDays).toBe(2);
  });

  it('보고서는 접수 때부터 받을 서류로 잡힌다', () => {
    const r = trip({ startDate: '2026-10-19', endDate: '2026-10-20' });
    expect(missingDocs(r).map((d) => d.key)).toEqual([DOC_FT_APPLICATION, DOC_FT_REPORT]);
  });

  it('신청서 없이 실시되었거나 기한 후 접수면 미인정 대상 경고', () => {
    const none = trip({ id: 'n', startDate: '2026-10-13' });
    expect(warningsFor([none], '2026-10-13').get('n')?.[0]).toContain('신청서 없이 실시');
    const late = trip({ id: 'l', startDate: '2026-10-19' });
    late.docs = late.docs.map((d) => (d.key === DOC_FT_APPLICATION ? { ...d, received: true, receivedDate: '2026-10-16' } : d));
    expect(warningsFor([late], '2026-10-16').get('l')?.[0]).toContain('미인정 처리 대상');
  });
});

describe('체험학습 1.5일·2.5일', () => {
  const trip = (p: Partial<AttendanceRecord>) =>
    rec({ kind: '출석인정', reason: '체험학습', status: '결석', ...p });

  it('첫날 오후부터 + 다음 날 종일 = 1.5일, 첫날은 인정조퇴', () => {
    const r = trip({ startDate: '2026-10-15', endDate: '2026-10-16', fieldTrip: { abroad: false, guardianAccompanied: true, startPM: true } });
    expect(fieldTripDays(r, hol)).toBe(1.5);
    expect(statusOn(r, '2026-10-15')).toBe('조퇴');
    expect(statusOn(r, '2026-10-16')).toBe('결석');
    const [s] = summarize([{ id: 's1', number: 1, name: '가' }], [r], hol, new Map(), '2026-03-01', '2027-02-28', '2026-12-31');
    expect(s.counts['결석']['출석인정']).toBe(1);
    expect(s.counts['조퇴']['출석인정']).toBe(1);
    expect(s.approvedAbsenceDays).toBe(1);
  });

  it('첫날 오후부터 ~ 마지막 날 오전까지, 사이 이틀 종일 = 3일', () => {
    // 10/13(화) 오후 ~ 10/16(금) 오전
    const r = trip({ startDate: '2026-10-13', endDate: '2026-10-16', fieldTrip: { abroad: false, guardianAccompanied: true, startPM: true, endAM: true } });
    expect(fieldTripDays(r, hol)).toBe(3);
    expect(statusOn(r, '2026-10-16')).toBe('지각');
  });

  it('하루짜리 기록에서는 반일 표시를 무시한다', () => {
    const r = trip({ startDate: '2026-10-15', fieldTrip: { abroad: false, guardianAccompanied: true, startPM: true } });
    expect(fieldTripDays(r, hol)).toBe(1);
  });
});

describe('경조사 인정 일수', () => {
  it('종류가 없으면 고르라고, 인정 일수를 넘으면 미인정 대상이라고 경고', () => {
    const none = rec({ id: 'n', kind: '출석인정', reason: '경조사' });
    expect(warningsFor([none]).get('n')?.[0]).toContain('경조사 종류');
    const ok = rec({ id: 'o', kind: '출석인정', reason: '경조사', familyEvent: '(외)증조부모 사망', startDate: '2026-10-12', endDate: '2026-10-14' });
    expect(warningsFor([ok]).get('o')).toBeUndefined();
    const over = rec({ id: 'v', kind: '출석인정', reason: '경조사', familyEvent: '형제자매·부모 결혼', startDate: '2026-10-12', endDate: '2026-10-13' });
    expect(warningsFor([over]).get('v')?.[0]).toContain('1일까지 인정');
  });
});

describe('나이스 특기사항 대상', () => {
  const students = [
    { id: 's1', number: 1, name: '가' },
    { id: 's2', number: 2, name: '나' },
  ];
  it('여러 기록으로 나뉜 질병결석도 이어서 10일 이상이면 장기결석', () => {
    // 9/28(월)~10/8(목): 10/3·10/5 공휴일 없이 hol 에는 10/9 만 → 9/28~10/2 5일 + 10/5~10/8 4일 = 9일, 10/12 까지 10일
    const records = [
      rec({ kind: '질병', startDate: '2026-09-28', endDate: '2026-10-02' }),
      rec({ kind: '질병', startDate: '2026-10-05', endDate: '2026-10-12' }),
    ];
    const notes = specialNotes(students, records, hol, '2026-03-01', '2027-02-28');
    expect(notes.map((n) => [n.student.number, n.kind])).toEqual([
      [1, '장기결석'],
      [2, '개근'],
    ]);
    expect(notes[0].text).toContain('연속 10일');
  });

  it('출석인정만 있으면 개근, 기타결석은 사유 입력 대상', () => {
    const records = [
      rec({ kind: '출석인정', reason: '공문' }),
      rec({ studentId: 's2', kind: '기타', startDate: '2026-10-13' }),
    ];
    const notes = specialNotes(students, records, hol, '2026-03-01', '2027-02-28');
    expect(notes.map((n) => [n.student.number, n.kind])).toEqual([
      [1, '개근'],
      [2, '기타결석'],
    ]);
  });
});

describe('v3 → v4', () => {
  it('체험학습 근거자료와 보호자 확인 항목을 지우고 받은 상태는 유지', async () => {
    const { normalize } = await import('../storage/db');
    const trip = rec({ id: 't', kind: '출석인정', reason: '체험학습', fieldTrip: { abroad: false, guardianAccompanied: true } });
    trip.docs = [
      { key: DOC_FT_APPLICATION, label: '신청서', required: true, received: true, receivedDate: '2026-10-01' },
      { key: DOC_FT_REPORT, label: '보고서', required: true, received: false },
      { key: 'fieldtrip:evidence', label: '근거자료', required: true, received: false },
    ];
    const ill = rec({ id: 'i', kind: '질병' });
    ill.docs = [
      { key: 'absence-note', label: '결석계', required: true, received: false },
      { key: 'check:guardian', label: '보호자 확인', required: true, received: false },
    ];
    const s = normalize({ version: 3, students: [], holidays: HOLIDAYS, settings: {}, records: [trip, ill] });
    expect(s.records[0].docs.map((d) => [d.key, d.received])).toEqual([
      [DOC_FT_APPLICATION, true],
      [DOC_FT_REPORT, false],
    ]);
    expect(s.records[1].docs.map((d) => d.key)).toEqual(['absence-note', 'evidence:medical']);
  });
});
