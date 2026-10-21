# Codex 3단계 검수 — 경량 프롬프트 (토큰 절약용)

````text
request-desk 저장소의 stage-3-ai-provider 브랜치를 검수해줘. 코드·설정·git 은 수정하지 마. 실제 Anthropic API 는 호출하지 마(키 없음, 가짜 서버만).
토큰을 아끼기 위해 아래 범위만 봐줘. 1·2단계는 이미 검수·병합됐으니 다시 훑지 마.

## 범위 (이것만)
main 과의 차이: git diff main..HEAD --stat
핵심 파일: server/analysis/{anthropic,registry,run,usage,types,summary}.ts, server/db/migrations/0004_analysis_usage.sql,
  server/app.ts, server/config.ts, shared/types.ts, web/src/pages/RequestDetailPage.tsx(분석/AI 안내 부분), web/src/pages/Dialogs.tsx(ReanalyzeDialog),
  tests/server/anthropic.test.ts, tests/e2e-ai/*, playwright.ai.config.ts, scripts/ai-smoke.ts, .env.example, README.md(실제 AI 켜기)
설계 근거: docs/decisions.md "3단계 설계 결정", docs/requirements.md R-AI-01~15, docs/reports/stage-3.md
HEAD 해시를 보고서 첫 줄에 적어줘.

## 사용자 요구사항 (3단계)
- 제공자 Anthropic Claude API, API 키는 서버 `.env` 에만(브라우저/응답/로그/저장소에 노출 금지)
- 비용 상한: 하루 20회 / 한 달 300회 — 서버가 강제
- 요청 원문이 외부로 전송됨을 사용자에게 알릴 것, 전송 범위 최소화
- AI 결과는 항상 `검토 전` 제안, 재분석이 사람의 편집을 덮어쓰지 않음, 원문에 없는 기능 금지
- 실패·시간 초과·거절·형식 오류 처리, 오류에 키/제공자 원문 노출 금지
- 실제 API 통신은 미검증으로 표시(통과했다고 쓰지 않음)

## 확인해줘 (재현 가능한 문제만)
1. 키가 어떤 경로(응답, 실행 기록, 콘솔 로그, 에러 메시지, 프론트 번들, git 추적 파일)로든 새는가
2. 사용량 상한 우회: 동시 요청(레이스), 날짜 경계, 실패/중단 실행 집계, `failStaleRuns`·재시작 후, 재분석 경로
3. `startAnalysis` 의 상한 검사와 INSERT 가 한 트랜잭션인가(동시 2건이 한도를 넘길 수 있는가)
4. 제공자 응답 검증 우회(구조화 출력이 아닌 값, 거대한 값, 원문 인용 조작)와 원문 지시문 주입 방어 한계
5. 화면: AI/모의 구분, 전송 안내, 사용량·한도 표시가 서버 상태와 어긋나는 경우
6. 문서가 미검증 항목을 통과로 오해하게 쓰였는가

## 보고 형식 (40줄 이내)
- 병합 차단 / 수정 권장 / 참고 로 나눠 각 항목: 파일:줄, 재현 방법, 기대 vs 실제
- 확인했지만 문제 없던 것은 한 줄로만
- 실행한 명령과 결과(통과/실패 수)
개발 DB(data/app.db)와 실행 중인 개발 서버(3001/5173)는 건드리지 마. 검증은 DB_PATH 와 포트를 따로 써줘.
````
