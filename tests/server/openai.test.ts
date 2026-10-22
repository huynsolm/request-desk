import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { OpenAIAnalysisProvider } from '../../server/analysis/openai.ts';
import { createProvider } from '../../server/analysis/registry.ts';
import { detail, makeEnv, newRequest, Q1, Q2, type Env } from './helpers.ts';

// ChatGPT(OpenAI) 제공자 테스트. 실제 OpenAI 서버 대신 이 파일 안의 가짜 서버(localhost)를 쓴다.
// 실제 API 와의 연결은 여기서 검증하지 못한다(→ 미검증, `npm run ai:smoke` 로 확인).

const KEY = 'sk-test-OPENAI-SECRET-KEY-123456';

interface Seen {
  url: string;
  headers: IncomingMessage['headers'];
  body: any;
}
let server: Server;
let baseURL = '';
let seen: Seen[] = [];
let respond: (req: IncomingMessage, res: ServerResponse, body: any) => void;

function completionJson(result: unknown, over: Record<string, unknown> = {}, message: Record<string, unknown> = {}) {
  return {
    id: 'chatcmpl_test',
    object: 'chat.completion',
    model: 'gpt-5-mini-2026-test',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: { role: 'assistant', content: typeof result === 'string' ? result : JSON.stringify(result), refusal: null, ...message },
      },
    ],
    usage: { prompt_tokens: 321, completion_tokens: 45 },
    ...over,
  };
}
function sendJson(res: ServerResponse, status: number, json: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(json));
}
const GOOD = {
  requirements: [
    { content: '예약 가능한 날짜 조회', quote: Q1 },
    { content: '고객의 촬영 예약 신청', quote: Q2 },
  ],
  questions: [{ content: '결제가 필요한가요?', note: '원문에 결제 이야기가 없어요.' }],
  undecided: [{ content: '로그인 필요 여부', note: '고객이 정하지 않았어요.' }],
};

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body: any = null;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        /* 본문 없음 */
      }
      seen.push({ url: req.url ?? '', headers: req.headers, body });
      respond(req, res, body);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});
afterEach(() => {
  seen = [];
  vi.restoreAllMocks();
});

function aiEnv(timeoutMs = 5000): Env {
  const provider = new OpenAIAnalysisProvider({ apiKey: KEY, baseURL });
  return makeEnv(undefined, { provider, analysisTimeoutMs: timeoutMs });
}
async function waitRun(env: Env, rid: string) {
  for (let i = 0; i < 600; i++) {
    const run = (await detail(env, rid)).analysis.latestRun;
    if (run && run.status !== 'running') return run;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('분석이 끝나지 않았어요');
}
async function runOnce(env: Env, over: Record<string, unknown> = {}) {
  const rid = await newRequest(env, over);
  const res = await env.api('POST', `/api/requests/${rid}/analyze`, {});
  if (res.status !== 202) return { rid, res, run: null };
  return { rid, res, run: await waitRun(env, rid) };
}

describe('ChatGPT(OpenAI) 분석 성공', () => {
  it('[R-OA-01] 결과는 "AI 제안·검토 전"으로 저장되고, 모델·토큰 사용량이 남으며, 전송 대상은 OpenAI 로 안내된다', async () => {
    respond = (_q, res) => sendJson(res, 200, completionJson(GOOD));
    const env = aiEnv();
    const { rid, run } = await runOnce(env);
    expect(run!.status).toBe('succeeded');
    expect([run!.itemCount, run!.skippedCount]).toEqual([4, 0]);
    expect([run!.model, run!.inputTokens, run!.outputTokens]).toEqual(['gpt-5-mini-2026-test', 321, 45]);
    const d = await detail(env, rid);
    expect(d.items.every((i: any) => i.origin === 'ai' && i.reviewState === 'unreviewed' && !i.humanEdited)).toBe(true);
    expect(d.analysis.provider).toMatchObject({ id: 'ai', isMock: false, sendsDataTo: 'OpenAI' });
    expect(d.request.status).toBe('reviewing');
  });

  it('[R-OA-02] 원문만 보낸다(제목·고객명 제외). 키는 Authorization 헤더로만, 구조화 출력(strict)을 요청한다', async () => {
    respond = (_q, res) => sendJson(res, 200, completionJson(GOOD));
    const env = aiEnv();
    await runOnce(env, { title: '비밀제목XYZ', customerName: '비밀고객ABC' });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('/v1/chat/completions');
    expect(seen[0].headers.authorization).toBe(`Bearer ${KEY}`);
    const wire = JSON.stringify(seen[0].body);
    expect(wire).toContain('촬영 예약');
    expect(wire).not.toContain('비밀제목XYZ');
    expect(wire).not.toContain('비밀고객ABC');
    expect(wire).not.toContain(KEY);
    expect(seen[0].body.response_format).toMatchObject({ type: 'json_schema', json_schema: { strict: true } });
    expect(seen[0].body.messages.map((m: any) => m.role)).toEqual(['system', 'user']);
    const lines = (seen[0].body.messages[1].content as string).split('\n');
    expect(lines[0]).toMatch(/^REQUEST_[0-9a-f]{32}$/);
    expect(lines[lines.length - 1]).toBe(lines[0]);
  });

  it('[R-OA-02b] 시스템 프롬프트가 질문·미확정을 꼭 필요한 것만, 각 3개까지로 제한하도록 요청에 실려 간다', async () => {
    respond = (_q, res) => sendJson(res, 200, completionJson(GOOD));
    await runOnce(aiEnv());
    const system = seen[0].body.messages[0].content as string;
    expect(system).toContain('questions 는 최대 3개');
    expect(system).toContain('undecided 는 최대 3개');
    expect(system).toContain('꼭 물어봐야 하는 것만');
    expect(system).toContain('일반적인 제작 체크리스트');
  });

  it('[R-OA-03] 원문에 없는 근거의 요구사항은 서버 검증에서 제외된다', async () => {
    respond = (_q, res) =>
      sendJson(res, 200, completionJson({ ...GOOD, requirements: [...GOOD.requirements, { content: '결제 기능', quote: '결제를 연동한다' }] }));
    const env = aiEnv();
    const { rid, run } = await runOnce(env);
    expect(run!.skippedCount).toBe(1);
    expect((await detail(env, rid)).items.map((i: any) => i.content)).not.toContain('결제 기능');
  });
});

describe('ChatGPT(OpenAI) 호출 실패 처리', () => {
  it('[R-OA-04] 오류 상태는 구분된 안전한 문구로 실패하고, 키·서버 응답 본문은 어디에도 노출되지 않는다', async () => {
    const logs = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cases: [number, string | null, string][] = [
      [401, null, 'auth'],
      [429, null, 'rate_limited'],
      [429, 'insufficient_quota', 'billing'],
      [404, 'model_not_found', 'model_unavailable'],
      [400, null, 'bad_request'],
      [503, null, 'unavailable'],
    ];
    for (const [status, code, expected] of cases) {
      respond = (_q, res) => sendJson(res, status, { error: { code, message: `bad key ${KEY} SERVER_BODY_SECRET` } });
      const env = aiEnv();
      const { rid, run } = await runOnce(env);
      expect(run!.status).toBe('failed');
      expect(run!.errorCode).toBe(expected);
      const all = JSON.stringify(await detail(env, rid)) + JSON.stringify(logs.mock.calls);
      expect(all).not.toContain(KEY);
      expect(all).not.toContain('SERVER_BODY_SECRET');
      expect((await detail(env, rid)).items).toHaveLength(0);
    }
    // 서버가 꺼져 있는 경우
    const dead = new OpenAIAnalysisProvider({ apiKey: KEY, baseURL: 'http://127.0.0.1:1/v1' });
    const { run } = await runOnce(makeEnv(undefined, { provider: dead }));
    expect(run!.errorCode).toBe('network');
  });

  it('[R-OA-05] 거절·잘림·형식이 틀린 응답은 항목을 만들지 않고 실패하며, 거절·잘림도 사용량은 남는다', async () => {
    const cases: [any, string][] = [
      [completionJson(null, {}, { content: null, refusal: '거절' }), 'refused'],
      [completionJson(GOOD, { choices: [{ finish_reason: 'length', message: { content: '{' } }] }), 'truncated'],
      [completionJson('not json at all {'), 'invalid_response'],
      [completionJson({ requirements: [{ content: '내용만 있음' }], questions: [], undecided: [] }), 'invalid_response'],
      [completionJson({ requirements: [], questions: [] }), 'invalid_response'],
      [{ choices: [] }, 'invalid_response'],
    ];
    for (const [body, expected] of cases) {
      respond = (_q, res) => sendJson(res, 200, body);
      const env = aiEnv();
      const { rid, run } = await runOnce(env);
      expect(run!.status).toBe('failed');
      expect(run!.errorCode).toBe(expected);
      expect((await detail(env, rid)).items).toHaveLength(0);
    }
  });

  it('[R-OA-06] 응답이 없으면 시간 초과로 실패한다', async () => {
    respond = () => {
      /* 응답하지 않음 */
    };
    const env = aiEnv(200);
    const { run } = await runOnce(env);
    expect(run!.status).toBe('failed');
    expect(run!.errorCode).toBe('timeout');
  });
});

describe('ChatGPT(OpenAI) 통신 방어 (검수 지적 반영)', () => {
  it('[R-OA-09] 리다이렉트는 따라가지 않는다 — 허용한 주소 밖으로 원문이 재전송되지 않는다', async () => {
    let otherHits = 0;
    const other = createServer((_q, res) => {
      otherHits++;
      sendJson(res, 200, completionJson(GOOD));
    });
    await new Promise<void>((r) => other.listen(0, '127.0.0.1', r));
    const otherUrl = `http://127.0.0.1:${(other.address() as AddressInfo).port}/stolen`;
    respond = (_q, res) => {
      res.writeHead(307, { location: otherUrl });
      res.end();
    };
    try {
      const env = aiEnv();
      const { rid, run } = await runOnce(env);
      expect(run!.status).toBe('failed');
      expect(run!.errorCode).toBe('network');
      expect(otherHits).toBe(0);
      expect((await detail(env, rid)).items).toHaveLength(0);
    } finally {
      other.closeAllConnections();
      await new Promise((r) => other.close(r));
    }
  });

  it('[R-OA-10] 본문을 받다가 연결이 끊기면 통신 실패(network)이고, 사용량은 모르므로 0 으로 기록하지 않는다', async () => {
    respond = (_q, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': '5000' });
      res.write('{"choices":[{"message":{"content":"{\\"requ');
      setTimeout(() => res.socket?.destroy(), 20);
    };
    const env = aiEnv();
    const { rid, run } = await runOnce(env);
    expect(run!.status).toBe('failed');
    expect(run!.errorCode).toBe('network');
    expect([run!.inputTokens, run!.outputTokens]).toEqual([null, null]);
    expect((await detail(env, rid)).items).toHaveLength(0);
  });

  it('[R-OA-12] 오류 상태(401·403·429·503)를 받고 본문이 끊겨도 상태에 따른 안내를 유지한다', async () => {
    const cases: [number, string][] = [
      [401, 'auth'],
      [403, 'auth'],
      [429, 'rate_limited'],
      [503, 'unavailable'],
    ];
    for (const [status, expected] of cases) {
      respond = (_q, res) => {
        res.writeHead(status, { 'content-type': 'application/json', 'content-length': '5000' });
        res.write('{"error":{"message":"SERVER_BODY_SECRET');
        setTimeout(() => res.socket?.destroy(), 20);
      };
      const env = aiEnv();
      const { rid, run } = await runOnce(env);
      expect(run!.status).toBe('failed');
      expect(run!.errorCode).toBe(expected);
      expect(JSON.stringify(await detail(env, rid))).not.toContain('SERVER_BODY_SECRET');
    }
  });

  it('[R-OA-11] 본문이 끝까지 왔는데 JSON 이 아니면 invalid_response 다', async () => {
    respond = (_q, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('<html>not json</html>');
    };
    const { run } = await runOnce(aiEnv());
    expect(run!.errorCode).toBe('invalid_response');
  });
});

describe('ChatGPT(OpenAI) 설정', () => {
  it('[R-OA-07] baseURL 은 localhost 만 허용하고, 키가 없으면 만들 수 없다', () => {
    expect(() => new OpenAIAnalysisProvider({ apiKey: KEY, baseURL: 'https://evil.example.com/v1' })).toThrow(/localhost/);
    expect(() => new OpenAIAnalysisProvider({ apiKey: '' })).toThrow();
  });

  it('[R-OA-08] ANALYSIS_PROVIDER=openai 는 OPENAI_API_KEY 가 있어야 하고, 키 값은 오류에 담지 않는다', () => {
    const prev = process.env.OPENAI_API_KEY;
    try {
      delete process.env.OPENAI_API_KEY;
      expect(() => createProvider('openai')).toThrow(/OPENAI_API_KEY/);
      process.env.OPENAI_API_KEY = KEY;
      const p = createProvider('openai');
      expect(p).toMatchObject({ id: 'ai', isMock: false, sendsDataTo: 'OpenAI', limits: { daily: 20, monthly: 300 } });
      expect(p.label).toContain('ChatGPT');
      expect(() => createProvider('nope')).toThrow(/openai/);
    } finally {
      if (prev === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prev;
    }
  });
});
