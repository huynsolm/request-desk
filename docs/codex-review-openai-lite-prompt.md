# Codex OpenAI(ChatGPT) 제공자 검수 — 경량 프롬프트

````text
request-desk 저장소의 openai-provider 브랜치를 검수해줘. 코드·설정·git 은 수정하지 마. 실제 OpenAI/Anthropic API 는 호출하지 마(키 없음, 가짜 서버만). .env 파일은 열지도 마.
토큰을 아끼기 위해 아래 범위만 봐줘. 1~3단계는 이미 검수·병합됐으니 다시 훑지 마.

## 범위 (이것만)
main 과의 차이: git diff main..HEAD --stat  (코드 변경은 서버 쪽 6개 파일 + 테스트 1개)
핵심 파일: server/analysis/openai.ts(신규), server/analysis/prompt.ts(신규: 두 제공자가 공유하는 시스템 프롬프트),
  server/analysis/anthropic.ts(프롬프트 분리만), server/analysis/registry.ts, server/config.ts, scripts/ai-smoke.ts,
  tests/server/openai.test.ts, .env.example, README.md("ChatGPT(OpenAI) 로 켜기"), CLAUDE.md
참고(변경 없음, 비교용): server/analysis/run.ts(검증·상한·실행 기록), tests/server/anthropic.test.ts
HEAD 해시를 보고서 첫 줄에 적어줘.

## 변경 요약
- ANALYSIS_PROVIDER=openai 로 ChatGPT(OpenAI Chat Completions, 구조화 출력 strict)를 쓸 수 있게 추가. 새 의존성 없이 fetch 사용. Anthropic(ANALYSIS_PROVIDER=ai)은 그대로 유지.
- 두 제공자 모두 provider.id='ai' 라서 DB 마이그레이션·화면 코드는 바꾸지 않았다. 전송 대상 표시는 sendsDataTo='OpenAI'.
- 시스템 프롬프트를 prompt.ts 로 분리했고, 확인할 질문·미확정 사항을 "꼭 필요한 것만, 각 최대 3개"로 제한하는 문구를 넣었다(샘플 원문 두 문장에 질문 9·미확정 5가 나와서).
- config: mock 이 아니면 분석 시간 초과 기본값 120초(예전엔 provider==='ai' 일 때만).

## 사용자 요구사항 (기존 3단계 규칙이 openai 에도 그대로 적용돼야 함)
- API 키는 서버 `.env` 에만(브라우저/응답/로그/실행 기록/저장소에 노출 금지)
- 호출 횟수 상한 하루 20 / 한 달 300 — 서버 강제(제공자와 무관하게 동작해야 함)
- 요청 원문만 외부로 전송(제목·고객명 제외), 화면에 전송 안내
- AI 결과는 항상 `검토 전` 제안, 기존 항목을 수정·삭제하지 않음, 원문에 없는 기능 금지(인용 검증)
- 실패·시간 초과·거절·잘림·형식 오류 처리, 오류에 키/제공자 원문 노출 금지
- 실제 API 통신 검증 범위를 과장하지 않음: OpenAI 는 스모크 1회(샘플 1건)만 성공, Anthropic 과 다건 품질은 미검증, 프롬프트 변경 후 실제 응답 개수도 미검증

## 확인해줘 (재현 가능한 문제만)
1. 키 노출: Authorization 헤더·요청 본문·응답 본문·오류 메시지·콘솔 로그·실행 기록·ai-smoke 출력·테스트 산출물 중 어디로든 새는가. fetch 가 던지는 예외(cause 등)가 그대로 노출되는 경로는 없는가.
2. 오류 매핑: HTTP 상태·error.code 처리(401/403, 402·insufficient_quota, 429, 404, 400, 5xx, 응답 본문이 JSON 이 아닌 경우)가 올바르고, 응답 본문이 사용자에게 전달되지 않는가. 매핑이 빠지거나 잘못된 상태가 있는가.
3. 시간 초과·취소: AbortSignal 이 fetch 와 `res.json()` 본문 읽기까지 적용되는가(헤더만 오고 본문이 멈추는 경우). 응답 크기 상한이 없는데 거대한 응답이 문제를 일으킬 수 있는가.
4. 사용량 집계: 성공·거절(refusal)·잘림(finish_reason=length)·content_filter 에서 토큰이 기록되는가. 오류 상태(4xx/5xx)에서는 사용량이 없는데 횟수 상한에는 포함되는가(run.ts 와 정합).
5. 응답 검증 우회: choices 가 비었거나 content 가 문자열이 아닌 경우, 구조화 출력이 아닌 값·여분 필드·원문 인용 조작이 서버 검증(run.ts)에서 막히는가. 원문 지시문 주입 방어(경계 문자열)가 openai 경로에서도 동일한가.
6. baseURL 가드: OPENAI_BASE_URL 이 localhost/127.0.0.1 외에는 막히는가(우회 예: userinfo `http://127.0.0.1@evil`, 대소문자, 점 표기, IPv6 `[::1]`, 리다이렉트). 키가 다른 호스트로 갈 수 있는 경로가 있는가. fetch 리다이렉트를 따라가며 Authorization 헤더가 다른 호스트로 전달되는 경우는 없는가.
7. 설정: ANALYSIS_PROVIDER 오타·빈 값·대소문자, OPENAI_API_KEY 누락, AI_DAILY_LIMIT 잘못된 값의 처리. config.ts 의 시간 초과 기본값 변경이 mock 에 영향을 주지 않는가.
8. 프롬프트 변경이 기존 원칙을 깨지 않는가: 인용(quote) 규칙·"원문에 없는 기능 금지"·세 종류(명시된 요구사항/확인할 질문/미확정) 구분이 유지되는가. "최대 3개" 제한이 프롬프트에만 있고 서버가 강제하지 않는 점은 의도된 것이니, 이로 인한 실제 문제 시나리오가 있을 때만 알려줘. strict JSON 스키마(openai.ts)가 OpenAI 구조화 출력 규칙(모든 필드 required, additionalProperties:false)에 맞는가.
9. 문서(README·CLAUDE.md·HANDOFF.md)가 미검증 항목을 통과로 오해하게 쓰였는가, 설정 안내가 실제 동작과 다른가.

## 보고 형식 (40줄 이내)
- 병합 차단 / 수정 권장 / 참고 로 나눠 각 항목: 파일:줄, 재현 방법, 기대 vs 실제
- 확인했지만 문제 없던 것은 한 줄로만
- 실행한 명령과 결과(통과/실패 수)
개발 DB(data/app.db)와 실행 중인 개발 서버(3001/5173)는 건드리지 마. 검증은 DB_PATH 와 포트를 따로 써줘(예: DB_PATH=data/review.db, API_PORT=3399).
테스트는 `npm run typecheck`, `npx vitest run tests/server/openai.test.ts tests/server/anthropic.test.ts` 를 먼저 보고, 전체 `npm test` 는 한 번만 돌려줘. E2E 는 이번 변경(서버 쪽만)과 관련이 적으니 돌리지 않아도 돼.
````
