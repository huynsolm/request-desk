import type { AnalysisResult } from './types.ts';

// 기준 디자인(README)과 사용자 지시 §8 의 샘플. 모의 분석과 시드가 같은 데이터를 쓴다.
// 주의: 실시간 조회·결제·승인/반려·CSV 같은 것을 원문에 명시된 사실(요구사항)로 넣지 않는다.
export const MORNING_ORIGINAL =
  '홈페이지에서 촬영 예약을 받았으면 좋겠어요. 가능한 날짜를 보고 신청하게 하고, 예약이 들어오면 제가 확인할 수 있으면 좋겠어요.';

export const MORNING_ANALYSIS = {
  reqs: [
    { content: '예약 가능한 날짜 조회', quote: '가능한 날짜를 보고' },
    { content: '고객의 촬영 예약 신청', quote: '홈페이지에서 촬영 예약을 받았으면 좋겠어요' },
    { content: '운영자의 예약 내역 확인', quote: '예약이 들어오면 제가 확인할 수 있으면 좋겠어요' },
  ],
  questions: [
    { content: '촬영 상품마다 소요 시간이 다른가요?', note: '날짜 단위로 받을지, 시간 단위로 받을지 정하는 데 필요해요.' },
    {
      content: '예약 즉시 확정인가요, 운영자 승인 후 확정인가요?',
      note: '‘제가 확인할 수 있으면’이 단순 조회인지 승인 절차인지 원문만으로는 알 수 없어요.',
    },
    { content: '결제가 필요한가요?', note: '원문에 결제 언급이 없어요. 답변 전까지 기능에 넣지 않아요.' },
  ],
  unknowns: [
    { content: '로그인 필요 여부', note: '예약자 정보를 어떻게 받을지 정해지지 않았어요.' },
    { content: '취소와 변경 규칙', note: '원문에 언급이 없어요.' },
    { content: '예약 알림 방식', note: '‘확인할 수 있으면’이 알림까지 뜻하는지 정해지지 않았어요.' },
  ],
};

/**
 * 모의 분석이 돌려주는 고정 결과. 실제 AI 분석이 아니다(화면에도 "모의 분석 · 개발용"으로 표시한다).
 * - 모닝 스튜디오 샘플 원문이면 샘플 분석(§8)을 그대로 돌려준다.
 * - 그 밖의 원문은 문장 단위로 쪼갠 요구사항(각 문장이 곧 근거 인용문)과 일반 질문·미확정 사항을 돌려준다.
 *   문장을 그대로 쓰므로 원문에 없는 기능을 만들어 내지 않는다.
 */
export function buildMockResult(originalText: string): AnalysisResult {
  if (originalText.trim() === MORNING_ORIGINAL) {
    return {
      requirements: MORNING_ANALYSIS.reqs.map((r) => ({ content: r.content, quote: r.quote })),
      questions: MORNING_ANALYSIS.questions.map((q) => ({ content: q.content, note: q.note })),
      undecided: MORNING_ANALYSIS.unknowns.map((u) => ({ content: u.content, note: u.note })),
    };
  }
  const sentences = originalText
    .split(/(?<=[.!?。])\s+|\n+/)
    .map((s) => s.trim().replace(/[.!?。]+$/, '').trim())
    .filter(Boolean)
    .slice(0, 4);
  return {
    requirements: sentences.map((s) => ({ content: s, quote: s })),
    questions: [
      { content: '원하는 완료 시점이 있나요?', note: '원문에 일정 언급이 없어요.' },
      { content: '참고할 만한 사이트나 예시가 있나요?', note: '결과물의 형태를 구체화하는 데 필요해요.' },
    ],
    undecided: [{ content: '적용할 페이지와 기기 범위', note: '원문만으로는 범위를 특정할 수 없어요.' }],
  };
}
