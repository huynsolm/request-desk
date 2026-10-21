import { existsSync } from 'node:fs';

// 서버 전용 .env 를 읽는다(있을 때만). 이미 설정된 환경 변수는 덮어쓰지 않는다. 키는 이 파일/환경에서만 읽고 브라우저로 보내지 않는다.
if (existsSync('.env')) process.loadEnvFile('.env');

export const PORT = Number(process.env.API_PORT ?? 3001);
export const DB_PATH = process.env.DB_PATH ?? 'data/app.db';
// 분석 제공자: 'mock'(모의 분석, 개발용, 기본) 또는 'ai'(Anthropic Claude API, ANTHROPIC_API_KEY 필요)
export const ANALYSIS_PROVIDER = process.env.ANALYSIS_PROVIDER ?? 'mock';
export const ANALYSIS_TIMEOUT_MS = Number(process.env.ANALYSIS_TIMEOUT_MS ?? (ANALYSIS_PROVIDER === 'ai' ? 120000 : 30000));
// 모의 분석의 지연·실패를 테스트에서 조절하는 개발용 엔드포인트. 기본은 꺼져 있다(E2E 에서만 켠다).
export const ENABLE_DEV_CONTROLS = process.env.ENABLE_DEV_CONTROLS === '1';
