import { useRef, useState } from 'react';
import { ApiError } from '../api.ts';
import { Overlay, Spinner } from '../ui.tsx';
import { checkCustomer, checkOriginal, checkTitle } from '../../../shared/validation.ts';

export interface PanelValues {
  title: string;
  customerName: string;
  originalText: string;
}

/** 새 요청 등록 / 요청 정보 수정 슬라이드 패널 */
export function RequestPanel({
  mode,
  initial,
  hasAnalysis,
  confirmed,
  onSubmit,
  onClose,
}: {
  mode: 'new' | 'edit';
  initial: PanelValues;
  hasAnalysis: boolean;
  confirmed: boolean;
  onSubmit: (v: PanelValues) => Promise<void>;
  onClose: () => void;
}) {
  const [v, setV] = useState<PanelValues>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof PanelValues, string>>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [retryMode, setRetryMode] = useState(false);
  const refs = {
    title: useRef<HTMLInputElement>(null),
    customerName: useRef<HTMLInputElement>(null),
    originalText: useRef<HTMLTextAreaElement>(null),
  };

  function set<K extends keyof PanelValues>(k: K, val: string) {
    setV((p) => ({ ...p, [k]: val }));
    if (errors[k]) setErrors((p) => ({ ...p, [k]: undefined }));
  }

  async function submit() {
    if (saving) return;
    const next = {
      title: checkTitle(v.title) ?? undefined,
      customerName: checkCustomer(v.customerName) ?? undefined,
      originalText: checkOriginal(v.originalText) ?? undefined,
    };
    setErrors(next);
    const firstBad = (['title', 'customerName', 'originalText'] as const).find((k) => next[k]);
    if (firstBad) {
      refs[firstBad].current?.focus();
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await onSubmit({ title: v.title.trim(), customerName: v.customerName.trim(), originalText: v.originalText });
    } catch (e) {
      // 입력값(v)은 그대로 남긴다.
      if (e instanceof ApiError && e.fieldErrors && Object.keys(e.fieldErrors).length) {
        setErrors(e.fieldErrors as any);
      } else if (e instanceof ApiError && !e.retryable) {
        setSaveError(e.message);
      } else {
        setSaveError('저장하지 못했어요. 입력한 내용은 그대로 남아 있어요. 잠시 후 다시 시도해 주세요.');
        setRetryMode(true);
      }
    } finally {
      setSaving(false);
    }
  }

  const heading = mode === 'new' ? '새 요청 등록' : '요청 정보 수정';
  return (
    <Overlay variant="panel" label={heading} onClose={onClose}>
      <div className="panel-head">
        <h2>{heading}</h2>
        <button type="button" className="icon-btn" aria-label="닫기" onClick={onClose}>
          ×
        </button>
      </div>
      <form
        style={{ display: 'contents' }}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="panel-body">
          {saveError && (
            <div className="notice notice-err" role="alert">
              {saveError.startsWith('저장하지 못했어요') ? (
                <>
                  <strong>저장하지 못했어요.</strong> 입력한 내용은 그대로 남아 있어요. 잠시 후 다시 시도해 주세요.
                </>
              ) : (
                saveError
              )}
            </div>
          )}
          {mode === 'new' && <div className="notice">고객이 보낸 내용을 고치지 말고 그대로 붙여 넣어 주세요.</div>}
          <div className="field">
            <label htmlFor="rp-title">요청 제목</label>
            <input
              id="rp-title"
              ref={refs.title}
              className={`input${errors.title ? ' is-error' : ''}`}
              value={v.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="예: 홈페이지 예약 기능 추가"
              aria-invalid={!!errors.title}
              aria-describedby={errors.title ? 'rp-title-err' : undefined}
              required
            />
            {errors.title && (
              <div id="rp-title-err" className="field-error">
                {errors.title}
              </div>
            )}
          </div>
          <div className="field">
            <label htmlFor="rp-customer">고객명</label>
            <input
              id="rp-customer"
              ref={refs.customerName}
              className={`input${errors.customerName ? ' is-error' : ''}`}
              value={v.customerName}
              onChange={(e) => set('customerName', e.target.value)}
              placeholder="예: 모닝 스튜디오"
              aria-invalid={!!errors.customerName}
              aria-describedby={errors.customerName ? 'rp-customer-err' : undefined}
              required
            />
            {errors.customerName && (
              <div id="rp-customer-err" className="field-error">
                {errors.customerName}
              </div>
            )}
          </div>
          <div className="field">
            <label htmlFor="rp-original">요청 원문</label>
            <textarea
              id="rp-original"
              ref={refs.originalText}
              className={`textarea${errors.originalText ? ' is-error' : ''}`}
              rows={9}
              value={v.originalText}
              onChange={(e) => set('originalText', e.target.value)}
              placeholder="메신저나 이메일로 받은 내용을 그대로 붙여 넣어 주세요."
              aria-invalid={!!errors.originalText}
              aria-describedby={errors.originalText ? 'rp-original-err' : undefined}
              required
            />
            {errors.originalText && (
              <div id="rp-original-err" className="field-error">
                {errors.originalText}
              </div>
            )}
            {mode === 'edit' && confirmed && (
              <div className="hint" style={{ color: 'var(--warn-text)' }}>
                원문을 바꾸면 새 검토 버전이 시작돼요. 기존 확정 기록과 만든 작업은 그대로 남고, 작업에는 ‘원본 변경됨’이 표시돼요.
              </div>
            )}
            {mode === 'edit' && !confirmed && hasAnalysis && (
              <div className="hint" style={{ color: 'var(--warn-text)' }}>
                원문을 바꿔도 기존 분석 결과는 자동으로 바뀌지 않아요. 필요한 항목은 직접 수정해 주세요.
              </div>
            )}
          </div>
        </div>
        <div className="panel-foot">
          <button type="button" className="btn" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="btn btn-primary btn-lg" disabled={saving}>
            {saving ? (
              <>
                <Spinner />
                저장 중…
              </>
            ) : retryMode ? (
              '다시 시도'
            ) : mode === 'new' ? (
              '등록하기'
            ) : (
              '저장하기'
            )}
          </button>
        </div>
      </form>
    </Overlay>
  );
}
