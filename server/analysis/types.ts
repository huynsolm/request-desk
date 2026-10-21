import { z } from 'zod';

export interface AnalysisInput {
  title: string;
  customerName: string;
  originalText: string;
}

/** 제공자가 알려 주는 사용량(비용 확인용). 모르면 알리지 않아도 된다. */
export interface UsageReport {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface AnalyzeOptions {
  signal: AbortSignal;
  /** 호출이 끝나면(성공이든 실패든 사용량을 알게 되면) 실행 기록에 남기도록 알린다. */
  reportUsage?: (u: UsageReport) => void;
}

/** 제공자가 정해 두는 호출 횟수 상한. 실제 비용이 드는 제공자에만 둔다. */
export interface UsageLimits {
  daily: number;
  monthly: number;
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
  /** 요청 원문을 보내는 외부 서비스 이름(없으면 null). 화면에 "…로 전송돼요" 안내를 띄우는 데 쓴다. */
  readonly sendsDataTo?: string | null;
  /** 호출 횟수 상한(서버가 DB 의 분석 기록으로 센다). 없으면 제한하지 않는다. */
  readonly limits?: UsageLimits;
  analyze(input: AnalysisInput, opts: AnalyzeOptions): Promise<unknown>;
}

/**
 * 제공자가 사용자에게 보여도 되는 안전한 사유만 담아 던지는 오류.
 * (제공자의 원래 오류 메시지·응답 본문·키 등은 담지 않는다. 서버는 이 code/message 만 노출한다.)
 */
export class ProviderError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
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
