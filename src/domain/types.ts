import { PUBLIC_HOLIDAYS } from './publicHolidays';

/** 날짜는 모두 'YYYY-MM-DD' 문자열로 다룬다. */
export type DateStr = string;

export const STATUSES = ['결석', '지각', '조퇴', '결과'] as const;
export type Status = (typeof STATUSES)[number];

export const KINDS = ['출석인정', '질병', '미인정', '기타'] as const;
export type Kind = (typeof KINDS)[number];

/** 목록에 쓰는 짧은 표기 */
export const KIND_SHORT: Record<Kind, string> = { 출석인정: '인정', 질병: '질병', 미인정: '미인정', 기타: '기타' };

/** 출석인정 세부 사유 */
export const APPROVED_REASONS = ['법정감염병', '체험학습', '경조사', '생리', '공문'] as const;
export type ApprovedReason = (typeof APPROVED_REASONS)[number];

/** 경조사 종류와 인정 일수 (교내 출결 기준표, 2025학년도~) */
export const FAMILY_EVENTS = [
  { key: '형제자매·부모 결혼', days: 1 },
  { key: '학생 본인 입양', days: 20 },
  { key: '부모·(외)조부모 사망', days: 5 },
  { key: '(외)증조부모 사망', days: 3 },
  { key: '부모의 형제자매(배우자 포함) 사망', days: 3 },
] as const;
export type FamilyEvent = (typeof FAMILY_EVENTS)[number]['key'];

export interface ExamPeriod {
  start: DateStr;
  end: DateStr;
  name: string;
}

/** 기기 간 동기화용: 마지막으로 고친 시각 (ISO). 동기화에서 나중에 고친 쪽을 남긴다. */
export interface Stamped {
  updatedAt?: string;
}

export interface Student extends Stamped {
  id: string;
  number: number;
  name: string;
}

export type HolidayType = '공휴일' | '재량휴업일';

export interface Holiday extends Stamped {
  date: DateStr;
  name: string;
  type: HolidayType;
}

export interface DocItem {
  /** 같은 서류를 식별하는 키. 출결 종류를 바꿔 서류 목록을 다시 만들 때 받은 상태를 유지하는 데 쓴다. */
  key: string;
  label: string;
  required: boolean;
  received: boolean;
  receivedDate?: DateStr;
}

export interface IllnessInfo {
  /** 질병명 (독감, 코로나19 등) */
  disease: string;
  /** 의사 소견서에 적힌 출석인정 기간 */
  certStart?: DateStr;
  certEnd?: DateStr;
}

export interface FieldTripInfo {
  abroad: boolean;
  guardianAccompanied: boolean;
  /** 여러 날 체험학습에서 첫날은 오후부터 (첫날 인정조퇴, 0.5일) */
  startPM?: boolean;
  /** 여러 날 체험학습에서 마지막 날은 오전까지 (마지막 날 인정지각, 0.5일) */
  endAM?: boolean;
}

export interface AttendanceRecord extends Stamped {
  id: string;
  studentId: string;
  status: Status;
  kind: Kind;
  /** kind === '출석인정' 일 때만 */
  reason?: ApprovedReason;
  startDate: DateStr;
  /** 결석은 기간 입력 가능. 지각·조퇴·결과는 startDate 와 같다. */
  endDate: DateStr;
  /** 결과일 때 해당 교시 */
  periods?: number[];
  /** 지각: 몇 교시까지 빠졌는지 (0 = 조회만). 체험학습 마지막 날 오전까지도 여기에 */
  lateUntil?: number;
  /** 조퇴: 몇 교시부터 빠졌는지. 체험학습 첫날 오후부터도 여기에 */
  leaveFrom?: number;
  illness?: IllnessInfo;
  fieldTrip?: FieldTripInfo;
  /** 출석인정 경조사 종류 */
  familyEvent?: FamilyEvent;
  docs: DocItem[];
  memo: string;
}

/** 학생 기록 유형 */
export const NOTE_KINDS = ['관찰', '학생상담', '학부모상담'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export const PARENT_METHODS = ['대면', '전화', '문자'] as const;
export type ParentMethod = (typeof PARENT_METHODS)[number];

/** 관찰·학생상담·학부모상담 기록 */
export interface Note extends Stamped {
  id: string;
  /** 같이 상담한 학생 등 여러 명일 수 있다 */
  studentIds: string[];
  kind: NoteKind;
  date: DateStr;
  content: string;
  /** 후속 조치 (할 일) */
  followUp?: string;
  followUpDone?: boolean;
  /** 학부모상담일 때만: 상담한 보호자 (어머니, 아버지 등) */
  parentWho?: string;
  parentMethod?: ParentMethod;
  /** 아직 하지 않은 상담 (일정). 내용을 적어 저장하면 끝난 상담이 된다 */
  planned?: boolean;
  /** 상담 시각 'HH:MM' (일정일 때) */
  time?: string;
  /** 나이스 누가기록에 옮겨 적었는가 */
  neisDone?: boolean;
  /** 기록을 처음 저장한 시각 (ISO, 이 기기 시계). 상담 일정은 결과를 적어 저장한 때. 이 기능 전 기록에는 없다 */
  writtenAt?: string;
  /** 내용·날짜를 마지막으로 고친 시각 (ISO) */
  editedAt?: string;
  /** 고치기 전 내용들 (오래된 것부터). 고쳐도 원래 내용이 남는다 */
  history?: NoteVersion[];
}

/** 선생님이 직접 적어 둔 할 일 (처리 예정 «기타»). 다 하면 지운다 */
export interface Todo extends Stamped {
  id: string;
  text: string;
  due?: DateStr;
  createdAt: DateStr;
}

/** 고치기 전의 기록 한 판 */
export interface NoteVersion {
  /** 이 판을 저장한 시각 (ISO). 모르면 없음 */
  at?: string;
  date: DateStr;
  content: string;
}

/** 제출물·회신 체크 (가정통신문 회신, 동의서 등) */
export interface Checklist extends Stamped {
  id: string;
  title: string;
  createdAt: DateStr;
  dueDate?: DateStr;
  /** 학생id → 낸 날짜. 면제는 'exempt' */
  marks: Record<string, DateStr | 'exempt'>;
  /** 다 받아서 치워 둔 항목 */
  closed?: boolean;
}

/** 명심보감 필사 부여 한 번. 낸 장은 앞에서부터 채운다 */
export interface PilsaTask extends Stamped {
  id: string;
  studentId: string;
  date: DateStr;
  reason: string;
  pages: number;
  /** 낸 장마다 낸 날짜 (길이 ≤ pages) */
  submitted: DateStr[];
}

export const EVENT_KINDS = ['학급 행사', '기타'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** 학급 일정 (행사 등). 학부모 상담 일정은 관찰·상담 기록(planned)으로 따로 둔다 */
export interface ClassEvent extends Stamped {
  id: string;
  kind: EventKind;
  title: string;
  date: DateStr;
  /** 'HH:MM' — 없으면 하루 종일 */
  time?: string;
  memo?: string;
}

/** 자리 배치 한 번. seats 는 교탁 쪽 첫 줄 왼쪽(학생이 칠판을 볼 때)부터 줄마다 */
export interface SeatPlan extends Stamped {
  id: string;
  date: DateStr;
  rows: number;
  cols: number;
  /** 두 자리씩 붙여 앉는가 (짝) */
  pair: boolean;
  seats: (string | null)[];
}

/** 행동특성 및 종합의견 초안. id 는 '학년도:학생id' */
export interface BehaviorDraft extends Stamped {
  id: string;
  studentId: string;
  year: number;
  text: string;
  done?: boolean;
}

/** 구글 캘린더에 넣은 일정. id 는 그 일정을 만든 항목 ('note:id', 'due:id') */
export interface CalendarLink extends Stamped {
  id: string;
  eventId: string;
  /** 일정 내용 요약 — 바뀌었을 때만 다시 올린다 */
  hash: string;
}

export interface SeatingRules {
  rows: number;
  cols: number;
  pair: boolean;
  /** 앞쪽 두 줄에 앉힐 학생 */
  front: string[];
  /** 서로 붙지 않게 할 두 학생 */
  apart: [string, string][];
}

export type DeadlineBasis = 'school' | 'calendar';

export interface Settings extends Stamped {
  className: string;
  /** 체험학습 신청서: 실시 N일 전까지 */
  applicationDaysBefore: number;
  applicationBasis: DeadlineBasis;
  /** 체험학습 보고서: 종료 후 N일 이내 */
  reportDaysAfter: number;
  reportBasis: DeadlineBasis;
  /** 체험학습 1회 연속 최대 일수 (국내·국외 모두) */
  tripMaxConsecutiveDays: number;
  /** 체험학습 연간 최대 일수 */
  fieldTripYearlyMax: number;
  /** 시험 기간: 이 기간의 질병결석은 일수와 관계없이 진료확인서 등 근거 서류가 필요하다 */
  examPeriods: ExamPeriod[];
  lastBackupAt?: string;
  /** 마지막으로 나이스 파일을 내보낸 기간의 끝 날짜 */
  lastNeisExportTo?: DateStr;
  /** 필사 1회 기본 분량(장)과 부여할 때마다 늘어나는 분량 */
  pilsaBase: number;
  pilsaStep: number;
  /** 행발 글자 한도 (나이스 바이트) */
  behaviorByteLimit: number;
  seating: SeatingRules;
  /** 구글 캘린더에 일정·제출 마감을 넣는가: 기본은 넣는다 (구글에 로그인했을 때). 설정에서 끄면 false. calendarWanted() 로 읽는다 */
  calendarOn?: boolean;
  /** 넣는 캘린더 */
  calendarId?: string;
}

/** 구글 캘린더에 넣을 것인가 — 끄지 않았으면 넣는다 */
export const calendarWanted = (s: Settings): boolean => s.calendarOn !== false;

export interface AppState {
  version: 6;
  students: Student[];
  records: AttendanceRecord[];
  notes: Note[];
  checklists: Checklist[];
  pilsa: PilsaTask[];
  seatPlans: SeatPlan[];
  events: ClassEvent[];
  behavior: BehaviorDraft[];
  calendarLinks: CalendarLink[];
  todos: Todo[];
  holidays: Holiday[];
  settings: Settings;
  /** 지운 항목과 지운 시각 (키: 'r:기록id' / 's:학생id' / 'n:기록id' / 'h:날짜' 등, merge.ts 참고). 다른 기기에도 지운 것이 퍼지게 한다. */
  tombstones: Record<string, string>;
}

export const DEFAULT_SETTINGS: Settings = {
  className: '',
  applicationDaysBefore: 2,
  applicationBasis: 'school',
  reportDaysAfter: 7,
  reportBasis: 'calendar',
  tripMaxConsecutiveDays: 10,
  fieldTripYearlyMax: 20,
  examPeriods: [],
  pilsaBase: 1,
  pilsaStep: 1,
  behaviorByteLimit: 1500,
  seating: { rows: 5, cols: 6, pair: true, front: [], apart: [] },
};

export function emptyState(): AppState {
  return {
    version: 6,
    students: [],
    records: [],
    notes: [],
    checklists: [],
    pilsa: [],
    seatPlans: [],
    events: [],
    behavior: [],
    calendarLinks: [],
    todos: [],
    holidays: [...PUBLIC_HOLIDAYS],
    settings: { ...DEFAULT_SETTINGS },
    tombstones: {},
  };
}
