# Codex 3단계 재검수 — 경량 프롬프트

````text
request-desk 저장소의 stage-3-ai-provider 브랜치 재검수야. 코드·설정·git 은 수정하지 마. 실제 Anthropic API 는 호출하지 마(가짜 서버만).
범위는 1차 검수(1620919) 이후 변경분만: git diff 1620919..HEAD
HEAD 해시를 보고서 첫 줄에 적어줘. 개발 DB(data/app.db)와 개발 서버(3001/5173)는 건드리지 말고 DB_PATH·포트를 따로 써줘.

## 1차 지적 3건과 반영 내용 — 각각 해결됐는지만 확인
1. [P2] 인용문 검증이 의미 일치를 보장하지 않음 → 코드는 그대로 두고 문서(requirements R-AI-03, decisions)를 "존재만 검증, 의미는 사람이 검토"로 바로잡고 한계 테스트 R-AI-03b 추가.
   확인: 문서에 과장된 보장 표현이 남아 있지 않은지(README, reports/stage-3.md 포함).
2. [P2] 한도 소진 후 화면이 갱신되지 않음 → web/src/pages/RequestDetailPage.tsx: usage_limit 응답 시 reload, 탭 visible/focus 시 reload(AI 제공자일 때만).
   확인: 이벤트 리스너 정리, 불필요한 reload 폭주·무한 루프, 분석 중 폴링과의 충돌. (브라우저 E2E 는 없음 → 미검증으로 표시돼 있음)
3. [P2] 저장 단계 내부 오류에서 토큰 기록 유실 → server/analysis/run.ts 바깥 catch 의 markFailed 에 usage 전달, 테스트 R-AI-16.
   확인: 다른 실패 경로(markFailed 호출부)에 usage 누락이 더 없는지.

## 추가로 새로 생긴 문제가 있는지만 (변경분 안에서)
## 보고 형식 (25줄 이내)
- 병합 차단 / 수정 권장 / 참고, 각 항목 파일:줄·재현 방법
- 1~3번 각각 "해결/미해결" 한 줄
- 실행한 명령과 결과(통과/실패 수)
````
