-- 0001_init: 리퀘스트 데스크 1단계 스키마 (SQLite, STRICT)
-- 연결마다 PRAGMA foreign_keys=ON 이 필요하다 (server/db/open.ts 에서 설정).
-- 규칙은 서버 서비스 계층과 이 파일의 CHECK/UNIQUE/트리거에서 이중으로 막는다.

CREATE TABLE requests (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL CHECK (length(trim(title)) >= 2),
  customer_name TEXT NOT NULL CHECK (length(trim(customer_name)) >= 1),
  original_text TEXT NOT NULL
    CHECK (length(replace(replace(replace(original_text, ' ', ''), char(10), ''), char(13), '')) >= 10),
  original_rev  INTEGER NOT NULL DEFAULT 1,            -- 원문이 바뀔 때만 +1
  analysis_rev  INTEGER NOT NULL DEFAULT 1,            -- 새 검토 버전마다 +1
  phase         TEXT NOT NULL DEFAULT 'reviewing' CHECK (phase IN ('reviewing', 'confirmed')),
  version       INTEGER NOT NULL DEFAULT 1,            -- 요청 정보 수정용 낙관적 잠금
  content_seq   INTEGER NOT NULL DEFAULT 0,            -- 분석 항목/원문이 바뀔 때마다 +1 (확정 승인 토큰)
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
) STRICT;

CREATE TABLE request_originals (
  request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE RESTRICT,
  rev        INTEGER NOT NULL,
  text       TEXT NOT NULL,
  saved_at   TEXT NOT NULL,
  PRIMARY KEY (request_id, rev)
) STRICT;

CREATE TABLE analysis_items (
  id           TEXT PRIMARY KEY,
  request_id   TEXT NOT NULL REFERENCES requests(id) ON DELETE RESTRICT,
  kind         TEXT NOT NULL CHECK (kind IN ('requirement', 'question', 'undecided')),
  position     INTEGER NOT NULL,
  content      TEXT NOT NULL CHECK (length(trim(content)) >= 2),
  quote        TEXT CHECK (quote IS NULL OR length(trim(quote)) >= 1),   -- 요구사항의 원문 근거
  note         TEXT,                                                    -- 질문 이유 / 미확정 판단
  origin       TEXT NOT NULL CHECK (origin IN ('ai', 'mock', 'manual')),
  human_edited INTEGER NOT NULL DEFAULT 0 CHECK (human_edited IN (0, 1)),
  review_state TEXT NOT NULL DEFAULT 'unreviewed' CHECK (review_state IN ('unreviewed', 'reviewed')),
  resolution   TEXT,                 -- 질문: open|answered, 미확정: open|decided, 요구사항: NULL
  resolution_text TEXT,              -- 고객 답변 / 결정 내용
  resolved_at  TEXT,
  derived_from_item_id TEXT REFERENCES analysis_items(id),   -- 답변/결정 → 요구사항 전환
  derived_basis TEXT,                                         -- 전환 근거
  deleted_at   TEXT,
  version      INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  CHECK (
    (kind = 'requirement' AND resolution IS NULL) OR
    (kind = 'question'    AND resolution IN ('open', 'answered')) OR
    (kind = 'undecided'   AND resolution IN ('open', 'decided'))
  ),
  CHECK (resolution IS NULL OR resolution = 'open' OR length(trim(coalesce(resolution_text, ''))) > 0),
  CHECK (kind = 'requirement' OR quote IS NULL),
  -- AI/모의 요구사항은 원문 인용이 필수. 담당자가 직접 쓴 항목은 근거 없이 허용(화면에 표시).
  CHECK (kind <> 'requirement' OR origin = 'manual' OR quote IS NOT NULL),
  CHECK ((derived_from_item_id IS NULL) = (derived_basis IS NULL)),
  CHECK (derived_from_item_id IS NULL OR kind = 'requirement')
) STRICT;

CREATE INDEX ix_items_request ON analysis_items(request_id, kind, position) WHERE deleted_at IS NULL;

-- 확정 기록 (불변)
CREATE TABLE confirmations (
  id                 TEXT PRIMARY KEY,
  request_id         TEXT NOT NULL REFERENCES requests(id) ON DELETE RESTRICT,
  analysis_rev       INTEGER NOT NULL,
  original_rev       INTEGER NOT NULL,
  included_count     INTEGER NOT NULL,
  excluded_questions INTEGER NOT NULL,
  excluded_undecided INTEGER NOT NULL,
  confirmed_at       TEXT NOT NULL,
  UNIQUE (request_id, analysis_rev)
) STRICT;

CREATE TABLE confirmation_items (
  id              TEXT PRIMARY KEY,
  confirmation_id TEXT NOT NULL REFERENCES confirmations(id) ON DELETE RESTRICT,
  source_item_id  TEXT NOT NULL REFERENCES analysis_items(id),
  kind            TEXT NOT NULL CHECK (kind IN ('requirement', 'question', 'undecided')),
  content         TEXT NOT NULL,
  quote           TEXT,
  resolution      TEXT,
  resolution_text TEXT,
  UNIQUE (confirmation_id, source_item_id)
) STRICT;

CREATE TABLE tasks (
  id                   TEXT PRIMARY KEY,
  confirmation_item_id TEXT NOT NULL UNIQUE REFERENCES confirmation_items(id) ON DELETE RESTRICT,
  source_item_id       TEXT NOT NULL UNIQUE REFERENCES analysis_items(id) ON DELETE RESTRICT,
  title                TEXT NOT NULL CHECK (length(trim(title)) >= 1),
  description          TEXT NOT NULL DEFAULT '',
  status               TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
  version              INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
) STRICT;
-- UNIQUE(confirmation_item_id), UNIQUE(source_item_id): 같은 확정 요구사항(그리고 같은 원 항목)으로 작업은 하나만.

CREATE INDEX ix_tasks_status ON tasks(status, created_at DESC);

CREATE TABLE task_criteria (
  id       TEXT PRIMARY KEY,
  task_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  text     TEXT NOT NULL CHECK (length(trim(text)) >= 1),
  done     INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1))
) STRICT;

CREATE INDEX ix_criteria_task ON task_criteria(task_id, position);

-- ───────── 트리거 (마지막 방어선) ─────────

-- 확정(confirmed) 중에는 분석 항목을 추가·수정할 수 없다.
CREATE TRIGGER trg_items_locked_ins BEFORE INSERT ON analysis_items
WHEN (SELECT phase FROM requests WHERE id = NEW.request_id) = 'confirmed'
BEGIN SELECT RAISE(ABORT, 'locked_confirmed'); END;

CREATE TRIGGER trg_items_locked_upd BEFORE UPDATE ON analysis_items
WHEN (SELECT phase FROM requests WHERE id = NEW.request_id) = 'confirmed'
BEGIN SELECT RAISE(ABORT, 'locked_confirmed'); END;

-- 내용/인용이 바뀌는데 검토 완료로 남기면 거부 (수정하면 다시 검토 필요).
CREATE TRIGGER trg_items_edit_requires_review BEFORE UPDATE ON analysis_items
WHEN (NEW.content <> OLD.content OR coalesce(NEW.quote, '') <> coalesce(OLD.quote, ''))
     AND NEW.review_state = 'reviewed'
BEGIN SELECT RAISE(ABORT, 'edit_requires_rereview'); END;

-- 인용문은 원문(줄바꿈 정규화 후)에 실제로 존재해야 한다. 쓰기 시점에만 검사한다.
CREATE TRIGGER trg_items_quote_ins BEFORE INSERT ON analysis_items
WHEN NEW.quote IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM requests r
  WHERE r.id = NEW.request_id AND instr(replace(r.original_text, char(13), ''), NEW.quote) > 0)
BEGIN SELECT RAISE(ABORT, 'quote_not_in_original'); END;

CREATE TRIGGER trg_items_quote_upd BEFORE UPDATE OF quote ON analysis_items
WHEN NEW.quote IS NOT NULL AND NEW.quote IS NOT OLD.quote AND NOT EXISTS (
  SELECT 1 FROM requests r
  WHERE r.id = NEW.request_id AND instr(replace(r.original_text, char(13), ''), NEW.quote) > 0)
BEGIN SELECT RAISE(ABORT, 'quote_not_in_original'); END;

-- 분석 항목이 바뀔 때마다 요청의 content_seq 를 올린다 (확정 승인 토큰 무효화).
CREATE TRIGGER trg_items_bump_ins AFTER INSERT ON analysis_items
BEGIN UPDATE requests SET content_seq = content_seq + 1 WHERE id = NEW.request_id; END;

CREATE TRIGGER trg_items_bump_upd AFTER UPDATE ON analysis_items
BEGIN UPDATE requests SET content_seq = content_seq + 1 WHERE id = NEW.request_id; END;

-- 확정 기록은 불변.
CREATE TRIGGER trg_confirmations_immutable_upd BEFORE UPDATE ON confirmations
BEGIN SELECT RAISE(ABORT, 'immutable_confirmation'); END;
CREATE TRIGGER trg_confirmations_immutable_del BEFORE DELETE ON confirmations
BEGIN SELECT RAISE(ABORT, 'immutable_confirmation'); END;
CREATE TRIGGER trg_confirmation_items_immutable_upd BEFORE UPDATE ON confirmation_items
BEGIN SELECT RAISE(ABORT, 'immutable_confirmation'); END;
CREATE TRIGGER trg_confirmation_items_immutable_del BEFORE DELETE ON confirmation_items
BEGIN SELECT RAISE(ABORT, 'immutable_confirmation'); END;

-- 질문·미확정 사항은 작업이 될 수 없다. source_item_id 는 확정 항목의 원 항목과 일치해야 한다.
CREATE TRIGGER trg_tasks_requirement_only BEFORE INSERT ON tasks
WHEN (SELECT kind FROM confirmation_items WHERE id = NEW.confirmation_item_id) IS NOT 'requirement'
BEGIN SELECT RAISE(ABORT, 'task_requires_requirement'); END;

CREATE TRIGGER trg_tasks_source_match BEFORE INSERT ON tasks
WHEN (SELECT source_item_id FROM confirmation_items WHERE id = NEW.confirmation_item_id) IS NOT NEW.source_item_id
BEGIN SELECT RAISE(ABORT, 'task_source_mismatch'); END;

-- 확정/작업 이력이 있는 요청은 삭제할 수 없다. (첫 버전에는 요청 삭제 기능이 없다.)
CREATE TRIGGER trg_requests_no_delete BEFORE DELETE ON requests
BEGIN SELECT RAISE(ABORT, 'request_delete_not_allowed'); END;

-- ───────── 뷰 ─────────

-- 요청 상태는 저장하지 않고 계산한다.
CREATE VIEW v_request_list AS
SELECT r.id, r.title, r.customer_name, r.original_text, r.created_at, r.phase,
  CASE
    WHEN r.phase = 'confirmed' THEN 'confirmed'
    WHEN NOT EXISTS (SELECT 1 FROM analysis_items i WHERE i.request_id = r.id AND i.deleted_at IS NULL) THEN 'received'
    ELSE 'reviewing'
  END AS status,
  (SELECT count(*) FROM analysis_items i
     WHERE i.request_id = r.id AND i.deleted_at IS NULL AND i.review_state = 'unreviewed') AS unreviewed_count
FROM requests r;
