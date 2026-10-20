import { Hono } from 'hono';
import type { Db } from './db/open.ts';
import { AppError, translateDbError } from './errors.ts';
import * as svc from './service.ts';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
// 개발 웹(Vite) 출처. 다른 포트를 쓰면 ALLOWED_ORIGINS(쉼표로 구분)로 지정한다.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** JSON 본문을 읽는다. 본문이 없거나 깨졌으면 빈 객체. */
async function body(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, any>> {
  try {
    const v = await c.req.json();
    return v && typeof v === 'object' ? (v as Record<string, any>) : {};
  } catch {
    return {};
  }
}

function requireVersion(b: Record<string, any>): number {
  if (typeof b.version !== 'number') throw new AppError(422, 'validation', '버전 정보(version)가 필요해요.');
  return b.version;
}

export function createApp(db: Db): Hono {
  const app = new Hono();

  // 로그인이 없는 로컬 서버라서, 사용자가 연 다른 웹사이트가 이 API 를 호출하지 못하게 막는다.
  app.use('/api/*', async (c, next) => {
    // DNS 리바인딩 방지: Host 가 로컬 주소가 아니면 거부 (조회 포함)
    const hostName = (c.req.header('host') ?? '').replace(/:\d+$/, '').toLowerCase();
    if (hostName && !LOCAL_HOSTS.has(hostName)) {
      return c.json({ code: 'forbidden_host', message: '허용되지 않은 주소로 접근했어요.' }, 403);
    }
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      const origin = c.req.header('origin');
      if (origin && !ALLOWED_ORIGINS.includes(origin) && origin !== `http://${c.req.header('host')}`) {
        return c.json({ code: 'forbidden_origin', message: '허용되지 않은 출처의 요청이에요.' }, 403);
      }
      if (c.req.header('sec-fetch-site') === 'cross-site') {
        return c.json({ code: 'forbidden_origin', message: '허용되지 않은 출처의 요청이에요.' }, 403);
      }
      // 본문이 있는 변경 요청은 JSON 만 받는다(폼/text-plain 우회 방지).
      // 헤더(content-length)에 의존하지 않고 실제 본문을 읽어 있는지 확인한다.
      const type = (c.req.header('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (type !== 'application/json' && c.req.raw.body !== null) {
        const text = await c.req.raw.clone().text();
        if (text.length > 0) {
          return c.json({ code: 'unsupported_media_type', message: 'JSON 형식으로만 보낼 수 있어요.' }, 415);
        }
      }
    }
    await next();
  });

  app.onError((err, c) => {
    const known = err instanceof AppError ? err : translateDbError(err);
    if (known) {
      return c.json({ code: known.code, message: known.message, fieldErrors: known.fieldErrors }, known.status as 400);
    }
    console.error(err);
    return c.json({ code: 'internal', message: '서버에서 문제가 생겼어요. 잠시 후 다시 시도해 주세요.' }, 500);
  });

  app.get('/api/health', (c) => c.json({ ok: true }));
  app.get('/api/summary', (c) => c.json(svc.summary(db)));

  // 요청
  app.get('/api/requests', (c) => c.json(svc.listRequests(db, (c.req.query('q') ?? '').trim(), c.req.query('status') ?? 'all')));
  app.post('/api/requests', async (c) => {
    const b = await body(c);
    return c.json(svc.createRequest(db, b as any), 201);
  });
  app.get('/api/requests/:id', (c) => c.json(svc.getRequestDetail(db, c.req.param('id'))));
  app.patch('/api/requests/:id', async (c) => {
    const b = await body(c);
    return c.json(svc.updateRequest(db, c.req.param('id'), { ...b, version: requireVersion(b) }));
  });
  app.post('/api/requests/:id/reopen', (c) => c.json(svc.reopenRequest(db, c.req.param('id'))));

  // 분석 항목
  app.post('/api/requests/:id/items', async (c) => {
    const b = await body(c);
    return c.json(svc.addItem(db, c.req.param('id'), b as any), 201);
  });
  app.patch('/api/items/:id', async (c) => {
    const b = await body(c);
    return c.json(svc.updateItem(db, c.req.param('id'), { ...b, version: requireVersion(b) }));
  });
  app.delete('/api/items/:id', async (c) => {
    const b = await body(c);
    svc.deleteItem(db, c.req.param('id'), requireVersion(b));
    return c.json({ ok: true });
  });
  app.post('/api/items/:id/restore', (c) => c.json(svc.restoreItem(db, c.req.param('id'))));
  app.post('/api/items/:id/review', async (c) => {
    const b = await body(c);
    return c.json(svc.reviewItem(db, c.req.param('id'), requireVersion(b)));
  });
  app.post('/api/items/:id/resolve', async (c) => {
    const b = await body(c);
    return c.json(svc.resolveItem(db, c.req.param('id'), { ...(b as any), version: requireVersion(b) }));
  });
  app.post('/api/items/:id/convert', async (c) => {
    const b = await body(c);
    return c.json(svc.convertToRequirement(db, c.req.param('id'), { ...(b as any), version: requireVersion(b) }), 201);
  });

  // 확정
  app.get('/api/requests/:id/confirm-preview', (c) => c.json(svc.confirmPreview(db, c.req.param('id'))));
  app.post('/api/requests/:id/confirm', async (c) => {
    const b = await body(c);
    if (typeof b.contentSeq !== 'number') throw new AppError(422, 'validation', '확정 승인 정보(contentSeq)가 필요해요.');
    return c.json(svc.confirmRequest(db, c.req.param('id'), b.contentSeq));
  });

  // 작업
  app.post('/api/requests/:id/tasks', async (c) => {
    const b = await body(c);
    return c.json(svc.createTasks(db, c.req.param('id'), b as any), 201);
  });
  app.get('/api/tasks', (c) => c.json(svc.listTasks(db, c.req.query('status') ?? 'all')));
  app.get('/api/tasks/:id', (c) => c.json(svc.getTaskDetail(db, c.req.param('id'))));
  app.patch('/api/tasks/:id', async (c) => {
    const b = await body(c);
    return c.json(svc.updateTask(db, c.req.param('id'), { ...(b as any), version: requireVersion(b) }));
  });
  app.post('/api/tasks/:id/criteria', async (c) => {
    const b = await body(c);
    return c.json(svc.addCriterion(db, c.req.param('id'), b.text), 201);
  });
  app.patch('/api/criteria/:id', async (c) => {
    const b = await body(c);
    return c.json(svc.updateCriterion(db, c.req.param('id'), b as any));
  });
  app.delete('/api/criteria/:id', (c) => c.json(svc.deleteCriterion(db, c.req.param('id'))));

  app.all('/api/*', (c) => c.json({ code: 'not_found', message: '없는 주소예요.' }, 404));
  return app;
}
