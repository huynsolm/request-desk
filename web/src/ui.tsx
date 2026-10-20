import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { RequestStatus, TaskStatus } from '../../shared/types.ts';

export const REQ_LABEL: Record<RequestStatus, string> = { received: '접수', reviewing: '검토 중', confirmed: '확정' };
export const TASK_LABEL: Record<TaskStatus, string> = { todo: '할 일', doing: '진행 중', done: '완료' };

/** 상태는 색뿐 아니라 점 + 텍스트로 표시한다. */
export function ReqBadge({ status, small }: { status: RequestStatus; small?: boolean }) {
  return <span className={`badge b-${status}${small ? ' badge-sm' : ''}`}>{REQ_LABEL[status]}</span>;
}
export function TaskBadge({ status }: { status: TaskStatus }) {
  return <span className={`badge b-${status} badge-sm`}>{TASK_LABEL[status]}</span>;
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

/** ISO 시각 → YYYY.MM.DD (브라우저 로컬 날짜) */
export function fmtDate(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

// ───── 토스트 ─────
interface ToastState {
  text: string;
  actionLabel?: string;
  onAction?: () => void;
}
const ToastCtx = createContext<(text: string, actionLabel?: string, onAction?: () => void) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<number>(0);
  const show = useCallback((text: string, actionLabel?: string, onAction?: () => void) => {
    window.clearTimeout(timer.current);
    setToast({ text, actionLabel, onAction });
    timer.current = window.setTimeout(() => setToast(null), 5000);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="toast-wrap" role="status" aria-live="polite">
        {toast && (
          <div className="toast">
            <span>{toast.text}</span>
            {toast.actionLabel && (
              <button
                type="button"
                onClick={() => {
                  toast.onAction?.();
                  setToast(null);
                }}
              >
                {toast.actionLabel}
              </button>
            )}
          </div>
        )}
      </div>
    </ToastCtx.Provider>
  );
}

// ───── 모달/패널: Esc 닫기, 포커스 가두기, 닫히면 원래 위치로 포커스 복귀 ─────
export function Overlay({
  onClose,
  variant,
  label,
  children,
  closeOnBackdrop = true,
}: {
  onClose: () => void;
  variant: 'panel' | 'center';
  label: string;
  children: ReactNode;
  closeOnBackdrop?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const root = ref.current!;
    const focusables = () =>
      Array.from(root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(
        (el) => !el.hasAttribute('disabled'),
      );
    // 첫 입력 칸에 포커스, 없으면 첫 포커스 가능 요소
    const first = root.querySelector<HTMLElement>('input, textarea') ?? focusables()[0];
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'Tab') {
        const list = focusables();
        if (!list.length) return;
        const a = list[0];
        const z = list[list.length - 1];
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          z.focus();
        } else if (!e.shiftKey && document.activeElement === z) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    root.addEventListener('keydown', onKey);
    return () => {
      root.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      className={`overlay${variant === 'center' ? ' center' : ''}`}
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={ref} role="dialog" aria-modal="true" aria-label={label} className={variant === 'panel' ? 'panel' : 'modal'}>
        {children}
      </div>
    </div>
  );
}
