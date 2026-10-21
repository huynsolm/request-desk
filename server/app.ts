import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Db } from './db/open.ts';
import { AppError, translateDbError } from './errors.ts';
import * as svc from './service.ts';
import { startAnalysis } from './analysis/run.ts';
import { MockAnalysisProvider } from './analysis/mock.ts';
import type { AnalysisProvider } from './analysis/types.ts';
import type { RequestDetail } from '../shared/types.ts';

export interface AppOptions {
  /** 분석 제공자. 없으면 모의 분석을 쓴다. */
  provider?: AnalysisProvider;
  analysisTimeoutMs?: number;
  /** 개발용 조절 엔드포인트(모의 분석의 지연·실패)를 켠다. 기본 꺼짐. */
  devControls?: boolean;
}

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
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {};
  } catch {
    return {};
  }
}

function requireVersion(b: Record<string, any>): number {
  if (typeof b.version !== 'number') throw new AppError(422, 'validation', '버전 정보(version)가 필요해요.');
  return b.version;
}

export function createApp(db: Db, options: AppOptions = {}): Hono {
  const app = new Hono();
  const provider = options.provider ?? new MockAnalysisProvider();
  const timeoutMs = options.analysisTimeoutMs ?? 30000;
  const providerInfo = { id: provider.id, label: provider.label, isMock: provider.isMock };
  /** 요청 상세 응답에 분석 제공자 정보를 붙인다(화면이 "모의 분석 · 개발용"을 표시하는 데 쓴다). */
  const withProvider = (d: RequestDetail): RequestDetail => ({ ...d, analysis: { ...d.analysis, provider: providerInfo } });

  // 비정상적으로 큰 본문은 읽기 전에 거부한다(필드별 길이 상한은 service 에서 별도로 검사).
  app.use(
    '/api/*',
    bodyLimit({
      maxSize: 1024 * 1024,
      onError: (c) => c.json({ code: 'payload_too_large', message: '보낸 내용이 너무 커요.' }, 413),
    }),
  );

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
    return c.json(withProvider(svc.createRequest(db, b as any)), 201);
  });
  app.get('/api/requests/:id', (c) => c.json(withProvider(svc.getRequestDetail(db, c.req.param('id')))));
  app.patch('/api/requests/:id', async (c) => {
    const b = await body(c);
    return c.json(withProvider(svc.updateRequest(db, c.req.param('id'), { ...b, version: requireVersion(b) })));
  });
  app.post('/api/requests/:id/reopen', (c) => c.json(withProvider(svc.reopenRequest(db, c.req.param('id')))));

  // 분석 실행(2단계): 실행 기록을 만들고 곧바로 202 로 돌려준다. 결과는 요청 상세(analysis.latestRun)로 확인한다.
  app.post('/api/requests/:id/analyze', async (c) => {
    const b = await body(c);
    const { run, done } = startAnalysis(db, provider, c.req.param('id'), {
      confirmReanalysis: b.confirmReanalysis === true,
      timeoutMs,
    });
    void done.catch(() => {});
    return c.json({ run }, 202);
  });

  // 개발용: 모의 분석의 지연·실패 조절(ENABLE_DEV_CONTROLS=1 일 때만, 모의 제공자에서만)
  if (options.devControls && provider instanceof MockAnalysisProvider) {
    app.get('/api/dev/mock-analysis', (c) => c.json(provider.controls));
    app.post('/api/dev/mock-analysis', async (c) => {
      const b = await body(c);
      if (typeof b.delayMs === 'number') provider.controls.delayMs = Math.max(0, b.delayMs);
      if (typeof b.failNext === 'number') provider.controls.failNext = Math.max(0, b.failNext);
      return c.json(provider.controls);
    });
  }

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
    return c.json(withProvider(svc.confirmRequest(db, c.req.param('id'), b.contentSeq)));
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
