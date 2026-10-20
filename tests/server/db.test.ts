import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from '../../server/db/open.ts';
import { migrate } from '../../server/db/migrate.ts';
import { seed } from '../../server/db/seed.ts';
import * as svc from '../../server/service.ts';
import { CRITERIA, ORIGINAL, Q1, addManual, confirm, confirmedRequest, detail, makeEnv, newRequest, snapshotItems } from './helpers.ts';

// 서버 코드를 거치지 않고 SQL 을 직접 실행해서, 서버 검증이 뚫려도 DB 가 막는지 확인한다.

function fails(fn: () => unknown, message: RegExp) {
  expect(fn).toThrowError(message);
}

describe('DB 방어선 (직접 SQL)', () => {
  it('[R-INPUT-01] 의미 없이 짧은 원문(2)은 CHECK 로 거부된다', () => {
    const env = makeEnv();
    fails(
      () => env.db.prepare(`INSERT INTO requests (id, title, customer_name, original_text, created_at, updated_at) VALUES ('a','예약 기능','모닝','2','t','t')`).run(),
      /CHECK constraint failed/,
    );
  });

  it('[R-QUOTE-01] 원문에 없는 인용문은 트리거가 거부한다(INSERT·UPDATE)', async () => {
    const env = makeEnv();
    const rid = await newRequest(env);
    fails(
      () =>
        env.db
          .prepare(`INSERT INTO analysis_items (id, request_id, kind, position, content, quote, origin, resolution, created_at, updated_at)
                    VALUES ('x','${rid}','requirement',1,'결제 기능','결제를 받고 싶어요','ai',NULL,'t','t')`)
          .run(),
      /quote_not_in_original/,
    );
    const item = await addManual(env, rid, 'requirement', '예약 가능한 날짜 조회', Q1);
    fails(
      () => env.db.prepare(`UPDATE analysis_items SET quote = '없는 문장', review_state = 'unreviewed' WHERE id = ?`).run(item.id),
      /quote_not_in_original/,
    );
  });

  it('[R-CONFIRM-04] AI·모의 요구사항은 인용 없이 저장할 수 없다(CHECK)', async () => {
    const env = makeEnv();
    const rid = await newRequest(env);
    fails(
      () =>
        env.db
          .prepare(`INSERT INTO analysis_items (id, request_id, kind, position, content, origin, resolution, created_at, updated_at)
                    VALUES ('x','${rid}','requirement',1,'근거 없는 요구사항','mock',NULL,'t','t')`)
          .run(),
      /CHECK constraint failed/,
    );
  });

  it('[R-REVIEW-01] 내용을 바꾸면서 검토 완료로 남기는 UPDATE 는 트리거가 거부한다', async () => {
    const env = makeEnv();
    const rid = await newRequest(env);
    const item = await addManual(env, rid, 'requirement', '예약 가능한 날짜 조회', Q1);
    fails(() => env.db.prepare(`UPDATE analysis_items SET content = '몰래 바꾼 내용' WHERE id = ?`).run(item.id), /edit_requires_rereview/);
    // 검토 전으로 바꾸면서 고치는 것은 허용
    env.db.prepare(`UPDATE analysis_items SET content = '정상적으로 바꾼 내용', review_state = 'unreviewed' WHERE id = ?`).run(item.id);
  });

  it('[R-LOCK-01] 확정 중에는 분석 항목을 직접 UPDATE/INSERT 해도 거부된다', async () => {
    const env = makeEnv();
    const { rid } = await confirmedRequest(env);
    const d = await detail(env, rid);
    fails(() => env.db.prepare(`UPDATE analysis_items SET note = '몰래' WHERE id = ?`).run(d.items[0].id), /locked_confirmed/);
    fails(
      () =>
        env.db
          .prepare(`INSERT INTO analysis_items (id, request_id, kind, position, content, origin, resolution, created_at, updated_at)
                    VALUES ('y','${rid}','question',9,'새 질문입니다','manual','open','t','t')`)
          .run(),
      /locked_confirmed/,
    );
    fails(() => env.db.prepare(`UPDATE analysis_items SET deleted_at = 't' WHERE id = ?`).run(d.items[0].id), /locked_confirmed/);
  });

  it('[R-CONFIRM-04] 확정 기록은 UPDATE/DELETE 할 수 없다', async () => {
    const env = makeEnv();
    const { rid } = await confirmedRequest(env);
    fails(() => env.db.prepare(`UPDATE confirmations SET included_count = 99 WHERE request_id = ?`).run(rid), /immutable_confirmation/);
    fails(() => env.db.prepare(`DELETE FROM confirmations WHERE request_id = ?`).run(rid), /immutable_confirmation/);
    fails(() => env.db.prepare(`UPDATE confirmation_items SET content = '조작'`).run(), /immutable_confirmation/);
    fails(() => env.db.prepare(`DELETE FROM confirmation_items`).run(), /immutable_confirmation/);
  });

  it('[R-TASK-01] 질문 확정 항목으로 작업을 직접 INSERT 해도 거부된다', async () => {
    const env = makeEnv();
    const { detail: d } = await confirmedRequest(env);
    const q = snapshotItems(d, 'question')[0];
    fails(
      () => env.db.prepare(`INSERT INTO tasks (id, confirmation_item_id, source_item_id, title, created_at, updated_at) VALUES ('t1', ?, ?, '작업', 't', 't')`).run(q.id, q.sourceItemId),
      /task_requires_requirement/,
    );
  });

  it('[R-TASK-02] 같은 확정 요구사항으로 작업을 두 번 INSERT 하면 UNIQUE 로 거부된다', async () => {
    const env = makeEnv();
    const { detail: d } = await confirmedRequest(env);
    const r = snapshotItems(d, 'requirement')[0];
    const ins = () =>
      env.db.prepare(`INSERT INTO tasks (id, confirmation_item_id, source_item_id, title, created_at, updated_at) VALUES (lower(hex(randomblob(8))), ?, ?, '작업', 't', 't')`).run(r.id, r.sourceItemId);
    ins();
    fails(ins, /UNIQUE constraint failed: tasks\./);
  });

  it('[R-TASK-02] 재확정한 다른 확정 버전의 같은 원 요구사항으로도 작업은 하나뿐이다(source_item_id UNIQUE)', async () => {
    const env = makeEnv();
    const { rid, detail: d } = await confirmedRequest(env);
    const first = snapshotItems(d, 'requirement')[0];
    const made = await env.api('POST', `/api/requests/${rid}/tasks`, { tasks: [{ confirmationItemId: first.id, title: '작업', criteria: CRITERIA }] });
    expect(made.json.created).toHaveLength(1);
    await env.api('POST', `/api/requests/${rid}/reopen`);
    const second = await confirm(env, rid);
    const again = second.json.confirmations[0].items.find((i: any) => i.sourceItemId === first.sourceItemId);
    fails(
      () => env.db.prepare(`INSERT INTO tasks (id, confirmation_item_id, source_item_id, title, created_at, updated_at) VALUES ('t9', ?, ?, '작업2', 't', 't')`).run(again.id, again.sourceItemId),
      /UNIQUE constraint failed: tasks\./,
    );
  });

  it('[R-TASK-01] 작업과 확정 항목의 원 항목이 어긋나면 거부된다', async () => {
    const env = makeEnv();
    const { detail: d } = await confirmedRequest(env);
    const [a, b] = snapshotItems(d, 'requirement');
    fails(
      () => env.db.prepare(`INSERT INTO tasks (id, confirmation_item_id, source_item_id, title, created_at, updated_at) VALUES ('t3', ?, ?, '작업', 't', 't')`).run(a.id, b.sourceItemId),
      /task_source_mismatch/,
    );
  });

  it('[R-DATA-01] 요청은 삭제할 수 없고, 질문의 상태 값이 틀리면 거부된다', async () => {
    const env = makeEnv();
    const rid = await newRequest(env);
    fails(() => env.db.prepare('DELETE FROM requests WHERE id = ?').run(rid), /request_delete_not_allowed/);
    fails(
      () =>
        env.db
          .prepare(`INSERT INTO analysis_items (id, request_id, kind, position, content, origin, resolution, created_at, updated_at)
                    VALUES ('q','${rid}','question',1,'질문입니다','manual','decided','t','t')`)
          .run(),
      /CHECK constraint failed/,
    );
    fails(
      () =>
        env.db
          .prepare(`INSERT INTO analysis_items (id, request_id, kind, position, content, origin, resolution, created_at, updated_at)
                    VALUES ('q','${rid}','question',1,'질문입니다','manual','answered','t','t')`)
          .run(),
      /CHECK constraint failed/, // 답변 내용 없이 answered
    );
  });
});

describe('영속화와 마이그레이션', () => {
  it('[R-PERSIST-01] DB 연결을 닫고 다시 열어도(서버 재시작) 요청·분석·확정·작업 데이터가 그대로 남는다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rd-test-'));
    const path = join(dir, 'app.db');
    try {
      const db1 = openDb(path);
      migrate(db1);
      const env1 = makeEnv(db1);
      const { rid, detail: d } = await confirmedRequest(env1);
      const task = await env1.api('POST', `/api/requests/${rid}/tasks`, {
        tasks: [{ confirmationItemId: snapshotItems(d, 'requirement')[0].id, title: '날짜 조회 화면', criteria: CRITERIA }],
      });
      const taskId = task.json.created[0].id;
      await env1.api('PATCH', `/api/tasks/${taskId}`, { version: task.json.created[0].version, status: 'doing' });
      const before = await detail(env1, rid);
      db1.close();

      const db2 = openDb(path);
      expect(migrate(db2)).toEqual([]); // 이미 적용된 마이그레이션은 다시 실행하지 않는다
      const env2 = makeEnv(db2);
      const after = await detail(env2, rid);
      expect(after).toEqual(before);
      expect(after.request.originalText).toBe(ORIGINAL);
      expect((await env2.api('GET', `/api/tasks/${taskId}`)).json.status).toBe('doing');
      expect((await env2.api('GET', '/api/requests')).json.counts.confirmed).toBe(1);
      db2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('[R-DATA-02] 시드 데이터(샘플 3건)가 규칙을 모두 통과해 만들어지고, 분석 샘플에는 원문에 없는 기능이 없다', () => {
    const env = makeEnv();
    seed(env.db, { withMorningAnalysis: true });
    const list = svc.listRequests(env.db, '', 'all');
    expect(list.counts).toEqual({ all: 3, received: 0, reviewing: 2, confirmed: 1 });
    const morning = list.items.find((r) => r.customerName === '모닝 스튜디오')!;
    const d = svc.getRequestDetail(env.db, morning.id);
    expect(d.items.filter((i) => i.kind === 'requirement').map((i) => i.content)).toEqual([
      '예약 가능한 날짜 조회',
      '고객의 촬영 예약 신청',
      '운영자의 예약 내역 확인',
    ]);
    expect(d.items.filter((i) => i.kind === 'question')).toHaveLength(3);
    expect(d.items.filter((i) => i.kind === 'undecided')).toHaveLength(3);
    expect(d.items.every((i) => i.origin === 'mock' && i.reviewState === 'unreviewed')).toBe(true);
    const all = d.items.map((i) => i.content).join(' ');
    for (const forbidden of ['실시간', '결제 기능', '승인·반려', 'CSV']) expect(all).not.toContain(forbidden);
    expect(svc.listTasks(env.db, 'all').counts).toEqual({ all: 2, todo: 0, doing: 1, done: 1 });
  });

  it('[R-DATA-02] 기본 시드에서 모닝 스튜디오 요청은 접수(분석 항목 없음) 상태다', () => {
    const env = makeEnv();
    seed(env.db);
    const list = svc.listRequests(env.db, '', 'all');
    expect(list.counts).toEqual({ all: 3, received: 1, reviewing: 1, confirmed: 1 });
  });
});
