import { defineConfig } from '@playwright/test';

// 별도 포트/DB(data/e2e.db)를 써서 개발 데이터와 섞이지 않게 한다.
// 브라우저 다운로드를 피하려고 설치된 Chrome 을 사용한다(channel: 'chrome').
// 주의: 테스트 파일은 이름 순서(flow → recovery → stage2-analysis)로 같은 DB 를 이어서 쓴다.
// flow.spec.ts 의 첫 테스트는 '빈 DB 에서 시작하는 첫 사용' 상태를 전제로 하므로,
// 새 E2E 파일은 flow 보다 먼저 정렬되지 않는 이름으로 만든다.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5199', channel: 'chrome', locale: 'ko-KR', trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'npx tsx server/index.ts',
      url: 'http://127.0.0.1:3199/api/health',
      env: { API_PORT: '3199', DB_PATH: 'data/e2e.db', E2E_RESET: '1', ALLOWED_ORIGINS: 'http://localhost:5199', ENABLE_DEV_CONTROLS: '1', MOCK_ANALYSIS_DELAY_MS: '200' },
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: 'npx vite --config web/vite.config.ts --port 5199 --strictPort',
      url: 'http://localhost:5199',
      env: { API_PORT: '3199' },
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});

