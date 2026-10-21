import { defineConfig } from '@playwright/test';

// 3단계 AI 연결 E2E. 실제 Anthropic 서버가 아니라 가짜 서버(tests/e2e-ai/fake-anthropic.ts)를 쓴다.
// 별도 포트(API 3198 / 웹 5198 / 가짜 3299)와 DB(data/e2e-ai.db)를 써서 개발·일반 E2E 와 섞이지 않는다.
// 실제 API 와의 연결은 이 테스트로 검증되지 않는다(→ npm run ai:smoke).
export default defineConfig({
  testDir: 'tests/e2e-ai',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5198', channel: 'chrome', locale: 'ko-KR', trace: 'retain-on-failure' },
  webServer: [
    { command: 'npx tsx tests/e2e-ai/fake-anthropic.ts', url: 'http://127.0.0.1:3299/health', reuseExistingServer: false, timeout: 30000 },
    {
      command: 'npx tsx server/index.ts',
      url: 'http://127.0.0.1:3198/api/health',
      env: {
        API_PORT: '3198',
        DB_PATH: 'data/e2e-ai.db',
        E2E_RESET: '1',
        ALLOWED_ORIGINS: 'http://localhost:5198',
        ANALYSIS_PROVIDER: 'ai',
        ANTHROPIC_API_KEY: 'sk-ant-e2e-fake-KEY',
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:3299',
        AI_DAILY_LIMIT: '3',
        AI_MONTHLY_LIMIT: '50',
      },
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: 'npx vite --config web/vite.config.ts --port 5198 --strictPort',
      url: 'http://localhost:5198',
      env: { API_PORT: '3198' },
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});
