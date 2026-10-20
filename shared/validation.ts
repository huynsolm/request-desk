// 서버와 웹이 함께 쓰는 입력 검증. 서버가 최종 판단하고, 웹은 같은 규칙으로 미리 안내만 한다.

export const MIN_ORIGINAL_NONSPACE = 10;
export const MIN_ORIGINAL_LETTERS = 4;
// 입력 길이 상한(글자 수). 비정상적으로 큰 붙여넣기를 막는다.
export const MAX = { title: 200, customer: 100, original: 20000, item: 1000, note: 2000, criterion: 500, taskTitle: 200, description: 5000 } as const;
export const tooLong = (label: string, max: number) => `${label}은(는) ${max.toLocaleString('ko-KR')}자까지 쓸 수 있어요.`;

export function normalizeNewlines(s: string): string {
  return s.replace(/\r\n?/g, '\n');
}
export function nonSpaceLength(s: string): number {
  return s.replace(/\s/g, '').length;
}
/** 한글·영문 글자 수. 숫자·기호만 있는 입력(예: "2")을 걸러내는 데 쓴다. */
export function countLetters(s: string): number {
  return (s.match(/[가-힣A-Za-z]/g) ?? []).length;
}

export function checkTitle(v: string): string | null {
  const t = v.trim();
  if (!t) return '요청 제목을 입력해 주세요.';
  if (t.length < 2 || countLetters(t) < 2) return '요청 제목은 두 글자 이상의 글로 적어 주세요.';
  if (t.length > MAX.title) return tooLong('요청 제목', MAX.title);
  return null;
}
export function checkCustomer(v: string): string | null {
  const t = v.trim();
  if (!t) return '고객명을 입력해 주세요.';
  if (countLetters(t) < 1) return '고객명을 글자로 적어 주세요.';
  if (t.length > MAX.customer) return tooLong('고객명', MAX.customer);
  return null;
}
export function checkOriginal(v: string): string | null {
  if (!v.trim()) return '요청 원문을 입력해 주세요.';
  if (v.length > MAX.original) return tooLong('요청 원문', MAX.original);
  if (nonSpaceLength(v) < MIN_ORIGINAL_NONSPACE || countLetters(v) < MIN_ORIGINAL_LETTERS) {
    return '요청 원문이 너무 짧아요. 고객이 보낸 내용을 그대로 붙여 넣어 주세요. (공백 제외 10자 이상)';
  }
  return null;
}
/** 분석 항목(요구사항·질문·미확정 사항) 내용 */
export function checkItemContent(v: string): string | null {
  const t = v.trim();
  if (!t) return '내용을 입력해 주세요.';
  if (t.length < 2 || countLetters(t) < 2) return '의미를 알 수 있게 두 글자 이상의 글로 적어 주세요.';
  if (t.length > MAX.item) return tooLong('내용', MAX.item);
  return null;
}
/** 고객 답변·결정 내용·전환 근거 */
export function checkNote(v: string, label: string): string | null {
  const t = v.trim();
  if (!t) return `${label}을 입력해 주세요.`;
  if (countLetters(t) < 1) return `${label}을 글자로 적어 주세요.`;
  if (t.length > MAX.note) return tooLong(label, MAX.note);
  return null;
}

// 확인할 수 없는 모호한 완료 조건. 공백·문장부호를 뺀 문자열에 아래 문구가 들어 있으면 거부한다.
const VAGUE_PATTERNS = [
  '요청대로동작',
  '정상동작',
  '정상적으로동작',
  '잘동작',
  '잘작동',
  '제대로동작',
  '제대로작동',
  '문제없이동작',
  '문제없이작동',
  '요청대로구현',
  '요청사항을반영',
];

export function checkCriterion(v: string): string | null {
  const t = v.trim();
  if (!t) return '완료 조건을 입력해 주세요.';
  const compact = t.replace(/[\s.,!?·~'"‘’“”]/g, '');
  if (compact.length < 6) return '완료 조건은 확인할 수 있는 문장으로 6자 이상 적어 주세요.';
  if (t.length > MAX.criterion) return tooLong('완료 조건', MAX.criterion);
  if (VAGUE_PATTERNS.some((p) => compact.includes(p))) {
    return '“요청대로 동작한다”처럼 모호한 문장은 쓸 수 없어요. 무엇이 보이거나 되는지 구체적으로 적어 주세요.';
  }
  return null;
}
