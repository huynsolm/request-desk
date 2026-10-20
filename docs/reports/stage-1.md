# 1단계 완료 보고 — AI 없는 핵심 기능

## 구현한 기능
요청 등록·조회·수정 → 분석 항목 수동 작성·편집·검토 → 질문 답변/미확정 결정 기록과 요구사항 전환 → 확정(확인창) → 작업 생성 → 작업 상태·완료 조건 관리. 모두 서버·SQLite 에 저장되며 서버(와 DB)에서 규칙을 검증합니다. 화면은 기준 디자인(B, `docs/design/README.md`)을 따릅니다.
요구사항별 구현 위치·테스트는 [requirements.md](../requirements.md), 디자인과 달라진 점은 [decisions.md](../decisions.md) 참조.

## 주요 변경 파일
- DB: `server/db/migrations/0001_init.sql`(스키마·트리거·뷰), `open.ts`, `migrate.ts`, `seed.ts`, `reset.ts`
- 서버: `server/service.ts`(규칙), `app.ts`(API), `errors.ts`, `index.ts`
- 공용: `shared/types.ts`, `shared/validation.ts`
- 웹: `web/src/App.tsx`, `pages/{RequestsPage,RequestPanel,RequestDetailPage,ItemSection,Dialogs,TasksPage,useSaver}`, `ui.tsx`, `api.ts`, `styles.css`
- 테스트: `tests/server/{helpers,rules,db}.test.ts`, `tests/e2e/flow.spec.ts`
- 문서: `README.md`, `docs/*`

## 실행·DB 초기화
```bash
npm install
npm run db:reset                          # 샘플 3건(모닝 스튜디오는 '접수')
npm run db:reset -- --morning-analysis    # 모닝 스튜디오에 §8 샘플 분석(모의 제안, 검토 전)도 넣기
npm run db:reset -- --empty               # 빈 DB(첫 사용 상태)
npm run dev                               # http://localhost:5173 (API 127.0.0.1:3001)
```

## 수행한 테스트와 실제 결과
| 검증 | 명령 | 결과 |
|---|---|---|
| 타입 검사 | `npm run typecheck` | 오류 없음 |
| 서버 규칙 + DB 직접 SQL | `npm test` | **51개 통과** (3 파일; 접근 검사 5개 포함) |
| 브라우저 시나리오 | `npm run test:e2e` (Chrome) | **11개 통과** (CSS 수정 후 재실행 포함, 1.4분) |
| 프로덕션 빌드 | `npm run build` | 성공 (dist/web) |

요청하신 검증 항목과 대응:
- 새로고침 후 데이터 유지 → DB 연결을 닫고 다시 열어 비교(`db.test.ts`) + 브라우저 새로고침(E2E-01·05)
- 검토 전 확정 차단 → `rules.test.ts`(API 직접 호출), E2E-04
- 질문·미확정 작업 생성 차단 → API(`rules.test.ts`)와 DB 직접 INSERT(`db.test.ts`) 모두
- 반복 요청 중복 방지 → 동시 10회 요청 시 작업 1개, 직접 SQL 이중 INSERT 거부, 재확정 버전에서도 거부
- 수정 후 재검토 필요 → `rules.test.ts`, 직접 UPDATE 거부(`db.test.ts`), E2E-04
- 기존 확정 버전·작업 보존 → `rules.test.ts` [R-VERSION-01/03], 불변 트리거 테스트, E2E-06
- 실패 시 입력 보존 → E2E-02(등록), E2E-08(항목 편집, 네트워크 차단으로 재현)
- "2" 입력 → 등록·항목 추가·확정 단계·DB CHECK 에서 모두 거부
- 직접 화면 확인: 요청 목록, 상세(1440폭), 375px 폭 상세, 작업 화면(패널 열림). 긴 원문·좁은 화면은 E2E-10 이 가로 스크롤 없음과 세로 배치를 확인

테스트가 실제로 규칙을 잡는지 확인하려고 규칙을 일부러 깨 보았습니다(검토 전 차단 제거 → 3개 실패, 중복 방지 로직 제거 → 2개 실패 등, 원복 후 46개 통과).
테스트를 쓰는 과정에서 찾은 실제 문제: 접근성 라벨의 어색한 문구("미해결으로")를 고쳤고, 좁은 데스크톱(1000~1300px)에서 작업 상세 패널이 열리면 목록 열이 잘려서 행을 세로로 쌓도록 고쳤습니다.

## 보안 보강 (검수 피드백 반영, 6abfaa4 이후 커밋)
무인증 로컬 서버가 다른 웹사이트의 변경 요청에 열려 있었습니다(서버가 Content-Type·Origin·Host 를 검사하지 않아 `text/plain` 폼 전송이 통과할 수 있었음). `/api/*` 에 Host·Origin·Sec-Fetch-Site·JSON 본문 검사를 추가하고 `security.test.ts` 로 검증했습니다. 처음 구현은 Content-Length 헤더에만 의존해 테스트에서 허점이 드러났고, 실제 본문을 읽어 확인하도록 고쳤습니다. **보호 범위(정정)**: 브라우저를 거쳐 오는 다른 웹사이트·다른 포트의 웹 앱의 변경 요청을 막는 것이 목적입니다. `Origin` 헤더가 없는 요청은 허용하므로(테스트·curl 용), **같은 PC 에서 도는 일반 프로그램·스크립트·curl 의 접근은 막지 못합니다.** 인증과 CSRF 토큰도 없으므로 외부 공개 배포 전에는 별도 설계가 필요합니다.

## 미완료·미검증
- **픽셀 단위 디자인 일치는 미검증.** 기준 프로토타입(`docs/design/request-desk-v2.dc.html`)과 화면을 나란히 비교하지 못했습니다(브라우저 패널이 정적 스냅숏으로만 열어줌). README 수치(색·간격·글자 크기)를 CSS 로 옮겼을 뿐입니다.
- 스크린 리더, Chrome 외 브라우저, 한글 IME 로 직접 입력하며 Enter 처리하는 실사용은 미검증(코드에서 `isComposing` 확인만 구현).
- 모호한 완료 조건 걸러내기는 문자열 규칙이라 모든 모호한 문장을 막지는 못함.
- 첫 실행 시 `tsx watch` 서버가 뜨기 전 몇 초간 화면에 연결 오류가 보일 수 있음.
- 2단계(모의 분석)·3단계(실제 AI)·외부 배포는 미구현. 샘플 분석 항목(`--morning-analysis`)은 모의 제안 라벨의 시드이며 AI 결과가 아님.
- 요구사항에 없던 선택(완료 조건 최소 1개 등)은 [decisions.md](../decisions.md) "가정한 것" 참조.

## Codex 가 집중 검수할 부분
1. `server/service.ts` `confirmPreview`/`confirmRequest`: 확정 조건, `contentSeq` 승인 토큰, 확정 기록 스냅숏
2. `0001_init.sql` 트리거: 확정 중 잠금, 수정 시 재검토, 인용 검증, 확정 기록 불변, 작업 대상 제한. 서버 로직과 이중으로 어긋나는 경우가 없는지
3. `createTasks`: 원자성(검증 실패 시 하나도 안 만들어짐), 멱등(기존 작업 반환), `tasks.source_item_id` UNIQUE 와 새 확정 버전의 상호작용
4. `updateRequest`/`reopenRequest`/`taskChange()`: 새 검토 버전 전환과 `원본 변경됨` 계산(저장하지 않고 매번 계산)
5. `RequestDetailPage.tsx` `commitForm`/`useSaver.ts`: 저장 실패·재시도 시 입력값 보존, 대기열 key 중복 처리, 오래된 `version` 으로 재시도할 때의 동작
6. 인용 검증은 쓰기 시점에만 DB 에서 검사되고 이후 원문 변경은 `quoteValid` 로 계산해 확정 차단(`quote_mismatch`)하는 구조가 충분한지
7. `shared/validation.ts` 의미 없는 입력 기준(글자 수 기반)이 한국어 입력에 지나치게 엄격하거나 느슨하지 않은지
