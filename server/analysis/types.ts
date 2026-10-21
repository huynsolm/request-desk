import { z } from 'zod';

export interface AnalysisInput {
  title: string;
  customerName: string;
  originalText: string;
}

/**
 * 분석 제공자 인터페이스. 실제 AI 와 모의 분석은 이 인터페이스를 구현하고 서로 교체할 수 있다.
 * 제공자는 "아직 검증되지 않은 값(unknown)" 을 돌려주고, 서버가 아래 스키마와 규칙으로 직접 검증한다.
 * (제공자가 검증을 건너뛰거나 잘못된 값을 돌려주어도 DB 에 들어가지 못하게 하기 위해서다.)
 */
export interface AnalysisProvider {
  readonly id: 'mock' | 'ai';
  readonly label: string;
  /** true 면 화면에 "모의 분석 · 개발용" 임을 항상 표시한다. */
  readonly isMock: boolean;
  analyze(input: AnalysisInput, opts: { signal: AbortSignal }): Promise<unknown>;
}

const Q = z.object({ content: z.string(), note: z.string().optional() }).strict();

/** 분석 결과의 기대 형태. 이 밖의 필드·형태는 모두 거부한다. */
export const AnalysisResultSchema = z
  .object({
    requirements: z.array(z.object({ content: z.string(), quote: z.string() }).strict()).max(50),
    questions: z.array(Q).max(50),
    undecided: z.array(Q).max(50),
  })
  .strict();

export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
