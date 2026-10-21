-- 0004_analysis_usage: 3단계(실제 AI) — 분석 실행의 모델·토큰 사용량 기록
-- 실제 호출 비용을 어림이 아니라 기록으로 확인할 수 있게 한다. (끝난 실행 기록은 수정할 수 없으므로
-- 실행이 끝나는 UPDATE 에서 한 번에 채운다. 모의 분석 등 사용량을 모르는 제공자는 NULL.)

ALTER TABLE analysis_runs ADD COLUMN model TEXT;
ALTER TABLE analysis_runs ADD COLUMN input_tokens INTEGER;
ALTER TABLE analysis_runs ADD COLUMN output_tokens INTEGER;
