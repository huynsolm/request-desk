// 실제 AI API 연결 확인용 스모크(호출 1회, 비용 발생). 사용법: .env 에 ANALYSIS_PROVIDER(ai 또는 openai)와 해당 키를 직접 넣은 뒤 `npm run ai:smoke`.
// 개발 DB 는 건드리지 않는다(메모리 DB). 키 값은 출력하지 않는다.
import '../server/config.ts';
import { AnthropicAnalysisProvider } from '../server/analysis/anthropic.ts';
import { OpenAIAnalysisProvider } from '../server/analysis/openai.ts';
import { AnalysisResultSchema, ProviderError } from '../server/analysis/types.ts';

const name = process.env.ANALYSIS_PROVIDER === 'openai' ? 'openai' : 'ai';
const keyName = name === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
const apiKey = process.env[keyName];
if (!apiKey) {
  console.error(`${keyName} 가 없어요. 프로젝트 루트의 .env 파일에 직접 넣어 주세요(.env.example 참고).`);
  process.exit(1);
}
const ORIGINAL = '홈페이지에서 촬영 예약을 받았으면 좋겠어요. 가능한 날짜를 보고 신청하게 하고, 예약이 들어오면 제가 확인할 수 있으면 좋겠어요.';
const provider =
  name === 'openai'
    ? new OpenAIAnalysisProvider({ apiKey, model: process.env.OPENAI_MODEL || undefined })
    : new AnthropicAnalysisProvider({ apiKey, model: process.env.ANTHROPIC_MODEL || undefined });
console.log(`모델: ${provider.model} — 샘플 원문 1건을 ${provider.sendsDataTo} 로 보냅니다(호출 1회).`);

let usage: { model: string; inputTokens: number; outputTokens: number } | null = null;
try {
  const raw = await provider.analyze(
    { title: '스모크', customerName: '스모크', originalText: ORIGINAL },
    { signal: AbortSignal.timeout(120000), reportUsage: (u) => (usage = u) },
  );
  const parsed = AnalysisResultSchema.safeParse(raw);
  if (!parsed.success) {
    console.error('실패: 응답 형식이 기대와 달라요.');
    process.exit(2);
  }
  const r = parsed.data;
  const original = ORIGINAL;
  const badQuotes = r.requirements.filter((x) => !original.includes(x.quote)).length;
  console.log(`성공: 요구사항 ${r.requirements.length} · 질문 ${r.questions.length} · 미확정 ${r.undecided.length} (원문에 없는 인용 ${badQuotes}개)`);
  console.log(`사용량: ${JSON.stringify(usage)}`);
  for (const x of r.requirements) console.log(` - [요구사항] ${x.content}  ← “${x.quote}”`);
} catch (e) {
  console.error(`실패: ${e instanceof ProviderError ? `${e.code} — ${e.message}` : '알 수 없는 오류'}`);
  if (usage) console.error(`사용량: ${JSON.stringify(usage)}`);
  process.exit(3);
}
