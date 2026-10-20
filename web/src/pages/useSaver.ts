import { useCallback, useRef, useState } from 'react';
import { ApiError } from '../api.ts';

export type SaveState = 'saved' | 'saving' | 'error';
export type TrackResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };

interface Queued {
  fn: () => Promise<unknown>;
  onOk?: () => void | Promise<void>;
}

/**
 * 자동 저장 상태(저장 중/저장됨/저장 실패)를 추적한다.
 * 네트워크·서버 오류(다시 시도하면 될 수 있는 실패)는 key 별로 대기열에 남겨 "다시 저장"으로 재시도한다.
 * 검증 오류(4xx)는 대기열에 넣지 않고 호출한 쪽이 메시지를 보여준다.
 */
export function useSaver() {
  const [state, setState] = useState<SaveState>('saved');
  const pending = useRef(0);
  const queue = useRef(new Map<string, Queued>());

  const settle = () => {
    if (pending.current === 0) setState(queue.current.size ? 'error' : 'saved');
  };

  const track = useCallback(async <T,>(key: string, fn: () => Promise<T>, onOk?: () => void | Promise<void>): Promise<TrackResult<T>> => {
    pending.current += 1;
    setState('saving');
    try {
      const value = await fn();
      queue.current.delete(key);
      pending.current -= 1;
      settle();
      await onOk?.();
      return { ok: true, value };
    } catch (e) {
      pending.current -= 1;
      const error = e instanceof ApiError ? e : new ApiError(0, 'network', '서버에 연결하지 못했어요.');
      if (error.retryable) queue.current.set(key, { fn, onOk });
      else queue.current.delete(key);
      settle();
      return { ok: false, error };
    }
  }, []);

  const retry = useCallback(async () => {
    const entries = Array.from(queue.current.entries());
    for (const [key, q] of entries) await track(key, q.fn, q.onOk);
  }, [track]);

  const dismiss = useCallback((key: string) => {
    queue.current.delete(key);
    if (pending.current === 0) setState(queue.current.size ? 'error' : 'saved');
  }, []);

  return { state, track, retry, dismiss };
}
