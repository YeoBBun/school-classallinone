/**
 * 아직 받지 않은 필수 서류 목록 — 오늘 화면 «처리 예정»의 출결 서류와 휴대폰 위젯이 같이 쓴다.
 */
import type { HolidayIndex } from './calendar';
import { applicationDeadline, DOC_FT_APPLICATION, DOC_FT_REPORT, missingDocs, reportDeadline } from './rules';
import { KIND_SHORT, type AppState, type AttendanceRecord, type DateStr, type DocItem } from './types';

export interface PendingRow {
  record: AttendanceRecord;
  doc: DocItem;
  deadline?: DateStr;
}

/** 받을 서류를 출결 시작일 순으로. 기한은 체험학습 신청서·보고서에만 있다. */
export function pendingDocs(state: AppState, holidays: HolidayIndex): PendingRow[] {
  const out: PendingRow[] = [];
  for (const record of state.records) {
    for (const doc of missingDocs(record)) {
      let deadline: DateStr | undefined;
      if (doc.key === DOC_FT_APPLICATION) deadline = applicationDeadline(record, state.settings, holidays);
      if (doc.key === DOC_FT_REPORT) deadline = reportDeadline(record, state.settings, holidays);
      out.push({ record, doc, deadline });
    }
  }
  return out.sort((a, b) => a.record.startDate.localeCompare(b.record.startDate));
}

/** 서류 목록용 짧은 표기. 예: 질병결석, 생리 조퇴, 체험학습 */
export function shortTitle(r: AttendanceRecord): string {
  if (r.kind !== '출석인정' || !r.reason) return `${KIND_SHORT[r.kind]}${r.status}`;
  return r.reason === '체험학습' ? '체험학습' : `${r.reason} ${r.status}`;
}

export function studentName(state: AppState, id: string): string {
  const s = state.students.find((x) => x.id === id);
  return s ? `${s.number}. ${s.name}` : '?';
}
