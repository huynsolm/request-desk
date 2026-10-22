# 리퀘스트 데스크

고객이 보낸 모호한 요청을 붙여 넣고 → 원문과 분석을 비교하며 → 요구사항·확인할 질문·미확정 사항으로 정리·검토 → 확정 → 작업으로 만들어 관리하는 **로컬 개발용** 웹앱입니다. 담당자 1명이 쓰는 것을 전제로 하며, 로그인이 없으므로 외부에 공개하지 마세요(서버는 `127.0.0.1` 에만 열립니다).

현재 **1단계(AI 없는 핵심 기능)**, **2단계(모의 분석 제공자)**, **3단계(실제 AI 연결: Anthropic Claude API)** 가 구현되어 있습니다. 기본값은 **모의 분석(개발용, 키 불필요)** 이고, 실제 AI 는 서버 `.env` 에 키를 넣고 켠 경우에만 동작합니다. 실제 API 연결은 **OpenAI(ChatGPT)만 스모크 1회로 확인**했고(2026-10-22, `gpt-5-mini`), Anthropic 은 아직 **미검증**입니다(아래 "실제 AI 켜기"의 스모크 확인 필요).

> **다른 PC 에서 이어서 작업하려면** [docs/HANDOFF.md](docs/HANDOFF.md) 를 먼저 읽으세요. 1·2단계는 독립 검수를 통과해 `main` 에 병합되었습니다(`git clone -b main ...`).

## 실행

요구: Node 24 이상 (내장 `node:sqlite` 사용, "실험 기능" 경고가 한 번 뜰 수 있어요)

```bash
npm ci                    # 잠금 파일(package-lock.json) 기준으로 설치
npm run db:reset          # DB 만들기 + 샘플 3건 (기본: 모닝 스튜디오 요청은 '접수' 상태)
npm run dev               # API 서버(3001) + 웹(5173) 동시 실행 → http://localhost:5173
```

처음 켤 때는 서버가 뜨기까지 몇 초 걸려서 화면에 오류가 잠깐 보일 수 있어요. 새로고침하면 됩니다.

### DB 초기화 옵션
```bash
npm run db:reset -- --morning-analysis   # 첫 요청에 §8 샘플 분석(모의 제안 9개, 검토 전)을 함께 넣기
npm run db:reset -- --empty              # 시드 없이 빈 DB (첫 사용 상태)
```
DB 파일은 `data/app.db` (git 에 올라가지 않음). 지우고 다시 만들면 초기화됩니다. 환경 변수는 `.env.example` 참고 (`API_PORT`, `DB_PATH`).

### 빌드 후 단일 서버로 실행
```bash
npm run build && npm start   # http://127.0.0.1:3001 (dist/web 을 함께 서빙)
```

## 분석(2단계: 모의 분석)
요청 상세에서 `요청 분석하기`를 누르면 **모의 분석**이 원문을 요구사항·확인할 질문·미확정 사항으로 나눠 제안합니다. 실제 AI 가 아니라 고정된 샘플 결과이고, 화면에 "모의 분석 · 개발용"으로 표시됩니다. 제안은 모두 `모의 제안 · 검토 전`으로 들어가며 사람이 검토해야 확정됩니다.

### ChatGPT(OpenAI) 로 켜기
Anthropic 대신 OpenAI API 를 쓰려면 `.env` 에 아래를 **직접** 채웁니다(키는 [OpenAI 플랫폼](https://platform.openai.com/api-keys)에서 만들고, 사용 전 크레딧 충전이 필요할 수 있어요). 나머지(전송 안내·사용량 상한·검토 전 제안 저장)는 동일합니다.
```
ANALYSIS_PROVIDER=openai
OPENAI_API_KEY=sk-...
# OPENAI_MODEL=gpt-5-mini     # 기본값. 거부되면 계정에서 쓸 수 있는 모델 이름으로 바꾸세요
```
`npm run ai:smoke` 는 `ANALYSIS_PROVIDER` 에 맞춰 같은 방식으로 확인합니다. 실제 OpenAI API 와는 `npm run ai:smoke` 1회(2026-10-22, `gpt-5-mini`)로 연결·구조화 출력·원문 인용 정확도를 확인했습니다(샘플 1건). 여러 원문에서의 품질은 **미검증**입니다.

| 환경 변수 | 기본값 | 설명 |
|---|---|---|
| `ANALYSIS_PROVIDER` | `mock` | 분석 제공자: `mock`(모의) 또는 `ai`(Anthropic Claude) |
| `ANALYSIS_TIMEOUT_MS` | mock 30000 / ai 120000 | 분석 시간 초과 |
| `MOCK_ANALYSIS_DELAY_MS` | `1500` | 모의 분석이 걸리는 시간(분석 중 화면 확인용) |
| `ENABLE_DEV_CONTROLS` | 꺼짐 | `1` 이면 테스트용 `/api/dev/mock-analysis`(지연·실패 조절)가 생깁니다. E2E 에서만 사용 |

## 실제 AI 켜기 (3단계, Anthropic Claude API)
**원문이 외부(Anthropic)로 전송**되고 호출마다 **비용이 발생**합니다. 기본값(모의)을 쓰면 아무것도 전송되지 않습니다.

1. `.env.example` 을 복사해 프로젝트 루트에 `.env` 를 만들고 아래를 **직접** 채웁니다(키를 채팅·이슈·커밋에 붙여 넣지 마세요. `.env` 는 git 에서 제외됩니다).
   ```
   ANALYSIS_PROVIDER=ai
   ANTHROPIC_API_KEY=sk-ant-...
   ```
2. 연결 확인(호출 1회, 비용 발생): `npm run ai:smoke` — 키 값은 출력하지 않습니다.
3. `npm run dev` 로 서버를 다시 시작하면 요청 상세에 전송 안내와 사용량(오늘 N/20 · 이번 달 N/300)이 표시됩니다.

| 환경 변수 | 기본값 | 설명 |
|---|---|---|
| `ANTHROPIC_API_KEY` | 없음 | 서버 전용 키. 브라우저·API 응답·로그에 나오지 않습니다 |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | 더 싸게: `claude-sonnet-5-5`, `claude-haiku-5-5` |
| `AI_DAILY_LIMIT` / `AI_MONTHLY_LIMIT` | `20` / `300` | 호출 횟수 상한(서버가 강제, 실패한 호출도 셈). 서버 PC의 현지 날짜·달 기준 |

- 원문만 전송합니다(제목·고객명 제외). 결과는 항상 `AI 제안 · 검토 전`이며, 기존 항목은 수정·삭제하지 않습니다.
- 비용은 모델·원문 길이에 따라 다릅니다. 매 실행의 모델·입출력 토큰이 DB(`analysis_runs`)에 기록되니 실제 비용은 거기서 확인하세요. 호출 횟수 상한만 있고 금액 상한은 없습니다.

## 테스트
```bash
npm run typecheck
npm test                  # 서버 규칙 + DB 방어선 (Vitest, 메모리/임시 DB)
npm run test:e2e          # 브라우저 시나리오 (Playwright, 설치된 Chrome 사용, data/e2e.db 로 격리)
npm run test:e2e:ai       # AI 연결 시나리오 (가짜 Anthropic 서버, 3198/5198/3299, data/e2e-ai.db). 실제 API 는 호출하지 않음
```

## 구조
```
server/       Hono API, 서비스 규칙(service.ts), SQLite(db/), 마이그레이션(db/migrations)
shared/       서버·웹이 함께 쓰는 타입과 입력 검증
web/          Vite + React + TypeScript 화면
tests/        server/(Vitest) · e2e/(Playwright)
docs/         requirements.md(요구사항 추적표) · decisions.md(결정·디자인 차이) · design/(기준 디자인) · reports/
```

## 문서
- 요구사항 ↔ 구현 ↔ 테스트: [docs/requirements.md](docs/requirements.md)
- 설계 결정과 디자인과 달라진 점: [docs/decisions.md](docs/decisions.md)
- 단계별 완료 보고: [docs/reports/](docs/reports/)
- 기준 디자인: [docs/design/README.md](docs/design/README.md) (`request-desk-v2.dc.html` 은 브라우저로 열어 볼 수 있는 프로토타입)

## 범위 밖
로그인·다중 사용자, 채팅, 결제, 견적, 음성·사진 입력, 외부 서비스 연동, 자동 코드 생성, 통계 대시보드, 외부 공개 배포.
