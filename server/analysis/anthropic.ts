import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { SYSTEM_PROMPT } from './prompt.ts';
import { ProviderError, type AnalysisInput, type AnalysisProvider, type AnalyzeOptions, type UsageLimits } from './types.ts';

export const DEFAULT_MODEL = 'claude-opus-5-5';

/**
 * API 에 구조화 출력으로 요청하는 스키마. (서버의 엄격한 검증 스키마와는 별개다:
 * 여기에는 개수 상한 같은 제약을 두지 않고, 돌아온 값은 서버가 `AnalysisResultSchema` 와 항목별 규칙으로 다시 검증한다.)
 */
const ApiResultSchema = z.object({
  requirements: z.array(z.object({ content: z.string(), quote: z.string() })),
  questions: z.array(z.object({ content: z.string(), note: z.string() })),
  undecided: z.array(z.object({ content: z.string(), note: z.string() })),
});

/** 사용량 상한의 기본값(사용자가 정한 값: 하루 20회 / 한 달 300회). */
export const DEFAULT_LIMITS: UsageLimits = { daily: 20, monthly: 300 };

export interface AnthropicProviderOptions {
  /** API 키. 서버 환경 변수에서만 읽어 넘기고, 어떤 응답·로그에도 담지 않는다. */
  apiKey: string;
  model?: string;
  /** 테스트용(가짜 서버). 키가 엉뚱한 곳으로 보내지지 않도록 localhost 만 허용한다. */
  baseURL?: string;
  limits?: UsageLimits;
  maxTokens?: number;
}

function assertSafeBaseUrl(baseURL: string) {
  const host = new URL(baseURL).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') {
    throw new Error('ANTHROPIC_BASE_URL 은 테스트용이라 localhost 만 허용돼요. (API 키가 다른 곳으로 보내지는 것을 막기 위해서예요.)');
  }
}

export class AnthropicAnalysisProvider implements AnalysisProvider {
  readonly id = 'ai' as const;
  readonly label: string;
  readonly isMock = false;
  readonly sendsDataTo = 'Anthropic';
  readonly limits: UsageLimits;
  readonly model: string;
  private readonly client: Anthropic;
  private readonly maxTokens: number;

  constructor(opts: AnthropicProviderOptions) {
    if (!opts.apiKey) throw new Error('API 키가 없어요.');
    if (opts.baseURL) assertSafeBaseUrl(opts.baseURL);
    this.model = opts.model || DEFAULT_MODEL;
    this.label = `AI 분석 · Claude (${this.model})`;
    this.limits = opts.limits ?? DEFAULT_LIMITS;
    this.maxTokens = opts.maxTokens ?? 16000;
    // 자동 재시도는 1회만: 재시도마다 호출·지연이 늘어나므로 비용 상한(횟수 기준)과 시간 초과를 예측 가능하게 한다.
    this.client = new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseURL, maxRetries: 1 });
  }

  async analyze(input: AnalysisInput, opts: AnalyzeOptions): Promise<unknown> {
    // 비용·개인정보 최소화: 분석에 필요한 요청 원문만 보낸다(제목·고객명은 보내지 않는다).
    // 원문 안의 지시문이 경계를 벗어나지 못하도록, 요청마다 새로 만든 무작위 경계 문자열로 감싼다.
    const boundary = `REQUEST_${randomUUID().replace(/-/g, '')}`;
    let response;
    try {
      response = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: this.maxTokens,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: `${boundary}\n${input.originalText}\n${boundary}` }],
          output_config: { format: zodOutputFormat(ApiResultSchema) },
        },
        { signal: opts.signal },
      );
    } catch (e) {
      throw this.toProviderError(e, opts.signal);
    }

    // 호출이 끝났으니(성공·거절·잘림 모두 토큰을 썼다) 사용량을 알린다.
    opts.reportUsage?.({
      model: response.model || this.model,
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    });

    if (response.stop_reason === 'refusal') {
      throw new ProviderError('refused', 'AI 가 이 내용은 분석하지 않았어요. 직접 작성해 주세요.');
    }
    if (response.stop_reason === 'max_tokens') {
      throw new ProviderError('truncated', 'AI 응답이 길어 중간에 잘렸어요. 원문을 줄이거나 다시 시도해 주세요.');
    }
    // 응답을 해석만 하고(JSON), 구조·내용 검증은 서버(run.ts)가 직접 한다.
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') {
      throw new ProviderError('invalid_response', '분석 결과가 올바르지 않아 반영하지 않았어요.');
    }
    try {
      return JSON.parse(text.text) as unknown;
    } catch {
      throw new ProviderError('invalid_response', '분석 결과가 올바르지 않아 반영하지 않았어요.');
    }
  }

  /** SDK 오류를 사용자에게 보여도 되는 문구로만 바꾼다. 원래 오류 메시지·응답 본문은 담지 않는다. */
  private toProviderError(e: unknown, signal: AbortSignal): unknown {
    if (signal.aborted) return e; // 시간 초과/취소는 실행기가 판단한다
    if (e instanceof Anthropic.APIUserAbortError) return e;
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      return new ProviderError('auth', 'AI 연결 설정(API 키)을 확인해 주세요.');
    }
    if (e instanceof Anthropic.RateLimitError) {
      return new ProviderError('rate_limited', 'AI 서비스가 요청이 많다고 해요. 잠시 후 다시 시도해 주세요.');
    }
    if (e instanceof Anthropic.NotFoundError) {
      return new ProviderError('model_unavailable', '설정한 AI 모델을 사용할 수 없어요. 모델 이름(ANTHROPIC_MODEL)을 확인해 주세요.');
    }
    if (e instanceof Anthropic.BadRequestError) {
      return new ProviderError('bad_request', 'AI 서비스가 요청을 받아들이지 않았어요.');
    }
    if (e instanceof Anthropic.APIConnectionError) {
      return new ProviderError('network', 'AI 서비스에 연결하지 못했어요. 네트워크를 확인한 뒤 다시 시도해 주세요.');
    }
    if (e instanceof Anthropic.APIError) {
      if (e.status === 402) return new ProviderError('billing', 'AI 서비스 결제 상태를 확인해 주세요.');
      if (typeof e.status === 'number' && e.status >= 500) {
        return new ProviderError('unavailable', 'AI 서비스가 일시적으로 응답하지 않아요. 잠시 후 다시 시도해 주세요.');
      }
    }
    return new ProviderError('provider_error', '분석을 하지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
}
