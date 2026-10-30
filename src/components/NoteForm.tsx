import { useState } from 'react';
import { formatKo, today } from '../domain/calendar';
import { NOTE_KINDS, PARENT_METHODS, type Note, type NoteKind } from '../domain/types';
import { newId, useStore } from '../store';
import { Modal, sortStudents } from './common';

const PLACEHOLDER: Record<NoteKind, string> = {
  관찰: '예: 모둠활동에서 친구를 먼저 도와줌',
  학생상담: '예: 진로 고민 — 미술 쪽에 관심, 부모님과 의견 차이',
  학부모상담: '예: 수학 학원 문의, 가정에서 휴대폰 사용 지도 부탁드림',
};

/** 관찰·상담 기록 쓰기. 꼭 필요한 칸(유형·내용)만 보이고, 나머지는 «더 적기» 안에 있다. */
export function NoteForm({
  initial,
  studentId,
  defaultKind,
  onClose,
}: {
  initial?: Note;
  studentId: string;
  defaultKind?: NoteKind;
  onClose: () => void;
}) {
  const { state, update, removeNote } = useStore();
  const isNew = !initial;
  const [draft, setDraft] = useState<Note>(
    () => initial ?? { id: newId(), studentIds: [studentId], kind: defaultKind ?? '관찰', date: today(), content: '' },
  );
  const hasExtra = !!(initial?.followUp || (initial?.studentIds.length ?? 0) > 1 || (initial && initial.date !== today()));
  const [more, setMore] = useState(hasExtra);
  const [error, setError] = useState('');
  const set = (patch: Partial<Note>) => setDraft((d) => ({ ...d, ...patch }));
  const student = state.students.find((s) => s.id === studentId);

  const save = () => {
    if (!draft.content.trim()) return setError('내용을 적어 주세요.');
    const note: Note = {
      ...draft,
      content: draft.content.trim(),
      followUp: draft.followUp?.trim() || undefined,
      followUpDone: draft.followUp?.trim() ? draft.followUpDone : undefined,
      parentWho: draft.kind === '학부모상담' ? draft.parentWho?.trim() || undefined : undefined,
      parentMethod: draft.kind === '학부모상담' ? draft.parentMethod : undefined,
    };
    update((s) => ({
      ...s,
      notes: isNew ? [...s.notes, note] : s.notes.map((n) => (n.id === note.id ? note : n)),
    }));
    onClose();
  };

  const remove = () => {
    removeNote(draft.id, `${student?.name ?? ''} ${formatKo(draft.date)} ${draft.kind}`);
    onClose();
  };

  const toggleStudent = (id: string) =>
    set({ studentIds: draft.studentIds.includes(id) ? draft.studentIds.filter((x) => x !== id) : [...draft.studentIds, id] });

  return (
    <Modal title={`${student ? `${student.number}. ${student.name}` : ''} ${isNew ? '기록 남기기' : '기록 고치기'}`} onClose={onClose}>
      <div className="form">
        <section>
          <div className="big-seg">
            {NOTE_KINDS.map((k) => (
              <button key={k} type="button" className={draft.kind === k ? 'on' : ''} onClick={() => set({ kind: k })}>
                {k}
              </button>
            ))}
          </div>
        </section>

        {draft.kind === '학부모상담' && (
          <section className="row">
            <div>
              <label className="field-label">누구와</label>
              <input
                className="narrow"
                value={draft.parentWho ?? ''}
                placeholder="어머니"
                onChange={(e) => set({ parentWho: e.target.value })}
              />
            </div>
            <div>
              <span className="field-label">어떻게</span>
              <div className="seg">
                {PARENT_METHODS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={draft.parentMethod === m ? 'on' : ''}
                    onClick={() => set({ parentMethod: draft.parentMethod === m ? undefined : m })}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}

        <section>
          <label className="field-label">내용</label>
          <textarea
            rows={4}
            autoFocus
            value={draft.content}
            placeholder={PLACEHOLDER[draft.kind]}
            onChange={(e) => {
              set({ content: e.target.value });
              setError('');
            }}
          />
        </section>

        {!more ? (
          <button type="button" className="link" onClick={() => setMore(true)}>
            + 더 적기 (날짜, 할 일, 같이 있던 학생)
          </button>
        ) : (
          <>
            <section>
              <label className="field-label">날짜</label>
              <input type="date" value={draft.date} onChange={(e) => e.target.value && set({ date: e.target.value })} />
            </section>
            <section>
              <label className="field-label">할 일 (후속 조치)</label>
              <input
                className="wide"
                value={draft.followUp ?? ''}
                placeholder="예: 다음 주 다시 면담"
                onChange={(e) => set({ followUp: e.target.value })}
              />
            </section>
            <section>
              <span className="field-label">같이 있던 학생 (이 기록이 그 학생 페이지에도 보여요)</span>
              <div className="chips">
                {sortStudents(state.students).map((s) => {
                  const on = draft.studentIds.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className={`chip${on ? ' on' : ''}`}
                      onClick={() => s.id !== studentId && toggleStudent(s.id)}
                    >
                      {s.number} {s.name}
                    </button>
                  );
                })}
              </div>
            </section>
          </>
        )}

        {error && <p className="error">{error}</p>}

        <footer className="form-actions">
          {!isNew && (
            <button type="button" className="danger" onClick={remove}>
              이 기록 삭제
            </button>
          )}
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            취소
          </button>
          <button type="button" className="primary" onClick={save}>
            저장
          </button>
        </footer>
      </div>
    </Modal>
  );
}
