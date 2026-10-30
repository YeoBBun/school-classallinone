import { describe, expect, it } from 'vitest';
import { emptyState, type AppState, type AttendanceRecord, type Note } from '../domain/types';
import { normalize } from '../storage/db';
import { canonical, mergeStates, stamp } from './merge';

const rec = (id: string, memo = ''): AttendanceRecord => ({
  id, studentId: 's1', status: '결석', kind: '질병', startDate: '2026-10-19', endDate: '2026-10-19', docs: [], memo,
});
const base = (): AppState => ({ ...emptyState(), holidays: [], students: [] });

describe('동기화 표시', () => {
  it('바뀐 항목에만 시각을 찍고, 지운 항목은 tombstone 으로', () => {
    const s0 = stamp(base(), { ...base(), records: [rec('a'), rec('b')] }, 'T1');
    expect(s0.records.map((r) => r.updatedAt)).toEqual(['T1', 'T1']);
    const s1 = stamp(s0, { ...s0, records: [s0.records[0], { ...s0.records[1], memo: '감기' }] }, 'T2');
    expect(s1.records.map((r) => r.updatedAt)).toEqual(['T1', 'T2']);
    const s2 = stamp(s1, { ...s1, records: [s1.records[1]] }, 'T3');
    expect(s2.tombstones).toEqual({ 'r:a': 'T3' });
    const s3 = stamp(s2, { ...s2, records: [...s2.records, s1.records[0]] }, 'T4'); // 되돌리기
    expect(s3.tombstones).toEqual({});
    expect(s3.records.find((r) => r.id === 'a')?.updatedAt).toBe('T4');
  });
});

describe('두 기기 합치기', () => {
  const now = new Date('2026-10-19T12:00:00Z');
  it('각자 추가한 기록은 둘 다, 같은 기록은 나중에 고친 쪽', () => {
    const phone = { ...base(), records: [{ ...rec('a', '폰'), updatedAt: '2026-10-19T10:00:00Z' }, { ...rec('p'), updatedAt: '2026-10-19T09:00:00Z' }] };
    const pc = { ...base(), records: [{ ...rec('a', 'PC'), updatedAt: '2026-10-19T11:00:00Z' }, { ...rec('c'), updatedAt: '2026-10-19T09:30:00Z' }] };
    const m1 = mergeStates(phone, pc, now);
    const m2 = mergeStates(pc, phone, now);
    expect(m1.records.map((r) => [r.id, r.memo])).toEqual([['a', 'PC'], ['c', ''], ['p', '']]);
    expect(canonical(m1)).toBe(canonical(m2));
  });

  it('한쪽에서 지운 기록은 다른 쪽에서도 지워진다 (그 뒤에 고친 게 아니면)', () => {
    const phone = { ...base(), records: [], tombstones: { 'r:a': '2026-10-19T11:00:00Z' } };
    const pc = { ...base(), records: [{ ...rec('a'), updatedAt: '2026-10-19T10:00:00Z' }] };
    expect(mergeStates(pc, phone, now).records).toEqual([]);
    const pcLater = { ...base(), records: [{ ...rec('a'), updatedAt: '2026-10-19T11:30:00Z' }] };
    expect(mergeStates(pcLater, phone, now).records.map((r) => r.id)).toEqual(['a']);
  });

  it('백업 시각은 기기마다 따로', () => {
    const a = { ...base(), settings: { ...base().settings, lastBackupAt: 'A', className: '1-4', updatedAt: '2' } };
    const b = { ...base(), settings: { ...base().settings, lastBackupAt: 'B', className: '1-3', updatedAt: '1' } };
    const m = mergeStates(b, a, now);
    expect(m.settings.className).toBe('1-4');
    expect(m.settings.lastBackupAt).toBe('B');
  });
});

describe('관찰·상담 기록', () => {
  const now = new Date('2026-10-19T12:00:00Z');
  const note = (id: string, content: string, updatedAt: string, studentIds = ['s1']): Note => ({
    id, studentIds, kind: '관찰', date: '2026-10-19', content, updatedAt,
  });

  it('출결처럼 나중에 고친 쪽을 남기고, 지운 기록은 지운 채로', () => {
    const phone = { ...base(), notes: [note('a', '폰', '2026-10-19T10:00:00Z'), note('b', '', '2026-10-19T09:00:00Z')] };
    const pc = { ...base(), notes: [note('a', 'PC', '2026-10-19T11:00:00Z')], tombstones: { 'n:b': '2026-10-19T10:00:00Z' } };
    const m = mergeStates(phone, pc, now);
    expect(m.notes.map((n) => [n.id, n.content])).toEqual([['a', 'PC']]);
    expect(canonical(m)).toBe(canonical(mergeStates(pc, phone, now)));
  });

  it('지운 기록은 tombstone 으로 남는다', () => {
    const s0 = stamp(base(), { ...base(), notes: [note('a', '', '')] }, 'T1');
    expect(stamp(s0, { ...s0, notes: [] }, 'T2').tombstones).toEqual({ 'n:a': 'T2' });
  });

  it('합쳐진 학생으로 기록도 옮긴다', () => {
    const phone = { ...base(), students: [{ id: 'p-1', number: 7, name: '박지우' }], notes: [note('a', '', '1', ['p-1', 'c-1'])] };
    const pc = { ...base(), students: [{ id: 'c-1', number: 7, name: '박지우' }] };
    expect(mergeStates(phone, pc, now).notes[0].studentIds).toEqual(['c-1']);
  });
});

describe('이전 버전 파일', () => {
  it('v5 파일은 관찰·상담 기록 없이 읽힌다', () => {
    const { notes: _n, ...v5 } = { ...base(), version: 5 };
    const s = normalize(v5);
    expect(s.version).toBe(6);
    expect(s.notes).toEqual([]);
  });
});

describe('명단 중복', () => {
  it('두 기기에서 따로 등록한 같은 학생은 하나로 합치고 기록도 옮긴다', () => {
    const now = new Date('2026-10-19T12:00:00Z');
    const phone = { ...base(), students: [{ id: 'p-1', number: 7, name: '박지우' }], records: [{ ...rec('a'), studentId: 'p-1' }] };
    const pc = { ...base(), students: [{ id: 'c-1', number: 7, name: '박지우' }], records: [{ ...rec('b'), studentId: 'c-1' }] };
    const m = mergeStates(phone, pc, now);
    expect(m.students.map((x) => x.id)).toEqual(['c-1']);
    expect(m.records.map((r) => r.studentId)).toEqual(['c-1', 'c-1']);
    expect(canonical(m)).toBe(canonical(mergeStates(pc, phone, now)));
  });
});
