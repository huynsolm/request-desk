import { expect, test, type Page } from '@playwright/test';

// 한 DB(data/e2e.db, 시작할 때 초기화)를 순서대로 쓰는 시나리오 테스트.
test.describe.configure({ mode: 'serial' });

const ORIGINAL = '홈페이지에서 촬영 예약을 받았으면 좋겠어요. 가능한 날짜를 보고 신청하게 하고, 예약이 들어오면 제가 확인할 수 있으면 좋겠어요.';

async function openNewPanel(page: Page) {
  await page.getByRole('button', { name: '+ 새 요청' }).click();
  await expect(page.getByRole('dialog', { name: '새 요청 등록' })).toBeVisible();
}

async function addItem(page: Page, section: string, addLabel: string, text: string) {
  await page.getByRole('region', { name: section }).getByRole('button', { name: addLabel }).click();
  await page.getByRole('textbox', { name: /입력해 주세요/ }).fill(text);
  await page.keyboard.press('Enter');
}

test('[E2E-01] 첫 사용 빈 상태 → 등록 검증 → 등록 → 상세 이동 → 새로고침 후 유지', async ({ page }) => {
  await page.goto('/requests');
  await expect(page.getByText('아직 등록된 요청이 없어요')).toBeVisible();
  await expect(page.getByText('1 요청 붙여 넣기')).toBeVisible();
  await page.getByRole('button', { name: '첫 요청 등록하기' }).click();

  const dialog = page.getByRole('dialog', { name: '새 요청 등록' });
  // 빈 값
  await dialog.getByRole('button', { name: '등록하기' }).click();
  await expect(dialog.getByText('요청 제목을 입력해 주세요.')).toBeVisible();
  await expect(dialog.getByText('고객명을 입력해 주세요.')).toBeVisible();
  await expect(dialog.getByText('요청 원문을 입력해 주세요.')).toBeVisible();
  // "2" 처럼 의미 없는 입력
  await dialog.getByLabel('요청 제목').fill('2');
  await dialog.getByLabel('고객명').fill('2');
  await dialog.getByLabel('요청 원문').fill('2');
  await dialog.getByRole('button', { name: '등록하기' }).click();
  await expect(dialog.getByText('요청 원문이 너무 짧아요', { exact: false })).toBeVisible();
  await expect(page).toHaveURL(/\/requests$/);

  await dialog.getByLabel('요청 제목').fill('홈페이지 예약 기능 추가');
  await dialog.getByLabel('고객명').fill('모닝 스튜디오');
  await dialog.getByLabel('요청 원문').fill(ORIGINAL);
  await dialog.getByRole('button', { name: '등록하기' }).click();

  await expect(page).toHaveURL(/\/requests\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: '홈페이지 예약 기능 추가' })).toBeVisible();
  await expect(page.getByTestId('raw-original')).toHaveText(ORIGINAL);
  await expect(page.getByRole('button', { name: '분석 항목 직접 작성하기' })).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('raw-original')).toHaveText(ORIGINAL);
  await page.goto('/requests');
  await expect(page.getByRole('button', { name: '홈페이지 예약 기능 추가' })).toBeVisible();
});

test('[E2E-02] 등록 저장이 실패하면 입력값이 그대로 남고 재시도할 수 있다', async ({ page }) => {
  await page.goto('/requests');
  await openNewPanel(page);
  const dialog = page.getByRole('dialog', { name: '새 요청 등록' });
  await dialog.getByLabel('요청 제목').fill('문의 폼 항목 정리');
  await dialog.getByLabel('고객명').fill('한빛 공방');
  await dialog.getByLabel('요청 원문').fill('문의 폼에 항목이 너무 많아서 사람들이 중간에 나가는 것 같아요.');
  let blocked = true;
  await page.route('**/api/requests', async (route) => {
    if (route.request().method() === 'POST' && blocked) return route.abort('failed');
    return route.continue();
  });
  await dialog.getByRole('button', { name: '등록하기' }).click();
  await expect(dialog.getByText('저장하지 못했어요.')).toBeVisible();
  await expect(dialog.getByLabel('요청 제목')).toHaveValue('문의 폼 항목 정리');
  await expect(dialog.getByLabel('고객명')).toHaveValue('한빛 공방');
  await expect(dialog.getByLabel('요청 원문')).toHaveValue('문의 폼에 항목이 너무 많아서 사람들이 중간에 나가는 것 같아요.');
  blocked = false;
  await dialog.getByRole('button', { name: '다시 시도' }).click();
  await expect(page).toHaveURL(/\/requests\/[0-9a-f-]+$/);
  await page.unroute('**/api/requests');
});

test('[E2E-03] 검색·필터와 결과 없음 상태', async ({ page }) => {
  await page.goto('/requests');
  await expect(page.getByRole('button', { name: '문의 폼 항목 정리' })).toBeVisible();
  await page.getByLabel('요청 검색').fill('모닝');
  await expect(page.getByRole('button', { name: '문의 폼 항목 정리' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '홈페이지 예약 기능 추가' })).toBeVisible();
  await page.getByLabel('요청 검색').fill('없는고객');
  await expect(page.getByText('‘없는고객’에 맞는 요청이 없어요')).toBeVisible();
  await page.getByRole('button', { name: '검색 조건 초기화' }).click();
  await page.getByRole('button', { name: /^확정/ }).click();
  await expect(page.getByText('‘확정’ 상태인 요청이 없어요')).toBeVisible();
  await page.getByRole('button', { name: '검색 조건 초기화' }).click();
  await expect(page.getByRole('button', { name: '홈페이지 예약 기능 추가' })).toBeVisible();
});

test('[E2E-04] 분석 항목 작성 → 검토 전 확정 차단 → 검토 → 확정 확인창 → 확정 → 작업 생성 → 작업 관리', async ({ page }) => {
  await page.goto('/requests');
  await page.getByRole('button', { name: '홈페이지 예약 기능 추가' }).click();
  await page.getByRole('button', { name: '분석 항목 직접 작성하기' }).click();

  await addItem(page, '명시된 요구사항', '+ 요구사항 추가', '예약 가능한 날짜 조회');
  await addItem(page, '명시된 요구사항', '+ 요구사항 추가', '고객의 촬영 예약 신청');
  await addItem(page, '확인할 질문', '+ 질문 추가', '결제가 필요한가요?');
  await addItem(page, '미확정 사항', '+ 미확정 사항 추가', '로그인 필요 여부');
  await expect(page.getByText('담당자 추가').first()).toBeVisible();
  await expect(page.getByText('원문 근거 없음 · 담당자가 추가한 항목').first()).toBeVisible();

  // 직접 추가한 항목은 검토 완료 → 확정 가능
  await expect(page.getByRole('button', { name: '검토 완료하고 확정' })).toBeEnabled();

  // 수정하면 다시 검토가 필요하다 → 확정 버튼 비활성
  await page.getByRole('button', { name: '수정: 예약 가능한 날짜 조회' }).click();
  await page.getByRole('textbox', { name: '내용을 입력해 주세요' }).fill('예약 가능한 날짜 보기');
  await page.getByRole('button', { name: '적용', exact: true }).click();
  await expect(page.getByText('검토 전 항목이 1개 남아 있어요', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: '검토 완료하고 확정' })).toBeDisabled();
  await expect(page.getByText('담당자 추가 · 검토 전')).toBeVisible();
  await page.getByRole('button', { name: '검토함으로 표시: 예약 가능한 날짜 보기' }).click();
  await expect(page.getByRole('button', { name: '검토 완료하고 확정' })).toBeEnabled();

  // 확정 확인창: 포함·제외 개수를 보여주고 사람이 승인한다
  await page.getByRole('button', { name: '검토 완료하고 확정' }).click();
  const dlg = page.getByRole('dialog', { name: '요구사항 확정' });
  await expect(dlg.getByText('확정되는 요구사항 2개')).toBeVisible();
  await expect(dlg.getByText('확인할 질문 1개(미해결 1개)', { exact: false })).toBeVisible();
  await expect(dlg.getByText('미확정 사항 1개(미결정 1개)', { exact: false })).toBeVisible();
  await dlg.getByRole('button', { name: '확정하기' }).click();
  await expect(page.getByText('요구사항을 확정했어요. 작업은 아직 만들어지지 않았어요.')).toBeVisible();

  // 확정 후: 요구사항만 선택 가능, 질문·미확정은 선택 대상이 아니다. 편집은 잠긴다.
  await expect(page.getByRole('checkbox')).toHaveCount(2);
  await expect(page.getByRole('button', { name: /^수정:/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '작업 만들기 (2)' })).toBeVisible();

  await page.getByRole('button', { name: '작업 만들기 (2)' }).click();
  const tm = page.getByRole('dialog', { name: '작업 만들기' });
  await expect(tm.getByText('확인할 질문 1개와 미확정 사항 1개는', { exact: false })).toBeVisible();
  // 완료 조건은 기본값 없이 비어 있다
  await expect(tm.getByLabel(/완료 조건/).first()).toHaveValue('');
  await tm.getByRole('button', { name: '작업 2개 만들기' }).click();
  await expect(tm.getByText('완료 조건을 한 줄 이상 적어 주세요.').first()).toBeVisible();
  // 모호한 문장 거부
  await tm.getByLabel(/완료 조건/).first().fill('예약 기능이 요청대로 동작한다');
  await tm.getByRole('button', { name: '작업 2개 만들기' }).click();
  await expect(tm.getByText('모호한 문장은 쓸 수 없어요', { exact: false })).toBeVisible();
  await tm.getByLabel(/완료 조건/).first().fill('고객이 홈페이지에서 예약 가능한 날짜를 볼 수 있다\n예약할 수 없는 날짜는 선택할 수 없게 구분된다');
  await tm.getByLabel(/완료 조건/).nth(1).fill('고객이 날짜를 골라 촬영 예약을 신청할 수 있다');
  await tm.getByRole('button', { name: '작업 2개 만들기' }).click();
  await expect(page.getByText('작업 2개를 만들었어요.')).toBeVisible();
  await expect(page.getByText('모든 요구사항을 작업으로 만들었어요.')).toBeVisible();
  await expect(page.getByText('작업 생성됨 →')).toHaveCount(2);

  // 작업 목록 → 상태 변경 → 새로고침 후 유지
  await page.getByRole('button', { name: '작업 목록 보기' }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByRole('button', { name: '예약 가능한 날짜 보기', exact: true })).toBeVisible();
  await page.getByLabel('예약 가능한 날짜 보기 상태').selectOption('doing');
  await page.reload();
  await expect(page.getByLabel('예약 가능한 날짜 보기 상태')).toHaveValue('doing');
  await page.getByRole('button', { name: /진행 중/ }).first().click();
  await expect(page.getByRole('button', { name: '예약 가능한 날짜 보기', exact: true })).toBeVisible();
});

test('[E2E-05] 작업 상세: 편집·완료 조건 체크리스트·요청으로 이동', async ({ page }) => {
  await page.goto('/tasks');
  await page.getByRole('button', { name: '예약 가능한 날짜 보기', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '작업 상세' });
  await expect(panel.getByText('완료 조건').first()).toBeVisible();
  await panel.getByLabel('완료 조건 확인: 고객이 홈페이지에서 예약 가능한 날짜를 볼 수 있다').click();
  await expect(panel.getByText('1/2')).toBeVisible();
  await panel.getByLabel('설명').fill('디자인 가이드의 캘린더 규격을 따른다');
  await panel.getByLabel('작업 제목').fill('예약 가능한 날짜 조회 화면');
  await panel.getByLabel('작업 제목').blur();
  // 모호한 완료 조건 추가 거부
  await panel.getByLabel('완료 조건 추가').fill('정상 동작');
  await panel.getByRole('button', { name: '추가', exact: true }).click();
  await expect(panel.getByRole('alert').filter({ hasText: '6자 이상' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('complementary', { name: '작업 상세' }).getByLabel('작업 제목')).toHaveValue('예약 가능한 날짜 조회 화면');
  await expect(page.getByRole('complementary', { name: '작업 상세' }).getByLabel('설명')).toHaveValue('디자인 가이드의 캘린더 규격을 따른다');
  await expect(page.getByRole('complementary', { name: '작업 상세' }).getByText('1/2')).toBeVisible();
  await page.getByRole('complementary', { name: '작업 상세' }).getByRole('button', { name: /요청 보기/ }).click();
  await expect(page).toHaveURL(/\/requests\/[0-9a-f-]+$/);
});

test('[E2E-06] 다시 검토하기: 새 검토 버전을 시작해도 확정 기록과 작업은 남고, 수정하면 작업에 원본 변경이 표시된다', async ({ page }) => {
  await page.goto('/requests');
  await page.getByRole('button', { name: '홈페이지 예약 기능 추가' }).click();
  await expect(page.getByText('확정 기록')).toBeVisible();
  await page.getByRole('button', { name: '다시 검토하기' }).click();
  await page.getByRole('dialog', { name: '다시 검토하기' }).getByRole('button', { name: '다시 검토하기' }).click();
  await expect(page.getByText('새 검토 버전을 시작했어요')).toBeVisible();
  await expect(page.getByRole('button', { name: '수정: 고객의 촬영 예약 신청' })).toBeVisible();
  await page.getByRole('button', { name: '수정: 고객의 촬영 예약 신청' }).click();
  await page.getByRole('textbox', { name: '내용을 입력해 주세요' }).fill('고객의 촬영 예약 신청 받기');
  await page.getByRole('button', { name: '적용', exact: true }).click();
  await expect(page.getByText('검토 전 항목이 1개 남아 있어요', { exact: false })).toBeVisible();
  // 이전 확정 기록(검토 버전 1)은 그대로
  await page.getByText('검토 버전 1', { exact: false }).click();
  await expect(page.getByText('• 고객의 촬영 예약 신청', { exact: true })).toBeVisible();
  await expect(page.getByText('작업 만든 뒤 원본이 바뀜')).toBeVisible();
  await expect(page.getByText('원본 변경됨').first()).toBeVisible();
  await page.goto('/tasks');
  await expect(page.getByText('원본 변경됨').first()).toBeVisible();
});

test('[E2E-07] 질문 답변 기록·요구사항으로 반영(근거 필수), 질문을 검토해도 답변 완료가 아니다', async ({ page }) => {
  await page.goto('/requests');
  await page.getByRole('button', { name: '홈페이지 예약 기능 추가' }).click();
  const q = page.getByRole('region', { name: '확인할 질문' });
  // 직접 추가한 질문은 검토 완료 상태지만, 답변 전에는 계속 '미해결'이다(검토 ≠ 답변).
  await expect(q.getByText('미해결')).toBeVisible();
  await expect(q.getByText('답변받음')).toHaveCount(0);
  await q.getByRole('button', { name: /^답변 기록/ }).click();
  await page.getByRole('textbox', { name: '고객 답변' }).fill('  ');
  await page.getByRole('button', { name: '기록', exact: true }).click();
  await expect(page.getByText('고객 답변을 입력해 주세요.')).toBeVisible();
  await page.getByRole('textbox', { name: '고객 답변' }).fill('예약금 결제가 필요해요');
  await page.getByRole('button', { name: '기록', exact: true }).click();
  await expect(q.getByText('답변받음')).toBeVisible();
  await q.getByRole('button', { name: /^요구사항으로 반영/ }).click();
  await page.getByRole('textbox', { name: '요구사항 내용' }).fill('예약금 결제');
  await page.getByRole('textbox', { name: '전환 근거' }).fill('');
  await page.getByRole('button', { name: '요구사항으로 전환' }).click();
  await expect(page.getByText('전환 근거을 입력해 주세요.', { exact: false })).toBeVisible();
  await page.getByRole('textbox', { name: '전환 근거' }).fill('고객 답변: 예약금 결제가 필요해요');
  await page.getByRole('button', { name: '요구사항으로 전환' }).click();
  const r = page.getByRole('region', { name: '명시된 요구사항' });
  await expect(r.getByText('예약금 결제', { exact: true })).toBeVisible();
  await expect(r.getByText('근거(고객 답변·결정): 고객 답변: 예약금 결제가 필요해요')).toBeVisible();
  await expect(page.getByRole('button', { name: '검토 완료하고 확정' })).toBeDisabled(); // 전환한 항목도 검토 필요
});

test('[E2E-08] 편집 저장이 실패하면 입력값이 남고 저장 실패가 표시되며 다시 저장으로 복구된다', async ({ page }) => {
  await page.goto('/requests');
  await page.getByRole('button', { name: '홈페이지 예약 기능 추가' }).click();
  let blocked = true;
  await page.route('**/api/items/*', async (route) => {
    if (route.request().method() === 'PATCH' && blocked) return route.abort('failed');
    return route.continue();
  });
  await page.getByRole('button', { name: '수정: 예약금 결제' }).click();
  await page.getByRole('textbox', { name: '내용을 입력해 주세요' }).fill('예약금 결제 받기');
  await page.keyboard.press('Enter');
  await expect(page.getByText('! 저장 실패')).toBeVisible();
  await expect(page.getByText('편집 내용을 저장하지 못했어요.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: '내용을 입력해 주세요' })).toHaveValue('예약금 결제 받기');
  blocked = false;
  await page.getByRole('button', { name: '다시 저장' }).click();
  await expect(page.getByText('✓ 편집 내용 자동 저장됨')).toBeVisible();
  await expect(page.getByRole('region', { name: '명시된 요구사항' }).getByText('예약금 결제 받기')).toBeVisible();
  await page.unroute('**/api/items/*');
});

test('[E2E-09] 삭제 후 되돌리기', async ({ page }) => {
  await page.goto('/requests');
  await page.getByRole('button', { name: '홈페이지 예약 기능 추가' }).click();
  await page.getByRole('button', { name: '삭제: 로그인 필요 여부' }).click();
  await expect(page.getByText('항목을 삭제했어요.')).toBeVisible();
  await expect(page.getByText('로그인 필요 여부')).toHaveCount(0);
  await page.getByRole('button', { name: '되돌리기', exact: true }).click();
  await expect(page.getByText('로그인 필요 여부')).toBeVisible();
});

test('[E2E-10] 긴 원문과 좁은 화면(375px)에서 내용이 잘리지 않고 세로로 배치된다', async ({ page }) => {
  const long = Array.from({ length: 60 }, (_, i) => `${i + 1}번째 문장입니다. 홈페이지에서 촬영 예약을 받고 싶어요.`).join('\n') + ' ' + 'ㅇ'.repeat(5) + ' https://example.com/' + 'a'.repeat(120);
  await page.goto('/requests');
  await page.setViewportSize({ width: 375, height: 800 });
  await page.getByRole('button', { name: '+ 새 요청' }).click();
  const dialog = page.getByRole('dialog', { name: '새 요청 등록' });
  await dialog.getByLabel('요청 제목').fill('아주 긴 원문과 아주아주 긴 제목이 들어간 요청 정보 테스트');
  await dialog.getByLabel('고객명').fill('긴원문 고객');
  await dialog.getByLabel('요청 원문').fill(long);
  await dialog.getByRole('button', { name: '등록하기' }).click();
  await expect(page).toHaveURL(/\/requests\/[0-9a-f-]+$/);
  await expect(page.getByTestId('raw-original')).toBeVisible();
  const noHScroll = async () => {
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(m.sw).toBeLessThanOrEqual(m.cw);
  };
  await noHScroll();
  // 원문(왼쪽)이 분석 영역(오른쪽)보다 위에 세로로 쌓인다
  const raw = await page.getByTestId('raw-original').boundingBox();
  const right = await page.getByRole('region', { name: '분석과 검토' }).boundingBox();
  expect(raw!.y).toBeLessThan(right!.y);
  expect(Math.abs(raw!.x - right!.x)).toBeLessThan(40);
  await page.getByRole('button', { name: '분석 항목 직접 작성하기' }).click();
  await addItem(page, '명시된 요구사항', '+ 요구사항 추가', '아주 긴 요구사항 ' + '내용'.repeat(60));
  await noHScroll();
  await page.goto('/requests');
  await noHScroll();
  await page.goto('/tasks');
  await noHScroll();
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('[E2E-11] 키보드: Esc 로 패널 닫기, 포커스가 패널 안에 머물고 닫으면 버튼으로 돌아온다', async ({ page }) => {
  await page.goto('/requests');
  const btn = page.getByRole('button', { name: '+ 새 요청' });
  await btn.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: '새 요청 등록' });
  await expect(dialog.getByLabel('요청 제목')).toBeFocused();
  for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
  const inside = await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'));
  expect(inside).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(btn).toBeFocused();
});
