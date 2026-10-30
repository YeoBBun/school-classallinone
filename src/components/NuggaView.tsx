import { useMemo, useState } from 'react';
import { formatKo, schoolYearOf, schoolYearRange, today } from '../domain/calendar';
import { neisBytes } from '../domain/classroom';
import type { Note } from '../domain/types';
import { downloadBlob } from '../storage/db';
import { useStore } from '../store';
import { sortStudents } from './common';
import { NOTE_CLASS } from './StudentsView';
import { CopyButton, PageHead } from './ui';

export const NUGA_FILE_FORMAT = 'class-app/nuga-v1';

/**
 * 나이스 누가기록에 옮길 관찰·상담 기록. 학생별로 모아 [복사] → 나이스에 붙여넣기 → [넣음] 체크.
 * 키트 자동 입력용 파일(class-app/nuga-v1)도 만든다.
 */
export function NuggaView() {
  const { state, update } = useStore();
  const [show, setShow] = useState<'todo' | 'done'>('todo');
  const [from, to] = schoolYearRange(schoolYearOf(today()));

  const groups = useMemo(() => {
    const notes = state.notes.filter((n) => !n.planned && n.content.trim() && n.date >= from && n.date <= to && !!n.neisDone === (show === 'done'));
    return sortStudents(state.students)
      .map((s) => ({ student: s, notes: notes.filter((n) => n.studentIds.includes(s.id)).sort((a, b) => a.date.localeCompare(b.date)) }))
      .filter((g) => g.notes.length > 0);
  }, [state.notes, state.students, show, from, to]);
  const count = groups.reduce((n, g) => n + g.notes.length, 0);

  const mark = (n: Note, done: boolean) =>
    update((s) => ({ ...s, notes: s.notes.map((x) => (x.id === n.id ? { ...x, neisDone: done || undefined } : x)) }));

  const saveFile = () => {
    const items = groups.flatMap((g) =>
      g.notes.map((n) => ({ date: n.date, number: g.student.number, name: g.student.name, kind: n.kind, content: n.content })),
    );
    const file = { format: NUGA_FILE_FORMAT, className: state.settings.className, createdAt: new Date().toISOString(), items };
    downloadBlob(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }), `nuga_neis_${today().replace(/-/g, '')}.json`);
  };

  return (
    <div className="module">
      <PageHead title="나이스 누가기록">
        {show === 'todo' && count > 0 && (
          <button className="ghost small" onClick={saveFile} title="나이스 자동 입력 키트에서 읽는 파일">
            키트용 파일 저장
          </button>
        )}
      </PageHead>
      <p className="hint">
        관찰·상담 기록 중 나이스 누가기록에 옮길 것이에요. [복사]를 눌러 나이스에 붙여 넣고, 다 넣었으면 [넣음]에 체크하세요.
      </p>
      <div className="toolbar">
        <div className="seg">
          <button className={show === 'todo' ? 'on' : ''} onClick={() => setShow('todo')}>
            아직 안 넣은 것
          </button>
          <button className={show === 'done' ? 'on' : ''} onClick={() => setShow('done')}>
            넣은 것
          </button>
        </div>
        <span className="muted">{count}건</span>
      </div>

      {groups.length === 0 ? (
        <p className="empty">{show === 'todo' ? '옮길 기록이 없어요.' : '아직 넣었다고 표시한 기록이 없어요.'}</p>
      ) : (
        <ul className="cards">
          {groups.map((g) => (
            <li key={g.student.id} className="card">
              <h3>
                {g.student.number}. {g.student.name}
              </h3>
              <ul className="nuga-list">
                {g.notes.map((n) => (
                  <li key={n.id}>
                    <div className="row">
                      <span className="muted">{formatKo(n.date)}</span>
                      <span className={`tag ${NOTE_CLASS[n.kind]}`}>{n.kind}</span>
                      <span className="muted small">{neisBytes(n.content)}바이트</span>
                      <span className="spacer" />
                      <CopyButton text={n.content} />
                      <label className="check">
                        <input type="checkbox" checked={!!n.neisDone} onChange={(e) => mark(n, e.target.checked)} />
                        넣음
                      </label>
                    </div>
                    <p className="note-text">{n.content}</p>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
