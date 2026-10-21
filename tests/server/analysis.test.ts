import { describe, expect, it } from 'vitest';
import { MockAnalysisProvider } from '../../server/analysis/mock.ts';
import { MORNING_ORIGINAL } from '../../server/analysis/mock-data.ts';
import { failStaleRuns } from '../../server/analysis/run.ts';
import type { AnalysisProvider } from '../../server/analysis/types.ts';
import { addManual, confirm, confirmedRequest, detail, makeEnv, newRequest, ORIGINAL, type Env } from './helpers.ts';

// 2단계(모의 분석 제공자) 규칙 테스트. 테스트 이름의 [R-ANALYZE-…] 는 docs/requirements.md 의 ID 와 연결된다.

/** 분석이 끝날 때까지(running 이 아닐 때까지) 기다린다. */
async function waitRun(env: Env, rid: string) {
  for (let i = 0; i < 300; i++) {
    const run = (await detail(env, rid)).analysis.latestRun;
    if (run && run.status !== 'running') return run;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('분석이 끝나지 않았어요');
}
const analyze = (env: Env, rid: string, confirmReanalysis = false) => env.api('POST', `/api/requests/${rid}/analyze`, { confirmReanalysis });
const items = async (env: Env, rid: string) => (await detail(env, rid)).items as any[];

/** 테스트용 제공자: 원하는 값을 돌려주거나(또는 멈춘다). */
function fake(analyze: AnalysisProvider['analyze']): AnalysisProvider {
  return { id: 'mock', label: '테스트 제공자', isMock: true, analyze };
}
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('모의 분석 결과', () => {
  it('[R-ANALYZE-01] 샘플 원문: 요구사항 3·질문 3·미확정 3 이 모두 "모의 제안·검토 전"으로 들어가고 원문에 없는 기능은 없다', async () => {
    const env = makeEnv();
    const rid = await newRequest(env, { originalText: MORNING_ORIGINAL });
    const res = await analyze(env, rid);
    expect(res.status).toBe(202);
    expect(res.json.run.status).toBe('running');
    const run = await waitRun(env, rid);
    expect(run.status).toBe('succeeded');
    expect([run.itemCount, run.skippedCount]).toEqual([9, 0]);
    const list = await items(env, rid);
    expect(list.filter((i) => i.kind === 'requirement').map((i) => i.content)).toEqual([
      '예약 가능한 날짜 조회',
      '고객의 촬영 예약 신청',
      '운영자의 예약 내역 확인',
    ]);
    expect(list.filter((i) => i.kind === 'question')).toHaveLength(3);
    expect(list.filter((i) => i.kind === 'undecided')).toHaveLength(3);
    // 실제 AI 처럼 보이지 않게: 모두 origin=mock, 검토 전, 요구사항의 근거는 원문에 실제로 있음
    expect(list.every((i) => i.origin === 'mock' && i.reviewState === 'unreviewed' && !i.humanEdited)).toBe(true);
    expect(list.filter((i) => i.kind === 'requirement').every((i) => i.quote && i.quoteValid)).toBe(true);
    expect(list.filter((i) => i.kind !== 'requirement').every((i) => i.resolution === 'open')).toBe(true);
    const text = list.map((i) => i.content).join(' ');
    for (const forbidden of ['실시간', '결제 기능', '승인·반려', 'CSV']) expect(text).not.toContain(forbidden);
    // 분석만으로는 확정되지 않는다
    const d = await detail(env, rid);
    expect(d.request.status).toBe('reviewing');
    expect(d.confirmations).toHaveLength(0);
    expect((await confirm(env, rid)).json.code).toBe('unreviewed_items');
  });

  it('[R-ANALYZE-02] 일반 원문: 요구사항은 원문 문장 그대로(근거 인용)이고 새 기능을 만들어 내지 않는다', async () => {
    const env = makeEnv();
    const text = '문의 폼에 항목이 너무 많아요. 꼭 필요한 것만 남기고 싶어요. 연락처는 전화번호만 받아도 돼요.';
    const rid = await newRequest(env, { originalText: text });
    await analyze(env, rid);
    expect((await waitRun(env, rid)).status).toBe('succeeded');
    const reqs = (await items(env, rid)).filter((i) => i.kind === 'requirement');
    expect(reqs.map((r) => r.content)).toEqual(['문의 폼에 항목이 너무 많아요', '꼭 필요한 것만 남기고 싶어요', '연락처는 전화번호만 받아도 돼요']);
    for (const r of reqs) expect(text).toContain(r.quote);
  });

  it('[R-ANALYZE-13] 요청 상세가 분석 제공자 정보를 알려준다(화면의 "모의 분석 · 개발용" 표시 근거)', async () => {
    const env = makeEnv();
    const rid = await newRequest(env);
    const d = await detail(env, rid);
    expect(d.analysis.provider).toEqual({ id: 'mock', label: '모의 분석 · 개발용', isMock: true, sendsDataTo: null });
    expect(d.analysis.latestRun).toBeNull();
  });
});

describe('분석 시작 규칙', () => {
  it('[R-ANALYZE-03] 진행 중이면 다시 시작할 수 없고, 동시에 여러 번 눌러도 실행은 하나만 만들어진다', async () => {
    const gate = deferred();
    const env = makeEnv(undefined, { provider: fake(async () => (await gate.promise, { requirements: [], questions: [{ content: '새로운 질문입니다' }], undecided: [] })) });
    const rid = await newRequest(env);
    const results = await Promise.all(Array.from({ length: 6 }, () => analyze(env, rid)));
    expect(results.filter((r) => r.status === 202)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409).every((r) => r.json.code === 'analysis_running')).toBe(true);
    expect((env.db.prepare('SELECT count(*) AS n FROM analysis_runs').get() as any).n).toBe(1);
    gate.resolve();
    expect((await waitRun(env, rid)).status).toBe('succeeded');
    // 끝난 뒤에는 (확인과 함께) 다시 시작할 수 있다
    expect((await analyze(env, rid, true)).status).toBe(202);
    await waitRun(env, rid);
  });

  it('[R-ANALYZE-04] 확정된 요청은 분석할 수 없고, 새 검토 버전을 시작하면 다시 가능하다', async () => {
    const env = makeEnv();
    const { rid } = await confirmedRequest(env);
    const res = await analyze(env, rid);
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('locked_confirmed');
    expect((env.db.prepare('SELECT count(*) AS n FROM analysis_runs').get() as any).n).toBe(0);
    await env.api('POST', `/api/requests/${rid}/reopen`);
    expect((await analyze(env, rid, true)).status).toBe(202);
    await waitRun(env, rid);
  });

  it('[R-ANALYZE-09] 분석이 진행 중이면 확정할 수 없다', async () => {
    const gate = deferred();
    const env = makeEnv(undefined, { provider: fake(async () => (await gate.promise, { requirements: [], questions: [{ content: '새로운 질문입니다' }], undecided: [] })) });
    const rid = await newRequest(env);
    await addManual(env, rid, 'requirement', '예약 가능한 날짜 조회', '가능한 날짜를 보고');
    expect((await analyze(env, rid, true)).status).toBe(202);
    const preview = (await env.api('GET', `/api/requests/${rid}/confirm-preview`)).json;
    expect(preview.blockers.map((b: any) => b.code)).toContain('analysis_running');
    expect((await confirm(env, rid)).json.code).toBe('analysis_running');
    gate.resolve();
    await waitRun(env, rid);
  });

  it('[R-ANALYZE-12] DB: 같은 요청의 진행 중 실행을 둘 만들 수 없고, 끝난 실행 기록은 바꾸거나 지울 수 없다', async () => {
    const env = makeEnv();
    const rid = await newRequest(env);
    const ins = () =>
      env.db
        .prepare(`INSERT INTO analysis_runs (id, request_id, provider, status, original_rev, started_at) VALUES (lower(hex(randomblob(8))), ?, 'mock', 'running', 1, 't')`)
        .run(rid);
    ins();
    expect(ins).toThrowError(/UNIQUE constraint failed: analysis_runs\.request_id/);
    env.db.prepare(`UPDATE analysis_runs SET status = 'succeeded', finished_at = 't', item_count = 0, skipped_count = 0 WHERE request_id = ?`).run(rid);
    expect(() => env.db.prepare(`UPDATE analysis_runs SET item_count = 99 WHERE request_id = ?`).run(rid)).toThrowError(/immutable_analysis_run/);
    expect(() => env.db.prepare('DELETE FROM analysis_runs').run()).toThrowError(/immutable_analysis_run/);
    ins(); // 끝난 뒤에는 새 실행을 만들 수 있다
  });
});

describe('재분석: 사람의 편집을 덮어쓰지 않는다', () => {
  it('[R-ANALYZE-05] 이미 항목이 있으면 사용자 확인 없이는 시작하지 않는다(서버 강제)', async () => {
    const env = makeEnv();
    const rid = await newRequest(env, { originalText: MORNING_ORIGINAL });
    await addManual(env, rid, 'requirement', '직접 쓴 요구사항', '가능한 날짜를 보고');
    const res = await analyze(env, rid); // confirmReanalysis 없음
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('reanalysis_confirmation_required');
    expect(res.json.message).toContain('기존 항목은 그대로 두고');
    expect((env.db.prepare('SELECT count(*) AS n FROM analysis_runs').get() as any).n).toBe(0);
  });

  it('[R-ANALYZE-05] 확인 후 재분석해도 기존 항목(사람이 고친 것·검토한 것)은 그대로이고, 새 제안만 검토 전으로 추가된다', async () => {
    const env = makeEnv();
    const rid = await newRequest(env, { originalText: MORNING_ORIGINAL });
    await analyze(env, rid);
    await waitRun(env, rid);
    let list = await items(env, rid);
    // 사람이 요구사항 하나를 고치고 검토, 질문 하나는 삭제, 다른 질문에는 답변을 기록
    const req = list.find((i) => i.kind === 'requirement' && i.content === '예약 가능한 날짜 조회');
    const edited = (await env.api('PATCH', `/api/items/${req.id}`, { version: req.version, content: '예약 가능한 날짜를 보여주기' })).json;
    const reviewed = (await env.api('POST', `/api/items/${edited.id}/review`, { version: edited.version })).json;
    const del = list.find((i) => i.content === '결제가 필요한가요?');
    await env.api('DELETE', `/api/items/${del.id}`, { version: del.version });
    const qa = list.find((i) => i.content === '촬영 상품마다 소요 시간이 다른가요?');
    const answered = (await env.api('POST', `/api/items/${qa.id}/resolve`, { version: qa.version, resolution: 'answered', text: '상품마다 달라요' })).json;
    const before = await items(env, rid);

    expect((await analyze(env, rid, true)).status).toBe(202);
    const run = await waitRun(env, rid);
    expect(run.status).toBe('succeeded');
    expect(run.reanalysis).toBe(true);
    expect(run.itemCount).toBe(0); // 같은 모의 결과이므로 새 제안이 없다(사람이 고친·지운 것을 다시 만들지 않는다)
    const after = await items(env, rid);
    expect(after).toEqual(before); // 기존 항목은 한 글자도 바뀌지 않았다(버전·검토 상태 포함)
    const keptEdit = after.find((i) => i.id === reviewed.id);
    expect([keptEdit.content, keptEdit.reviewState, keptEdit.humanEdited]).toEqual(['예약 가능한 날짜를 보여주기', 'reviewed', true]);
    expect(after.find((i) => i.id === answered.id).resolutionText).toBe('상품마다 달라요');
    expect(after.some((i) => i.content === '결제가 필요한가요?')).toBe(false); // 지운(거절한) 제안은 되살리지 않는다
  });

  it('[R-ANALYZE-05] 재분석이 새로 찾은 제안만 추가하고, 이미 있는 것과 같은 제안은 건너뛴다', async () => {
    let call = 0;
    const env = makeEnv(undefined, {
      provider: fake(async () => {
        call += 1;
        return call === 1
          ? { requirements: [{ content: '예약 가능한 날짜 조회', quote: '가능한 날짜를 보고' }], questions: [{ content: '결제가 필요한가요?' }], undecided: [] }
          : {
              requirements: [
                { content: '예약 가능한 날짜 조회', quote: '가능한 날짜를 보고' }, // 중복(내용·근거)
                { content: '예약 날짜 보기(표현만 다른 같은 근거)', quote: '가능한 날짜를 보고' }, // 같은 근거 → 중복
                { content: '운영자의 예약 내역 확인', quote: '예약이 들어오면 제가 확인할 수 있으면 좋겠어요' }, // 새 제안
              ],
              questions: [{ content: '결제가 필요한가요?' }, { content: '예약 취소 규칙이 있나요?' }],
              undecided: [],
            };
      }),
    });
    const rid = await newRequest(env, { originalText: ORIGINAL });
    await analyze(env, rid);
    expect((await waitRun(env, rid)).itemCount).toBe(2);
    await analyze(env, rid, true);
    const run = await waitRun(env, rid);
    expect([run.status, run.itemCount]).toEqual(['succeeded', 2]);
    const list = await items(env, rid);
    expect(list).toHaveLength(4);
    expect(list.filter((i) => i.kind === 'question').map((i) => i.content).sort()).toEqual(['결제가 필요한가요?', '예약 취소 규칙이 있나요?']);
  });
});

describe('실패와 재시도', () => {
  it('[R-ANALYZE-06] 분석이 실패해도 원문·직접 쓴 항목은 그대로이고 오류 내용이 새어 나가지 않으며, 다시 시도하면 성공한다', async () => {
    const provider = new MockAnalysisProvider({ delayMs: 0, failNext: 1 });
    const env = makeEnv(undefined, { provider });
    const rid = await newRequest(env, { originalText: MORNING_ORIGINAL });
    await addManual(env, rid, 'question', '직접 적은 질문입니다');
    const before = await items(env, rid);
    await analyze(env, rid, true);
    const failed = await waitRun(env, rid);
    expect(failed.status).toBe('failed');
    expect(failed.errorCode).toBe('provider_error');
    expect(failed.errorMessage).not.toContain('테스트용'); // 제공자의 내부 오류 내용은 노출하지 않는다
    expect(await items(env, rid)).toEqual(before);
    expect((await detail(env, rid)).request.originalText).toBe(MORNING_ORIGINAL);
    // 다시 시도
    await analyze(env, rid, true);
    const ok = await waitRun(env, rid);
    expect(ok.status).toBe('succeeded');
    expect((await items(env, rid)).length).toBe(before.length + 9);
  });

  it('[R-ANALYZE-10] 시간이 초과되면 실패로 닫히고(제공자가 멈춰도) 다시 시도할 수 있다', async () => {
    const env = makeEnv(undefined, { provider: fake(() => new Promise(() => {})), analysisTimeoutMs: 40 });
    const rid = await newRequest(env);
    await analyze(env, rid);
    const run = await waitRun(env, rid);
    expect([run.status, run.errorCode]).toEqual(['failed', 'timeout']);
    expect((await items(env, rid)).length).toBe(0);
    expect((await analyze(env, rid)).status).toBe(202); // 계속 "분석 중"으로 막히지 않는다
    await waitRun(env, rid);
  });

  it('[R-ANALYZE-11] 서버가 다시 시작되면 진행 중이던 분석은 실패로 정리되어 재시도를 막지 않는다', async () => {
    const env = makeEnv(undefined, { provider: fake(() => new Promise(() => {})) });
    const rid = await newRequest(env);
    await analyze(env, rid);
    expect((await detail(env, rid)).analysis.latestRun.status).toBe('running');
    expect(failStaleRuns(env.db)).toBe(1); // 서버 시작 시 index.ts 가 하는 일
    const run = (await detail(env, rid)).analysis.latestRun;
    expect([run.status, run.errorCode]).toEqual(['failed', 'interrupted']);
    expect(failStaleRuns(env.db)).toBe(0);
    expect((await analyze(env, rid)).status).toBe(202);
  });
});

describe('제공자 응답 검증 (제공자를 믿지 않는다)', () => {
  const bad: [string, unknown][] = [
    ['문자열', '분석 결과입니다'],
    ['null', null],
    ['필드 누락', { requirements: [] }],
    ['알 수 없는 필드', { requirements: [], questions: [], undecided: [], extra: 1 }],
    ['요구사항에 근거 없음', { requirements: [{ content: '예약 가능한 날짜 조회' }], questions: [], undecided: [] }],
    ['내용이 문자열이 아님', { requirements: [], questions: [{ content: 5 }], undecided: [] }],
    ['배열이 너무 큼', { requirements: [], questions: Array.from({ length: 51 }, () => ({ content: '질문입니다 하나' })), undecided: [] }],
  ];
  for (const [name, payload] of bad) {
    it(`[R-ANALYZE-07] 잘못된 형태(${name})는 아무것도 저장하지 않고 실패로 닫는다`, async () => {
      const env = makeEnv(undefined, { provider: fake(async () => payload) });
      const rid = await newRequest(env);
      await analyze(env, rid);
      const run = await waitRun(env, rid);
      expect([run.status, run.errorCode]).toEqual(['failed', 'invalid_response']);
      expect((await items(env, rid)).length).toBe(0);
    });
  }

  it('[R-ANALYZE-07] 형태는 맞아도 원문에 없는 근거·의미 없는 내용인 항목은 제외하고(개수 기록), 나머지만 반영한다', async () => {
    const env = makeEnv(undefined, {
      provider: fake(async () => ({
        requirements: [
          { content: '예약 가능한 날짜 조회', quote: '가능한 날짜를 보고' }, // 정상
          { content: '결제 기능 추가', quote: '결제를 받고 싶어요' }, // 원문에 없는 근거 → 제외
          { content: '2', quote: '가능한 날짜를 보고' }, // 의미 없는 내용 → 제외
          { content: '근거가 비었어요', quote: '   ' }, // 빈 근거 → 제외
        ],
        questions: [{ content: '결제가 필요한가요?' }, { content: '!!' }], // 두 번째는 제외
        undecided: [],
      })),
    });
    const rid = await newRequest(env, { originalText: ORIGINAL });
    await analyze(env, rid);
    const run = await waitRun(env, rid);
    expect([run.status, run.itemCount, run.skippedCount]).toEqual(['succeeded', 2, 4]);
    expect((await items(env, rid)).map((i) => i.content).sort()).toEqual(['결제가 필요한가요?', '예약 가능한 날짜 조회']);
  });

  it('[R-ANALYZE-07] 모든 항목이 검증을 통과하지 못하면 실패로 닫고 아무것도 저장하지 않는다', async () => {
    const env = makeEnv(undefined, { provider: fake(async () => ({ requirements: [{ content: '결제 기능', quote: '없는 문장' }], questions: [], undecided: [] })) });
    const rid = await newRequest(env);
    await analyze(env, rid);
    const run = await waitRun(env, rid);
    expect([run.status, run.errorCode]).toEqual(['failed', 'invalid_response']);
    expect((await items(env, rid)).length).toBe(0);
  });

  it('[R-ANALYZE-07] 제공자가 비어 있는 결과를 주면 첫 분석은 실패(empty_result), 재분석은 새 제안 0개로 성공한다', async () => {
    const env = makeEnv(undefined, { provider: fake(async () => ({ requirements: [], questions: [], undecided: [] })) });
    const rid = await newRequest(env);
    await analyze(env, rid);
    expect((await waitRun(env, rid)).errorCode).toBe('empty_result');
    await addManual(env, rid, 'question', '직접 적은 질문입니다');
    await analyze(env, rid, true);
    const run = await waitRun(env, rid);
    expect([run.status, run.itemCount]).toEqual(['succeeded', 0]);
  });

  it('[R-ANALYZE-08] 분석하는 사이에 원문이 바뀌면 결과를 반영하지 않는다', async () => {
    const gate = deferred();
    const env = makeEnv(undefined, {
      provider: fake(async () => (await gate.promise, { requirements: [{ content: '예약 가능한 날짜 조회', quote: '가능한 날짜를 보고' }], questions: [], undecided: [] })),
    });
    const rid = await newRequest(env);
    await analyze(env, rid);
    const d = await detail(env, rid);
    // 원문을 바꾼다(근거 인용은 새 원문에도 있어서, 개정판 비교가 없다면 잘못 반영될 수 있는 경우)
    await env.api('PATCH', `/api/requests/${rid}`, { version: d.request.version, originalText: `${ORIGINAL} 그리고 취소도 가능하면 좋겠어요.` });
    gate.resolve();
    const run = await waitRun(env, rid);
    expect([run.status, run.errorCode]).toEqual(['failed', 'original_changed']);
    expect((await items(env, rid)).length).toBe(0);
  });
});

describe('개발용 조절 장치', () => {
  it('[R-ANALYZE-14] 모의 분석 조절 엔드포인트는 기본으로 꺼져 있고, 켠 경우에만 동작한다', async () => {
    const off = makeEnv();
    expect((await off.api('GET', '/api/dev/mock-analysis')).status).toBe(404);
    const provider = new MockAnalysisProvider({ delayMs: 0 });
    const on = makeEnv(undefined, { provider, devControls: true });
    expect((await on.api('POST', '/api/dev/mock-analysis', { failNext: 2, delayMs: 5 })).json).toEqual({ delayMs: 5, failNext: 2 });
    expect(provider.controls).toEqual({ delayMs: 5, failNext: 2 });
  });
});

describe('2단계 검수 지적(31b439a): 재분석 판정과 중복 키', () => {
  it('[R-ANALYZE-17] 재분석에서 모든 제안이 검증에 실패하면 성공으로 기록하지 않고 실패(invalid_response)로 닫는다', async () => {
    const env = makeEnv(undefined, { provider: fake(async () => ({ requirements: [{ content: '결제 기능 추가', quote: '원문에 없는 문장' }], questions: [], undecided: [] })) });
    const rid = await newRequest(env, { originalText: ORIGINAL });
    await addManual(env, rid, 'question', '직접 적은 질문입니다');
    const before = await items(env, rid);
    await analyze(env, rid, true);
    const run = await waitRun(env, rid);
    expect([run.status, run.errorCode, run.skippedCount]).toEqual(['failed', 'invalid_response', null]);
    expect(await items(env, rid)).toEqual(before);
  });

  it('[R-ANALYZE-17] 재분석에서 통과한 제안이 전부 이미 있는 것(중복)이면 새 제안 0개로 성공한다(검증 실패와 구분)', async () => {
    const env = makeEnv(undefined, { provider: fake(async () => ({ requirements: [{ content: '예약 가능한 날짜 조회', quote: '가능한 날짜를 보고' }], questions: [], undecided: [] })) });
    const rid = await newRequest(env, { originalText: ORIGINAL });
    await analyze(env, rid);
    await waitRun(env, rid);
    await analyze(env, rid, true);
    const run = await waitRun(env, rid);
    expect([run.status, run.itemCount, run.skippedCount]).toEqual(['succeeded', 0, 0]);
  });

  it('[R-ANALYZE-18] 분석 항목을 전부 삭제한 뒤에도 재분석으로 판정하고(삭제한 제안은 되살리지 않음), 새 제안 0개는 실패가 아니라 성공이다', async () => {
    const env = makeEnv();
    const rid = await newRequest(env, { originalText: MORNING_ORIGINAL });
    await analyze(env, rid);
    await waitRun(env, rid);
    for (const it of await items(env, rid)) await env.api('DELETE', `/api/items/${it.id}`, { version: it.version });
    expect(await items(env, rid)).toHaveLength(0);
    // 화면에 보이는 항목이 없으므로 확인창 없이 시작할 수 있지만, 분석 이력이 있으므로 재분석이다.
    expect((await analyze(env, rid)).status).toBe(202);
    const run = await waitRun(env, rid);
    expect([run.status, run.reanalysis, run.itemCount]).toEqual(['succeeded', true, 0]);
    expect(await items(env, rid)).toHaveLength(0); // 삭제(거절)한 제안은 되살리지 않는다
  });

  it('[R-ANALYZE-19] 시각적으로 같은 내용(유니코드 NFC/NFD)은 같은 제안으로 보고 중복 저장하지 않는다', async () => {
    const nfc = '카페 café 예약이 필요한가요?';
    const nfd = nfc.normalize('NFD');
    expect(nfd).not.toBe(nfc);
    const env = makeEnv(undefined, { provider: fake(async () => ({ requirements: [], questions: [{ content: nfc }, { content: nfd }], undecided: [] })) });
    const rid = await newRequest(env, { originalText: ORIGINAL });
    await analyze(env, rid);
    const run = await waitRun(env, rid);
    expect([run.status, run.itemCount]).toEqual(['succeeded', 1]); // 한 응답 안의 NFC/NFD 중복
    // 이미 있는 항목(NFC)과 같은 NFD 제안도 건너뛴다
    const env2 = makeEnv(undefined, { provider: fake(async () => ({ requirements: [], questions: [{ content: nfd }], undecided: [] })) });
    const rid2 = await newRequest(env2, { originalText: ORIGINAL });
    await addManual(env2, rid2, 'question', nfc);
    await analyze(env2, rid2, true);
    const run2 = await waitRun(env2, rid2);
    expect([run2.status, run2.itemCount]).toEqual(['succeeded', 0]);
    expect(await items(env2, rid2)).toHaveLength(1);
  });
});
