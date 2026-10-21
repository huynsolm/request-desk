import { MockAnalysisProvider } from './mock.ts';
import type { AnalysisProvider } from './types.ts';

/**
 * 설정(ANALYSIS_PROVIDER)에 따라 분석 제공자를 고른다.
 * 실제 AI 제공자는 3단계(제공자·인증 방식·비용 확인 후)에서 이 자리에 추가한다. 키는 서버 환경 변수로만 읽는다.
 */
export function createProvider(name: string): AnalysisProvider {
  switch (name) {
    case 'mock':
      return new MockAnalysisProvider();
    case 'ai':
      throw new Error('실제 AI 분석 제공자는 아직 구현되지 않았어요(3단계). ANALYSIS_PROVIDER=mock 을 사용하세요.');
    default:
      throw new Error(`알 수 없는 분석 제공자: ${name}`);
  }
}
