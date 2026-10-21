import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

// 2단계: 모의 분석 제공자. 모의 분석의 지연·실패는 개발용 조절 엔드포인트(E2E 서버에서만 켜짐)로 제어한다.
test.describe.configure({ mode: 'serial' });

const ORIGINAL = '홈페이지에서 촬영 예약을 받았으면 좋겠어요. 가능한 날짜를 보고 신청하게 하고, 예약이 들어오면 제가 확인할 수 있으면 좋겠어요.';

async function post(request: APIRequestContext, path: string, data: unknown) {
  const r = await request.post(path, { data });
  expect(r.ok(), `${path} → ${r.status()} ${await r.text()}`).toBeTruthy();
  return r.json();
}
async function setMock(request: APIRequestContext, controls: { delayMs: number; failNext: number }) {
  await post(request, '/api/dev/mock-analysis', controls);
}
async function newRequest(request: APIRequestContext, title: string, originalText = ORIGINAL) {
  const d = await post(request, '/api/requests', { title, customerName: '분석 고객', originalText });
  return d.request.id as string;
}
const latestRun = async (request: APIRequestContext, rid: string) => (await (await request.get(`/api/requests/${rid}`)).json()).analysis.latestRun;
const section = (page: Page, name: string) => page.getByRole('region', { name });

test('[E2E-A1] 요청 분석하기 → 분석 중 → 결과 9개가 모두 "모의 제안 · 검토 전"으로 들어오고 실제 AI 처럼 보이지 않는다', async ({ page, request }) => {
  await setMock(request, { delayMs: 1500, failNext: 0 });
  const rid = await newRequest(request, 'A1 분석 시작');
  await page.goto(`/requests/${rid}`);
  // 모의 분석임을 항상 표시한다
  await expect(page.getByTestId('mock-banner')).toContainText('모의 분석 · 개발용');
  await expect(page.getByText('모의 분석이 원문을 요구사항·확인할 질문·미확정 사항으로 나눠 제안해요')).toBeVisible();
  await page.getByRole('button', { name: '요청 분석하기' }).click();
  // 분석 중: 비활성 버튼과 스켈레톤, 원문은 계속 읽을 수 있다
  await expect(page.getByRole('button', { name: '분석 중…' })).toBeDisabled();
  await expect(page.getByRole('status', { name: '분석 중' })).toBeVisible();
  await expect(page.getByTestId('raw-original')).toHaveText(ORIGINAL);
  // 완료
  await expect(page.getByText('모의 분석이 끝났어요. 제안 9개를 ‘검토 전’으로 추가했어요.')).toBeVisible({ timeout: 10000 });
  await expect(section(page, '명시된 요구사항').getByText('모의 제안 · 검토 전')).toHaveCount(3);
  await expect(section(page, '확인할 질문').getByText('모의 제안 · 검토 전')).toHaveCount(3);
  await expect(section(page, '미확정 사항').getByText('모의 제안 · 검토 전')).toHaveCount(3);
  await expect(page.getByText('AI 제안')).toHaveCount(0); // 모의 결과를 AI 제안이라고 부르지 않는다
  await expect(section(page, '명시된 요구사항').getByText('예약 가능한 날짜 조회')).toBeVisible();
  // 분석은 확정이 아니다: 검토 전 항목이 남아 있어 확정할 수 없다
  await expect(page.getByRole('button', { name: '검토 완료하고 확정' })).toBeDisabled();
  await expect(page.getByText('검토 전 항목이 9개 남아 있어요.')).toBeVisible();
  // 요구사항의 근거 문장이 원문에 밑줄로 표시된다
  await expect(page.locator('.seg-src.has')).toHaveCount(3);
});

test('[E2E-A2] 분석 중에 새로고침해도 진행 상태가 유지되고, 끝나면 결과가 보인다(서버가 진행 상태를 기억한다)', async ({ page, request }) => {
  await setMock(request, { delayMs: 2500, failNext: 0 });
  const rid = await newRequest(request, 'A2 분석 중 새로고침');
  await page.goto(`/requests/${rid}`);
  await page.getByRole('button', { name: '요청 분석하기' }).click();
  await expect(page.getByRole('button', { name: '분석 중…' })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole('button', { name: '분석 중…' })).toBeDisabled(); // 새로고침 뒤에도 "분석 중"
  await expect(page.getByText('모의 분석이 끝났어요.')).toBeVisible({ timeout: 10000 });
  await expect(section(page, '명시된 요구사항').getByText('예약 가능한 날짜 조회')).toBeVisible();
});

test('[E2E-A3] 분석이 실패하면 오류 카드와 "다시 시도"가 나오고 원문은 그대로이며, 다시 시도하면 성공한다', async ({ page, request }) => {
  await setMock(request, { delayMs: 300, failNext: 1 });
  const rid = await newRequest(request, 'A3 분석 실패');
  await page.goto(`/requests/${rid}`);
  await page.getByRole('button', { name: '요청 분석하기' }).click();
  await expect(page.getByRole('heading', { name: '분석 결과를 받지 못했어요' })).toBeVisible();
  await expect(page.getByText('분석에 실패했어요. 원문은 그대로 남아 있어요.')).toBeVisible();
  await expect(page.getByTestId('raw-original')).toHaveText(ORIGINAL);
  await expect(page.getByText('분석을 하지 못했어요. 잠시 후 다시 시도해 주세요.')).toBeVisible(); // 제공자의 내부 오류 내용은 보이지 않는다
  await expect(page.getByText('모의 분석 실패(테스트용)')).toHaveCount(0);
  // 직접 작성하기는 여전히 가능하다
  await expect(page.getByRole('button', { name: '분석 항목 직접 작성하기' })).toBeVisible();
  await page.getByRole('button', { name: '다시 시도' }).click();
  await expect(page.getByText('모의 분석이 끝났어요. 제안 9개를 ‘검토 전’으로 추가했어요.')).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('heading', { name: '분석 결과를 받지 못했어요' })).toHaveCount(0);
});

test('[E2E-A4] 다시 분석하기: 확인창에서 "기존 항목은 그대로"임을 알리고, 사람이 고친 항목은 건드리지 않는다', async ({ page, request }) => {
  await setMock(request, { delayMs: 100, failNext: 0 });
  const rid = await newRequest(request, 'A4 재분석');
  await page.goto(`/requests/${rid}`);
  await page.getByRole('button', { name: '요청 분석하기' }).click();
  await expect(page.getByText('모의 분석이 끝났어요.')).toBeVisible({ timeout: 10000 });
  // 사람이 요구사항 하나를 고친다
  await page.getByRole('button', { name: '수정: 예약 가능한 날짜 조회' }).click();
  await page.getByRole('textbox', { name: '내용을 입력해 주세요' }).fill('예약 가능한 날짜를 보여주기');
  await page.getByRole('button', { name: '적용', exact: true }).click();
  await expect(page.getByText('담당자 수정 · 검토 전')).toBeVisible();
  const runBefore = (await latestRun(request, rid)).id;

  // 확인창: 취소하면 분석이 시작되지 않는다
  await page.getByRole('button', { name: '다시 분석하기' }).click();
  const dialog = page.getByRole('dialog', { name: '다시 분석하기' });
  await expect(dialog.getByText('기존 항목은 그대로 두고')).toBeVisible();
  await expect(dialog.getByText('이미 분석 항목이 9개 있어요.')).toBeVisible();
  await dialog.getByRole('button', { name: '취소' }).click();
  expect((await latestRun(request, rid)).id).toBe(runBefore);

  // 확인하면 시작된다. 같은 모의 결과이므로 새 제안은 없고, 고친 항목은 그대로다.
  await page.getByRole('button', { name: '다시 분석하기' }).click();
  await page.getByRole('dialog', { name: '다시 분석하기' }).getByRole('button', { name: '다시 분석하기' }).click();
  await expect(page.getByText('모의 분석이 끝났어요. 새로 추가할 제안이 없었어요.')).toBeVisible({ timeout: 10000 });
  await expect(section(page, '명시된 요구사항').getByText('예약 가능한 날짜를 보여주기')).toBeVisible();
  await expect(section(page, '명시된 요구사항').getByText('담당자 수정 · 검토 전')).toHaveCount(1);
  const items = (await (await request.get(`/api/requests/${rid}`)).json()).items;
  expect(items).toHaveLength(9);
  expect((await latestRun(request, rid)).id).not.toBe(runBefore);
});

test('[E2E-A5] 이미 항목이 있는 요청에서 분석이 실패해도 기존 항목은 그대로이고, 안내와 다시 시도가 나온다', async ({ page, request }) => {
  await setMock(request, { delayMs: 100, failNext: 1 });
  const rid = await newRequest(request, 'A5 재분석 실패');
  await post(request, `/api/requests/${rid}/items`, { kind: 'question', content: '직접 적은 질문입니다' });
  await page.goto(`/requests/${rid}`);
  await page.getByRole('button', { name: '다시 분석하기' }).click();
  await page.getByRole('dialog', { name: '다시 분석하기' }).getByRole('button', { name: '다시 분석하기' }).click();
  await expect(page.getByText('마지막 분석에 실패했어요.')).toBeVisible({ timeout: 10000 });
  await expect(section(page, '확인할 질문').getByText('직접 적은 질문입니다')).toBeVisible(); // 기존 항목 그대로
  await expect((await (await request.get(`/api/requests/${rid}`)).json()).items).toHaveLength(1);
  await page.getByRole('button', { name: '다시 시도' }).click();
  await page.getByRole('dialog', { name: '다시 분석하기' }).getByRole('button', { name: '다시 분석하기' }).click();
  await expect(page.getByText('모의 분석이 끝났어요. 제안 9개를 ‘검토 전’으로 추가했어요.')).toBeVisible({ timeout: 10000 });
  await expect(section(page, '확인할 질문').getByText('직접 적은 질문입니다')).toBeVisible();
  await expect(page.getByText('마지막 분석에 실패했어요.')).toHaveCount(0);
});

test('[E2E-A6] 분석한 뒤 검토·확정까지 이어지고, 확정된 요청은 다시 분석할 수 없다(모의 제안도 사람이 검토해야 확정된다)', async ({ page, request }) => {
  await setMock(request, { delayMs: 100, failNext: 0 });
  const rid = await newRequest(request, 'A6 분석 후 확정');
  await page.goto(`/requests/${rid}`);
  await page.getByRole('button', { name: '요청 분석하기' }).click();
  await expect(page.getByText('모의 분석이 끝났어요.')).toBeVisible({ timeout: 10000 });
  // 검토 전 9개를 하나씩 검토
  for (let i = 0; i < 9; i++) {
    await page.getByRole('button', { name: /^검토함으로 표시/ }).first().click();
    await expect(page.getByText(`검토 전 항목이 ${8 - i}개 남아 있어요.`).or(page.getByText('확정하면 요구사항이 고정돼요.'))).toBeVisible();
  }
  await expect(page.getByRole('button', { name: '검토 완료하고 확정' })).toBeEnabled();
  await page.getByRole('button', { name: '검토 완료하고 확정' }).click();
  const dlg = page.getByRole('dialog', { name: '요구사항 확정' });
  await expect(dlg.getByText('확정되는 요구사항 3개')).toBeVisible();
  await expect(dlg.getByText('확인할 질문 3개(미해결 3개)', { exact: false })).toBeVisible();
  await dlg.getByRole('button', { name: '확정하기' }).click();
  await expect(page.getByText('요구사항을 확정했어요.')).toBeVisible();
  // 확정된 요청은 분석할 수 없다: 분석 시작 버튼이 없다
  await expect(page.getByRole('button', { name: /다시 분석하기|요청 분석하기/ })).toHaveCount(0);
});

test('[E2E-A7] 좁은 화면(375px)에서 분석 전·분석 중·결과 화면이 잘리지 않는다', async ({ page, request }) => {
  await setMock(request, { delayMs: 1200, failNext: 0 });
  const rid = await newRequest(request, 'A7 좁은 화면 분석');
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`/requests/${rid}`);
  const noHScroll = async () => {
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(m.sw).toBeLessThanOrEqual(m.cw);
  };
  await expect(page.getByRole('button', { name: '요청 분석하기' })).toBeVisible();
  await noHScroll();
  await page.getByRole('button', { name: '요청 분석하기' }).click();
  await expect(page.getByRole('button', { name: '분석 중…' })).toBeVisible();
  await noHScroll();
  await expect(page.getByText('모의 분석이 끝났어요.')).toBeVisible({ timeout: 10000 });
  await noHScroll();
  await page.setViewportSize({ width: 1280, height: 800 });
});
