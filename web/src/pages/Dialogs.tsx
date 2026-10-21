import { useEffect, useState } from 'react';
import { api, ApiError } from '../api.ts';
import type { ConfirmPreview, Confirmation, RequestDetail } from '../../../shared/types.ts';
import { checkCriterion } from '../../../shared/validation.ts';
import { Overlay, Spinner } from '../ui.tsx';

/** 확정 확인창 — 사람이 최종 승인하는 곳. 포함/제외 개수를 보여주고, 서버가 알려준 확정 불가 사유를 표시한다. */
export function ConfirmDialog({
  requestId,
  onClose,
  onConfirmed,
}: {
  requestId: string;
  onClose: () => void;
  onConfirmed: (d: RequestDetail) => void;
}) {
  const [preview, setPreview] = useState<ConfirmPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setPreview(null);
    api
      .confirmPreview(requestId)
      .then(setPreview)
      .catch((e: ApiError) => setError(e.message));
  };
  useEffect(load, [requestId]);

  async function approve() {
    if (!preview || busy) return;
    setBusy(true);
    setError(null);
    try {
      const d = await api.confirm(requestId, preview.contentSeq);
      onConfirmed(d);
    } catch (e) {
      const err = e as ApiError;
      setError(err.message);
      if (err.code === 'stale_confirmation') load(); // 최신 내용으로 다시 확인
    } finally {
      setBusy(false);
    }
  }

  const blocked = !preview || preview.blockers.length > 0;
  return (
    <Overlay variant="center" label="요구사항 확정" onClose={onClose} closeOnBackdrop={!busy}>
      <div className="modal-head">
        <h2>요구사항을 확정할까요?</h2>
        <p>확정 내용을 확인한 뒤 직접 승인해 주세요.</p>
      </div>
      <div className="modal-body">
        {!preview && !error && (
          <div className="hint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Spinner /> 확정 내용을 확인하고 있어요…
          </div>
        )}
        {preview && (
          <>
            <div className="sub-card">
              <div style={{ fontWeight: 700 }}>확정되는 요구사항 {preview.included.length}개</div>
              <ul className="summary-list">
                {preview.included.map((i) => (
                  <li key={i.id}>{i.content}</li>
                ))}
              </ul>
            </div>
            <div className="dashed-note">
              <strong>작업 대상에서 제외되는 내용</strong> · 확인할 질문 {preview.excludedQuestions}개(미해결 {preview.unresolvedQuestions}개)와 미확정 사항{' '}
              {preview.excludedUndecided}개(미결정 {preview.unresolvedUndecided}개)는 확정 기록에 남지만 작업으로 만들 수 없어요. 고객 답변을 받아 요구사항으로 반영한 뒤 다시 확정해 주세요.
            </div>
            <div className="hint">
              확정하면 분석 항목 편집이 잠겨요. 바꾸려면 ‘다시 검토하기’로 새 검토 버전을 시작해요. 작업은 확정 후 다음 단계에서 따로 만들어요.
            </div>
            {preview.blockers.length > 0 && (
              <div className="notice notice-err" role="alert">
                <strong>지금은 확정할 수 없어요.</strong>
                <ul className="summary-list" style={{ marginTop: 6 }}>
                  {preview.blockers.map((b) => (
                    <li key={b.code}>{b.message}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
        {error && (
          <div className="notice notice-err" role="alert">
            {error}
          </div>
        )}
      </div>
      <div className="modal-foot">
        <button type="button" className="btn" onClick={onClose}>
          취소
        </button>
        <button type="button" className="btn btn-primary btn-lg" disabled={blocked || busy} onClick={approve}>
          {busy ? (
            <>
              <Spinner />
              확정 중…
            </>
          ) : (
            '확정하기'
          )}
        </button>
      </div>
    </Overlay>
  );
}

/** 다시 검토하기 — 새 검토 버전을 시작한다는 사실을 알리고 확인받는다. */
export function ReopenDialog({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Overlay variant="center" label="다시 검토하기" onClose={onClose}>
      <div className="modal-head">
        <h2>새 검토 버전을 시작할까요?</h2>
        <p>이전 확정 기록과 이미 만든 작업은 그대로 남아요. 다시 확정하기 전까지 요청 상태는 ‘검토 중’이 돼요.</p>
      </div>
      <div className="modal-foot">
        <button type="button" className="btn" onClick={onClose}>
          취소
        </button>
        <button
          type="button"
          className="btn btn-primary btn-lg"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
            } finally {
              setBusy(false);
            }
          }}
        >
          다시 검토하기
        </button>
      </div>
    </Overlay>
  );
}

interface Draft {
  confirmationItemId: string;
  requirement: string;
  title: string;
  description: string;
  criteriaText: string;
}

/** 작업 만들기 확인 모달 — 제목·설명·완료 조건을 확인·편집한 뒤 만든다. 완료 조건은 비어 있는 채로 시작한다. */
export function TaskModal({
  request,
  confirmation,
  requirements,
  onClose,
  onCreated,
}: {
  request: RequestDetail['request'];
  confirmation: Confirmation;
  requirements: { sourceItemId: string; confirmationItemId: string; content: string }[];
  onClose: () => void;
  onCreated: (created: { id: string }[], existingCount: number) => void;
}) {
  const [drafts, setDrafts] = useState<Draft[]>(
    requirements.map((r) => ({ confirmationItemId: r.confirmationItemId, requirement: r.content, title: r.content, description: '', criteriaText: '' })),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);

  const patch = (i: number, p: Partial<Draft>) => {
    setDrafts((ds) => ds.map((d, idx) => (idx === i ? { ...d, ...p } : d)));
    setErrors((e) => {
      const n = { ...e };
      delete n[`tasks.${i}.title`];
      delete n[`tasks.${i}.criteria`];
      return n;
    });
  };

  async function submit() {
    if (busy) return;
    const errs: Record<string, string> = {};
    drafts.forEach((d, i) => {
      if (!d.title.trim()) errs[`tasks.${i}.title`] = '작업 제목을 입력해 주세요.';
      const lines = d.criteriaText.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length === 0) errs[`tasks.${i}.criteria`] = '완료 조건을 한 줄 이상 적어 주세요.';
      for (const l of lines) {
        const e = checkCriterion(l);
        if (e) {
          errs[`tasks.${i}.criteria`] = e;
          break;
        }
      }
    });
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setFail(null);
    try {
      const res = await api.createTasks(request.id, {
        tasks: drafts.map((d) => ({
          confirmationItemId: d.confirmationItemId,
          title: d.title.trim(),
          description: d.description.trim() || undefined,
          criteria: d.criteriaText.split('\n').map((l) => l.trim()).filter(Boolean),
        })),
      });
      onCreated(res.created, res.existing.length);
    } catch (e) {
      const err = e as ApiError;
      if (err.fieldErrors) setErrors(err.fieldErrors);
      setFail(
        err.retryable
          ? '작업을 만들지 못했어요. 입력한 내용은 그대로 남아 있어요. 잠시 후 다시 시도해 주세요.'
          : err.message,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay variant="center" label="작업 만들기" onClose={onClose} closeOnBackdrop={!busy}>
      <div className="modal-head">
        <h2>작업 만들기</h2>
        <p>확정한 요구사항 {drafts.length}개로 작업을 만들어요. 만들기 전에 제목과 완료 조건을 확인해 주세요.</p>
      </div>
      <div className="modal-body">
        {drafts.map((d, i) => (
          <div className="sub-card" key={d.confirmationItemId}>
            <div className="req-line">
              <span className="lbl lbl-confirmed">확정</span>
              <span>요구사항: {d.requirement}</span>
            </div>
            <div className="field">
              <label htmlFor={`tm-title-${i}`}>작업 제목</label>
              <input
                id={`tm-title-${i}`}
                className={`input${errors[`tasks.${i}.title`] ? ' is-error' : ''}`}
                value={d.title}
                onChange={(e) => patch(i, { title: e.target.value })}
                aria-invalid={!!errors[`tasks.${i}.title`]}
              />
              {errors[`tasks.${i}.title`] && <div className="field-error">{errors[`tasks.${i}.title`]}</div>}
            </div>
            <div className="field">
              <label htmlFor={`tm-desc-${i}`}>
                설명 <span className="hint">· 비워 두면 요청과 요구사항을 적은 기본 설명이 들어가요</span>
              </label>
              <textarea
                id={`tm-desc-${i}`}
                className="textarea"
                rows={2}
                value={d.description}
                onChange={(e) => patch(i, { description: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor={`tm-crit-${i}`}>
                완료 조건 <span className="hint">· 한 줄에 하나씩, 확인할 수 있는 문장으로</span>
              </label>
              <textarea
                id={`tm-crit-${i}`}
                className={`textarea${errors[`tasks.${i}.criteria`] ? ' is-error' : ''}`}
                rows={3}
                value={d.criteriaText}
                placeholder={'예: 고객이 홈페이지에서 예약 가능한 날짜를 볼 수 있다'}
                onChange={(e) => patch(i, { criteriaText: e.target.value })}
                aria-invalid={!!errors[`tasks.${i}.criteria`]}
              />
              {errors[`tasks.${i}.criteria`] && <div className="field-error">{errors[`tasks.${i}.criteria`]}</div>}
            </div>
          </div>
        ))}
        <div className="dashed-note">
          <strong>작업에 포함되지 않는 내용</strong> · 확인할 질문 {confirmation.excludedQuestions}개와 미확정 사항 {confirmation.excludedUndecided}개는 고객 답변을 받아 요구사항으로 확정한 뒤에 작업으로 만들 수 있어요.
        </div>
        {fail && (
          <div className="notice notice-err" role="alert">
            {fail}
          </div>
        )}
      </div>
      <div className="modal-foot">
        <button type="button" className="btn" onClick={onClose}>
          취소
        </button>
        <button type="button" className="btn btn-primary btn-lg" disabled={busy} onClick={submit}>
          {busy ? (
            <>
              <Spinner />
              만드는 중…
            </>
          ) : (
            `작업 ${drafts.length}개 만들기`
          )}
        </button>
      </div>
    </Overlay>
  );
}

/** 다시 분석 확인창 — 기존 항목(사람이 고치거나 지운 것 포함)은 그대로 두고 새 제안만 추가한다는 사실을 알리고 확인받는다. */
export function ReanalyzeDialog({
  itemCount,
  isMock,
  sendsDataTo,
  busy,
  onClose,
  onConfirm,
}: {
  itemCount: number;
  isMock: boolean;
  sendsDataTo: string | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Overlay variant="center" label="다시 분석하기" onClose={onClose} closeOnBackdrop={!busy}>
      <div className="modal-head">
        <h2>다시 분석할까요?</h2>
        <p>이미 분석 항목이 {itemCount}개 있어요.</p>
      </div>
      <div className="modal-body">
        <div className="dashed-note">
          <strong>기존 항목은 그대로 두고</strong>, 새 제안만 ‘검토 전’으로 추가해요. 직접 고치거나 검토한 항목, 답변·결정을 기록한 항목, 삭제한 항목은 건드리지 않고, 이미 있는 제안과 같은 것은 다시 만들지 않아요.
        </div>
        {sendsDataTo && (
          <div className="hint" data-testid="reanalyze-send-notice">
            요청 원문이 {sendsDataTo}로 다시 전송되고, AI 호출 1회로 세어져요.
          </div>
        )}
        {isMock && (
          <div className="hint">모의 분석은 같은 샘플 결과를 돌려주므로 새로 추가되는 제안이 없을 수도 있어요.</div>
        )}
      </div>
      <div className="modal-foot">
        <button type="button" className="btn" onClick={onClose}>
          취소
        </button>
        <button type="button" className="btn btn-primary btn-lg" disabled={busy} onClick={onConfirm}>
          {busy ? (
            <>
              <Spinner />
              시작하는 중…
            </>
          ) : (
            '다시 분석하기'
          )}
        </button>
      </div>
    </Overlay>
  );
}
