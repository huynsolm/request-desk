import { existsSync, rmSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './app.ts';
import { ANALYSIS_PROVIDER, ANALYSIS_TIMEOUT_MS, DB_PATH, ENABLE_DEV_CONTROLS, PORT } from './config.ts';
import { openDb } from './db/open.ts';
import { migrate } from './db/migrate.ts';
import { createProvider } from './analysis/registry.ts';
import { failStaleRuns } from './analysis/run.ts';

// E2E 전용: 매번 깨끗한 DB 로 시작한다. (개발 DB 와는 다른 DB_PATH 를 반드시 같이 지정)
if (process.env.E2E_RESET === '1') {
  if (!DB_PATH.includes('e2e')) throw new Error('E2E_RESET 은 e2e DB 경로에서만 쓸 수 있어요.');
  for (const suffix of ['', '-wal', '-shm']) rmSync(DB_PATH + suffix, { force: true });
}

const db = openDb(DB_PATH);
const applied = migrate(db);
if (applied.length) console.log(`마이그레이션 적용: ${applied.join(', ')}`);

const stale = failStaleRuns(db);
if (stale) console.log(`중단된 분석 ${stale}건을 실패로 정리했어요.`);
const provider = createProvider(ANALYSIS_PROVIDER);
const app = createApp(db, { provider, analysisTimeoutMs: ANALYSIS_TIMEOUT_MS, devControls: ENABLE_DEV_CONTROLS });
// 빌드 결과(dist/web)가 있으면 함께 서빙한다 (npm run build 후 npm start).
if (existsSync('./dist/web/index.html')) {
  app.use('/*', serveStatic({ root: './dist/web' }));
  app.get('*', serveStatic({ path: './dist/web/index.html' }));
}

// 로그인이 없는 로컬 개발용 앱이므로 반드시 루프백에만 바인딩한다.
serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, (info) => {
  console.log(`리퀘스트 데스크 서버: http://127.0.0.1:${info.port} (DB: ${DB_PATH})`);
});
