# Codex 4차 재검수 — 경량 프롬프트 (토큰 절약용)

전체 프롬프트([codex-rereview-4-prompt.md](codex-rereview-4-prompt.md))를 줄인 버전입니다. 범위를 **이번 변경분**으로 좁히고, 이미 통과한 검사를 반복하지 않으며, 보고서를 짧게 받습니다.

````text
request-desk 저장소의 stage-1-review 브랜치를 검수해줘. 코드·설정·git 은 수정하지 마.
토큰을 아끼기 위해 아래 범위만 봐줘. 전체 문서를 읽거나 전체 테스트를 반복하지 마.

## 범위 (이것만)
직전 검수 기준 be7e60d 이후 변경 중 코드 3개 + 테스트 1개:
  git diff be7e60d..HEAD -- web/src/pages/TasksPage.tsx web/src/pages/RequestDetailPage.tsx web/src/pages/ItemSection.tsx tests/e2e/recovery.spec.ts
(HEAD 의 코드는 e0dea65 와 같고 그 뒤 커밋은 문서만 바뀌었다. HEAD 해시만 보고서 첫 줄에 적어줘.)
위 diff 와 그 주변 함수만 읽어줘. 다른 파일은 필요할 때만.

## 확인할 것 (각 항목 한두 줄 판정)
1. R2: 작업 상세에서 건드리지 않은 칸(제목/설명)이 충돌·재시도·포커스 이동 후 서버의 최신 값을 덮어쓰지 않는가? 고친 초안은 보존되는가? (TasksPage.tsx `dirtyRef`, `applyKeepDrafts`, `save`, 제목·설명 onChange/onBlur)
2. dirty 허점: 저장 요청 중에 더 입력 / 고쳤다가 원래 값으로 되돌림 / 한글 IME 조합 중 blur / 작업 전환 시 상태 유입 중 오동작이 있는가?
3. 구현자가 추가로 고친 항목 수정 창(RequestDetailPage.tsx `commitForm`, `FormState.base`): 열 때의 값과 같으면 저장하지 않는 수정이 타당한가? 질문 답변·전환 입력창에 같은 유형이 남았는가?
4. T1: recovery.spec.ts 의 F3 테스트가 삭제 반영을 기다리는가? 같은 유형(비동기 반영 전 단일 요소 단정)이 더 있는가?
5. 새 회귀 테스트 E2E-R2 3개가 R2 를 실제로 잡는가(읽기만으로 판단).

## 실행 (최소한만)
npm ci 는 생략해도 된다(이미 설치돼 있으면). 개발 DB(data/app.db)·3001/5173 서버는 건드리지 마.
  npm run typecheck
  npm test                         # 기대: 58개 통과
  npx playwright test recovery     # 기대: 13개 통과 (전체 E2E 는 돌리지 않아도 됨)
다르면 실패한 것만 알려줘. 못 돌린 것은 "미검증"이라고만 적어줘.

## 보고 (짧게, 40줄 이내)
- 첫 줄: 검수한 HEAD 해시, 한 줄 총평(main 병합 가능 여부)
- 항목 1~5: 수정됨/부분/미수정/새 문제 + 근거 한 줄
- 새 문제는 표 한 줄씩: 심각도 · 파일:줄 · 문제 · 재현 한 줄 · 제안 한 줄
- 실행 결과 한 줄씩. 칭찬·배경 설명·이전 결과 반복·긴 로그 인용·스크린샷·재현 스크립트 첨부는 생략.
````
