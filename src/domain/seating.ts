/**
 * 자리 배치: 조건(앞자리, 떨어뜨리기, 지난번 짝 피하기)을 지키며 섞기, 인쇄용 시점 바꾸기.
 * 자리 번호는 교탁 쪽 첫 줄 왼쪽(학생이 칠판을 볼 때)부터 줄마다 센다.
 */
import type { SeatingRules } from './types';

/** 앞쪽으로 치는 줄 수 */
export const FRONT_ROWS = 2;

export function seatRow(i: number, cols: number): number {
  return Math.floor(i / cols);
}

/** 옆(같은 줄 바로 옆)이나 앞뒤(같은 열 바로 앞뒤)에 붙은 두 자리인가 */
export function adjacent(a: number, b: number, cols: number): boolean {
  const [ra, ca, rb, cb] = [seatRow(a, cols), a % cols, seatRow(b, cols), b % cols];
  return (ra === rb && Math.abs(ca - cb) === 1) || (ca === cb && Math.abs(ra - rb) === 1);
}

/** 짝: 짝 모드에서 같은 줄의 (0,1) (2,3)… 자리 */
export function partnerSeat(i: number, cols: number): number | null {
  const c = i % cols;
  const p = c % 2 === 0 ? i + 1 : i - 1;
  return p >= seatRow(i, cols) * cols && p < (seatRow(i, cols) + 1) * cols ? p : null;
}

/** 지난 배치에서 짝이었던 두 학생 ('a|b', 작은 id 먼저) */
export function partnerPairs(seats: (string | null)[], cols: number): Set<string> {
  const out = new Set<string>();
  seats.forEach((id, i) => {
    const p = partnerSeat(i, cols);
    const other = p === null ? null : seats[p];
    if (id && other) out.add([id, other].sort().join('|'));
  });
  return out;
}

/** 배치의 벌점: 조건을 어긴 만큼 (앞자리·떨어뜨리기는 크게, 지난번 짝은 작게) */
export function penalty(seats: (string | null)[], rules: SeatingRules, previousPairs: Set<string>): number {
  const where = new Map<string, number>();
  seats.forEach((id, i) => id && where.set(id, i));
  let p = 0;
  for (const id of rules.front) {
    const i = where.get(id);
    if (i !== undefined && seatRow(i, rules.cols) >= FRONT_ROWS) p += 100;
  }
  for (const [a, b] of rules.apart) {
    const ia = where.get(a);
    const ib = where.get(b);
    if (ia !== undefined && ib !== undefined && adjacent(ia, ib, rules.cols)) p += 100;
  }
  if (rules.pair) for (const k of partnerPairs(seats, rules.cols)) if (previousPairs.has(k)) p += 1;
  return p;
}

/**
 * 학생을 섞어 앉힌다. 빈자리는 뒤쪽에 남긴다.
 * 여러 번 섞어 보고 벌점이 가장 적은 배치를 고른다 (조건이 많으면 다 못 지킬 수도 있다).
 */
export function shuffleSeats(
  studentIds: string[],
  rules: SeatingRules,
  previous: (string | null)[] | null,
  random: () => number = Math.random,
  tries = 400,
): { seats: (string | null)[]; penalty: number } {
  const size = rules.rows * rules.cols;
  const prevPairs = previous ? partnerPairs(previous, rules.cols) : new Set<string>();
  let best: { seats: (string | null)[]; penalty: number } | null = null;
  for (let t = 0; t < tries; t++) {
    const order = [...studentIds];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const seats: (string | null)[] = Array.from({ length: size }, (_, i) => order[i] ?? null);
    const p = penalty(seats, rules, prevPairs);
    if (!best || p < best.penalty) best = { seats, penalty: p };
    if (p === 0) break;
  }
  return best!;
}

/**
 * 인쇄할 때 보일 자리 순서. 학생 시점(게시용)은 칠판이 위, 교사 시점(교탁 부착용)은
 * 교탁에서 학생을 보는 방향이라 위아래·좌우가 모두 바뀐다.
 */
export function viewRows<T>(seats: T[], rows: number, cols: number, view: 'student' | 'teacher'): T[][] {
  const grid = Array.from({ length: rows }, (_, r) => seats.slice(r * cols, (r + 1) * cols));
  return view === 'student' ? grid : grid.reverse().map((row) => [...row].reverse());
}

/** 학생 수에 맞게 자리 크기를 바꿀 때 앉은 학생을 앞에서부터 다시 채운다 */
export function resizeSeats(seats: (string | null)[], rows: number, cols: number): (string | null)[] {
  const ids = seats.filter((x): x is string => !!x);
  return Array.from({ length: rows * cols }, (_, i) => ids[i] ?? null);
}
