import { buildMockResult } from './mock-data.ts';
import type { AnalysisInput, AnalysisProvider } from './types.ts';

/** 개발·테스트에서 모의 분석의 지연과 실패를 조절한다. 제품 화면에는 이 조절 장치가 없다. */
export interface MockControls {
  delayMs: number;
  /** 다음 N 번의 분석을 실패시킨다. */
  failNext: number;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('aborted'));
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new Error('aborted'));
      },
      { once: true },
    );
  });
}

export class MockAnalysisProvider implements AnalysisProvider {
  readonly id = 'mock' as const;
  readonly label = '모의 분석 · 개발용';
  readonly isMock = true;
  readonly controls: MockControls;

  constructor(controls: Partial<MockControls> = {}) {
    this.controls = {
      delayMs: controls.delayMs ?? Number(process.env.MOCK_ANALYSIS_DELAY_MS ?? 1500),
      failNext: controls.failNext ?? 0,
    };
  }

  async analyze(input: AnalysisInput, opts: { signal: AbortSignal }): Promise<unknown> {
    if (this.controls.delayMs > 0) await sleep(this.controls.delayMs, opts.signal);
    if (this.controls.failNext > 0) {
      this.controls.failNext -= 1;
      throw new Error('모의 분석 실패(테스트용)');
    }
    return buildMockResult(input.originalText);
  }
}
