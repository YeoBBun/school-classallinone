/** 여러 화면이 같이 쓰는 작은 부품: 복사 버튼, 인쇄, 학생 고르기, 화면 머리 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Student } from '../domain/types';
import { sortStudents } from './common';
import { Icon } from './icons';

export async function copyText(text: string): Promise<void> {
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
}

export function CopyButton({ text, label = '복사', className = 'ghost small' }: { text: string | (() => string); label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        await copyText(typeof text === 'function' ? text() : text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} size={15} />
      {copied ? '복사됨' : label}
    </button>
  );
}

/**
 * 인쇄용 종이. 화면에는 안 보이고, 열리면 바로 인쇄 창을 띄운 뒤 닫힌다.
 * landscape 면 가로로 인쇄한다.
 */
export function PrintSheet({ children, onDone, landscape }: { children: ReactNode; onDone: () => void; landscape?: boolean }) {
  useEffect(() => {
    document.body.classList.add('printing');
    // 용지 방향은 @page 로만 정할 수 있어서 인쇄하는 동안만 규칙을 넣는다
    const page = document.createElement('style');
    page.textContent = `@page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 12mm; }`;
    document.head.append(page);
    const done = () => {
      document.body.classList.remove('printing');
      page.remove();
      onDone();
    };
    window.addEventListener('afterprint', done, { once: true });
    const t = setTimeout(() => window.print(), 80);
    return () => {
      clearTimeout(t);
      window.removeEventListener('afterprint', done);
      document.body.classList.remove('printing');
      page.remove();
    };
    // 한 번 열 때 한 번만 인쇄한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return createPortal(<div className="print-root">{children}</div>, document.body);
}

/** 학생 여러 명 고르기 (번호 이름 칩) */
export function StudentChips({
  students,
  selected,
  onToggle,
  locked,
}: {
  students: Student[];
  selected: string[];
  onToggle: (id: string) => void;
  /** 빼지 못하게 고정한 학생 */
  locked?: string;
}) {
  return (
    <div className="chips">
      {sortStudents(students).map((s) => {
        const on = selected.includes(s.id);
        return (
          <button key={s.id} type="button" className={`chip${on ? ' on' : ''}`} onClick={() => s.id !== locked && onToggle(s.id)}>
            {s.number} {s.name}
          </button>
        );
      })}
    </div>
  );
}

export function toggleIn(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

/** «더보기» 안 화면의 제목 줄 */
export function PageHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="page-head">
      <h2 className="page-title">{title}</h2>
      <span className="spacer" />
      {children}
    </header>
  );
}

export function nameOf(students: Student[], id: string): string {
  return students.find((s) => s.id === id)?.name ?? '(삭제된 학생)';
}

/** [⋯] 메뉴: 자주 안 쓰는 것을 넣어 둔다. 바깥을 누르거나 고르면 닫힌다 */
export function Menu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button className="icon-btn" aria-label="더 보기" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="more" size={22} />
      </button>
      {open && (
        <div className="menu-pop" role="menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}
