# 인수인계 — 다른 PC에서 이어서 작업하기

마지막 갱신: 2026-10-20 · 기준 커밋 `e0dea65` · 브랜치 `stage-1-review`

## 1. 지금 어디까지 왔나

| 항목 | 상태 |
|---|---|
| 1단계(AI 없는 핵심 기능) | **구현 완료**, 독립 검수 3차까지 반영 |
| 4차 재검수 | 완료 — R3·R4 발견, 수정함. **5차 재검수 대기 중** — 요청 프롬프트는 [codex-rereview-5-lite-prompt.md](codex-rereview-5-lite-prompt.md) |
| `main` 병합 | **보류** — 원격 `main` 은 비어 있음. 검수 통과 후 사용자가 승인하면 병합 |
| 2단계(모의 분석 제공자) | **보류** — 검수 통과 후 시작 |
| 3단계(실제 AI) | 미착수 — 제공자·인증·비용을 사용자와 확인한 뒤 별도 진행 |

검증 상태(R3·R4 수정 후): 타입 검사 통과, 서버·DB 테스트 58개, 브라우저 E2E 28개(연속 2회), 빌드 성공.
미검증: 기준 디자인과의 픽셀 단위 일치, 스크린 리더, Chrome 외 브라우저, 한글 IME 실입력. 자세한 내용은 [reports/stage-1.md](reports/stage-1.md).

## 2. 다른 PC에서 시작하기

**준비물**: Node 24 이상, git, **Google Chrome**(E2E 가 설치된 Chrome 을 씁니다), 인터넷(Pretendard 폰트 CDN, 오프라인이면 시스템 폰트로 대체됨)

```bash
git clone -b stage-1-review https://github.com/huynsolm/request-desk.git
cd request-desk
npm ci
npm run db:reset                          # DB 만들기 + 샘플 3건
npm run dev                               # http://localhost:5173  (API 는 127.0.0.1:3001)
```

> **`main` 이 아니라 `stage-1-review` 를 받으세요.** 원격 `main` 은 아직 비어 있습니다. `git clone` 만 하면 빈 브랜치가 나옵니다.

확인용 명령:
```bash
npm run typecheck
npm test            # 기대: 58개 통과
npm run test:e2e    # 기대: 28개 통과 (약 2.5분, 포트 3199/5199, data/e2e.db 사용)
npm run build
```

### 알아둘 점
- `npm ci` 중 `esbuild ... install-scripts` 경고가 나오는데 무시해도 됩니다(새로 clone 해서 설치·테스트·빌드·E2E 를 모두 통과함을 확인했습니다. 확인 커밋 `04f21c1`).
- **DB 파일은 git 에 없습니다.** `data/app.db` 는 PC 마다 따로 생깁니다. 작업한 데이터는 옮겨지지 않으며, 샘플은 `npm run db:reset` 으로 다시 만듭니다. (옵션: `-- --morning-analysis` 첫 요청에 샘플 분석 포함, `-- --empty` 빈 DB)
- **`npm run db:reset` 은 `data/app.db` 를 지우고 새로 만듭니다.** 소중한 데이터가 있는 DB 에서는 실행하지 마세요. 다른 파일에 쓰려면 `DB_PATH=data/other.db` 를 지정합니다.
- 비밀키·`.env` 는 필요 없습니다(1단계). `.env.example` 만 있습니다. 3단계에서 서버 전용 키가 필요해지면 `.env` 에 넣고 **절대 커밋하지 않습니다.**
- 개발 서버를 처음 켤 때 서버가 뜨기까지 몇 초 걸려 화면에 연결 오류가 잠깐 보일 수 있습니다. 새로고침하면 됩니다.
- Windows 에서 `LF will be replaced by CRLF` 경고가 나오지만 무시해도 됩니다.
- 포트: 개발 3001(API)·5173(웹), E2E 3199·5199. 겹치면 `API_PORT` 환경 변수로 바꿉니다.
- 이 앱은 **로그인이 없는 로컬 개발용**입니다. 서버는 `127.0.0.1` 에만 열리고, 외부에 공개하면 안 됩니다(외부 공개 배포는 별도 범위).

## 3. 이어서 할 일 (순서)

1. **5차 재검수 결과 받기** — [codex-rereview-5-lite-prompt.md](codex-rereview-5-lite-prompt.md) 를 Codex 에 붙여 넣어 요청(범위를 변경분으로 좁힌 경량 프롬프트). 토큰을 아끼려면 범위를 이번 변경분으로 좁힌 [codex-rereview-4-lite-prompt.md](codex-rereview-4-lite-prompt.md) 를 쓴다. 결과의 지적 사항은 코드·실행으로 재현해 확인한 뒤 수정하고, 수정 전 코드에서 회귀 테스트가 실패하는지도 확인한다(지금까지의 방식, [reviews/](reviews/README.md) 참조).
2. **검수 통과 후, 사용자 승인을 받아** `stage-1-review` 를 `main` 에 병합.
3. **2단계: 모의 분석 제공자** (사용자 지시 §7)
   - 분석 호출을 별도 인터페이스(`AnalysisProvider`)로 분리, 실제 AI 와 모의 분석을 교체 가능하게
   - 모의 분석은 화면에 `모의 분석 · 개발용` 으로 명확히 표시, 고정 응답을 실제 AI 처럼 보이게 하지 않기
   - `요청 분석하기` 버튼, 분석 중/실패/재시도, 재분석이 사람의 편집을 덮어쓰지 않도록 사전 확인
   - DB: `analysis_runs` 테이블 (`0003_*.sql` 로 추가. 적용된 마이그레이션 파일은 수정하지 말 것)
   - 결과는 항상 `origin='mock'`(또는 `ai`), 검토 전 상태로 저장
4. **3단계: 실제 AI 연결** — 제공자·인증 방식·사용 비용을 사용자와 확인한 뒤 진행. API 키는 서버에서만 사용, 응답 구조 검증·시간 초과·오류 처리.

## 4. 작업 규칙 (사용자 지시, 계속 지킬 것)
- 한 번에 모든 기능을 만들지 말고 **단계별로** 진행, 단계가 끝나면 실행 가능한 상태로 두고 완료/남은 범위를 보고
- 요구사항과 디자인이 충돌하면 **요구사항 우선**, 차이는 [decisions.md](decisions.md) 에 기록
- 화면에서 버튼을 숨기는 것만으로 규칙을 구현하지 말고 **서버와 DB 에서도 검증**
- 수행하지 못한 검증은 통과했다고 쓰지 말고 **미검증**으로 표시
- 검수 요청용 문서에는 개발 DB 를 건드리지 않도록 별도 `DB_PATH`·포트를 쓰게 한다
- 사용자 승인 없이 `main` 병합·`main` push 금지. 작업 브랜치 push 만 허용된 상태
- 관련 없는 코드는 변경하지 않고, 비밀키는 커밋하지 않는다

## 5. 문서 지도
| 문서 | 내용 |
|---|---|
| [../README.md](../README.md) | 실행·테스트·구조 |
| [requirements.md](requirements.md) | 요구사항 ID ↔ 구현 위치 ↔ 테스트 추적표 |
| [decisions.md](decisions.md) | 설계 결정, 디자인과 달라진 점, 가정, 검수 반영 결정 |
| [reports/stage-1.md](reports/stage-1.md) | 1단계 완료 보고, 테스트 결과, 미검증 사항 |
| [reviews/](reviews/README.md) | Codex 독립 검수 보고서 3건(원문) |
| [codex-review-prompt.md](codex-review-prompt.md) → [rereview](codex-rereview-prompt.md) → [3](codex-rereview-3-prompt.md) → [4](codex-rereview-4-prompt.md) | 검수 요청 프롬프트(최초~4차) |
| [design/README.md](design/README.md) | 기준 디자인 핸드오프. `request-desk-v2.dc.html` 은 브라우저로 여는 프로토타입 |

## 6. 코드 지도
```
server/service.ts          규칙(확정·작업 생성·버전·검증)의 중심
server/app.ts              API 라우트 + 접근 검사(Host/Origin/JSON) + 본문 크기 상한
server/db/migrations/      0001_init.sql, 0002_review_hardening.sql  (스키마·트리거·뷰)
shared/validation.ts       서버·웹 공용 입력 검증(의미 없는 입력, 길이 상한, 모호한 완료 조건)
web/src/pages/            RequestsPage, RequestDetailPage(+ItemSection, Dialogs), TasksPage, useSaver(저장 상태·재시도)
tests/server/              규칙·DB 직접 SQL·접근 검사·검수 회귀
tests/e2e/                 flow.spec.ts(주요 흐름) · recovery.spec.ts(저장 실패·충돌·편집 경로 회귀)
```

## 7. 검수 이력 한눈에
| 차수 | 대상 커밋 | 결과 | 수정 커밋 |
|---|---|---|---|
| 1차 | 5a05652 | F1~F6 + 추가 확인 사항 | b371952 |
| 2차 | b371952 | R1(여러 저장 동시 실패 후 재시도) | be7e60d |
| 3차 | be7e60d | R2(건드리지 않은 필드 덮어쓰기), T1(테스트 타이밍) | e0dea65 |
| 4차 | 836b4ea | R3(저장 중 되돌리기 유실), R4(인용문만 수정 시 본문 덮어쓰기) | (이 커밋) |
| 5차 | — | **대기 중** | — |
