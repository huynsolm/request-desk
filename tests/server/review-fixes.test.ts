import { describe, expect, it } from 'vitest';
import { CRITERIA, addManual, confirm, confirmedRequest, makeEnv, newRequest, snapshotItems } from './helpers.ts';

// 독립 검수(5a05652) 지적 사항 F5·F6 및 추가 확인 사항의 회귀 테스트.
const fails = (fn: () => unknown, m: RegExp) => expect(fn).toThrowError(m);

describe('검수 F6: 질문·미확정의 resolution 은 NULL 일 수 없다', () => {
  it('[R-DATA-01] 직접 INSERT/UPDATE 로 resolution=NULL 질문을 만들 수 없다', async () => {
    const env = makeEnv();
    const rid = await newRequest(env);
    for (const kind of ['question', 'undecided']) {
      fails(
        () =>
          env.db
            .prepare(`INSERT INTO analysis_items (id, request_id, kind, position, content, origin, review_state, resolution, created_at, updated_at)
                      VALUES (lower(hex(randomblob(8))), ?, ?, 1, '질문입니다', 'manual', 'reviewed', NULL, 't', 't')`)
            .run(rid, kind),
        /resolution_required|CHECK constraint failed/,
      );
    }
    const q = await addManual(env, rid, 'question', '결제가 필요한가요?');
    fails(() => env.db.prepare('UPDATE analysis_items SET resolution = NULL WHERE id = ?').run(q.id), /resolution_required|CHECK constraint failed/);
    // 요구사항에는 상태가 있으면 안 된다(기존 규칙 유지)
    const r = await addManual(env, rid, 'requirement', '예약 가능한 날짜 조회');
    fails(() => env.db.prepare(`UPDATE analysis_items SET resolution = 'open' WHERE id = ?`).run(r.id), /CHECK constraint failed/);
  });

  it('[R-CONFIRM-07] 미해결 질문 수는 항상 제외 질문 수 이하이고 NULL 때문에 누락되지 않는다', async () => {
    const env = makeEnv();
    const rid = await newRequest(env);
    await addManual(env, rid, 'requirement', '예약 가능한 날짜 조회', '가능한 날짜를 보고');
    await addManual(env, rid, 'question', '결제가 필요한가요?');
    const p = (await env.api('GET', `/api/requests/${rid}/confirm-preview`)).json;
    expect([p.excludedQuestions, p.unresolvedQuestions]).toEqual([1, 1]);
  });
});

describe('검수 F5: 작업의 연결(확정 항목·원 항목)은 바꿀 수 없다', () => {
  it('[R-TASK-01] 직접 UPDATE 로 작업을 질문에 연결할 수 없다', async () => {
    const env = makeEnv();
    const { rid, detail } = await confirmedRequest(env);
    const req = snapshotItems(detail, 'requirement')[0];
    const q = snapshotItems(detail, 'question')[0];
    const made = await env.api('POST', `/api/requests/${rid}/tasks`, { tasks: [{ confirmationItemId: req.id, title: '작업', criteria: CRITERIA }] });
    const taskId = made.json.created[0].id;
    fails(() => env.db.prepare('UPDATE tasks SET confirmation_item_id = ?, source_item_id = ? WHERE id = ?').run(q.id, q.sourceItemId, taskId), /task_link_immutable/);
    fails(() => env.db.prepare('UPDATE tasks SET source_item_id = ? WHERE id = ?').run(q.sourceItemId, taskId), /task_link_immutable/);
    // 제목·상태 같은 일반 필드는 계속 수정할 수 있다
    env.db.prepare(`UPDATE tasks SET title = '다른 제목', status = 'doing' WHERE id = ?`).run(taskId);
    expect((await env.api('GET', `/api/tasks/${taskId}`)).json.requirementText).toBe('예약 가능한 날짜 조회');
  });
});

describe('검수 추가 확인: 원문 개정판 불변, 완료 조건 최소 1개 유지, 잘못된 요청 형태, 입력 크기', () => {
  it('[R-CONFIRM-04] 원문 개정판(request_originals)은 직접 UPDATE/DELETE 할 수 없다', async () => {
    const env = makeEnv();
    await newRequest(env);
    fails(() => env.db.prepare(`UPDATE request_originals SET text = '조작'`).run(), /immutable_original/);
    fails(() => env.db.prepare('DELETE FROM request_originals').run(), /immutable_original/);
  });

  it('[R-TASK-03] 작업의 마지막 완료 조건은 삭제할 수 없다(서버·DB)', async () => {
    const env = makeEnv();
    const { rid, detail } = await confirmedRequest(env);
    const made = await env.api('POST', `/api/requests/${rid}/tasks`, {
      tasks: [{ confirmationItemId: snapshotItems(detail, 'requirement')[0].id, title: '작업', criteria: ['첫 번째 완료 조건입니다', '두 번째 완료 조건입니다'] }],
    });
    const t = (await env.api('GET', `/api/tasks/${made.json.created[0].id}`)).json;
    expect((await env.api('DELETE', `/api/criteria/${t.criteria[0].id}`)).status).toBe(200);
    const last = await env.api('DELETE', `/api/criteria/${t.criteria[1].id}`);
    expect(last.status).toBe(422);
    expect(last.json.code).toBe('last_criterion');
    fails(() => env.db.prepare('DELETE FROM task_criteria WHERE id = ?').run(t.criteria[1].id), /last_criterion/);
    expect((await env.api('GET', `/api/tasks/${t.id}`)).json.criteria).toHaveLength(1);
  });

  it('[R-INPUT-05] 잘못된 JSON 형태는 500 이 아니라 422 로 거부한다', async () => {
    const env = makeEnv();
    const { rid, detail } = await confirmedRequest(env);
    const id = snapshotItems(detail, 'requirement')[0].id;
    for (const tasks of [[null], [1], ['x'], [{}], [{ confirmationItemId: id, title: '작업', criteria: 'abc' }], [{ confirmationItemId: id, title: 5, criteria: CRITERIA }], 'nope', {}]) {
      const res = await env.api('POST', `/api/requests/${rid}/tasks`, { tasks });
      expect(res.status, JSON.stringify(tasks)).toBe(422);
    }
    expect((await env.api('POST', '/api/requests', ['배열'])).status).toBe(422);
    expect((await env.api('POST', `/api/requests/${rid}/items`, { kind: 'question', content: { a: 1 } })).status).toBe(422);
  });

  it('[R-INPUT-05] 너무 긴 입력은 항목별 오류로 거부하고, 과도하게 큰 본문은 413 으로 거부한다', async () => {
    const env = makeEnv();
    const long = (n: number) => '가'.repeat(n);
    const res = await env.api('POST', '/api/requests', { title: long(201), customerName: long(101), originalText: long(20001) });
    expect(res.status).toBe(422);
    expect(Object.keys(res.json.fieldErrors).sort()).toEqual(['customerName', 'originalText', 'title']);
    const rid = await newRequest(env);
    expect((await env.api('POST', `/api/requests/${rid}/items`, { kind: 'question', content: long(1001) })).status).toBe(422);
    const huge = await env.api('POST', '/api/requests', { title: '예약 기능', customerName: '모닝', originalText: long(1_200_000) });
    expect(huge.status).toBe(413);
    // 정상 길이는 통과
    expect((await env.api('POST', '/api/requests', { title: long(200), customerName: long(100), originalText: long(20000) })).status).toBe(201);
    await confirm(env, rid);
  });
});
