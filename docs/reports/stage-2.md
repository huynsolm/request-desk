# 2단계 완료 보고 — 모의 분석 제공자

브랜치 `stage-2-mock-analysis` (기준: `main` d2346b5). **독립 검수 전**이며 `main` 에 병합하지 않았습니다.

## 구현한 기능
- 분석 호출을 별도 인터페이스(`AnalysisProvider`)로 분리, 실제 AI 와 모의 분석을 설정(`ANALYSIS_PROVIDER`)으로 교체 가능. 지금은 `mock` 만 있고 `ai` 는 3단계 전까지 시작 시 거부.
- 모의 분석: 샘플 원문이면 §8 샘플(요구사항 3·질문 3·미확정 3), 그 밖의 원문은 원문 문장 그대로의 요구사항 + 일반 질문·미확정. 원문에 없는 기능을 만들어 내지 않음.
- `요청 분석하기` → **분석 중**(비활성 버튼·스켈레톤, 원문은 계속 읽기 가능) → 결과 / **분석 실패**(오류 카드·`다시 시도`).
- **재분석(`다시 분석하기`)은 파괴적이지 않음**: 확인창에서 안내, 서버도 확인을 강제, 기존 항목(사람이 고치거나 검토하거나 삭제한 것 포함)은 건드리지 않고 새 제안만 `검토 전`으로 추가.
- **모의 표시**: 화면에 "모의 분석 · 개발용" 안내를 항상 보이고, 모든 제안은 `모의 제안 · 검토 전`(`AI 제안` 아님).
- 제공자 응답을 **서버가 직접 검증**(구조 → 항목별: 의미 있는 내용, 요구사항의 원문 근거 존재). 통과하지 못한 항목은 제외하고 개수를 기록, 전부 못 쓰면 실패.
- 분석 실행 기록(`analysis_runs`): 새로고침·재시작에도 상태 유지, 서버 재시작 시 중단된 실행은 실패로 정리, 시간 초과(기본 30초), 같은 요청에 동시 분석 1개(DB UNIQUE).
- 상세 설계와 결정: [decisions.md](../decisions.md) "2단계 설계 결정". 요구사항 추적: [requirements.md](../requirements.md) R-ANALYZE-01~16.

## 1차 검수(31b439a) 지적 반영
| 번호 | 지적 | 수정 | 회귀 테스트 |
|---|---|---|---|
| P1 | 재분석에서 모든 제안이 검증에 실패해도 succeeded(새 제안 0개) | 통과한 제안(중복 포함)과 실패를 구분, 통과 0개 + 실패 있으면 `invalid_response` | R-ANALYZE-17 ×2(실패 / 중복만이면 성공 대조) |
| P2 | 삭제된 항목만 남으면 재분석으로 인식 못 해 empty_result 실패 | 재분석 여부는 삭제 포함 이력으로, 확인 필요 여부는 보이는 항목으로 분리 | R-ANALYZE-18 |
| P2 | NFC/NFD 가 다른 중복 키 | 중복 비교에 NFC 정규화 | R-ANALYZE-19 |
세 문제는 수정 전 코드에서 테스트가 실패함을 먼저 확인한 뒤 고쳤다(대조 테스트 1개는 수정 전에도 통과, 의도대로). 검수의 나머지 판정(비파괴성·경쟁 조건, 신뢰 경계, 실행 수명, 화면, 개발용 엔드포인트)은 문제 없음.

## 변경 파일
- DB: `server/db/migrations/0003_analysis_runs.sql`
- 서버: `server/analysis/{types,mock-data,mock,registry,summary,run}.ts`(신규), `server/app.ts`(분석 라우트·개발용 조절·제공자 정보), `server/service.ts`(상세에 분석 정보, 확정 blocker), `server/config.ts`, `server/index.ts`, `server/errors.ts`, `server/db/seed.ts`(샘플 데이터 공용화)
- 웹: `web/src/pages/RequestDetailPage.tsx`, `Dialogs.tsx`(재분석 확인창), `api.ts`, `styles.css`, `shared/types.ts`
- 테스트: `tests/server/analysis.test.ts`(29), `tests/e2e/stage2-analysis.spec.ts`(7)

## 실행
```bash
npm ci
npm run db:reset            # 기존 DB 는 0003 이 자동 적용되므로 reset 없이도 됩니다
npm run dev                 # 요청 상세에서 '요청 분석하기'
```
환경 변수: `ANALYSIS_PROVIDER`(기본 mock), `ANALYSIS_TIMEOUT_MS`, `MOCK_ANALYSIS_DELAY_MS`(기본 1.5초), `ENABLE_DEV_CONTROLS`(테스트용, 기본 꺼짐). [README](../../README.md) 참조.

## 테스트와 실제 결과
| 검증 | 명령 | 결과 |
|---|---|---|
| 타입 검사 | `npm run typecheck` | 오류 없음 |
| 서버·DB 규칙 | `npm test` | **87개 통과** (기존 58 + 2단계 29) |
| 브라우저 E2E | `npm run test:e2e` | **38개 통과**, 연속 2회 (기존 31 + 2단계 7) |
| 빌드 | `npm run build` | 성공 |
| 화면 직접 확인 | 개발 서버(1440px) | 분석 전·분석 중·결과 화면 확인 |

규칙을 일부러 깨 보아 테스트가 잡는지도 확인했다(원문 근거 검증 제거 → 2개 실패, 재분석 확인 요구 제거 → 1개, 원문 개정판 비교 제거 → 1개, 중복 건너뛰기 제거 → 2개, 구조 검증 우회 → 7개 실패, 원복 후 25개 통과).
테스트 과정에서 고친 것: 새 E2E 파일이 알파벳 순서로 먼저 실행되어 기존 `[E2E-01]`(빈 DB 가정)을 깨뜨렸다. 파일을 `stage2-analysis.spec.ts` 로 바꿔 마지막에 실행되게 하고 설정에 순서 의존을 명시했다. 이전에 PowerShell 로 고친 `playwright.config.ts` 의 한글 주석이 깨져 있던 것도 바로잡았다(동작 영향 없음).

## 미완료·미검증
- **독립 검수 전.** 아래 "Codex 가 집중 검수할 부분" 참조.
- 실제 AI 연결은 3단계(제공자·인증·비용 확인 후). 모의 분석은 UI·흐름·검증을 확인할 뿐 **분석 품질은 검증할 수 없다**.
- 중복 판단은 정규화한 내용·근거 인용이 같을 때만(사람이 질문 문구를 고치면 같은 질문이 새 제안으로 다시 들어올 수 있음, [decisions.md](../decisions.md) 참조).
- 분석 중 화면 갱신은 700ms 폴링이다. 서버 푸시(SSE 등)는 하지 않았다.
- 기준 디자인과의 픽셀 비교, 스크린 리더, Chrome 외 브라우저, 한글 IME 실입력은 여전히 미검증.
- `npm run dev` 가 이미 켜져 있는 환경에서 `tsx watch` 가 새 마이그레이션을 자동 적용함을 확인했다. 새 PC 에서의 처음부터 설치는 이 브랜치에서 아직 재확인하지 않았다(검수 통과 후 `main` 병합 때 다시 확인 예정).

## Codex 가 집중 검수할 부분
1. `server/analysis/run.ts` `applyResult`: 트랜잭션 안에서 기존 항목을 건드리지 않는지, 중복·삭제 항목 처리, 원문 근거 검증, 개정판 비교. 분석 중 사람이 항목을 편집·삭제·확정하는 경쟁 조건.
2. `startAnalysis`/`execute`/`raceAbort`: 진행 중 중복 방지, 시간 초과·제공자 멈춤·예외 처리, 처리되지 않은 Promise 거부, 서버 재시작(`failStaleRuns`).
3. 제공자 신뢰 경계: `AnalysisResultSchema`(strict)와 항목별 검증으로 제공자가 DB 를 오염시킬 수 있는 경로가 남는가. 오류 메시지·내용이 사용자에게 새지 않는가.
4. `RequestDetailPage.tsx`: 분석 중·실패·재시도 상태 전이, 폴링 정리, 완료 알림이 한 번만 뜨는가, 확정 단계와의 상호작용, 저장 실패 UI 와의 간섭.
5. 개발용 조절 엔드포인트(`/api/dev/mock-analysis`)가 기본으로 꺼져 있고 접근 검사(Host/Origin)를 지나는가.
6. 새 테스트가 규칙을 실제로 잡는지(빈 검증·시간 의존 여부).
