import type { Db } from './open.ts';
import { tx } from './open.ts';
import * as svc from '../service.ts';

import { MORNING_ANALYSIS, MORNING_ORIGINAL } from '../analysis/mock-data.ts';

// 기준 디자인(README) 샘플. 1단계에는 AI 가 없으므로 샘플 분석 항목은 origin='mock'(모의 제안)으로 넣는다.
const MORNING = {
  title: '홈페이지 예약 기능 추가',
  customerName: '모닝 스튜디오',
  originalText: MORNING_ORIGINAL,
};

export { MORNING_ANALYSIS };

export function addMorningAnalysis(db: Db, requestId: string) {
  tx(db, () => {
    for (const r of MORNING_ANALYSIS.reqs)
      svc.insertItem(db, { requestId, kind: 'requirement', content: r.content, quote: r.quote, origin: 'mock' });
    for (const q of MORNING_ANALYSIS.questions)
      svc.insertItem(db, { requestId, kind: 'question', content: q.content, note: q.note, origin: 'mock' });
    for (const u of MORNING_ANALYSIS.unknowns)
      svc.insertItem(db, { requestId, kind: 'undecided', content: u.content, note: u.note, origin: 'mock' });
  });
}

const kst = (d: string) => new Date(`${d}T12:00:00+09:00`).toISOString();

/**
 * 샘플 데이터. withMorningAnalysis 가 true 이면 첫 요청(모닝 스튜디오)에 §8 샘플 분석 항목을 모의 제안으로 넣는다.
 * 기본값(false)은 디자인과 같은 '접수' 상태로 둔다.
 */
export function seed(db: Db, opts: { withMorningAnalysis?: boolean } = {}) {
  const r1 = svc.createRequest(db, { ...MORNING, createdAt: kst('2026-10-20') });
  if (opts.withMorningAnalysis) addMorningAnalysis(db, r1.request.id);

  const r2 = svc.createRequest(db, {
    title: '문의 폼 항목 정리',
    customerName: '한빛 공방',
    originalText:
      '문의 폼에 항목이 너무 많아서 사람들이 중간에 나가는 것 같아요. 꼭 필요한 것만 남기고, 연락처는 전화번호나 이메일 중 하나만 받아도 될 것 같아요.',
    createdAt: kst('2026-10-17'),
  });
  tx(db, () => {
    const id2 = r2.request.id;
    svc.insertItem(db, { requestId: id2, kind: 'requirement', content: '문의 폼 항목 줄이기', quote: '꼭 필요한 것만 남기고', origin: 'mock', reviewState: 'reviewed' });
    svc.insertItem(db, { requestId: id2, kind: 'requirement', content: '연락처는 전화번호와 이메일 중 하나만 입력받기', quote: '연락처는 전화번호나 이메일 중 하나만 받아도 될 것 같아요', origin: 'mock' });
    svc.insertItem(db, { requestId: id2, kind: 'question', content: '꼭 남겨야 하는 항목은 무엇인가요?', note: '‘꼭 필요한 것’의 기준이 원문에 없어요.', origin: 'mock' });
    svc.insertItem(db, { requestId: id2, kind: 'undecided', content: '삭제할 항목 목록', note: '고객 답변 전까지 정할 수 없어요.', origin: 'mock' });
  });

  const r3 = svc.createRequest(db, {
    title: '메인 배너 문구 변경',
    customerName: '소요 카페',
    originalText: '메인 배너 문구를 ‘가을 신메뉴 출시’로 바꿔 주세요. 버튼은 메뉴 페이지로 연결해 주시고요.',
    createdAt: kst('2026-10-14'),
  });
  const id3 = r3.request.id;
  tx(db, () => {
    svc.insertItem(db, { requestId: id3, kind: 'requirement', content: '메인 배너 문구를 ‘가을 신메뉴 출시’로 변경', quote: '메인 배너 문구를 ‘가을 신메뉴 출시’로 바꿔 주세요', origin: 'mock', reviewState: 'reviewed' });
    svc.insertItem(db, { requestId: id3, kind: 'requirement', content: '배너 버튼을 메뉴 페이지로 연결', quote: '버튼은 메뉴 페이지로 연결해 주시고요', origin: 'mock', reviewState: 'reviewed' });
    svc.insertItem(db, { requestId: id3, kind: 'question', content: '기존 배너 이미지는 그대로 사용하나요?', note: '원문에 이미지 언급이 없어요.', origin: 'mock', reviewState: 'reviewed' });
    svc.insertItem(db, { requestId: id3, kind: 'undecided', content: '변경 적용 날짜', note: '원문에 일정 언급이 없어요.', origin: 'mock', reviewState: 'reviewed' });
  });
  const preview = svc.confirmPreview(db, id3);
  svc.confirmRequest(db, id3, preview.contentSeq);
  const detail = svc.getRequestDetail(db, id3);
  const snap = detail.confirmations[0].items.filter((i) => i.kind === 'requirement');
  const made = svc.createTasks(db, id3, {
    tasks: [
      { confirmationItemId: snap[0].id, title: '메인 배너 문구 교체', description: '메인 배너의 문구를 고객이 요청한 문구로 바꿔요.', criteria: ['메인 배너에 ‘가을 신메뉴 출시’ 문구가 보인다'] },
      { confirmationItemId: snap[1].id, title: '배너 버튼 링크 변경', description: '배너 버튼을 누르면 메뉴 페이지로 이동하도록 바꿔요.', criteria: ['배너 버튼을 누르면 메뉴 페이지로 이동한다'] },
    ],
  }).created;
  svc.updateTask(db, made[0].id, { version: made[0].version, status: 'done' });
  svc.updateTask(db, made[1].id, { version: made[1].version, status: 'doing' });
  const firstDetail = svc.getTaskDetail(db, made[0].id);
  svc.updateCriterion(db, firstDetail.criteria[0].id, { done: true });
}
