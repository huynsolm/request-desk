import type { ReactNode } from 'react';
import type { AnalysisItem, ItemKind } from '../../../shared/types.ts';

export interface FormState {
  mode: 'edit' | 'new' | 'resolve' | 'convert';
  itemId?: string;
  kind: ItemKind;
  text: string; // 항목 내용 / 답변·결정 내용 / 전환할 요구사항 내용
  text2: string; // 전환 근거
  error?: string;
  busy?: boolean;
}

const META: Record<ItemKind, { title: string; desc: ReactNode; addLabel: string; placeholder: string }> = {
  requirement: {
    title: '명시된 요구사항',
    desc: (
      <>
        고객이 원문에서 <strong>직접 말한 내용</strong>이에요. 확정하면 작업으로 만들 수 있어요.
      </>
    ),
    addLabel: '+ 요구사항 추가',
    placeholder: '요구사항을 입력해 주세요',
  },
  question: {
    title: '확인할 질문',
    desc: (
      <>
        원문만으로는 알 수 없어 <strong>고객에게 물어봐야 하는 내용</strong>이에요. 답을 받기 전에는 작업에 넣지 않아요.
      </>
    ),
    addLabel: '+ 질문 추가',
    placeholder: '고객에게 물어볼 질문을 입력해 주세요',
  },
  undecided: {
    title: '미확정 사항',
    desc: (
      <>
        <strong>아직 결정되지 않은 내용</strong>이에요. 사실로 취급하지 않고, 기능이나 작업에도 넣지 않아요.
      </>
    ),
    addLabel: '+ 미확정 사항 추가',
    placeholder: '아직 정해지지 않은 내용을 입력해 주세요',
  },
};

/** 출처·검토 상태를 하나의 라벨로 보여준다. */
export function itemLabel(item: AnalysisItem, confirmedPhase: boolean): { text: string; cls: string; title?: string } {
  if (item.kind === 'requirement' && confirmedPhase) return { text: '확정', cls: 'lbl-confirmed' };
  const unreviewed = item.reviewState === 'unreviewed';
  let base = item.origin === 'ai' ? 'AI 제안' : item.origin === 'mock' ? '모의 제안' : '담당자 추가';
  if (item.origin !== 'manual' && item.humanEdited) base = '담당자 수정';
  const suffix = unreviewed ? ' · 검토 전' : item.origin !== 'manual' ? ' · 검토함' : '';
  const cls = unreviewed ? 'lbl-pending' : item.origin !== 'manual' && !item.humanEdited ? 'lbl-reviewed' : 'lbl-human';
  const title = item.origin === 'mock' ? '개발·테스트용 모의 결과예요. 실제 AI 분석이 아니에요.' : undefined;
  return { text: base + suffix, cls, title };
}

function reasonPrefix(item: AnalysisItem): string {
  if (item.kind === 'question') return item.origin === 'ai' ? 'AI가 질문한 이유' : item.origin === 'mock' ? '모의 제안의 이유' : '질문한 이유';
  return item.origin === 'ai' ? 'AI 판단' : item.origin === 'mock' ? '모의 판단' : '담당자 메모';
}

export interface SectionProps {
  kind: ItemKind;
  items: AnalysisItem[];
  reqNumbers: Map<string, number>;
  confirmed: boolean;
  form: FormState | null;
  onFormChange: (patch: Partial<FormState>) => void;
  onFormCommit: () => void;
  onFormCancel: () => void;
  setHover: (id: string | null) => void;
  hover: string | null;
  onReview: (i: AnalysisItem) => void;
  onDelete: (i: AnalysisItem) => void;
  onEdit: (i: AnalysisItem) => void;
  onNew: (k: ItemKind) => void;
  onResolve: (i: AnalysisItem) => void;
  onUnresolve: (i: AnalysisItem) => void;
  onConvert: (i: AnalysisItem) => void;
  selectable: Set<string>;
  selected: Record<string, boolean>;
  onToggle: (i: AnalysisItem) => void;
  onGoTask: (taskId: string) => void;
}

export function ItemSection(p: SectionProps) {
  const meta = META[p.kind];
  const pending = p.items.filter((i) => i.reviewState === 'unreviewed').length;
  const secCls = p.kind === 'undecided' ? 'sec sec-undecided' : 'sec';
  const newForm = p.form && p.form.mode === 'new' && p.form.kind === p.kind ? p.form : null;
  return (
    <section className={secCls} aria-labelledby={`sec-${p.kind}`}>
      <div className="sec-head">
        <div className="top">
          <h3 id={`sec-${p.kind}`}>
            {meta.title} <span className="n">{p.items.length}개</span>
          </h3>
          {!p.confirmed && pending > 0 && <span className="pending">검토 전 {pending}개</span>}
        </div>
        <div className="desc">{meta.desc}</div>
      </div>
      {p.items.length === 0 && !newForm && <div className="sec-empty">아직 적은 내용이 없어요.</div>}
      {p.items.map((it) => (
        <ItemRow key={it.id} item={it} {...p} />
      ))}
      {newForm && (
        <div className="item">
          <div className="item-main">
            <InlineText {...p} form={newForm} placeholder={meta.placeholder} />
          </div>
        </div>
      )}
      {!p.confirmed && !newForm && (
        <button type="button" className="btn-add" onClick={() => p.onNew(p.kind)}>
          {meta.addLabel}
        </button>
      )}
    </section>
  );
}

function InlineText({
  form,
  placeholder,
  onFormChange,
  onFormCommit,
  onFormCancel,
  rows = 2,
  label,
  applyLabel = '적용',
}: Pick<SectionProps, 'onFormChange' | 'onFormCommit' | 'onFormCancel'> & {
  form: FormState;
  placeholder: string;
  rows?: number;
  label?: string;
  applyLabel?: string;
}) {
  return (
    <div className="inline-form">
      {label && <div className="label">{label}</div>}
      <textarea
        autoFocus
        className="edit-area"
        aria-label={label ?? placeholder}
        rows={rows}
        value={form.text}
        placeholder={placeholder}
        onChange={(e) => onFormChange({ text: e.target.value, error: undefined })}
        onKeyDown={(e) => {
          // 한글 입력(IME) 조합 중 Enter 는 적용하지 않는다.
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onFormCommit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onFormCancel();
          }
        }}
      />
      {form.error && (
        <div className="field-error" role="alert">
          {form.error}
        </div>
      )}
      <div className="row">
        <button type="button" className="btn btn-sm btn-apply" disabled={form.busy} onClick={onFormCommit}>
          {applyLabel}
        </button>
        <button type="button" className="btn btn-sm" onClick={onFormCancel}>
          취소
        </button>
        <span className="hint">Enter {applyLabel} · Esc 취소</span>
      </div>
    </div>
  );
}

function ItemRow({ item, ...p }: { item: AnalysisItem } & SectionProps) {
  const confirmed = p.confirmed;
  const lbl = itemLabel(item, confirmed);
  const editing = p.form && p.form.itemId === item.id ? p.form : null;
  const isReq = item.kind === 'requirement';
  const num = p.reqNumbers.get(item.id);
  const unreviewed = item.reviewState === 'unreviewed';
  const selectable = p.selectable.has(item.id);
  const hasSrc = isReq && item.quote != null && item.quoteValid;
  const canAct = !confirmed;

  return (
    <div
      className={`item${isReq ? ' req' : ''}${unreviewed && !confirmed ? ' pending' : ''}`}
      onMouseEnter={() => isReq && p.setHover(item.id)}
      onMouseLeave={() => isReq && p.setHover(null)}
      onFocus={() => isReq && p.setHover(item.id)}
      onBlur={() => isReq && p.setHover(null)}
    >
      {isReq && selectable && (
        <button
          type="button"
          role="checkbox"
          aria-checked={!!p.selected[item.id]}
          aria-label={`작업으로 만들 요구사항 선택: ${item.content}`}
          className="checkbox"
          onClick={() => p.onToggle(item)}
        >
          {p.selected[item.id] ? '✓' : ''}
        </button>
      )}
      {isReq ? (
        <span className={`marker${hasSrc ? ' src' : ''}`} aria-label={`요구사항 ${num}`}>
          {num}
        </span>
      ) : item.kind === 'question' ? (
        <span className="marker q" aria-hidden="true">
          ?
        </span>
      ) : (
        <span className="marker u" aria-hidden="true" />
      )}
      <div className="item-main">
        {editing && editing.mode === 'edit' ? (
          <InlineText {...p} form={editing} placeholder="내용을 입력해 주세요" />
        ) : (
          <div className={`item-text${isReq ? ' req' : ''}`}>{item.content}</div>
        )}

        {isReq && item.quote != null && item.quoteValid && <div className="item-sub">원문 “{item.quote}”</div>}
        {isReq && item.quote != null && !item.quoteValid && (
          <div className="item-sub warn">원문에서 근거 문장 “{item.quote}”을(를) 찾을 수 없어요. 원문이 바뀌었는지 확인해 주세요.</div>
        )}
        {isReq && item.quote == null && !item.derivedBasis && <div className="item-sub dim">원문 근거 없음 · 담당자가 추가한 항목</div>}
        {isReq && item.derivedBasis && (
          <div className="item-sub">
            근거(고객 답변·결정): {item.derivedBasis}
          </div>
        )}
        {!isReq && item.note && (
          <div className="item-sub">
            {reasonPrefix(item)}: {item.note}
          </div>
        )}

        {!isReq && item.resolution && (
          <>
            {item.resolution !== 'open' && item.resolutionText && (
              <div className="answer-box">
                <b>{item.kind === 'question' ? '고객 답변' : '결정 내용'}</b> · {item.resolutionText}
              </div>
            )}
          </>
        )}

        {editing && editing.mode === 'resolve' && (
          <InlineText
            {...p}
            form={editing}
            rows={2}
            label={item.kind === 'question' ? '고객 답변' : '결정 내용'}
            placeholder={item.kind === 'question' ? '고객에게 받은 답변을 적어 주세요' : '결정된 내용을 적어 주세요'}
            applyLabel="기록"
          />
        )}
        {editing && editing.mode === 'convert' && (
          <div className="inline-form">
            <div className="label">요구사항으로 반영</div>
            <textarea
              autoFocus
              className="edit-area"
              aria-label="요구사항 내용"
              rows={2}
              value={editing.text}
              placeholder="확정할 요구사항 내용을 입력해 주세요"
              onChange={(e) => p.onFormChange({ text: e.target.value, error: undefined })}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  p.onFormCancel();
                }
              }}
            />
            <textarea
              className="edit-area"
              aria-label="전환 근거"
              rows={2}
              value={editing.text2}
              placeholder="근거(고객 답변·결정 내용)를 적어 주세요"
              onChange={(e) => p.onFormChange({ text2: e.target.value, error: undefined })}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  p.onFormCancel();
                }
              }}
            />
            <div className="hint">
              전환한 항목은 ‘검토 전’으로 추가돼요. 원래 {item.kind === 'question' ? '질문' : '미확정 사항'}은 그대로 남아요.
            </div>
            {editing.error && (
              <div className="field-error" role="alert">
                {editing.error}
              </div>
            )}
            <div className="row">
              <button type="button" className="btn btn-sm btn-apply" disabled={editing.busy} onClick={p.onFormCommit}>
                요구사항으로 전환
              </button>
              <button type="button" className="btn btn-sm" onClick={p.onFormCancel}>
                취소
              </button>
            </div>
          </div>
        )}

        <div className="item-labels">
          <span className={`lbl ${lbl.cls}`} title={lbl.title}>
            {lbl.text}
          </span>
          {item.kind === 'undecided' && item.resolution === 'open' && <span className="lbl lbl-undecided">미확정</span>}
          {item.kind === 'question' && (
            <span className={`lbl ${item.resolution === 'answered' ? 'lbl-resolved' : 'lbl-open'}`}>
              {item.resolution === 'answered' ? '답변받음' : '미해결'}
            </span>
          )}
          {item.kind === 'undecided' && item.resolution === 'decided' && <span className="lbl lbl-resolved">결정됨</span>}
          {isReq && item.derivedFromItemId && <span className="lbl lbl-human">답변·결정에서 전환</span>}
          {isReq && item.task && (
            <button type="button" className="lbl lbl-task" onClick={() => p.onGoTask(item.task!.id)}>
              작업 생성됨 →
            </button>
          )}
          {isReq && item.task?.sourceChanged && <span className="lbl changed">작업 만든 뒤 원본이 바뀜</span>}
        </div>
      </div>

      {canAct && !editing && (
        <div className="item-actions">
          {unreviewed && (
            <button type="button" className="btn btn-sm" aria-label={`검토함으로 표시: ${item.content}`} onClick={() => p.onReview(item)}>
              검토함으로 표시
            </button>
          )}
          {!isReq && item.resolution === 'open' && (
            <button type="button" className="btn btn-sm btn-text" aria-label={`${item.kind === 'question' ? '답변' : '결정'} 기록: ${item.content}`} onClick={() => p.onResolve(item)}>
              {item.kind === 'question' ? '답변 기록' : '결정 기록'}
            </button>
          )}
          {!isReq && item.resolution && item.resolution !== 'open' && (
            <>
              <button type="button" className="btn btn-sm btn-text" aria-label={`요구사항으로 반영: ${item.content}`} onClick={() => p.onConvert(item)}>
                요구사항으로 반영
              </button>
              <button type="button" className="btn btn-sm btn-text" aria-label={`${item.kind === 'question' ? '미해결' : '미결정'}으로 바꾸기: ${item.content}`} onClick={() => p.onUnresolve(item)}>
                {item.kind === 'question' ? '미해결로' : '미결정으로'}
              </button>
            </>
          )}
          <button type="button" className="btn btn-sm btn-text" aria-label={`수정: ${item.content}`} onClick={() => p.onEdit(item)}>
            수정
          </button>
          <button type="button" className="btn btn-sm btn-text btn-danger-text" aria-label={`삭제: ${item.content}`} onClick={() => p.onDelete(item)}>
            삭제
          </button>
        </div>
      )}
    </div>
  );
}
