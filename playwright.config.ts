import { defineConfig } from '@playwright/test';

// 蹂꾨룄 ?ы듃/DB(data/e2e.db)瑜??⑥꽌 媛쒕컻 ?곗씠?곗? ?욎씠吏 ?딄쾶 ?쒕떎.
// 釉뚮씪?곗? ?ㅼ슫濡쒕뱶瑜??쇳븯?ㅺ퀬 ?ㅼ튂??Chrome???ъ슜?쒕떎(channel: 'chrome').
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
      env: { API_PORT: '3199', DB_PATH: 'data/e2e.db', E2E_RESET: '1', ALLOWED_ORIGINS: 'http://localhost:5199' },
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

