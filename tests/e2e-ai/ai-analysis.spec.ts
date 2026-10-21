import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

// 3단계: AI 분석 연결(가짜 Anthropic 서버). 한 DB·하루 3회 상한을 순서대로 쓰는 serial 시나리오다.
test.describe.configure({ mode: 'serial' });

const FAKE = 'http://127.0.0.1:3299';
const KEY = 'sk-ant-e2e-fake-KEY';
const ORIGINAL = '홈페이지에서 촬영 예약을 받았으면 좋겠어요. 가능한 날짜를 보고 신청하게 하고, 예약이 들어오면 제가 확인할 수 있으면 좋겠어요.';

async function newRequest(request: APIRequestContext, title: string) {
  const r = await request.post('/api/requests', { data: { title, customerName: '비밀고객', originalText: ORIGINAL } });
  expect(r.ok()).toBeTruthy();
  return (await r.json()).request.id as string;
}
const setMode = (request: APIRequestContext, mode: string) => request.post(`${FAKE}/__mode`, { data: { mode } });
const calls = async (request: APIRequestContext) => (await (await request.get(`${FAKE}/__calls`)).json()) as { key?: string; body: any }[];
const section = (page: Page, name: string) => page.getByRole('region', { name });

test('[E2E-AI1] 전송 안내 → 분석 → 결과는 모두 "AI 제안 · 검토 전", 모의 표시 없음, 사용량 표시', async ({ page, request }) => {
  const rid = await newRequest(request, 'AI 1');
  await page.goto(`/requests/${rid}`);
  await expect(page.getByTestId('ai-notice')).toContainText('원문이 Anthropic로 전송돼요');
  await expect(page.getByTestId('ai-notice')).toContainText('제목·고객명은 보내지 않아요');
  await expect(page.getByTestId('ai-usage')).toContainText('오늘 0/3회');
  await expect(page.getByTestId('mock-banner')).toHaveCount(0);
  await page.getByRole('button', { name: '요청 분석하기' }).click();
  await expect(page.getByText('AI 분석이 끝났어요. 제안 4개를 ‘검토 전’으로 추가했어요.')).toBeVisible({ timeout: 10000 });
  await expect(section(page, '명시된 요구사항').getByText('AI 제안 · 검토 전')).toHaveCount(2);
  await expect(section(page, '확인할 질문').getByText('AI 제안 · 검토 전')).toHaveCount(1);
  await expect(section(page, '미확정 사항').getByText('AI 제안 · 검토 전')).toHaveCount(1);
  await expect(page.getByText('모의 제안')).toHaveCount(0);
  await expect(page.getByTestId('ai-usage')).toContainText('오늘 1/3회');
  // 전송된 내용: 원문만, 제목·고객명 없음. 키는 서버에서 헤더로만.
  const sent = (await calls(request)).at(-1)!;
  expect(JSON.stringify(sent.body)).toContain('촬영 예약');
  expect(JSON.stringify(sent.body)).not.toContain('비밀고객');
  expect(sent.key).toBe(KEY);
  // 확정되지 않음
  await expect(page.getByRole('button', { name: '검토 완료하고 확정' })).toBeDisabled();
});

test('[E2E-AI2] 실패(API 키 오류): 키·서버 메시지는 화면/API 어디에도 없고, 다시 시도하면 성공한다', async ({ page, request }) => {
  const rid = await newRequest(request, 'AI 2');
  await setMode(request, '401');
  await page.goto(`/requests/${rid}`);
  await page.getByRole('button', { name: '요청 분석하기' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'API 키' }).first()).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('button', { name: '다시 시도' }).first()).toBeVisible();
  const pageHtml = await page.content();
  const apiJson = await (await request.get(`/api/requests/${rid}`)).text();
  for (const t of [pageHtml, apiJson]) {
    expect(t).not.toContain(KEY);
    expect(t).not.toContain('invalid x-api-key');
  }
  await setMode(request, 'ok');
  await page.getByRole('button', { name: '다시 시도' }).first().click();
  await expect(section(page, '명시된 요구사항').getByText('AI 제안 · 검토 전')).toHaveCount(2, { timeout: 10000 });
  await expect(page.getByTestId('ai-usage')).toContainText('오늘 3/3회'); // 실패한 호출도 센다
});

test('[E2E-AI3] 하루 상한에 도달하면 버튼이 막히고 안내가 보인다(서버도 429)', async ({ page, request }) => {
  const rid = await newRequest(request, 'AI 3');
  await page.goto(`/requests/${rid}`);
  await expect(page.getByTestId('ai-limit')).toContainText('오늘 AI 분석 횟수(3회)를 모두 썼어요');
  await expect(page.getByRole('button', { name: '분석 한도 도달' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '요청 분석하기' })).toHaveCount(0);
  const before = (await calls(request)).length;
  const res = await request.post(`/api/requests/${rid}/analyze`, { data: {} });
  expect(res.status()).toBe(429);
  expect((await res.json()).code).toBe('usage_limit');
  expect((await calls(request)).length).toBe(before); // 외부 호출이 일어나지 않음
  // 직접 작성하기는 계속 가능
  await expect(page.getByRole('button', { name: '분석 항목 직접 작성하기' })).toBeVisible();
});
