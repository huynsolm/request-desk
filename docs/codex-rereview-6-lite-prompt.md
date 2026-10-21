# Codex 6차 재검수 — 경량 프롬프트 (5차 지적 수정 확인)

범위를 이번 변경분으로 좁히고, 이미 통과한 검사를 반복하지 않으며, 보고서를 짧게 받습니다.

````text
request-desk 저장소의 stage-1-review 브랜치를 검수해줘. 코드·설정·git 은 수정하지 마.
토큰을 아끼기 위해 아래 범위만 봐줘. 전체 문서를 읽거나 전체 테스트를 반복하지 마.

## 범위 (이것만)
직전 검수 기준 39006ad 이후의 코드 변경:
  git diff 39006ad..HEAD -- web/src/pages/TasksPage.tsx web/src/pages/RequestDetailPage.tsx web/src/pages/ItemSection.tsx tests/e2e/recovery.spec.ts
HEAD 해시를 보고서 첫 줄에 적어줘. 위 diff 와 그 주변 함수만 읽어줘.

## 확인할 것 (각 항목 한두 줄 판정)
1. P1: 재시도("다시 저장") 중에 입력을 원래 값으로 되돌려도 마지막 입력이 저장되는가? (TasksPage.tsx `save`/`exec` 에서 보내는 시점에 `sentRef` 를 기록, 제목·설명 onBlur)
   - 새 허점: `sentRef` 가 실패·충돌(409)·건너뛰기 경로에서 남거나 너무 일찍 지워지는 경우, 직렬화(`chainRef`)와 재시도 대기열이 겹칠 때의 순서, 상태(할 일/진행 중/완료) 저장이 같이 있을 때.
2. P2: 새 테스트가 고정 지연 없이 순서를 보장하는가? (`gateTaskPatch`, `revertWhileSaving`) 간헐 실패할 만한 곳이 남았는가?
3. 열어 둔 항목이 다른 곳에서 삭제된 경우 입력이 보존되는가? (ItemSection.tsx 의 `orphan` 블록, RequestDetailPage.tsx 의 `goneMsg`) 새 문제(예: 닫기 후 상태, 접근성, 다른 종류 항목)가 있는가?
4. 완료 조건 문구 수정에 version 이 없어 마지막 저장이 이기는 한계를 **의도적으로 수용**했다(docs/decisions.md). 수용 가능한 근거로 충분한가, 아니면 이번 단계에서 막아야 하는가? 한 줄 의견만.

## 실행 (최소한만)
개발 DB(data/app.db)·3001/5173 서버는 건드리지 마. 별도 DB·포트 사용.
  npm run typecheck
  npm test                         # 기대: 58개 통과
  npx playwright test recovery     # 기대: 20개 통과 (전체 E2E 는 생략 가능)
다르면 실패한 것만 알려줘. 못 돌린 것은 "미검증"이라고만 적어줘.

## 보고 (짧게, 40줄 이내)
- 첫 줄: 검수한 HEAD 해시, 한 줄 총평(main 병합 가능 여부)
- 항목 1~4: 수정됨/부분/미수정/새 문제 + 근거 한 줄
- 새 문제는 표 한 줄씩: 심각도 · 파일:줄 · 문제 · 재현 한 줄 · 제안 한 줄
- 실행 결과 한 줄씩. 칭찬·배경 설명·이전 결과 반복·긴 로그·스크린샷·재현 스크립트 첨부는 생략.
````
