export const PORT = Number(process.env.API_PORT ?? 3001);
export const DB_PATH = process.env.DB_PATH ?? 'data/app.db';
// 분석 제공자: 지금은 'mock'(모의 분석, 개발용)만 있다. 실제 AI('ai')는 3단계에서 추가한다.
export const ANALYSIS_PROVIDER = process.env.ANALYSIS_PROVIDER ?? 'mock';
export const ANALYSIS_TIMEOUT_MS = Number(process.env.ANALYSIS_TIMEOUT_MS ?? 30000);
// 모의 분석의 지연·실패를 테스트에서 조절하는 개발용 엔드포인트. 기본은 꺼져 있다(E2E 에서만 켠다).
export const ENABLE_DEV_CONTROLS = process.env.ENABLE_DEV_CONTROLS === '1';
