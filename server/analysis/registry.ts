import { AnthropicAnalysisProvider, DEFAULT_LIMITS } from './anthropic.ts';
import { MockAnalysisProvider } from './mock.ts';
import { OpenAIAnalysisProvider } from './openai.ts';
import type { AnalysisProvider } from './types.ts';

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} 는 1 이상의 정수여야 해요. (현재 값: ${raw})`);
  return n;
}

/**
 * 설정(ANALYSIS_PROVIDER)에 따라 분석 제공자를 고른다.
 * - mock: 모의 분석(개발용, 키 불필요)
 * - ai: Anthropic Claude API. 키는 서버 환경 변수 ANTHROPIC_API_KEY(.env)로만 읽는다.
 * - openai: OpenAI(ChatGPT) API. 키는 서버 환경 변수 OPENAI_API_KEY(.env)로만 읽는다.
 */
export function createProvider(name: string): AnalysisProvider {
  switch (name) {
    case 'mock':
      return new MockAnalysisProvider();
    case 'ai': {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error(
          'ANALYSIS_PROVIDER=ai 인데 ANTHROPIC_API_KEY 가 없어요. 서버의 .env 파일에 직접 넣어 주세요(.env.example 참고). 키는 화면·저장소·대화에 올리지 마세요.',
        );
      }
      return new AnthropicAnalysisProvider({
        apiKey,
        model: process.env.ANTHROPIC_MODEL || undefined,
        baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
        limits: {
          daily: positiveInt('AI_DAILY_LIMIT', DEFAULT_LIMITS.daily),
          monthly: positiveInt('AI_MONTHLY_LIMIT', DEFAULT_LIMITS.monthly),
        },
      });
    }
    case 'openai': {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error(
          'ANALYSIS_PROVIDER=openai 인데 OPENAI_API_KEY 가 없어요. 서버의 .env 파일에 직접 넣어 주세요(.env.example 참고). 키는 화면·저장소·대화에 올리지 마세요.',
        );
      }
      return new OpenAIAnalysisProvider({
        apiKey,
        model: process.env.OPENAI_MODEL || undefined,
        baseURL: process.env.OPENAI_BASE_URL || undefined,
        limits: {
          daily: positiveInt('AI_DAILY_LIMIT', DEFAULT_LIMITS.daily),
          monthly: positiveInt('AI_MONTHLY_LIMIT', DEFAULT_LIMITS.monthly),
        },
      });
    }
    default:
      throw new Error(`알 수 없는 분석 제공자: ${name} (mock, ai, openai)`);
  }
}
