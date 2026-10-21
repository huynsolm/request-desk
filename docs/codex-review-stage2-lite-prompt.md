# Codex 2단계 검수 — 경량 프롬프트 (토큰 절약용)

범위를 2단계 변경분으로 좁히고, 이미 통과한 1단계 검사를 반복하지 않으며, 보고서를 짧게 받습니다.

````text
request-desk 저장소의 stage-2-mock-analysis 브랜치를 검수해줘. 코드·설정·git 은 수정하지 마.
토큰을 아끼기 위해 아래 범위만 봐줘. 전체 문서를 읽거나 1단계 코드를 다시 훑지 마(1단계는 이미 검수·병합됨).

## 범위 (이것만)
main(d2346b5)과의 차이:
  git diff main..HEAD --stat
핵심 파일(이것부터 읽어줘):
  server/analysis/{types,mock-data,mock,registry,summary,run}.ts, server/db/migrations/0003_analysis_runs.sql,
  server/app.ts, server/service.ts(analysis·blocker 관련 부분만), server/index.ts, server/config.ts,
  web/src/pages/RequestDetailPage.tsx(분석 관련 부분), web/src/pages/Dialogs.tsx(ReanalyzeDialog),
  tests/server/analysis.test.ts, tests/e2e/stage2-analysis.spec.ts
설계 근거는 docs/decisions.md "2단계 설계 결정" 한 절과 docs/requirements.md 의 R-ANALYZE-01~16 만 보면 된다.
HEAD 해시를 보고서 첫 줄에 적어줘.

## 사용자 요구사항 (2단계, 원문 요약)
- 분석 호출을 별도 인터페이스로 분리, 실제 AI 와 모의 분석을 교체 가능하게 설계
- 개발·테스트용 모의 분석은 화면에 명확히 표시, 고정 응답을 실제 AI 분석처럼 보이게 하지 말 것
- 분석 결과는 항상 검토 전 제안으로 저장, 재분석이 사람의 편집 내용을 덮어쓰지 않도록 사전 확인
- 분석 중 / 분석 실패 / 재시도 지원, 응답 구조 검증·시간 초과·오류 처리
- 원문에 없는 기능이나 구현 방식을 "명시된 요구사항"에 넣지 말 것

## 확인할 것 (각 항목 한두 줄 판정)
1. 재분석이 정말 비파괴적인가: `applyResult` 가 기존 항목을 수정·삭제하지 않는지, 중복·삭제된 항목 처리, 분석 중 사람이 항목을 편집·삭제·답변·확정하려 할 때의 경쟁 조건(특히 트랜잭션 경계, `locked_confirmed` 트리거와의 상호작용).
2. 제공자 신뢰 경계: 제공자가 잘못된/악의적인 값을 줘도 DB 가 오염되지 않는가(zod strict + 항목별 규칙). 원문 근거 검증 우회(줄바꿈·공백·유니코드 정규화 차이), 길이 상한, 오류 메시지 노출.
3. 실행 수명: 진행 중 중복 방지(DB UNIQUE), 시간 초과(`raceAbort`)·제공자 멈춤·예외·처리되지 않은 Promise 거부, 서버 재시작(`failStaleRuns`), 분석 결과 반영 시점에 요청이 확정/원문 변경된 경우.
4. 화면: 분석 중·실패·재시도 상태 전이(RequestDetailPage), 폴링 정리·완료 알림 중복, 확정 단계와의 상호작용, "모의 분석 · 개발용" 표시가 모든 경로에서 보이는지, 모의 결과가 `AI 제안`으로 보이는 곳이 없는지.
5. 개발용 조절 엔드포인트(/api/dev/mock-analysis)가 기본 꺼짐이고 접근 검사(Host/Origin/JSON)를 지나는지.
6. 새 테스트가 규칙을 진짜 잡는지(빈 검증·시간 의존·고정 sleep 여부). 구현자는 핵심 규칙 5개를 일부러 깨서 테스트가 실패함을 확인했다고 보고(읽기만으로 판단해도 됨).

## 실행 (최소한만)
개발 DB(data/app.db)·3001/5173 서버는 건드리지 마. 별도 DB·포트 사용.
  npm run typecheck
  npm test                              # 기대: 83개 통과
  npx playwright test stage2-analysis   # 기대: 7개 통과 (전체 E2E 는 생략 가능)
다르면 실패한 것만 알려줘. 못 돌린 것은 "미검증"이라고만 적어줘.

## 보고 (짧게, 40줄 이내)
- 첫 줄: 검수한 HEAD 해시, 한 줄 총평(main 병합 가능 여부)
- 항목 1~6: 수정됨/문제없음/부분/새 문제 + 근거 한 줄
- 새 문제는 표 한 줄씩: 심각도 · 파일:줄 · 문제 · 재현 한 줄 · 제안 한 줄
- 실행 결과 한 줄씩. 칭찬·배경 설명·긴 로그·스크린샷·재현 스크립트 첨부는 생략.
````
