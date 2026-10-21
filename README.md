# 리퀘스트 데스크

고객이 보낸 모호한 요청을 붙여 넣고 → 원문과 분석을 비교하며 → 요구사항·확인할 질문·미확정 사항으로 정리·검토 → 확정 → 작업으로 만들어 관리하는 **로컬 개발용** 웹앱입니다. 담당자 1명이 쓰는 것을 전제로 하며, 로그인이 없으므로 외부에 공개하지 마세요(서버는 `127.0.0.1` 에만 열립니다).

현재 **1단계(AI 없는 핵심 기능)** 와 **2단계(모의 분석 제공자)** 가 구현되어 있습니다. 분석은 미리 정해 둔 **모의 결과(개발용)** 이며 실제 AI 연결(3단계)은 아직 없습니다.

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

| 환경 변수 | 기본값 | 설명 |
|---|---|---|
| `ANALYSIS_PROVIDER` | `mock` | 분석 제공자. `ai` 는 3단계 전까지 거부됩니다 |
| `ANALYSIS_TIMEOUT_MS` | `30000` | 분석 시간 초과 |
| `MOCK_ANALYSIS_DELAY_MS` | `1500` | 모의 분석이 걸리는 시간(분석 중 화면 확인용) |
| `ENABLE_DEV_CONTROLS` | 꺼짐 | `1` 이면 테스트용 `/api/dev/mock-analysis`(지연·실패 조절)가 생깁니다. E2E 에서만 사용 |

## 테스트
```bash
npm run typecheck
npm test                  # 서버 규칙 + DB 방어선 (Vitest, 메모리/임시 DB)
npm run test:e2e          # 브라우저 시나리오 (Playwright, 설치된 Chrome 사용, data/e2e.db 로 격리)
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
