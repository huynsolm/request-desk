-- 0002_review_hardening: 독립 검수(5a05652) 지적 사항 반영. 기존 DB 에도 그대로 적용된다.
-- (0001 의 CHECK 는 SQLite 에서 NULL 을 통과시키고, 테이블을 다시 만들면 FK 가 얽히므로 트리거로 보강한다.)

-- F6: 질문·미확정 사항은 resolution(open/answered/decided)이 반드시 있어야 한다. NULL 금지.
CREATE TRIGGER trg_items_resolution_required_ins BEFORE INSERT ON analysis_items
WHEN NEW.kind <> 'requirement' AND NEW.resolution IS NULL
BEGIN SELECT RAISE(ABORT, 'resolution_required'); END;

CREATE TRIGGER trg_items_resolution_required_upd BEFORE UPDATE OF kind, resolution ON analysis_items
WHEN NEW.kind <> 'requirement' AND NEW.resolution IS NULL
BEGIN SELECT RAISE(ABORT, 'resolution_required'); END;

-- F5: 작업과 확정 요구사항/원 항목의 연결은 만든 뒤 바꿀 수 없다(UPDATE 로 질문에 연결하는 우회 차단).
CREATE TRIGGER trg_tasks_link_immutable BEFORE UPDATE OF confirmation_item_id, source_item_id ON tasks
WHEN NEW.confirmation_item_id IS NOT OLD.confirmation_item_id OR NEW.source_item_id IS NOT OLD.source_item_id
BEGIN SELECT RAISE(ABORT, 'task_link_immutable'); END;

-- 원문 개정판은 확정 당시 원문을 보존하는 기록이므로 수정·삭제할 수 없다.
CREATE TRIGGER trg_request_originals_immutable_upd BEFORE UPDATE ON request_originals
BEGIN SELECT RAISE(ABORT, 'immutable_original'); END;
CREATE TRIGGER trg_request_originals_immutable_del BEFORE DELETE ON request_originals
BEGIN SELECT RAISE(ABORT, 'immutable_original'); END;

-- 작업은 항상 완료 조건이 1개 이상 있어야 한다: 마지막 조건은 삭제할 수 없다.
-- (작업 자체를 지우는 경우 ON DELETE CASCADE 로 함께 지워지는 것은 막지 않는다. 이 앱은 작업 삭제 기능이 없다.)
CREATE TRIGGER trg_task_criteria_keep_one BEFORE DELETE ON task_criteria
WHEN EXISTS (SELECT 1 FROM tasks WHERE id = OLD.task_id)
 AND (SELECT count(*) FROM task_criteria WHERE task_id = OLD.task_id) <= 1
BEGIN SELECT RAISE(ABORT, 'last_criterion'); END;
