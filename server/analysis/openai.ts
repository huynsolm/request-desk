import { randomUUID } from 'node:crypto';
import { SYSTEM_PROMPT } from './prompt.ts';
import { DEFAULT_LIMITS } from './anthropic.ts';
import { ProviderError, type AnalysisInput, type AnalysisProvider, type AnalyzeOptions, type UsageLimits } from './types.ts';

// 모델 이름은 계정·시기에 따라 쓸 수 있는 것이 다르다. 거부되면 OPENAI_MODEL 로 바꾼다(→ model_unavailable 안내).
export const DEFAULT_OPENAI_MODEL = 'gpt-5-mini';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/**
 * API 에 구조화 출력으로 요청하는 JSON 스키마(strict 모드: 모든 필드 required, additionalProperties false).
 * 개수 상한 같은 제약은 두지 않고, 돌아온 값은 서버가 `AnalysisResultSchema` 와 항목별 규칙으로 다시 검증한다.
 */
const item = (second: string) => ({
  type: 'object',
  properties: { content: { type: 'string' }, [second]: { type: 'string' } },
  required: ['content', second],
  additionalProperties: false,
});
const RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'analysis_result',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        requirements: { type: 'array', items: item('quote') },
        questions: { type: 'array', items: item('note') },
        undecided: { type: 'array', items: item('note') },
      },
      required: ['requirements', 'questions', 'undecided'],
      additionalProperties: false,
    },
  },
} as const;

export interface OpenAIProviderOptions {
  /** API 키. 서버 환경 변수에서만 읽어 넘기고, 어떤 응답·로그에도 담지 않는다. */
  apiKey: string;
  model?: string;
  /** 테스트용(가짜 서버). 키가 엉뚱한 곳으로 보내지지 않도록 localhost 만 허용한다. */
  baseURL?: string;
  limits?: UsageLimits;
  /** 추론 토큰을 포함한 출력 토큰 상한. */
  maxCompletionTokens?: number;
}

function assertSafeBaseUrl(baseURL: string) {
  const host = new URL(baseURL).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') {
    throw new Error('OPENAI_BASE_URL 은 테스트용이라 localhost 만 허용돼요. (API 키가 다른 곳으로 보내지는 것을 막기 위해서예요.)');
  }
}

interface ChatCompletion {
  model?: string;
  choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { code?: string | null };
}

export class OpenAIAnalysisProvider implements AnalysisProvider {
  readonly id = 'ai' as const;
  readonly label: string;
  readonly isMock = false;
  readonly sendsDataTo = 'OpenAI';
  readonly limits: UsageLimits;
  readonly model: string;
  private readonly apiKey: string;
  private readonly url: string;
  private readonly maxCompletionTokens: number;

  constructor(opts: OpenAIProviderOptions) {
    if (!opts.apiKey) throw new Error('API 키가 없어요.');
    if (opts.baseURL) assertSafeBaseUrl(opts.baseURL);
    this.apiKey = opts.apiKey;
    this.url = `${(opts.baseURL || DEFAULT_BASE_URL).replace(/\/+$/, '')}/chat/completions`;
    this.model = opts.model || DEFAULT_OPENAI_MODEL;
    this.label = `AI 분석 · ChatGPT (${this.model})`;
    this.limits = opts.limits ?? DEFAULT_LIMITS;
    this.maxCompletionTokens = opts.maxCompletionTokens ?? 16000;
  }

  async analyze(input: AnalysisInput, opts: AnalyzeOptions): Promise<unknown> {
    // 비용·개인정보 최소화: 분석에 필요한 요청 원문만 보낸다(제목·고객명은 보내지 않는다).
    // 원문 안의 지시문이 경계를 벗어나지 못하도록, 요청마다 새로 만든 무작위 경계 문자열로 감싼다.
    const boundary = `REQUEST_${randomUUID().replace(/-/g, '')}`;
    let res: Response;
    try {
      res = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          max_completion_tokens: this.maxCompletionTokens,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: `${boundary}\n${input.originalText}\n${boundary}` },
          ],
          response_format: RESPONSE_FORMAT,
        }),
        signal: opts.signal,
        // 리다이렉트는 따라가지 않는다: 허용한 주소(localhost 검사 포함) 밖으로 원문이 다시 전송되는 것을 막는다.
        redirect: 'error',
      });
    } catch (e) {
      if (opts.signal.aborted) throw e; // 시간 초과/취소는 실행기가 판단한다
      throw new ProviderError('network', 'AI 서비스에 연결하지 못했어요. 네트워크를 확인한 뒤 다시 시도해 주세요.');
    }

    // 본문을 끝까지 받는 것(통신)과 JSON 으로 해석하는 것(형식)을 구분한다.
    // 받다가 끊기면 응답이 온전한지, 토큰을 썼는지 알 수 없으므로 통신 실패로 처리하고 사용량은 알리지 않는다.
    let raw: string;
    try {
      raw = await res.text();
    } catch (e) {
      if (opts.signal.aborted) throw e;
      throw new ProviderError('network', 'AI 서비스에 연결하지 못했어요. 네트워크를 확인한 뒤 다시 시도해 주세요.');
    }
    let json: ChatCompletion | null = null;
    try {
      json = JSON.parse(raw) as ChatCompletion;
    } catch {
      /* 본문이 JSON 이 아님 */
    }
    if (!res.ok) throw this.toProviderError(res.status, json?.error?.code ?? null);

    // 호출이 끝났으니(성공·거절·잘림 모두 토큰을 썼다) 사용량을 알린다.
    opts.reportUsage?.({
      model: json?.model || this.model,
      inputTokens: json?.usage?.prompt_tokens ?? 0,
      outputTokens: json?.usage?.completion_tokens ?? 0,
    });

    const choice = json?.choices?.[0];
    if (choice?.message?.refusal || choice?.finish_reason === 'content_filter') {
      throw new ProviderError('refused', 'AI 가 이 내용은 분석하지 않았어요. 직접 작성해 주세요.');
    }
    if (choice?.finish_reason === 'length') {
      throw new ProviderError('truncated', 'AI 응답이 길어 중간에 잘렸어요. 원문을 줄이거나 다시 시도해 주세요.');
    }
    // 응답을 해석만 하고(JSON), 구조·내용 검증은 서버(run.ts)가 직접 한다.
    const text = choice?.message?.content;
    if (typeof text !== 'string') {
      throw new ProviderError('invalid_response', '분석 결과가 올바르지 않아 반영하지 않았어요.');
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new ProviderError('invalid_response', '분석 결과가 올바르지 않아 반영하지 않았어요.');
    }
  }

  /** HTTP 상태·오류 코드만 보고 사용자에게 보여도 되는 문구로 바꾼다. 응답 본문·원래 메시지는 담지 않는다. */
  private toProviderError(status: number, code: string | null): ProviderError {
    if (status === 401 || status === 403) return new ProviderError('auth', 'AI 연결 설정(API 키)을 확인해 주세요.');
    if (code === 'insufficient_quota' || status === 402) {
      return new ProviderError('billing', 'AI 서비스 결제 상태(크레딧)를 확인해 주세요.');
    }
    if (status === 429) return new ProviderError('rate_limited', 'AI 서비스가 요청이 많다고 해요. 잠시 후 다시 시도해 주세요.');
    if (status === 404) {
      return new ProviderError('model_unavailable', '설정한 AI 모델을 사용할 수 없어요. 모델 이름(OPENAI_MODEL)을 확인해 주세요.');
    }
    if (status === 400) return new ProviderError('bad_request', 'AI 서비스가 요청을 받아들이지 않았어요.');
    if (status >= 500) {
      return new ProviderError('unavailable', 'AI 서비스가 일시적으로 응답하지 않아요. 잠시 후 다시 시도해 주세요.');
    }
    return new ProviderError('provider_error', '분석을 하지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
}
