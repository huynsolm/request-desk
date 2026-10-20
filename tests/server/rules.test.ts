import { describe, expect, it } from 'vitest';
import {
  CRITERIA,
  ORIGINAL,
  Q1,
  Q2,
  Q3,
  addManual,
  addProposal,
  confirm,
  confirmedRequest,
  detail,
  makeEnv,
  newRequest,
  snapshotItems,
} from './helpers.ts';

// 테스트 이름의 [R-…] 는 docs/requirements.md 의 요구사항 ID 와 연결된다.

describe('요청 등록', () => {
  it('[R-INPUT-01] "2"처럼 의미가 부족한 제목·원문·고객명은 등록을 거부한다', async () => {
    const env = makeEnv();
    const bad = await env.api('POST', '/api/requests', { title: '2', customerName: '2', originalText: '2' });
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.json.fieldErrors).sort()).toEqual(['customerName', 'originalText', 'title']);
    const shortOnly = await env.api('POST', '/api/requests', { title: '예약 기능', customerName: '모닝', originalText: '12345 67890' });
    expect(shortOnly.status).toBe(422); // 숫자만 10자: 글자가 없음
    expect(shortOnly.json.fieldErrors.originalText).toBeTruthy();
    expect((await env.api('GET', '/api/requests')).json.total).toBe(0);
  });

  it('[R-INPUT-02] 원문은 줄바꿈·공백을 포함해 그대로 보존된다(CRLF 만 LF 로 통일)', async () => {
    const env = makeEnv();
    const text = '  안녕하세요  사장님입니다.\r\n\r\n  예약을   받고 싶어요.  ';
    const rid = await newRequest(env, { originalText: text });
    const d = await detail(env, rid);
    expect(d.request.originalText).toBe('  안녕하세요  사장님입니다.\n\n  예약을   받고 싶어요.  ');
  });

  it('[R-INPUT-03] 필수 값이 비면 항목별 오류를 돌려준다', async () => {
    const env = makeEnv();
    const r = await env.api('POST', '/api/requests', { title: '', customerName: '', originalText: '' });
    expect(r.status).toBe(422);
    expect(r.json.fieldErrors.title).toBe('요청 제목을 입력해 주세요.');
    expect(r.json.fieldErrors.customerName).toBe('고객명을 입력해 주세요.');
    expect(r.json.fieldErrors.originalText).toBe('요청 원문을 입력해 주세요.');
  });

  it('[R-LIST-01] 목록은 제목·고객명 검색과 상태 필터, 상태별 개수를 서버가 계산한다', async () => {
    const env = makeEnv();
    const a = await newRequest(env, { title: '홈페이지 예약 기능 추가', customerName: '모닝 스튜디오' });
    await newRequest(env, { title: '문의 폼 항목 정리', customerName: '한빛 공방' });
    await addManual(env, a, 'requirement', '예약 가능한 날짜 조회', Q1);
    const all = (await env.api('GET', '/api/requests')).json;
    expect(all.counts).toEqual({ all: 2, received: 1, reviewing: 1, confirmed: 0 });
    expect((await env.api('GET', '/api/requests?q=%ED%95%9C%EB%B9%9B')).json.items.map((i: any) => i.customerName)).toEqual(['한빛 공방']);
    expect((await env.api('GET', '/api/requests?status=reviewing')).json.items.length).toBe(1);
    const none = (await env.api('GET', '/api/requests?q=없는검색어')).json;
    expect(none.items.length).toBe(0);
    expect(none.total).toBe(2); // 결과 없음 vs 첫 사용 구분용
    // LIKE 와일드카드는 문자 그대로 검색한다
    expect((await env.api('GET', '/api/requests?q=%25')).json.items.length).toBe(0);
  });
});

describe('검토와 확정', () => {
  it('[R-CONFIRM-01] 검토 전 항목이 남아 있으면 서버가 확정을 거부한다', async () => {
    const env = makeEnv();
    const rid = await newRequest(env);
    addProposal(env, rid, 'requirement', '예약 가능한 날짜 조회', Q1);
    const res = await confirm(env, rid);
    expect(res.status).toBe(422);
    expect(res.json.code).toBe('unreviewed_items');
    expect((await detail(env, rid)).request.phase).toBe('reviewing');
    expect((await detail(env, rid)).confirmations).toHaveLength(0);
  });

  it('[R-CONFIRM-01] 검토함으로 표시한 뒤에는 확정되고, 질문·미확정이 미해결이어도 확정할 수 있다', async () => {
    const env = makeEnv();
    const rid = await newRequest(env);
    const req = addProposal(env, rid, 'requirement', '예약 가능한 날짜 조회', Q1);
    const q = addProposal(env, rid, 'question', '결제가 필요한가요?');
    const u = addProposal(env, rid, 'undecided', '로그인 필요 여부');
    for (const itemId of [req, q, u]) {
      const cur = (await detail(env, rid)).items.find((i: any) => i.id === itemId);
      const r = await env.api('POST', `/api/items/${itemId}/review`, { version: cur.version });
      expect(r.status).toBe(200);
    }
    const res = await confirm(env, rid);
    expect(res.status).toBe(200);
    expect(res.json.request.status).toBe('confirmed');
    const c = res.json.confirmations[0];
    expect([c.includedCount, c.excludedQuestions, c.excludedUndecided]).toEqual([1, 1, 1]);
  });

  it('[R-CONFIRM-02] 명시된 요구사항이 하나도 없으면 확정할 수 없다', async () => {
    const env = makeEnv();
    const rid = await newRequest(env);
    await addManual(env, rid, 'question', '결제가 필요한가요?');
    const res = await confirm(env, rid);
    expect(res.status).toBe(422);
    expect(res.json.code).toBe('no_requirements');
  });

  it('[R-CONFIRM-03] 확인창을 연 뒤 내용이 바뀌면 이전 승인(contentSeq)으로는 확정되지 않는다', async () => {
    const env = makeEnv();
    const rid = await newRequest(env);
    await addManual(env, rid, 'requirement', '예약 가능한 날짜 조회', Q1);
    const preview = (await env.api('GET', `/api/requests/${rid}/confirm-preview`)).json;
    await addManual(env, rid, 'requirement', '고객의 촬영 예약 신청', Q2); // 확인창이 열린 사이에 변경
    const res = await env.api('POST', `/api/requests/${rid}/confirm`, { contentSeq: preview.contentSeq });
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('stale_confirmation');
    expect((await detail(env, rid)).request.phase).toBe('reviewing');
  });

  it('[R-CONFIRM-05] 의미 없는 항목("2")은 분석 항목으로 추가할 수 없다', async () => {
    const env = makeEnv();
    const rid = await newRequest(env);
    for (const content of ['2', '  ', '!!', '12']) {
      const bad = await env.api('POST', `/api/requests/${rid}/items`, { kind: 'requirement', content });
      expect(bad.status).toBe(422);
    }
    expect((await detail(env, rid)).items).toHaveLength(0);
  });

  it('[R-CONFIRM-05] 의미 없는 내용의 요구사항이 있으면 확정이 거부된다', async () => {
    const env = makeEnv();
    const rid = await newRequest(env);
    await addManual(env, rid, 'requirement', '예약 가능한 날짜 조회', Q1);
    // 수동 항목이지만 직접 DB 에 넣는다(검증 우회 상황 재현). reviewed 상태.
    env.db
      .prepare(
        `INSERT INTO analysis_items (id, request_id, kind, position, content, origin, review_state, resolution, created_at, updated_at)
         VALUES ('x1', ?, 'requirement', 99, '22', 'manual', 'reviewed', NULL, 't', 't')`,
      )
      .run(rid);
    const res = await confirm(env, rid);
    expect(res.status).toBe(422);
    expect(res.json.code).toBe('meaningless_content');
  });

  it('[R-CONFIRM-06] 원문이 바뀌어 근거 문장을 찾을 수 없으면 확정이 거부된다', async () => {
    const env = makeEnv();
    const rid = await newRequest(env);
    await addManual(env, rid, 'requirement', '예약 가능한 날짜 조회', Q1);
    const d = await detail(env, rid);
    const patched = await env.api('PATCH', `/api/requests/${rid}`, {
      version: d.request.version,
      originalText: '문의 폼에 항목이 너무 많아서 사람들이 중간에 나가는 것 같아요.',
    });
    expect(patched.status).toBe(200);
    expect(patched.json.items[0].quoteValid).toBe(false);
    const res = await confirm(env, rid);
    expect(res.status).toBe(422);
    expect(res.json.code).toBe('quote_mismatch');
  });

  it('[R-QUOTE-01] 원문에 없는 인용문은 항목 추가·수정에서 거부된다', async () => {
    const env = makeEnv();
    const rid = await newRequest(env);
    const bad = await env.api('POST', `/api/requests/${rid}/items`, { kind: 'requirement', content: '결제 기능 추가', quote: '결제를 받고 싶어요' });
    expect(bad.status).toBe(422);
    expect(bad.json.code).toBe('quote_not_in_original');
    const ok = await addManual(env, rid, 'requirement', '예약 가능한 날짜 조회', Q1);
    const edit = await env.api('PATCH', `/api/items/${ok.id}`, { version: ok.version, quote: '실시간으로 조회' });
    expect(edit.status).toBe(422);
  });

  it('[R-REVIEW-01] 항목 내용을 고치면 사람이 고친 항목이 되고 다시 검토가 필요해진다', async () => {
    const env = makeEnv();
    const rid = await newRequest(env);
    const item = await addManual(env, rid, 'requirement', '예약 가능한 날짜 조회', Q1);
    let cur = (await detail(env, rid)).items[0];
    expect(cur.reviewState).toBe('reviewed'); // 담당자가 직접 추가한 항목은 검토 완료
    // 같은 내용으로 저장하면 아무것도 바뀌지 않는다
    const same = await env.api('PATCH', `/api/items/${item.id}`, { version: cur.version, content: '예약 가능한 날짜 조회' });
    expect(same.json.reviewState).toBe('reviewed');
    // 실제로 고치면 검토 전으로
    const edited = await env.api('PATCH', `/api/items/${item.id}`, { version: cur.version, content: '예약 가능한 날짜 보기' });
    expect(edited.status).toBe(200);
    expect(edited.json.reviewState).toBe('unreviewed');
    expect(edited.json.humanEdited).toBe(true);
    const res = await confirm(env, rid);
    expect(res.json.code).toBe('unreviewed_items');
    cur = (await detail(env, rid)).items[0];
    await env.api('POST', `/api/items/${item.id}/review`, { version: cur.version });
    expect((await confirm(env, rid)).status).toBe(200);
  });

  it('[R-REVIEW-01] 오래된 version 으로 수정하면 409 로 막는다(덮어쓰기 방지)', async () => {
    const env = makeEnv();
    const rid = await newRequest(env);
    const item = await addManual(env, rid, 'requirement', '예약 가능한 날짜 조회', Q1);
    const first = await env.api('PATCH', `/api/items/${item.id}`, { version: item.version, content: '예약 가능한 날짜 보기' });
    expect(first.status).toBe(200);
    const stale = await env.api('PATCH', `/api/items/${item.id}`, { version: item.version, content: '다른 내용으로 덮어쓰기' });
    expect(stale.status).toBe(409);
    expect(stale.json.code).toBe('version_conflict');
  });

  it('[R-REVIEW-02] 질문을 검토해도 답변 완료가 되지 않고, 미확정 사항을 검토해도 결정되지 않는다', async () => {
    const env = makeEnv();
    const rid = await newRequest(env);
    const q = addProposal(env, rid, 'question', '결제가 필요한가요?');
    const u = addProposal(env, rid, 'undecided', '로그인 필요 여부');
    for (const itemId of [q, u]) {
      const cur = (await detail(env, rid)).items.find((i: any) => i.id === itemId);
      const r = await env.api('POST', `/api/items/${itemId}/review`, { version: cur.version });
      expect(r.json.reviewState).toBe('reviewed');
      expect(r.json.resolution).toBe('open');
      expect(r.json.resolutionText).toBeNull();
    }
  });

  it('[R-REVIEW-02] 답변·결정은 내용이 있어야 기록되고, 질문과 미확정의 허용 상태가 다르다', async () => {
    const env = makeEnv();
    const rid = await newRequest(env);
    const q = await addManual(env, rid, 'question', '결제가 필요한가요?');
    const u = await addManual(env, rid, 'undecided', '로그인 필요 여부');
    expect((await env.api('POST', `/api/items/${q.id}/resolve`, { version: q.version, resolution: 'answered', text: '  ' })).status).toBe(422);
    expect((await env.api('POST', `/api/items/${q.id}/resolve`, { version: q.version, resolution: 'decided', text: '네' })).status).toBe(422);
    const ok = await env.api('POST', `/api/items/${q.id}/resolve`, { version: q.version, resolution: 'answered', text: '결제는 필요 없어요' });
    expect(ok.json.resolution).toBe('answered');
    const dec = await env.api('POST', `/api/items/${u.id}/resolve`, { version: u.version, resolution: 'decided', text: '로그인 없이 받아요' });
    expect(dec.json.resolution).toBe('decided');
    const reopened = await env.api('POST', `/api/items/${u.id}/resolve`, { version: dec.json.version, resolution: 'open' });
    expect(reopened.json.resolution).toBe('open');
    expect(reopened.json.resolutionText).toBeNull();
  });

  it('[R-CONVERT-01] 답변·결정이 없으면 요구사항으로 전환할 수 없고, 전환에는 근거가 필수다', async () => {
    const env = makeEnv();
    const rid = await newRequest(env);
    const q = await addManual(env, rid, 'question', '결제가 필요한가요?');
    const early = await env.api('POST', `/api/items/${q.id}/convert`, { version: q.version, content: '예약 결제 기능', basis: '고객 답변' });
    expect(early.status).toBe(409);
    expect(early.json.code).toBe('source_unresolved');
    const answered = await env.api('POST', `/api/items/${q.id}/resolve`, { version: q.version, resolution: 'answered', text: '예약금 결제가 필요해요' });
    const noBasis = await env.api('POST', `/api/items/${q.id}/convert`, { version: answered.json.version, content: '예약금 결제', basis: '' });
    expect(noBasis.status).toBe(422);
    expect(noBasis.json.fieldErrors.basis).toBeTruthy();
    const ok = await env.api('POST', `/api/items/${q.id}/convert`, {
      version: answered.json.version,
      content: '예약금 결제',
      basis: '고객 답변: 예약금 결제가 필요해요',
    });
    expect(ok.status).toBe(201);
    expect(ok.json.kind).toBe('requirement');
    expect(ok.json.derivedFromItemId).toBe(q.id);
    expect(ok.json.derivedBasis).toContain('예약금');
    expect(ok.json.reviewState).toBe('unreviewed'); // 전환한 항목도 검토를 거쳐야 확정된다
    expect((await confirm(env, rid)).json.code).toBe('unreviewed_items');
  });

  it('[R-LOCK-01] 확정된 요청의 분석 항목은 서버에서도 수정·추가·삭제가 막힌다', async () => {
    const env = makeEnv();
    const { rid } = await confirmedRequest(env);
    const d = await detail(env, rid);
    const item = d.items[0];
    expect((await env.api('PATCH', `/api/items/${item.id}`, { version: item.version, content: '바꾼 내용' })).status).toBe(409);
    expect((await env.api('POST', `/api/requests/${rid}/items`, { kind: 'question', content: '새 질문입니다' })).json.code).toBe('locked_confirmed');
    expect((await env.api('DELETE', `/api/items/${item.id}`, { version: item.version })).status).toBe(409);
    expect((await env.api('POST', `/api/items/${item.id}/review`, { version: item.version })).status).toBe(409);
  });

  it('[R-LOCK-02] 항목을 삭제하면 목록에서 빠지고 되돌리기로 복원된다', async () => {
    const env = makeEnv();
    const rid = await newRequest(env);
    const item = await addManual(env, rid, 'requirement', '예약 가능한 날짜 조회', Q1);
    expect((await env.api('DELETE', `/api/items/${item.id}`, { version: item.version })).status).toBe(200);
    expect((await detail(env, rid)).items).toHaveLength(0);
    const restored = await env.api('POST', `/api/items/${item.id}/restore`);
    expect(restored.status).toBe(200);
    expect((await detail(env, rid)).items).toHaveLength(1);
  });
});

describe('작업 생성', () => {
  it('[R-TASK-01] 질문·미확정 사항은 작업으로 만들 수 없다', async () => {
    const env = makeEnv();
    const { rid, detail: d } = await confirmedRequest(env);
    for (const kind of ['question', 'undecided']) {
      const snap = snapshotItems(d, kind)[0];
      const res = await env.api('POST', `/api/requests/${rid}/tasks`, {
        tasks: [{ confirmationItemId: snap.id, title: '작업 제목', criteria: CRITERIA }],
      });
      expect(res.status).toBe(422);
      expect(res.json.code).toBe('task_requires_requirement');
    }
    expect((await env.api('GET', '/api/tasks')).json.items).toHaveLength(0);
  });

  it('[R-TASK-01] 확정 전에는 작업을 만들 수 없다', async () => {
    const env = makeEnv();
    const rid = await newRequest(env);
    await addManual(env, rid, 'requirement', '예약 가능한 날짜 조회', Q1);
    const res = await env.api('POST', `/api/requests/${rid}/tasks`, { tasks: [{ confirmationItemId: 'nope', title: '작업', criteria: CRITERIA }] });
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('not_confirmed');
  });

  it('[R-TASK-02] 같은 요구사항으로 반복·동시 요청해도 작업은 하나만 만들어진다', async () => {
    const env = makeEnv();
    const { rid, detail: d } = await confirmedRequest(env);
    const snap = snapshotItems(d, 'requirement')[0];
    const payload = { tasks: [{ confirmationItemId: snap.id, title: '예약 가능한 날짜 조회 화면', criteria: CRITERIA }] };
    const results = await Promise.all(Array.from({ length: 10 }, () => env.api('POST', `/api/requests/${rid}/tasks`, payload)));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const createdTotal = results.reduce((n, r) => n + r.json.created.length, 0);
    const existingTotal = results.reduce((n, r) => n + r.json.existing.length, 0);
    expect(createdTotal).toBe(1);
    expect(existingTotal).toBe(9);
    expect((await env.api('GET', '/api/tasks')).json.items).toHaveLength(1);
    expect((env.db.prepare('SELECT count(*) AS n FROM tasks').get() as any).n).toBe(1);
  });

  it('[R-TASK-02] 한 번에 여러 개를 만들 때 같은 요구사항을 두 번 넣으면 거부한다', async () => {
    const env = makeEnv();
    const { rid, detail: d } = await confirmedRequest(env);
    const snap = snapshotItems(d, 'requirement')[0];
    const t = { confirmationItemId: snap.id, title: '작업', criteria: CRITERIA };
    const res = await env.api('POST', `/api/requests/${rid}/tasks`, { tasks: [t, t] });
    expect(res.status).toBe(422);
    expect((await env.api('GET', '/api/tasks')).json.items).toHaveLength(0);
  });

  it('[R-TASK-03] 완료 조건이 없거나 "요청대로 동작한다"처럼 모호하면 작업이 하나도 만들어지지 않는다', async () => {
    const env = makeEnv();
    const { rid, detail: d } = await confirmedRequest(env);
    const [a, b] = snapshotItems(d, 'requirement');
    for (const criteria of [[], ['  '], ['예약 기능이 요청대로 동작한다'], ['정상 동작'], ['잘 동작함']]) {
      const res = await env.api('POST', `/api/requests/${rid}/tasks`, {
        tasks: [
          { confirmationItemId: a.id, title: '좋은 작업', criteria: CRITERIA },
          { confirmationItemId: b.id, title: '문제 작업', criteria },
        ],
      });
      expect(res.status).toBe(422);
      expect(res.json.fieldErrors['tasks.1.criteria']).toBeTruthy();
    }
    expect((await env.api('GET', '/api/tasks')).json.items).toHaveLength(0); // 일부만 만들어지지 않음(원자성)
  });

  it('[R-TASK-03] 작업 제목이 비어 있으면 거부한다', async () => {
    const env = makeEnv();
    const { rid, detail: d } = await confirmedRequest(env);
    const res = await env.api('POST', `/api/requests/${rid}/tasks`, {
      tasks: [{ confirmationItemId: snapshotItems(d, 'requirement')[0].id, title: '  ', criteria: CRITERIA }],
    });
    expect(res.status).toBe(422);
    expect(res.json.fieldErrors['tasks.0.title']).toBe('작업 제목을 입력해 주세요.');
  });

  it('[R-TASK-04] 작업은 확정 요구사항과 연결되고 기본 설명·완료 조건이 저장된다', async () => {
    const env = makeEnv();
    const { rid, detail: d } = await confirmedRequest(env);
    const snap = snapshotItems(d, 'requirement')[0];
    const res = await env.api('POST', `/api/requests/${rid}/tasks`, {
      tasks: [{ confirmationItemId: snap.id, title: '예약 가능한 날짜 조회 화면', criteria: ['  고객이 예약 가능한 날짜를 볼 수 있다  ', '', '예약할 수 없는 날짜는 구분되어 보인다'] }],
    });
    const task = (await env.api('GET', `/api/tasks/${res.json.created[0].id}`)).json;
    expect(task.requirementText).toBe('예약 가능한 날짜 조회');
    expect(task.description).toContain('홈페이지 예약 기능 추가');
    expect(task.criteria.map((c: any) => c.text)).toEqual(['고객이 예약 가능한 날짜를 볼 수 있다', '예약할 수 없는 날짜는 구분되어 보인다']);
    expect(task.status).toBe('todo');
    expect((await detail(env, rid)).items.find((i: any) => i.id === snap.sourceItemId).task.id).toBe(task.id);
  });
});

describe('확정 이후 변경과 보존', () => {
  async function withTask() {
    const env = makeEnv();
    const { rid, detail: d } = await confirmedRequest(env);
    const snap = snapshotItems(d, 'requirement')[0];
    const created = await env.api('POST', `/api/requests/${rid}/tasks`, {
      tasks: [{ confirmationItemId: snap.id, title: '예약 가능한 날짜 조회 화면', criteria: CRITERIA }],
    });
    return { env, rid, snap, taskId: created.json.created[0].id as string };
  }

  it('[R-VERSION-01] 다시 검토하기는 새 검토 버전을 시작하되 기존 확정 기록과 작업은 그대로 둔다', async () => {
    const { env, rid, taskId } = await withTask();
    const before = await detail(env, rid);
    const re = await env.api('POST', `/api/requests/${rid}/reopen`);
    expect(re.status).toBe(200);
    expect(re.json.request.phase).toBe('reviewing');
    expect(re.json.request.status).toBe('reviewing');
    expect(re.json.request.analysisRev).toBe(before.request.analysisRev + 1);
    expect(re.json.confirmations).toEqual(before.confirmations);
    const task = (await env.api('GET', `/api/tasks/${taskId}`)).json;
    expect(task.title).toBe('예약 가능한 날짜 조회 화면');
    expect(task.sourceChanged).toBe(false); // 아무것도 바꾸지 않았으면 변경 표시도 없다
    expect((await env.api('POST', `/api/requests/${rid}/reopen`)).status).toBe(409); // 확정이 아닐 때는 불가
  });

  it('[R-VERSION-01] 요구사항을 고쳐 다시 확정해도 이전 확정 기록의 내용과 작업은 바뀌지 않고, 작업에 원본 변경이 표시된다', async () => {
    const { env, rid, snap, taskId } = await withTask();
    await env.api('POST', `/api/requests/${rid}/reopen`);
    const cur = (await detail(env, rid)).items.find((i: any) => i.id === snap.sourceItemId);
    const edited = await env.api('PATCH', `/api/items/${cur.id}`, { version: cur.version, content: '예약 가능한 날짜 보기(수정)' });
    await env.api('POST', `/api/items/${cur.id}/review`, { version: edited.json.version });
    // 이 시점에 이미 작업에는 원본 변경이 표시된다
    expect((await env.api('GET', `/api/tasks/${taskId}`)).json.changeReasons).toEqual(['연결된 요구사항 내용이 바뀌었어요.']);
    const second = await confirm(env, rid);
    expect(second.status).toBe(200);
    const d = second.json;
    expect(d.confirmations).toHaveLength(2);
    expect(d.confirmations[1].items.find((i: any) => i.id === snap.id).content).toBe('예약 가능한 날짜 조회'); // v1 스냅숏 불변
    expect(d.confirmations[0].items.find((i: any) => i.sourceItemId === snap.sourceItemId).content).toBe('예약 가능한 날짜 보기(수정)');
    const task = (await env.api('GET', `/api/tasks/${taskId}`)).json;
    expect(task.title).toBe('예약 가능한 날짜 조회 화면');
    expect(task.requirementText).toBe('예약 가능한 날짜 조회');
    expect(task.sourceChanged).toBe(true);
    expect((await env.api('GET', '/api/tasks')).json.items[0].sourceChanged).toBe(true);
    expect(d.tasks[0].sourceChanged).toBe(true);
  });

  it('[R-VERSION-02] 새 확정 버전에서 같은 요구사항으로 작업을 또 만들 수 없다(기존 작업을 돌려준다)', async () => {
    const { env, rid, snap, taskId } = await withTask();
    await env.api('POST', `/api/requests/${rid}/reopen`);
    const second = await confirm(env, rid);
    const newSnap = second.json.confirmations[0].items.find((i: any) => i.sourceItemId === snap.sourceItemId);
    expect(newSnap.id).not.toBe(snap.id);
    const res = await env.api('POST', `/api/requests/${rid}/tasks`, { tasks: [{ confirmationItemId: newSnap.id, title: '또 다른 작업', criteria: CRITERIA }] });
    expect(res.json.created).toHaveLength(0);
    expect(res.json.existing[0].id).toBe(taskId);
    // 이전 확정 버전의 요구사항 id 로는 만들 수 없다
    const old = await env.api('POST', `/api/requests/${rid}/tasks`, { tasks: [{ confirmationItemId: snap.id, title: '작업', criteria: CRITERIA }] });
    expect(old.status).toBe(422);
    expect(old.json.code).toBe('not_in_confirmation');
  });

  it('[R-VERSION-03] 확정 후 원문을 고치면 새 검토 버전으로 전환되고 원문 개정판이 남으며 작업에 원본 변경이 표시된다', async () => {
    const { env, rid, taskId } = await withTask();
    const d = await detail(env, rid);
    const res = await env.api('PATCH', `/api/requests/${rid}`, {
      version: d.request.version,
      originalText: `${ORIGINAL} 그리고 취소도 가능하면 좋겠어요.`,
    });
    expect(res.status).toBe(200);
    expect(res.json.request.phase).toBe('reviewing');
    expect(res.json.request.status).toBe('reviewing');
    expect(res.json.request.originalRev).toBe(2);
    expect(res.json.request.analysisRev).toBe(d.request.analysisRev + 1);
    expect(res.json.confirmations).toHaveLength(1); // 기존 확정 기록 보존
    const revs = env.db.prepare('SELECT rev, text FROM request_originals ORDER BY rev').all() as any[];
    expect(revs.map((r) => r.rev)).toEqual([1, 2]);
    expect(revs[0].text).toBe(ORIGINAL);
    const task = (await env.api('GET', `/api/tasks/${taskId}`)).json;
    expect(task.sourceChanged).toBe(true);
    expect(task.changeReasons).toContain('고객 요청 원문이 바뀌었어요.');
  });

  it('[R-VERSION-03] 제목만 고치면 확정 상태가 유지된다', async () => {
    const { env, rid } = await withTask();
    const d = await detail(env, rid);
    const res = await env.api('PATCH', `/api/requests/${rid}`, { version: d.request.version, title: '홈페이지 촬영 예약 기능' });
    expect(res.json.request.phase).toBe('confirmed');
    expect(res.json.request.originalRev).toBe(1);
    const stale = await env.api('PATCH', `/api/requests/${rid}`, { version: d.request.version, title: '또 다른 제목입니다' });
    expect(stale.status).toBe(409);
  });
});

describe('작업 관리', () => {
  it('[R-TASK-05] 상태 변경·제목·설명 수정과 완료 조건 체크리스트가 저장된다', async () => {
    const env = makeEnv();
    const { rid, detail: d } = await confirmedRequest(env);
    const created = await env.api('POST', `/api/requests/${rid}/tasks`, {
      tasks: [{ confirmationItemId: snapshotItems(d, 'requirement')[0].id, title: '날짜 조회 화면', criteria: CRITERIA }],
    });
    const t = created.json.created[0];
    const doing = await env.api('PATCH', `/api/tasks/${t.id}`, { version: t.version, status: 'doing', title: '날짜 조회 화면(수정)', description: '메모' });
    expect(doing.json.status).toBe('doing');
    expect(doing.json.title).toBe('날짜 조회 화면(수정)');
    expect((await env.api('PATCH', `/api/tasks/${t.id}`, { version: t.version, status: 'done' })).status).toBe(409);
    expect((await env.api('PATCH', `/api/tasks/${t.id}`, { version: doing.json.version, title: ' ' })).status).toBe(422);
    expect((await env.api('PATCH', `/api/tasks/${t.id}`, { version: doing.json.version, status: 'archived' })).status).toBe(422);
    const added = await env.api('POST', `/api/tasks/${t.id}/criteria`, { text: '예약 불가 날짜는 회색으로 보인다' });
    expect(added.status).toBe(201);
    expect((await env.api('POST', `/api/tasks/${t.id}/criteria`, { text: '요청대로 동작한다' })).status).toBe(422);
    const crit = added.json.criteria[1];
    const toggled = await env.api('PATCH', `/api/criteria/${crit.id}`, { done: true });
    expect(toggled.json.criteria.filter((c: any) => c.done)).toHaveLength(1);
    const list = (await env.api('GET', '/api/tasks?status=doing')).json;
    expect(list.items).toHaveLength(1);
    expect([list.items[0].criteriaDone, list.items[0].criteriaTotal]).toEqual([1, 2]);
    expect(list.counts).toEqual({ all: 1, todo: 0, doing: 1, done: 0 });
    expect((await env.api('DELETE', `/api/criteria/${crit.id}`)).json.criteria).toHaveLength(1);
  });
});
