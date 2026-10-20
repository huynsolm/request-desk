import { describe, expect, it } from 'vitest';
import { openDb } from '../../server/db/open.ts';
import { migrate } from '../../server/db/migrate.ts';
import { createApp } from '../../server/app.ts';

// 무인증 로컬 서버: 다른 웹사이트/주소에서 오는 요청을 막는다. [R-SEC-01]
function app() {
  const db = openDb(':memory:');
  migrate(db);
  return createApp(db);
}
const body = JSON.stringify({ title: '예약 기능 추가', customerName: '모닝 스튜디오', originalText: '홈페이지에서 촬영 예약을 받고 싶어요. 가능한 날짜를 보고 신청하게 해 주세요.' });
const post = (a: ReturnType<typeof app>, headers: Record<string, string>, b = body) =>
  a.request('/api/requests', { method: 'POST', body: b, headers });

describe('로컬 서버 접근 검사', () => {
  it('[R-SEC-01] 허용된 출처(개발 웹)와 출처 없는 호출(테스트·curl)은 통과한다', async () => {
    const a = app();
    expect((await post(a, { 'content-type': 'application/json', origin: 'http://localhost:5173' })).status).toBe(201);
    expect((await post(a, { 'content-type': 'application/json' })).status).toBe(201);
    expect((await post(a, { 'content-type': 'application/json; charset=utf-8', origin: 'http://127.0.0.1:5173' })).status).toBe(201);
  });

  it('[R-SEC-01] 다른 웹사이트(Origin)에서 온 변경 요청은 거부하고 아무것도 저장하지 않는다', async () => {
    const a = app();
    const res = await post(a, { 'content-type': 'application/json', origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('forbidden_origin');
    // 같은 로컬 호스트라도 허용 목록에 없는 포트(다른 로컬 앱)는 거부
    expect((await post(a, { 'content-type': 'application/json', origin: 'http://localhost:9999' })).status).toBe(403);
    expect((await post(a, { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    const list = await (await a.request('/api/requests')).json();
    expect(list.total).toBe(0);
  });

  it('[R-SEC-01] JSON 이 아닌 본문(폼·text/plain 우회)은 거부한다', async () => {
    const a = app();
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', '']) {
      const res = await post(a, type ? { 'content-type': type } : {});
      expect(res.status).toBe(415);
    }
    expect((await (await a.request('/api/requests')).json()).total).toBe(0);
  });

  it('[R-SEC-01] 로컬 주소가 아닌 Host(DNS 리바인딩)는 조회도 거부한다', async () => {
    const a = app();
    const res = await a.request('/api/requests', { headers: { host: 'attacker.example:3001' } });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('forbidden_host');
    expect((await a.request('/api/requests', { headers: { host: '127.0.0.1:3001' } })).status).toBe(200);
    expect((await a.request('/api/requests', { headers: { host: 'localhost:5173' } })).status).toBe(200);
  });

  it('[R-SEC-01] 본문 없는 변경 요청(예: 다시 검토하기)은 Content-Type 없이도 동작한다', async () => {
    const a = app();
    const created = await (await post(a, { 'content-type': 'application/json' })).json();
    const res = await a.request(`/api/requests/${created.request.id}/reopen`, { method: 'POST' });
    expect(res.status).toBe(409); // 확정 전이라 도메인 규칙으로 거부 — 보안 검사는 통과했다는 뜻
  });
});
