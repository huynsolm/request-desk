# 리퀘스트 데스크 1단계 독립 검수

- 기준 커밋: `5a05652d2533910a67f13b6bc51d0d601f22cc63`
- 로컬 브랜치: `stage-1-review`
- 검수일: 2026-10-20
- 대상: `C:/작업/homepage_FDE/request-desk`
- 시작·종료 시 추적 파일 변경 없음. 소스·설정·커밋·원격 브랜치는 수정하지 않음.

## 1. 총평

**main 병합과 2단계 착수는 아래 수정·재검증 후 진행하는 것을 권장한다.** 기존 서버 테스트 51개, Chrome E2E 11개, 타입 검사, 프로덕션 빌드는 모두 독립 실행에서 통과했다. 그러나 별도 브라우저 장애 주입에서 저장 실패 후 최신 입력이 사라지는 두 경로를 재현했다. 완료 조건 문구 및 원문 인용의 편집 UI가 없고, 직접 SQL로 확인한 DB 제약에도 누락이 있다. 테스트 통과와 전체 요구사항 충족은 일치하지 않는다.

아래는 코드·실행으로 확인한 사실이다. DB 직접 SQL 지적은 현재 HTTP API를 통한 외부 침입 취약점이라는 뜻이 아니라, 문서에서 약속한 DB 방어선의 누락이다. 같은 PC의 일반 프로그램은 신뢰한다는 보안 가정은 그대로 인정했다.

## 2. 발견 사항

| 번호·심각도 | 위치 | 문제 | 재현·근거 | 관련 요구사항 | 수정 방향 |
|---|---|---|---|---|---|
| F1 · 높음/P1 | [RequestDetailPage.tsx:155](C:/작업/homepage_FDE/request-desk/web/src/pages/RequestDetailPage.tsx:155), [useSaver.ts:46](C:/작업/homepage_FDE/request-desk/web/src/pages/useSaver.ts:46) | 저장 실패 후 추가로 고친 최신 입력을 재시도가 버린다. | 항목을 A로 수정 → PATCH를 네트워크 오류로 실패시킴 → 남아 있는 입력창을 B로 수정 → ‘다시 저장’. 서버에는 A가 저장되고 입력창이 닫혀 B가 사라졌다. 최초 실패 시점의 `text`를 잡은 함수와 `setForm(null)` 콜백을 그대로 재실행한다. 두 번 재현. | R-INPUT-04 | 재시도 대상과 현재 초안을 구분한다. 최신 초안을 저장하거나, 제출했던 초안과 현재 입력이 동일한 경우에만 입력창을 닫는다. 취소·편집 대상 전환 시에도 과거 대기 작업이 새 초안을 지우지 않도록 한다. |
| F2 · 높음/P1 | [TasksPage.tsx:191](C:/작업/homepage_FDE/request-desk/web/src/pages/TasksPage.tsx:191), [TasksPage.tsx:209](C:/작업/homepage_FDE/request-desk/web/src/pages/TasksPage.tsx:209) | 작업 재시도 성공 시 패널 상태·버전이 갱신되지 않는다. 이어지는 편집에서 입력 유실이 발생한다. | 제목 PATCH 실패 → ‘다시 저장’ 성공 → 설명 입력·포커스 이동. 설명 PATCH가 오래된 `t.version`으로 409를 받고 `apply(fresh)`가 입력한 설명을 서버의 이전 설명으로 덮었다. 체크박스도 재시도 성공 후 서버 `done=true`, 화면 `aria-checked=false`로 남았다. 두 번 재현. | R-INPUT-04, R-TASK-05 | 최초 실행과 재시도에서 공통으로 성공 응답을 적용하도록 한다. 재시도에도 `t`와 `version`, 체크리스트, 목록을 갱신해야 한다. 충돌 시 새 데이터와 사용자 초안을 분리해 초안을 보존한다. |
| F3 · 중간/P2 | [TasksPage.tsx:348](C:/작업/homepage_FDE/request-desk/web/src/pages/TasksPage.tsx:348) | 기존 완료 조건의 문구를 수정할 UI가 없다. | 완료 조건은 일반 `<span>`이고 체크·삭제·새 항목 추가만 제공한다. 실제 패널의 textbox는 제목·설명·완료 조건 추가뿐이다. 서버의 `updateCriterion({text})` 기능은 있으나 화면에 연결되지 않았다. 삭제 후 재추가는 기존 조건의 ID·완료 상태를 유지하는 편집이 아니다. | R-TASK-05 | 기존 조건의 문구 편집·검증·실패 시 초안 보존 UI를 추가하고 기존 ID를 유지해 PATCH한다. |
| F4 · 중간/P2 | [api.ts:72](C:/작업/homepage_FDE/request-desk/web/src/api.ts:72), [RequestDetailPage.tsx:155](C:/작업/homepage_FDE/request-desk/web/src/pages/RequestDetailPage.tsx:155) | 원문이 바뀌어 무효가 된 근거 인용문을 화면에서 고칠 수 없다. | 원문 인용을 가진 요구사항을 만든 뒤 원문의 표현을 변경했다. 서버 `quoteValid=false`, 화면 확정 버튼 비활성은 올바르다. 그러나 ‘수정’에는 내용 입력창 하나뿐이고, 클라이언트 API도 `content`만 전달해 인용을 바로잡을 수 없다. 1단계 모의 시드에도 원문 인용이 있으므로 향후 AI 단계만의 문제가 아니다. | R-QUOTE-01, R-CONFIRM-06, R-VERSION-03 관련 사용자 흐름 | 인용 편집 필드와 서버 quote PATCH를 연결한다. AI·모의 항목의 필수 인용 규칙은 유지한다. 기존 요구사항 ID를 보존하여 작업 연결을 유지한다. |
| F5 · 중간/P2 | [0001_init.sql:161](C:/작업/homepage_FDE/request-desk/server/db/migrations/0001_init.sql:161) | 작업 대상 종류·원 항목 일치 검사가 INSERT에만 있다. | 정상 생성한 작업을 직접 `UPDATE tasks SET confirmation_item_id=?, source_item_id=? WHERE id=?`로 질문의 스냅숏·원 항목에 연결했을 때 성공했다. 그 후 작업 조회의 `requirementText`가 “결제가 필요한가요?”가 되었다. 현재 공개 API에서 연결 필드를 수정하는 경로는 발견하지 않았다. | R-TASK-01, R-TASK-04 | 연결 필드를 불변으로 만들거나 UPDATE에도 종류·연결 일치 검사를 추가한다. 기존 DB에 적용되는 새 마이그레이션 및 직접 UPDATE 회귀 테스트가 필요하다. |
| F6 · 중간/P2 | [0001_init.sql:48](C:/작업/homepage_FDE/request-desk/server/db/migrations/0001_init.sql:48), [service.ts:627](C:/작업/homepage_FDE/request-desk/server/service.ts:627) | 질문·미확정 상태 CHECK가 NULL을 허용한다. | 직접 SQL로 `kind='question', resolution=NULL, review_state='reviewed'`를 넣을 수 있었다. 확정 미리보기는 제외 질문 1개·미해결 질문 0개로 계산하고, 다른 정상 요구사항이 있으면 확정도 200으로 성공했다. 현재 추가 API는 정상값을 쓰지만 DB 마지막 방어선이 규칙을 보장하지 못한다. | R-DATA-01, R-REVIEW-02, R-CONFIRM-07 | 질문·미확정 분기에 `resolution IS NOT NULL`을 명시하고 필요한 상태 조합을 새 마이그레이션으로 강제한다. NULL INSERT·UPDATE와 미해결 개수 회귀 테스트를 추가한다. |

### 추가 확인·정책 명확화

아래는 위 6건과 구분하며, 모두 즉시 병합 차단 결함으로 간주하지는 않는다.

- **완료 조건 최소 1개 정책:** [service.ts:831](C:/작업/homepage_FDE/request-desk/server/service.ts:831)의 마지막 조건 삭제가 200으로 성공해 `criteria=[]`인 작업이 남는다. 생성 시 최소 1개는 강제한다. 최소 1개를 생성 시에만 요구하는지, 작업 유지 중에도 요구하는지 문서에 명시해야 한다. 후자라면 삭제 API에도 제약이 필요하다.
- **잘못된 요청 형태:** `POST /api/requests/:id/tasks`에 `{"tasks":[null]}`을 보내면 422가 아니라 500이다. `createTasks`가 원소의 런타임 타입을 검사하기 전에 `confirmationItemId`를 읽는다. 현재 정상 UI로 재현되는 문제는 아니지만 JSON 스키마 검증을 권장한다.
- **원문 개정판 DB 불변성:** `request_originals`는 직접 UPDATE가 가능했다. 정상 서비스의 원문 수정은 새 rev를 추가하고 과거 내용을 보존한다. 확정 당시 원문까지 DB 차원에서 불변을 보장하려면 해당 테이블에도 정책·제약이 필요하다.
- **입력 크기:** 요청 본문과 문자열의 상한이 없다. 특히 비JSON 검사에서도 전체 본문을 읽는다. 로컬 단일 사용자 범위에서는 위험이 제한적이지만, 대형 붙여넣기·비정상 클라이언트 대비 크기 제한이 있으면 좋다. 메모리 고갈 부하 테스트는 수행하지 않았다.
- **의미 검증 한계:** 한국어·영문 글자 수의 입력 기준은 문서의 결정과 일치한다. 완료 조건은 길이·금지 표현 검사이지 의미를 보장하는 검사가 아니다. 이미 문서에 명시된 한계이며 AI 의미 판정을 추가하라는 요구는 아니다.
- **원본 변경 표시:** 현재 내용·인용과 스냅숏의 차이를 계산하므로 수정했다가 완전히 되돌리면 분석 내용 변경 표시는 사라진다. “현재 내용이 다름”과 “한 번이라도 수정한 이력이 있음” 중 무엇을 표시할지 구분하는 것이 좋다. 현재 요구사항만으로 후자를 반드시 요구한다고 판단하지 않았다.

## 3. 요구사항별 판정

‘충족’은 이번에 확인한 코드·테스트 경로에서 충족한다는 의미이며 모든 가능한 입력에 대한 보장은 아니다.

| ID | 판정 | 근거 |
|---|---|---|
| R-PERSIST-01 | 충족 | DB 연결 재개방 비교 테스트 및 E2E 새로고침 통과. 기존 개발 DB 대신 테스트용 DB 사용. |
| R-INPUT-01 | 충족 | 의미 부족 입력 API·DB 테스트 통과. 문서에 정한 한글/영문 기준과 일치. |
| R-INPUT-02 | 충족 | 공백·줄바꿈 보존 테스트 통과. 원문 trim 없이 저장. CR 및 CRLF는 LF로 정규화. |
| R-INPUT-03 | 충족 | 서버 필드 오류와 E2E 등록 검증 통과. |
| R-INPUT-04 | 부분 | 기본 실패·재시도는 통과하지만 F1·F2에서 최신 입력 유실. |
| R-LIST-01 | 충족 | 검색·필터·빈 상태 서버/E2E 통과. LIKE 특수문자 이스케이프 확인. |
| R-REVIEW-01 | 충족 | 실제 항목 내용 변경 시 서버에서 unreviewed 전환, DB content/quote 변경 방어 테스트 통과. |
| R-REVIEW-02 | 부분 | 정상 API는 검토와 답변 상태를 분리. 직접 SQL의 NULL 상태는 F6. |
| R-CONVERT-01 | 충족 | 답변/결정 필요, 근거 필수, 명시적 전환·검토 전 상태를 서버/E2E로 확인. |
| R-QUOTE-01 | 부분 | 인용 존재 검증 API·DB는 통과. 사용자 인용 수정 경로는 F4. |
| R-CONFIRM-01 | 충족 | 모든 활성 항목의 검토 여부를 서버에서 검사. 기존 테스트 통과. |
| R-CONFIRM-02 | 충족 | 요구사항 0개 확정 거부 테스트 통과. |
| R-CONFIRM-03 | 충족 | 확인 모달 및 contentSeq 이후 변경 거부. 동기 트랜잭션 안에서 재검사. |
| R-CONFIRM-04 | 충족 | confirmations/confirmation_items UPDATE·DELETE 방어와 이전 스냅숏 보존 테스트 통과. 원문 개정판의 직접 SQL 불변성은 별도 추가 확인 사항. |
| R-CONFIRM-05 | 충족 | API 추가 검증 및 직접 삽입한 의미 부족 항목의 확정 거부 테스트 통과. |
| R-CONFIRM-06 | 충족 | 원문 불일치 시 서버 확정 차단. 브라우저에서도 비활성 확인. 복구 UI는 F4. |
| R-CONFIRM-07 | 부분 | 정상 데이터의 포함/제외 개수·작업 제외는 충족. F6의 NULL 질문은 미해결 개수에서 누락. |
| R-LOCK-01 | 충족 | 정상 API 및 직접 INSERT/UPDATE의 확정 중 편집 차단 테스트 통과. |
| R-LOCK-02 | 충족 | 소프트 삭제 및 되돌리기 서버/E2E 통과. |
| R-TASK-01 | 부분 | 생성 API와 DB INSERT는 차단. DB UPDATE는 F5. |
| R-TASK-02 | 충족 | 반복·동시 호출과 UNIQUE 테스트 통과. 별도로 첫 INSERT 후 두 번째 대상 오류 시 전체 롤백 확인. |
| R-TASK-03 | 충족(생성 기준) | 빈 조건·대표 모호 표현·빈 제목 거부, 임의 기본 완료 조건 없음. 생성 이후 최소 1개 정책은 추가 확인 사항. |
| R-TASK-04 | 부분 | 정상 생성·재확정 연결은 유지. DB 직접 UPDATE 방어는 F5. |
| R-TASK-05 | 부분 | 정상 상태 변경·제목·설명·체크·추가·삭제·이동은 통과. 기존 조건 문구 수정 UI F3, 재시도 상태 갱신 F2. |
| R-VERSION-01 | 충족 | 다시 검토·재확정에서 이전 스냅숏과 작업 보존 테스트 통과. |
| R-VERSION-02 | 충족 | source_item_id UNIQUE와 서비스의 기존 작업 반환 테스트 통과. |
| R-VERSION-03 | 충족(서버) | 원문 rev 추가, 새 검토 버전, 작업 변경 표시 테스트 통과. 인용 수정 사용자 흐름 F4. |
| R-UI-01 | 부분 | 실제 Chrome 화면에서 한국어·2열 상세·색상·주요 구성 확인. 디자인 프로토타입과 픽셀 단위 비교는 미검증. |
| R-UI-02 | 충족(검사 폭) | E2E 375px 긴 원문 검사 통과. 추가 375px 실제 화면의 scrollWidth=375, 세로 배치 확인. |
| R-UI-03 | 부분 | E2E 키보드 포커스·Esc 복귀 통과, 상태 텍스트 존재. 스크린 리더·전체 접근성·대비 실측은 미검증. |
| R-SEC-01 | 충족(명시된 범위) | 5개 보안 테스트 통과. 별도 실행 서버에서 외부/다른 포트 Origin 403, cross-site 403, text/plain 415 확인. 비브라우저 요청 허용은 의도된 정책. |
| R-DATA-01 | 부분 | 요청 삭제 차단·대표 잘못된 상태 차단 통과. NULL 상태 조합은 F6. |
| R-DATA-02 | 충족 | 시드 테스트와 seed 코드 확인. 원문에 없는 기능을 요구사항으로 확정하지 않으며 모의 제안 라벨 유지. |

## 4. 실행 결과 및 증거

| 실행 | 실제 결과 |
|---|---|
| `git rev-parse HEAD`, `git status --short`, 브랜치 확인 | 기준 커밋 일치, `stage-1-review`, 추적 파일 변경 없음 |
| `node --version` | v24.21.0 |
| `npm ls --depth=0` | 직접 의존성 목록 확인, 명령 성공 |
| `node node_modules/vitest/vitest.mjs run --configLoader native --no-cache` | 3개 파일, **51 passed**, 약 3.55초 |
| `node node_modules/typescript/bin/tsc --noEmit` | 종료 코드 0, 오류 없음 |
| `npm run build` | tsc 및 Vite 빌드 성공, 34개 모듈, dist/web 생성 |
| `npm run test:e2e` | Chrome **11 passed**, 약 1.4분 |
| 별도 브라우저 재현 스크립트 | F1·F2 두 번 재현, F3 DOM 확인, F4 인용 불일치·편집 UI 부재 확인 |
| 메모리 DB 추가 API/SQL 검사 | 중간 실패 작업 생성 전체 롤백 확인, F5·F6 재현, 마지막 조건 삭제·잘못된 JSON·원문 rev 직접 수정 확인 |
| 실행 서버 HTTP 검사 | 허용되지 않은 Origin 403, cross-site 403, 비JSON 본문 415 |
| `git ls-files` 점검 | 개발 DB·실제 .env·node_modules 추적 없음. `.env.example`은 추적됨 |

### 브라우저 재현 핵심 출력

```text
criterion retry state {"ui":"false","server":true}
task retry then edit {"status":409,
  "serverDescription":"요청 ‘독립 검수 요청’에서 확정한 요구사항 ‘예약 가능한 날짜 조회’을 구현해요.",
  "uiDescription":"요청 ‘독립 검수 요청’에서 확정한 요구사항 ‘예약 가능한 날짜 조회’을 구현해요."}
item retry after typing {"server":"첫 번째 실패한 변경 내용","editorClosed":true}
quote repair UI {"confirmDisabled":true,"textboxes":["내용을 입력해 주세요"],"quoteValid":false}
mobile dimensions { width: 375, scrollWidth: 375 }
NULL question preview {"excluded":1,"unresolved":0,"blockers":[]}
NULL question confirm status 200
UPDATE linked requirement becomes question "결제가 필요한가요?"
```

F1에서 재시도 직전 실제 입력은 **“실패 후 다시 고친 최신 내용”**이었다. F2에서 409 직전 설명 입력은 **“재시도 성공 이후에 쓴 중요한 설명”**이었다.

재현 스크립트: [request-desk-review.mjs](C:/Users/User/.codex/visualizations/2026/10/15/01a13cfc-7ca6-7841-b366-2cc72eb34392/request-desk-review.mjs)

화면 증거:

- [요청 상세 1440px](C:/Users/User/.codex/visualizations/2026/10/15/01a13cfc-7ca6-7841-b366-2cc72eb34392/review-detail-desktop.png)
- [요청 상세 375px](C:/Users/User/.codex/visualizations/2026/10/15/01a13cfc-7ca6-7841-b366-2cc72eb34392/review-detail-mobile.png)
- [작업 상세 1440px](C:/Users/User/.codex/visualizations/2026/10/15/01a13cfc-7ca6-7841-b366-2cc72eb34392/review-task-desktop.png)

## 5. 미검증·범위 제한 및 환경 보존

- `npm ci`는 실행하지 않았다. 사용자가 기존 개발 서버를 유지하고 있어 공유 node_modules를 재설치하지 않고 설치된 의존성으로 실행했다. 따라서 깨끗한 신규 설치의 재현성은 미검증이다.
- E2E는 프로젝트 설정대로 `3199/5199`, `data/e2e.db`를 사용했다. 테스트 DB는 E2E 실행 시 재생성됐다. 개발용 `data/app.db` 초기화·조회·변경 명령은 실행하지 않았다.
- 추가 실브라우저 검사는 **3299 포트 + `DB_PATH=:memory:`**에서 빌드된 앱을 사용했다. 검수 종료 후 이 서버를 종료했으며 해당 메모리 DB는 폐기됐다.
- 기존 개발 서버 3001/5173은 종료하거나 설정을 바꾸지 않았다. 빌드 산출물 `dist/web`과 E2E 산출물은 갱신됐다.
- 스크린 리더, Chrome 이외 브라우저, 실제 한글 IME 조합, 픽셀 단위 디자인 비교, 전면적인 대비 검사, 메모리 고갈·장시간 부하 검사는 미검증이다.
- 테스트가 모든 규칙을 검출한다는 보장은 하지 않는다. 소스 변경 금지 조건에 따라 프로덕션 코드를 일부러 변경하는 mutation testing은 수행하지 않았다. 대신 기존 테스트를 읽고 정상 흐름 외 장애·직접 SQL 입력을 추가 검사했다.
- GitHub 원격 상태 재조회·push·main 병합은 검수 범위에 포함하지 않았다.
- 웹 검색·외부 서비스로 사용자 요청 데이터를 전송하지 않았다. 앱의 기존 외부 폰트 요청은 별개다.

## 6. 재검수 권장 순서

1. F1·F2의 회귀 테스트를 먼저 추가한다: 실패 → 초안 추가 수정 → 재시도, 실패 → 취소/다른 편집 → 재시도, 작업 재시도 → 다음 편집, 체크리스트 재시도.
2. F3·F4의 빠진 편집 경로를 구현하고 기존 항목 ID·작업 연결·완료 상태 보존을 확인한다.
3. F5·F6은 새 마이그레이션으로 기존 DB에 적용하며 직접 INSERT뿐 아니라 UPDATE·NULL 사례도 검사한다.
4. 완료 조건 최소 1개 유지 정책을 확정한다.
5. 서버 전체·E2E·빌드 및 위 재현을 다시 실행한 뒤 main 병합/2단계를 진행한다.
