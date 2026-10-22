# Codex OpenAI(ChatGPT) 제공자 재검수 — 경량 프롬프트

````text
request-desk 저장소의 openai-provider 브랜치를 재검수해줘. 코드·설정·git 은 수정하지 마. 실제 OpenAI/Anthropic API 는 호출하지 마(키 없음, 가짜 서버만). .env 파일은 열지도 마.
이전 검수(HEAD f4a1af4)의 지적을 고친 커밋만 확인하는 재검수야. 토큰을 아끼기 위해 변경분만 봐줘. 이미 검수한 나머지는 다시 훑지 마.
HEAD 해시를 보고서 첫 줄에 적어줘(기대: 3f04583 이후 커밋. 3f04583 뒤에는 이 프롬프트 문서만 추가됨).

## 범위 (이것만)
변경분: git diff f4a1af4..3f04583 --stat  (기대: server/analysis/openai.ts, tests/server/openai.test.ts, README.md 3개 파일)
git diff f4a1af4..3f04583 -- server/analysis/openai.ts tests/server/openai.test.ts README.md

## 이전 지적과 수정 내용
- P2 리다이렉트: fetch 가 리다이렉트를 자동으로 따라가 허용 주소 밖으로 원문이 재전송됨 → fetch 옵션에 redirect:'error' 추가
- P2 본문 수신 오류: 200 헤더 후 본문을 받다 끊기면 invalid_response + 토큰 0 으로 기록됨 → 본문을 res.text() 로 먼저 끝까지 받고(실패하면 network, 사용량은 알리지 않음), 그다음 JSON.parse 로 해석(문법 오류만 invalid_response)
- 참고 README 환경 변수 표에 openai·OPENAI_API_KEY·OPENAI_MODEL 반영
- 회귀 테스트 R-OA-09(리다이렉트), R-OA-10(본문 단절), R-OA-11(JSON 아님) 추가. 09·10 은 수정 전 코드에서 실패함을 확인했다.

## 확인해줘 (재현 가능한 문제만)
1. 위 두 지적이 실제로 해결됐는지 가짜 서버로 직접 재현해 확인(리다이렉트 307/301/302/308 모두, 본문 단절·지연 후 단절).
2. 수정 때문에 생긴 부작용: 오류 상태(4xx/5xx) 응답의 본문 읽기 실패 시 처리, 시간 초과(AbortSignal)가 res.text() 본문 읽기 중에도 동작해 실행기가 timeout 으로 판단하는가, 정상 응답 경로·거절·잘림의 사용량 보고가 그대로인가.
3. redirect:'error' 가 정상 OpenAI 엔드포인트(리다이렉트 없는 https://api.openai.com/v1)에서 문제를 일으킬 가능성(예: 프록시 환경 변수)과, 오류 문구에 원래 예외 메시지가 새지 않는지.
4. 새 테스트가 항상 통과하도록 약하게 쓰였거나(예: 단언이 느슨함), 서로 영향을 주거나, 타이밍에 의존해 흔들릴 가능성이 있는가(여러 번 돌려 확인).
5. README 변경이 실제 동작(기본값·변수 이름)과 맞는가.

## 보고 형식 (25줄 이내)
- 병합 차단 / 수정 권장 / 참고 로 나눠 각 항목: 파일:줄, 재현 방법, 기대 vs 실제
- 확인했지만 문제 없던 것은 한 줄로만
- 실행한 명령과 결과(통과/실패 수)
개발 DB(data/app.db)와 실행 중인 개발 서버(3001/5173)는 건드리지 마. 검증은 DB_PATH 와 포트를 따로 써줘(예: DB_PATH=data/review.db, API_PORT=3399).
테스트는 `npm run typecheck`, `npx vitest run tests/server/openai.test.ts` 를 먼저 보고(흔들림 확인을 위해 3회), 전체 `npm test` 는 한 번만 돌려줘. E2E 는 서버 쪽 변경이라 돌리지 않아도 돼.
````
