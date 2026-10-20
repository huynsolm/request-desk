# 요구사항 추적표 (1단계)

Codex 등 독립 검수자가 "요구사항 → 구현 → 검증"을 따라갈 수 있게 정리한 표입니다.
테스트 이름의 `[R-…]`(서버/DB 테스트)와 `[E2E-…]`(브라우저 테스트)가 이 표의 ID 와 연결됩니다.
**상태 표기:** 구현됨 = 코드가 있고 자동 테스트가 통과 / 부분 = 일부만 / 미구현·미검증은 따로 적습니다.

| ID | 요구사항 | 구현 위치 | 검증 |
|---|---|---|---|
| R-PERSIST-01 | 서버·DB 영속화, 새로고침/재시작 후 데이터 유지 | `server/db/*`, `server/service.ts` | `db.test.ts` [R-PERSIST-01], `flow.spec.ts` E2E-01·05 |
| R-INPUT-01 | "2"처럼 의미가 부족한 입력은 등록 거부(제목·고객명·원문) | `shared/validation.ts`, `server/service.ts#createRequest`, `0001_init.sql` CHECK | `rules.test.ts`, `db.test.ts`, E2E-01 |
| R-INPUT-02 | 원문은 입력한 그대로 보존(CRLF→LF 통일만) | `createRequest`, `request_originals` | `rules.test.ts` [R-INPUT-02] |
| R-INPUT-03 | 필수 입력값 검증(항목별 오류 문구) | `RequestPanel.tsx`, `createRequest` | `rules.test.ts`, E2E-01 |
| R-INPUT-04 | 저장 실패 시 입력값 보존. "다시 저장"은 실패 당시 값이 아니라 **현재 입력**을 저장하고, 취소하면 대기가 사라지며, 재시도 성공 시 화면 상태·버전이 갱신됨 | `RequestPanel.tsx`, `RequestDetailPage.tsx#commitForm`, `TasksPage.tsx#TaskPanel`, `useSaver.ts` | E2E-02, E2E-08, **E2E-F1×2, E2E-F2×2, E2E-R1×4(여러 저장 동시 실패·반복 재시도·외부 수정 409), E2E-R2×3(충돌 뒤 건드리지 않은 필드 보호·고친 초안 보존·열어 둔 항목 입력창 보호), E2E-R3×3(저장 중 되돌리기·연속 수정), E2E-R4(인용문만 수정 시 본문 보호)** |
| R-INPUT-05 | 잘못된 JSON 형태는 422(500 금지), 필드 길이 상한, 본문 1MB 상한(413) | `service.ts#str`, `shared/validation.ts#MAX`, `app.ts#bodyLimit` | `review-fixes.test.ts` |
| R-LIST-01 | 목록: 제목·고객명 검색, 접수/검토 중/확정 필터, 첫 사용 vs 결과 없음 구분 | `listRequests`, `RequestsPage.tsx` | `rules.test.ts`, E2E-03 |
| R-REVIEW-01 | 분석 항목을 수정하면 다시 검토 필요(서버·DB 이중) | `updateItem`, 트리거 `trg_items_edit_requires_review` | `rules.test.ts`, `db.test.ts`, E2E-04 |
| R-REVIEW-02 | "검토했는가"와 "내용이 결정되었는가"는 별도 상태. 질문을 읽어도 답변 완료 아님, 미확정을 검토해도 확정 요구사항 아님 | `analysis_items.review_state` / `resolution`, `resolveItem` | `rules.test.ts` [R-REVIEW-02] ×2, E2E-07 |
| R-CONVERT-01 | 답변·결정을 사람이 명시적으로 요구사항으로 전환, 근거 필수, 전환 항목도 검토 필요 | `convertToRequirement` | `rules.test.ts`, E2E-07 |
| R-QUOTE-01 | 원문 근거 인용문이 원문에 실제로 존재하는지 검증. 무효가 된 근거는 화면(수정 창의 `원문 근거`)에서 같은 항목 ID 로 고칠 수 있음 | `addItem`/`updateItem`, 트리거 `trg_items_quote_*`, `ItemSection.tsx` | `rules.test.ts`, `db.test.ts`, **E2E-F4** |
| R-CONFIRM-01 | 활성 항목을 모두 검토해야 확정 가능(서버 강제) | `confirmPreview` blockers | `rules.test.ts`, E2E-04 |
| R-CONFIRM-02 | 명시된 요구사항 1개 이상 필요 | `confirmPreview` | `rules.test.ts` |
| R-CONFIRM-03 | 확인창에서 사람이 최종 승인, 승인 시점 이후 내용이 바뀌면 확정 거부(`contentSeq`) | `ConfirmDialog`, `confirmRequest`, `trg_items_bump_*` | `rules.test.ts`, E2E-04 |
| R-CONFIRM-04 | 확정 기록은 당시 내용의 버전으로 보존(불변). 원문 개정판(`request_originals`)도 수정·삭제 불가 | `confirmations`, `confirmation_items`, 불변 트리거, `trg_request_originals_immutable_*`(0002) | `db.test.ts`, `rules.test.ts` [R-VERSION-01], `review-fixes.test.ts` |
| R-CONFIRM-05 | 의미 없는 항목("2")은 확정 불가 | `confirmPreview` `meaningless_*` | `rules.test.ts` |
| R-CONFIRM-06 | 원문이 바뀌어 근거 문장을 찾을 수 없는 요구사항은 확정 불가 | `confirmPreview` `quote_mismatch` | `rules.test.ts` |
| R-CONFIRM-07 | 확정 시 포함 요구사항 수·제외 질문/미확정 수 표시, 미해결 질문/미확정은 남겨둘 수 있되 작업 대상 제외 | `ConfirmDialog`, `confirmations.excluded_*` | `rules.test.ts`, E2E-04 |
| R-LOCK-01 | 확정 중에는 분석 편집 잠금(UI+서버+DB) | `assertReviewing`, `trg_items_locked_*` | `rules.test.ts`, `db.test.ts` |
| R-LOCK-02 | 삭제는 소프트 삭제 + 되돌리기 | `deleteItem`/`restoreItem` | `rules.test.ts`, E2E-09 |
| R-TASK-01 | 질문·미확정 사항은 작업 대상 아님(서버·DB). 작업의 연결(확정 항목·원 항목)은 만든 뒤 UPDATE 로도 바꿀 수 없음 | `createTasks`, `trg_tasks_requirement_only`, **`trg_tasks_link_immutable`(0002)** | `rules.test.ts`, `db.test.ts`, `review-fixes.test.ts`, E2E-04 |
| R-TASK-02 | 반복·동시 요청으로 작업이 중복 생성되지 않음(서버·DB UNIQUE) | `createTasks`, `tasks` UNIQUE ×2 | `rules.test.ts`, `db.test.ts` |
| R-TASK-03 | 완료 조건: 모호한 문장 거부, 기본값 없음, 생성 시 최소 1개, **작업을 유지하는 동안에도 마지막 1개는 삭제 불가(서버·DB)**, 제목 필수 | `shared/validation.ts#checkCriterion`, `TaskModal` | `rules.test.ts`, E2E-04·05 |
| R-TASK-04 | 확정 요구사항 하나당 작업 하나, 원본 요구사항과 연결 유지 | `tasks.confirmation_item_id`, `source_item_id` | `rules.test.ts` |
| R-TASK-05 | 작업 목록·상세: 상태 변경, 제목·설명 편집, **기존 완료 조건 문구 수정(ID·완료 상태 유지)**, 체크리스트, 요청으로 이동 | `TasksPage.tsx` | `rules.test.ts`, E2E-04·05, **E2E-F3** |
| R-VERSION-01 | 확정 후 변경하면 새 검토 버전, 기존 확정 기록·작업은 덮어쓰지 않음 | `reopenRequest` | `rules.test.ts`, E2E-06 |
| R-VERSION-02 | 새 확정 버전에서 같은 요구사항으로 작업 중복 생성 불가 | `tasks.source_item_id` UNIQUE | `rules.test.ts`, `db.test.ts` |
| R-VERSION-03 | 확정 후 원문 변경 → 새 검토 버전 + 원문 개정판 보존 + 연결 작업에 "원본 변경됨" 표시 | `updateRequest`, `taskChange()` | `rules.test.ts`, E2E-06 |
| R-UI-01 | B 디자인(README) 레이아웃·색·문구, 한국어, 제작 도구 UI 제외 | `web/src/*`, `styles.css` | 화면 확인(보고서 참조) — 픽셀 단위 비교는 **미검증** |
| R-UI-02 | 좁은 화면에서 잘라내지 않고 세로 배치 | `styles.css` `@media (max-width:1000px)` | E2E-10 |
| R-UI-03 | 상태를 색뿐 아니라 텍스트로 표시, 키보드·라벨·포커스 | `ui.tsx`, `styles.css`, `aria-*` | E2E-11(일부). 스크린 리더 실측은 **미검증** |
| R-SEC-01 | 무인증 로컬 서버 보호(범위: **브라우저를 거친 다른 웹사이트·다른 포트 웹 앱의 변경 요청**. Origin 없는 비브라우저 요청은 막지 못함): 127.0.0.1 바인딩 + Host 검사(DNS 리바인딩), Origin 허용 목록, Sec-Fetch-Site, JSON 이 아닌 본문 거부 | `server/app.ts` `/api/*` 미들웨어, `server/index.ts` | `security.test.ts` 5개, 실행 중인 서버에 직접 요청(403/415/201 확인) |
| R-DATA-01 | 요청 삭제 불가, 질문/미확정 상태 값 CHECK(**NULL 금지: `trg_items_resolution_required_*`(0002)**) | 마이그레이션 | `db.test.ts`, `review-fixes.test.ts` |
| R-DATA-02 | 샘플 데이터(모닝 스튜디오 등)가 §8 과 일치하고 원문에 없는 기능을 넣지 않음 | `server/db/seed.ts` | `db.test.ts` [R-DATA-02] |

## 1단계 범위 밖(다음 단계)

- 2단계: 분석 제공자 인터페이스, 모의 분석(`요청 분석하기`, 분석 중/실패/재시도), 재분석 사전 확인
- 3단계: 실제 AI 연결(제공자·인증·비용 확인 후)
- 외부 공개 배포(인증, HTTPS, DB 이전 등)
