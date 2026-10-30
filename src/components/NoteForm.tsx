import { useState } from 'react';
import { addDays, formatKo, today } from '../domain/calendar';
import { NOTE_KINDS, PARENT_METHODS, type Note, type NoteKind } from '../domain/types';
import { newId, useStore } from '../store';
import { Modal } from './common';
import { StudentChips, toggleIn } from './ui';

const PLACEHOLDER: Record<NoteKind, string> = {
  관찰: '예: 모둠활동에서 친구를 먼저 도와줌',
  학생상담: '예: 진로 고민 — 미술 쪽에 관심, 부모님과 의견 차이',
  학부모상담: '예: 수학 학원 문의, 가정에서 휴대폰 사용 지도 부탁드림',
};

/**
 * 관찰·상담 기록 쓰기. 꼭 필요한 칸(유형·내용)만 보이고, 나머지는 «더 적기» 안에 있다.
 * 유형은 연 곳(학생 페이지의 [＋])에서 이미 골랐으므로 새 기록에는 유형 고르기가 없다 (고칠 때만 바꿀 수 있다).
 * 상담 일정은 따로 연다 (planned). 일정을 다시 열면 [상담했어요 — 결과 적기] 하나로 끝난 상담이 된다.
 */
export function NoteForm({
  initial,
  studentId,
  defaultKind,
  planned: startPlanned,
  onClose,
}: {
  initial?: Note;
  studentId: string;
  defaultKind?: NoteKind;
  /** 새 상담 일정으로 연다 */
  planned?: boolean;
  onClose: () => void;
}) {
  const { state, update, removeNote } = useStore();
  const isNew = !initial;
  const [draft, setDraft] = useState<Note>(
    () =>
      initial ??
      (startPlanned
        ? { id: newId(), studentIds: [studentId], kind: '학부모상담', date: addDays(today(), 1), time: '15:00', content: '', planned: true }
        : { id: newId(), studentIds: [studentId], kind: defaultKind ?? '관찰', date: today(), content: '' }),
  );
  const hasExtra = !!(initial?.followUp || (initial?.studentIds.length ?? 0) > 1 || (initial && !initial.planned && initial.date !== today()));
  const [more, setMore] = useState(hasExtra);
  const [error, setError] = useState('');
  const set = (patch: Partial<Note>) => setDraft((d) => ({ ...d, ...patch }));
  const student = state.students.find((s) => s.id === studentId);
  const parent = draft.kind === '학부모상담';
  const planned = parent && !!draft.planned;

  const save = () => {
    if (!planned && !draft.content.trim()) return setError('내용을 적어 주세요.');
    const note: Note = {
      ...draft,
      content: draft.content.trim(),
      followUp: draft.followUp?.trim() || undefined,
      followUpDone: draft.followUp?.trim() ? draft.followUpDone : undefined,
      parentWho: parent ? draft.parentWho?.trim() || undefined : undefined,
      parentMethod: parent ? draft.parentMethod : undefined,
      planned: planned || undefined,
      time: parent ? draft.time || undefined : undefined,
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

  const title = planned ? '상담 일정' : `${draft.kind} ${isNew ? '남기기' : '고치기'}`;

  return (
    <Modal title={`${student ? `${student.number}. ${student.name}` : ''} ${title}`} onClose={onClose}>
      <div className="form">
        {!isNew && !planned && (
          <section>
            <div className="seg">
              {NOTE_KINDS.map((k) => (
                <button key={k} type="button" className={draft.kind === k ? 'on' : ''} onClick={() => set({ kind: k })}>
                  {k}
                </button>
              ))}
            </div>
          </section>
        )}

        {planned && !isNew && (
          <button type="button" className="primary big" onClick={() => set({ planned: false, date: draft.date > today() ? today() : draft.date })}>
            상담했어요 — 결과 적기
          </button>
        )}

        {parent && (
          <>
            <section className="row">
              {planned && (
                <>
                  <div>
                    <label className="field-label">날짜</label>
                    <input type="date" value={draft.date} onChange={(e) => e.target.value && set({ date: e.target.value })} />
                  </div>
                  <div>
                    <label className="field-label">시각</label>
                    <input type="time" value={draft.time ?? ''} step={600} onChange={(e) => set({ time: e.target.value })} />
                  </div>
                </>
              )}
              <div>
                <label className="field-label">누구와</label>
                <input className="narrow" value={draft.parentWho ?? ''} placeholder="어머니" onChange={(e) => set({ parentWho: e.target.value })} />
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
            {planned && state.settings.calendarOn && <p className="hint">저장하면 구글 캘린더에도 들어가요.</p>}
          </>
        )}

        <section>
          <label className="field-label">{planned ? '미리 적어 둘 것 (선택)' : '내용'}</label>
          <textarea
            rows={planned ? 2 : 4}
            autoFocus={!planned}
            value={draft.content}
            placeholder={planned ? '예: 진로 이야기, 결석 관련' : PLACEHOLDER[draft.kind]}
            onChange={(e) => {
              set({ content: e.target.value });
              setError('');
            }}
          />
        </section>

        {!more ? (
          <button type="button" className="link" onClick={() => setMore(true)}>
            + 더 적기 ({planned ? '' : '날짜, '}할 일, 같이 있던 학생)
          </button>
        ) : (
          <>
            {!planned && (
              <section>
                <label className="field-label">날짜</label>
                <input type="date" value={draft.date} onChange={(e) => e.target.value && set({ date: e.target.value })} />
              </section>
            )}
            <section>
              <label className="field-label">할 일 (후속 조치)</label>
              <input className="wide" value={draft.followUp ?? ''} placeholder="예: 다음 주 다시 면담" onChange={(e) => set({ followUp: e.target.value })} />
            </section>
            <section>
              <span className="field-label">같이 있던 학생 (이 기록이 그 학생 페이지에도 보여요)</span>
              <StudentChips
                students={state.students}
                selected={draft.studentIds}
                locked={studentId}
                onToggle={(id) => set({ studentIds: toggleIn(draft.studentIds, id) })}
              />
            </section>
          </>
        )}

        {error && <p className="error">{error}</p>}

        <footer className="form-actions">
          {!isNew && (
            <button type="button" className="danger" onClick={remove}>
              {planned ? '일정 지우기' : '이 기록 삭제'}
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
