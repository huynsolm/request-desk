import { useCallback, useRef, useState } from 'react';
import { ApiError } from '../api.ts';

export type SaveState = 'saved' | 'saving' | 'error';
export type TrackResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };

export interface TrackOptions {
  /** 성공한 뒤 실행(화면 새로고침 등). 최초 저장과 재시도 모두에서 실행된다. */
  onOk?: () => void | Promise<void>;
  /**
   * 재시도 때 원래 함수 대신 실행할 동작. 입력창처럼 사용자가 실패 뒤에도 계속 고치는 경우에는
   * 실패 당시 값이 아니라 "지금 입력"을 저장해야 하므로 여기에 최신 상태를 읽는 함수를 넘긴다.
   */
  retry?: () => Promise<unknown>;
  /** true 면 다시 시도로 해결되지 않는 오류(검증·충돌 등)를 호출한 쪽이 직접 보여준다(onError 를 부르지 않음). */
  inline?: boolean;
}

interface Queued {
  retry: () => Promise<unknown>;
}

/**
 * 자동 저장 상태(저장 중/저장됨/저장 실패)를 추적한다.
 * - 네트워크·서버 오류(다시 시도하면 될 수 있는 실패)는 key 별로 대기열에 남겨 "다시 저장"으로 재시도한다.
 * - 다시 시도로 해결되지 않는 오류(4xx)는 대기열에 넣지 않고 `onError` 로 사용자에게 알린다.
 *   최초 저장이든 "다시 저장" 중이든 같은 경로를 지나므로, 재시도 중의 오류도 숨겨지지 않는다.
 * - 대기 작업이 있으면 `message` 에 마지막 안내 문구(예: 충돌 안내)를 담아 배너에서 보여줄 수 있다.
 */
export function useSaver(onError?: (e: ApiError) => void) {
  const [state, setState] = useState<SaveState>('saved');
  const [message, setMessage] = useState<string | null>(null);
  const pending = useRef(0);
  const queue = useRef(new Map<string, Queued>());
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const settle = () => {
    if (pending.current === 0) {
      setState(queue.current.size ? 'error' : 'saved');
      if (queue.current.size === 0) setMessage(null);
    }
  };

  const track = useCallback(
    async <T,>(key: string, fn: () => Promise<T>, opts: TrackOptions = {}): Promise<TrackResult<T>> => {
      pending.current += 1;
      setState('saving');
      try {
        const value = await fn();
        queue.current.delete(key);
        pending.current -= 1;
        settle();
        await opts.onOk?.();
        return { ok: true, value };
      } catch (e) {
        pending.current -= 1;
        const error = e instanceof ApiError ? e : new ApiError(0, 'network', '서버에 연결하지 못했어요.');
        if (error.retryable) {
          queue.current.set(key, { retry: opts.retry ?? (() => track(key, fn, opts)) });
          setMessage(error.code === 'network' ? null : error.message);
        } else {
          queue.current.delete(key);
          if (!opts.inline) onErrorRef.current?.(error);
        }
        settle();
        return { ok: false, error };
      }
    },
    [],
  );

  /** 대기 중인 저장을 차례로 다시 보낸다. 각 작업은 실행하는 시점의 최신 상태를 읽어야 한다. */
  const retry = useCallback(async () => {
    for (const [, q] of Array.from(queue.current.entries())) await q.retry();
  }, []);

  /** 취소·다른 입력창으로 전환처럼 더는 다시 저장할 필요가 없을 때 대기열에서 뺀다. */
  const dismiss = useCallback((key: string) => {
    queue.current.delete(key);
    if (pending.current === 0) {
      setState(queue.current.size ? 'error' : 'saved');
      if (queue.current.size === 0) setMessage(null);
    }
  }, []);

  return { state, message, track, retry, dismiss };
}
