-- 0003_analysis_runs: 2단계(모의 분석 제공자) — 분석 실행 기록
-- 분석 결과 항목은 기존 analysis_items 에 origin='mock'(또는 'ai'), review_state='unreviewed' 로 들어간다.
-- 이 테이블은 "언제, 어떤 제공자로, 어떤 결과였는가"만 기록한다.

CREATE TABLE analysis_runs (
  id            TEXT PRIMARY KEY,
  request_id    TEXT NOT NULL REFERENCES requests(id) ON DELETE RESTRICT,
  provider      TEXT NOT NULL CHECK (provider IN ('mock', 'ai')),
  status        TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  original_rev  INTEGER NOT NULL,              -- 분석을 시작할 때의 원문 개정판. 결과를 반영할 때 같은지 확인한다.
  reanalysis    INTEGER NOT NULL DEFAULT 0 CHECK (reanalysis IN (0, 1)),  -- 시작할 때 이미 분석 항목이 있었는가
  item_count    INTEGER,                       -- 새로 추가한 제안 수
  skipped_count INTEGER,                       -- 검증을 통과하지 못해 제외한 제안 수
  error_code    TEXT,
  error_message TEXT,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  CHECK ((status = 'running') = (finished_at IS NULL)),
  CHECK (status <> 'failed' OR error_code IS NOT NULL)
) STRICT;

-- 요청 하나에 동시에 진행 중인 분석은 하나뿐이다(더블 클릭·재시도·여러 탭 방지).
CREATE UNIQUE INDEX ux_analysis_runs_running ON analysis_runs(request_id) WHERE status = 'running';
CREATE INDEX ix_analysis_runs_request ON analysis_runs(request_id, started_at DESC);

-- 끝난 실행 기록은 바꾸거나 지울 수 없다.
CREATE TRIGGER trg_analysis_runs_final_immutable BEFORE UPDATE ON analysis_runs
WHEN OLD.status <> 'running'
BEGIN SELECT RAISE(ABORT, 'immutable_analysis_run'); END;

CREATE TRIGGER trg_analysis_runs_no_delete BEFORE DELETE ON analysis_runs
BEGIN SELECT RAISE(ABORT, 'immutable_analysis_run'); END;
