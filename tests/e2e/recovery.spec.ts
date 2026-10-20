import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

// 독립 검수(5a05652) F1~F4 회귀 테스트: 저장 실패 후 재시도에서 최신 입력이 사라지지 않는지,
// 빠져 있던 편집 경로(완료 조건 문구, 근거 인용)가 화면에서 동작하는지 확인한다.
test.describe.configure({ mode: 'serial' });

const ORIGINAL = '홈페이지에서 촬영 예약을 받았으면 좋겠어요. 가능한 날짜를 보고 신청하게 하고, 예약이 들어오면 제가 확인할 수 있으면 좋겠어요.';

async function post(request: APIRequestContext, path: string, data: unknown) {
  const r = await request.post(path, { data });
  expect(r.ok(), `${path} → ${r.status()} ${await r.text()}`).toBeTruthy();
  return r.json();
}

async function newRequestWithItem(request: APIRequestContext, title: string, quote?: string) {
  const d = await post(request, '/api/requests', { title, customerName: '검수 고객', originalText: ORIGINAL });
  const rid = d.request.id as string;
  const item = await post(request, `/api/requests/${rid}/items`, { kind: 'requirement', content: '예약 가능한 날짜 조회', quote });
  return { rid, itemId: item.id as string };
}

async function requestTaskWith(request: APIRequestContext, title: string, criteria: string[]) {
  const { rid } = await newRequestWithItem(request, title, '가능한 날짜를 보고');
  const preview = await (await request.get(`/api/requests/${rid}/confirm-preview`)).json();
  const confirmed = await post(request, `/api/requests/${rid}/confirm`, { contentSeq: preview.contentSeq });
  const snap = confirmed.confirmations[0].items.find((i: any) => i.kind === 'requirement');
  const made = await post(request, `/api/requests/${rid}/tasks`, { tasks: [{ confirmationItemId: snap.id, title: '날짜 조회 화면', criteria }] });
  return { rid, taskId: made.created[0].id as string };
}

async function blockPatch(page: Page, glob: string, methods = ['PATCH']) {
  const state = { blocked: true };
  await page.route(glob, async (route) => {
    if (methods.includes(route.request().method()) && state.blocked) return route.abort('failed');
    return route.continue();
  });
  return state;
}

test('[E2E-F1] 항목 저장 실패 후 입력을 더 고치고 "다시 저장"하면 최신 입력이 저장된다', async ({ page, request }) => {
  const { rid, itemId } = await newRequestWithItem(request, 'F1 재시도 최신 입력');
  await page.goto(`/requests/${rid}`);
  const net = await blockPatch(page, '**/api/items/*');
  await page.getByRole('button', { name: '수정: 예약 가능한 날짜 조회' }).click();
  const editor = page.getByRole('textbox', { name: '내용을 입력해 주세요' });
  await editor.fill('첫 번째로 실패한 내용입니다');
  await page.keyboard.press('Enter');
  await expect(page.getByText('! 저장 실패')).toBeVisible();
  // 실패한 뒤에도 입력창은 남아 있고, 사용자는 내용을 더 고친다.
  await expect(editor).toHaveValue('첫 번째로 실패한 내용입니다');
  await editor.fill('실패 후 다시 고친 최신 내용입니다');
  net.blocked = false;
  await page.getByRole('button', { name: '다시 저장' }).click();
  await expect(page.getByText('✓ 편집 내용 자동 저장됨')).toBeVisible();
  await expect(editor).toHaveCount(0);
  const items = (await (await request.get(`/api/requests/${rid}`)).json()).items;
  expect(items.find((i: any) => i.id === itemId).content).toBe('실패 후 다시 고친 최신 내용입니다');
});

test('[E2E-F1] 저장 실패 후 취소하면 "다시 저장" 대기가 사라지고 과거 입력이 되살아나지 않는다', async ({ page, request }) => {
  const { rid, itemId } = await newRequestWithItem(request, 'F1 취소 후 재시도');
  await page.goto(`/requests/${rid}`);
  const net = await blockPatch(page, '**/api/items/*');
  await page.getByRole('button', { name: '수정: 예약 가능한 날짜 조회' }).click();
  await page.getByRole('textbox', { name: '내용을 입력해 주세요' }).fill('취소할 내용입니다');
  await page.keyboard.press('Enter');
  await expect(page.getByText('! 저장 실패')).toBeVisible();
  await page.getByRole('button', { name: '취소', exact: true }).click();
  net.blocked = false;
  await expect(page.getByText('✓ 편집 내용 자동 저장됨')).toBeVisible();
  await expect(page.getByRole('button', { name: '다시 저장' })).toHaveCount(0);
  await page.waitForTimeout(300);
  const items = (await (await request.get(`/api/requests/${rid}`)).json()).items;
  expect(items.find((i: any) => i.id === itemId).content).toBe('예약 가능한 날짜 조회'); // 원래 내용 그대로
});

test('[E2E-F2] 작업 제목 저장 실패 → 다시 저장 성공 → 이어서 쓴 설명이 409 없이 저장된다', async ({ page, request }) => {
  const { taskId } = await requestTaskWith(request, 'F2 작업 재시도', ['고객이 예약 가능한 날짜를 볼 수 있다']);
  await page.goto(`/tasks/${taskId}`);
  const panel = page.getByRole('complementary', { name: '작업 상세' });
  const net = await blockPatch(page, '**/api/tasks/*');
  await panel.getByLabel('작업 제목').fill('재시도할 제목');
  await panel.getByLabel('작업 제목').blur();
  await expect(panel.getByText('저장하지 못했어요.')).toBeVisible();
  net.blocked = false;
  await panel.getByRole('button', { name: '다시 저장' }).click();
  await expect(panel.getByText('저장하지 못했어요.')).toHaveCount(0);
  // 재시도 성공 뒤에 이어서 설명을 쓴다 → 버전이 갱신되어 있어야 충돌이 나지 않는다.
  await panel.getByLabel('설명').fill('재시도 성공 이후에 쓴 중요한 설명');
  await panel.getByLabel('설명').blur();
  await expect(page.getByText('다른 곳에서 먼저 바뀐 내용이에요')).toHaveCount(0);
  await expect(panel.getByLabel('설명')).toHaveValue('재시도 성공 이후에 쓴 중요한 설명');
  await expect.poll(async () => (await (await request.get(`/api/tasks/${taskId}`)).json()).description).toBe('재시도 성공 이후에 쓴 중요한 설명');
  const t = await (await request.get(`/api/tasks/${taskId}`)).json();
  expect(t.title).toBe('재시도할 제목');
});

test('[E2E-F2] 완료 조건 체크 저장 실패 → 다시 저장 성공 후 화면과 서버 상태가 같다', async ({ page, request }) => {
  const { taskId } = await requestTaskWith(request, 'F2 체크리스트 재시도', ['고객이 예약 가능한 날짜를 볼 수 있다']);
  await page.goto(`/tasks/${taskId}`);
  const panel = page.getByRole('complementary', { name: '작업 상세' });
  const net = await blockPatch(page, '**/api/criteria/*');
  const box = panel.getByRole('checkbox', { name: /완료 조건 확인/ });
  await box.click();
  await expect(panel.getByText('저장하지 못했어요.')).toBeVisible();
  net.blocked = false;
  await panel.getByRole('button', { name: '다시 저장' }).click();
  await expect(box).toHaveAttribute('aria-checked', 'true');
  await expect(panel.getByText('1/1')).toBeVisible();
  const t = await (await request.get(`/api/tasks/${taskId}`)).json();
  expect(t.criteria[0].done).toBe(true);
});

test('[E2E-F3] 기존 완료 조건의 문구를 수정하면 같은 조건(ID·완료 상태)이 유지된다', async ({ page, request }) => {
  const { taskId } = await requestTaskWith(request, 'F3 완료 조건 수정', ['첫 번째 완료 조건입니다', '두 번째 완료 조건입니다']);
  const before = await (await request.get(`/api/tasks/${taskId}`)).json();
  await page.goto(`/tasks/${taskId}`);
  const panel = page.getByRole('complementary', { name: '작업 상세' });
  await panel.getByRole('checkbox', { name: '완료 조건 확인: 첫 번째 완료 조건입니다' }).click();
  await expect(panel.getByText('1/2')).toBeVisible();
  await panel.getByRole('button', { name: '완료 조건 수정: 첫 번째 완료 조건입니다' }).click();
  const editor = panel.getByRole('textbox', { name: '완료 조건 문구' });
  await editor.fill('요청대로 동작한다');
  await page.keyboard.press('Enter');
  await expect(panel.getByText('모호한 문장은 쓸 수 없어요', { exact: false })).toBeVisible(); // 모호한 문구 거부
  await editor.fill('첫 번째 완료 조건을 구체적으로 고쳤습니다');
  await page.keyboard.press('Enter');
  await expect(panel.getByText('첫 번째 완료 조건을 구체적으로 고쳤습니다')).toBeVisible();
  await expect(editor).toHaveCount(0);
  const after = await (await request.get(`/api/tasks/${taskId}`)).json();
  expect(after.criteria.map((c: any) => c.id)).toEqual(before.criteria.map((c: any) => c.id)); // ID 유지
  expect(after.criteria[0].text).toBe('첫 번째 완료 조건을 구체적으로 고쳤습니다');
  expect(after.criteria[0].done).toBe(true); // 완료 상태 유지
  // 마지막 한 개가 남으면 삭제할 수 없다
  await panel.getByRole('button', { name: /^완료 조건 삭제: 두 번째/ }).click();
  // 삭제 결과가 화면에 반영될 때까지(조건 1개만 남을 때까지) 기다린 뒤, 남은 조건의 삭제 버튼이 비활성인지 확인한다.
  await expect(panel.getByRole('button', { name: /^완료 조건 삭제:/ })).toHaveCount(1);
  await expect(panel.getByRole('button', { name: '완료 조건 삭제: 첫 번째 완료 조건을 구체적으로 고쳤습니다' })).toBeDisabled();
});

test('[E2E-F4] 원문이 바뀌어 무효가 된 근거 인용문을 화면에서 고쳐 확정할 수 있다', async ({ page, request }) => {
  const { rid, itemId } = await newRequestWithItem(request, 'F4 근거 수정', '가능한 날짜를 보고');
  await page.goto(`/requests/${rid}`);
  // 원문에서 근거 문장을 바꾼다
  await page.getByRole('button', { name: '요청 정보 수정' }).click();
  const dialog = page.getByRole('dialog', { name: '요청 정보 수정' });
  await dialog.getByLabel('요청 원문').fill(ORIGINAL.replace('가능한 날짜를 보고', '예약 가능한 일정을 확인하고'));
  await dialog.getByRole('button', { name: '저장하기' }).click();
  await expect(page.getByText('원문에서 근거 문장을 찾을 수 없는 요구사항이 있어요.')).toBeVisible();
  await expect(page.getByRole('button', { name: '검토 완료하고 확정' })).toBeDisabled();
  // 수정 창에서 근거 문장을 고친다(내용·ID 유지)
  await page.getByRole('button', { name: '수정: 예약 가능한 날짜 조회' }).click();
  await expect(page.getByRole('textbox', { name: '원문 근거' })).toHaveValue('가능한 날짜를 보고');
  await page.getByRole('textbox', { name: '원문 근거' }).fill('엉뚱한 문장');
  await page.getByRole('button', { name: '적용', exact: true }).click();
  await expect(page.getByText('근거 문장이 원문에 그대로 있어야 해요.')).toBeVisible();
  await page.getByRole('textbox', { name: '원문 근거' }).fill('예약 가능한 일정을 확인하고');
  await page.getByRole('button', { name: '적용', exact: true }).click();
  await expect(page.getByText('원문 “예약 가능한 일정을 확인하고”')).toBeVisible();
  await page.getByRole('button', { name: '검토함으로 표시: 예약 가능한 날짜 조회' }).click();
  await expect(page.getByRole('button', { name: '검토 완료하고 확정' })).toBeEnabled();
  const item = (await (await request.get(`/api/requests/${rid}`)).json()).items.find((i: any) => i.id === itemId);
  expect(item.quote).toBe('예약 가능한 일정을 확인하고');
  expect(item.quoteValid).toBe(true);
});

// ───── 재검수(b371952) R1: 여러 저장이 동시에 실패한 뒤 한 번에 재시도 ─────
async function taskPanelWithBlockedPatch(page: Page, request: APIRequestContext, title: string) {
  const { taskId } = await requestTaskWith(request, title, ['고객이 예약 가능한 날짜를 볼 수 있다']);
  await page.goto(`/tasks/${taskId}`);
  const panel = page.getByRole('complementary', { name: '작업 상세' });
  const net = await blockPatch(page, '**/api/tasks/*');
  return { taskId, panel, net };
}

test('[E2E-R1] 제목·설명 저장이 모두 실패해도 "다시 저장" 한 번으로 둘 다 저장되고 충돌이 나지 않는다', async ({ page, request }) => {
  const { taskId, panel, net } = await taskPanelWithBlockedPatch(page, request, 'R1 제목+설명');
  await panel.getByLabel('작업 제목').fill('동시 실패 후 제목');
  await panel.getByLabel('작업 제목').blur();
  await panel.getByLabel('설명').fill('동시 실패 후 중요한 설명');
  await panel.getByLabel('설명').blur();
  await expect(panel.getByText('저장하지 못했어요.')).toBeVisible();
  net.blocked = false;
  await panel.getByRole('button', { name: '다시 저장' }).click();
  await expect(panel.getByText('저장하지 못했어요.')).toHaveCount(0);
  await expect(page.getByText('다른 곳에서 먼저 바뀐 내용이에요')).toHaveCount(0);
  await expect.poll(async () => (await (await request.get(`/api/tasks/${taskId}`)).json()).description).toBe('동시 실패 후 중요한 설명');
  const t = await (await request.get(`/api/tasks/${taskId}`)).json();
  expect(t.title).toBe('동시 실패 후 제목'); // 서버에 두 필드 모두 저장됨
  await expect(panel.getByLabel('설명')).toHaveValue('동시 실패 후 중요한 설명');
});

test('[E2E-R1] 제목·설명·상태 세 개가 모두 실패해도 한 번에 재시도되어 모두 저장된다', async ({ page, request }) => {
  const { taskId, panel, net } = await taskPanelWithBlockedPatch(page, request, 'R1 세 개');
  await panel.getByLabel('작업 제목').fill('세 개 실패 제목');
  await panel.getByLabel('작업 제목').blur();
  await panel.getByLabel('설명').fill('세 개 실패 설명');
  await panel.getByLabel('설명').blur();
  await panel.getByRole('button', { name: '진행 중', exact: true }).click();
  await expect(panel.getByText('저장하지 못했어요.')).toBeVisible();
  net.blocked = false;
  await panel.getByRole('button', { name: '다시 저장' }).click();
  await expect(panel.getByText('저장하지 못했어요.')).toHaveCount(0);
  await expect.poll(async () => (await (await request.get(`/api/tasks/${taskId}`)).json()).status).toBe('doing');
  const t = await (await request.get(`/api/tasks/${taskId}`)).json();
  expect([t.title, t.description, t.status]).toEqual(['세 개 실패 제목', '세 개 실패 설명', 'doing']);
});

test('[E2E-R1] 다시 저장이 또 실패하면 실패 표시와 재시도 버튼이 유지되고, 복구 후 저장된다', async ({ page, request }) => {
  const { taskId, panel, net } = await taskPanelWithBlockedPatch(page, request, 'R1 반복');
  await panel.getByLabel('작업 제목').fill('반복 재시도 제목');
  await panel.getByLabel('작업 제목').blur();
  await panel.getByLabel('설명').fill('반복 재시도 설명');
  await panel.getByLabel('설명').blur();
  await expect(panel.getByText('저장하지 못했어요.')).toBeVisible();
  await panel.getByRole('button', { name: '다시 저장' }).click(); // 아직 연결이 끊긴 상태
  await expect(panel.getByText('저장하지 못했어요.')).toBeVisible();
  await expect(panel.getByRole('button', { name: '다시 저장' })).toBeVisible();
  net.blocked = false;
  await panel.getByRole('button', { name: '다시 저장' }).click();
  await expect(panel.getByText('저장하지 못했어요.')).toHaveCount(0);
  await expect.poll(async () => (await (await request.get(`/api/tasks/${taskId}`)).json()).description).toBe('반복 재시도 설명');
  expect((await (await request.get(`/api/tasks/${taskId}`)).json()).title).toBe('반복 재시도 제목');
});

test('[E2E-R1] 그 사이 다른 곳에서 작업이 바뀌어 409 가 나면 오류를 숨기지 않고, 다시 저장하면 최신 버전으로 저장된다', async ({ page, request }) => {
  const { taskId, panel, net } = await taskPanelWithBlockedPatch(page, request, 'R1 외부 수정');
  await panel.getByLabel('작업 제목').fill('내가 쓴 제목');
  await panel.getByLabel('작업 제목').blur();
  await expect(panel.getByText('저장하지 못했어요.')).toBeVisible();
  // 다른 곳(여기서는 API 직접 호출)에서 같은 작업의 설명을 먼저 바꿔 version 이 올라간다.
  const cur = await (await request.get(`/api/tasks/${taskId}`)).json();
  const ext = await request.patch(`/api/tasks/${taskId}`, { data: { version: cur.version, description: '외부에서 바꾼 설명' } });
  expect(ext.ok()).toBeTruthy();
  net.blocked = false;
  await panel.getByRole('button', { name: '다시 저장' }).click();
  // 첫 재시도는 409 → 오류 안내와 재시도 버튼이 남아 있어야 한다(숨겨지면 안 됨)
  await expect(panel.getByText('다른 곳에서 먼저 바뀐 내용이에요. 다시 저장하면 지금 입력한 내용으로 덮어써요.')).toBeVisible();
  await expect(panel.getByRole('button', { name: '다시 저장' })).toBeVisible();
  await expect(panel.getByLabel('작업 제목')).toHaveValue('내가 쓴 제목'); // 초안은 그대로
  await panel.getByRole('button', { name: '다시 저장' }).click(); // 최신 버전으로 다시 저장
  await expect(panel.getByText('저장하지 못했어요.')).toHaveCount(0);
  await expect.poll(async () => (await (await request.get(`/api/tasks/${taskId}`)).json()).title).toBe('내가 쓴 제목');
  const t = await (await request.get(`/api/tasks/${taskId}`)).json();
  expect(t.description).toBe('외부에서 바꾼 설명'); // 내가 건드리지 않은 필드는 덮어쓰지 않는다
});

// ───── 3차 재검수(be7e60d) R2: 건드리지 않은 필드는 충돌 뒤에도 덮어쓰지 않는다 ─────
test('[E2E-R2] 제목 충돌을 해결한 뒤 건드리지 않은 설명 칸에 포커스만 옮겨도 외부의 최신 설명을 덮어쓰지 않는다', async ({ page, request }) => {
  const { taskId } = await requestTaskWith(request, 'R2 미수정 필드', ['고객이 예약 가능한 날짜를 볼 수 있다']);
  await page.goto(`/tasks/${taskId}`);
  const panel = page.getByRole('complementary', { name: '작업 상세' });
  await expect(panel.getByLabel('설명')).not.toHaveValue('');
  // 다른 곳에서 설명을 먼저 바꾼다(화면은 아직 예전 설명을 보여준다).
  const cur = await (await request.get(`/api/tasks/${taskId}`)).json();
  const ext = await request.patch(`/api/tasks/${taskId}`, { data: { version: cur.version, description: '외부에서 갱신한 최신 설명' } });
  expect(ext.ok()).toBeTruthy();
  // 제목만 고친다 → 409 충돌 안내 + 다시 저장
  await panel.getByLabel('작업 제목').fill('내가 고친 제목');
  await panel.getByLabel('작업 제목').blur();
  await expect(panel.getByText('다른 곳에서 먼저 바뀐 내용이에요. 다시 저장하면 지금 입력한 내용으로 덮어써요.')).toBeVisible();
  await panel.getByRole('button', { name: '다시 저장' }).click();
  await expect(panel.getByText('저장하지 못했어요.')).toHaveCount(0);
  // 건드리지 않은 설명 칸은 서버의 최신 값으로 맞춰져 있어야 한다.
  await expect(panel.getByLabel('설명')).toHaveValue('외부에서 갱신한 최신 설명');
  // 설명 칸에 포커스를 넣었다 빼도 아무것도 저장되지 않는다(서버 설명이 그대로).
  const patches: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'PATCH' && r.url().includes('/api/tasks/')) patches.push(r.postData() ?? '');
  });
  await panel.getByLabel('설명').focus();
  await panel.getByLabel('작업 제목').focus();
  await page.waitForTimeout(500);
  expect(patches).toEqual([]);
  const t = await (await request.get(`/api/tasks/${taskId}`)).json();
  expect(t.title).toBe('내가 고친 제목');
  expect(t.description).toBe('외부에서 갱신한 최신 설명');
});

test('[E2E-R2] 충돌이 나도 사용자가 실제로 고친 설명 초안은 보존되고 저장된다', async ({ page, request }) => {
  const { taskId } = await requestTaskWith(request, 'R2 수정한 필드', ['고객이 예약 가능한 날짜를 볼 수 있다']);
  await page.goto(`/tasks/${taskId}`);
  const panel = page.getByRole('complementary', { name: '작업 상세' });
  await expect(panel.getByLabel('설명')).not.toHaveValue('');
  const cur = await (await request.get(`/api/tasks/${taskId}`)).json();
  await request.patch(`/api/tasks/${taskId}`, { data: { version: cur.version, title: '외부에서 바꾼 제목' } });
  // 사용자가 설명을 고친다 → 409 → 안내가 보이고 초안은 그대로
  await panel.getByLabel('설명').fill('내가 고친 설명 초안');
  await panel.getByLabel('설명').blur();
  await expect(panel.getByText('다른 곳에서 먼저 바뀐 내용이에요. 다시 저장하면 지금 입력한 내용으로 덮어써요.')).toBeVisible();
  await expect(panel.getByLabel('설명')).toHaveValue('내가 고친 설명 초안');
  // 건드리지 않은 제목은 서버의 최신 값으로 맞춰진다
  await expect(panel.getByLabel('작업 제목')).toHaveValue('외부에서 바꾼 제목');
  await panel.getByRole('button', { name: '다시 저장' }).click();
  await expect(panel.getByText('저장하지 못했어요.')).toHaveCount(0);
  const t = await (await request.get(`/api/tasks/${taskId}`)).json();
  expect(t.description).toBe('내가 고친 설명 초안');
  expect(t.title).toBe('외부에서 바꾼 제목'); // 내가 건드리지 않은 제목은 덮어쓰지 않았다
});

test('[E2E-R2] 항목 수정 창을 연 뒤 서버에서 그 항목이 바뀌어도, 고치지 않고 적용하면 최신 내용을 덮어쓰지 않는다', async ({ page, request }) => {
  const { rid, itemId } = await newRequestWithItem(request, 'R2 항목 입력창');
  await post(request, `/api/requests/${rid}/items`, { kind: 'requirement', content: '다른 요구사항 항목' });
  await page.goto(`/requests/${rid}`);
  await page.getByRole('button', { name: '수정: 예약 가능한 날짜 조회' }).click(); // 수정 창을 연다(내용은 고치지 않음)
  // 다른 곳에서 이 항목의 내용을 먼저 바꾼다.
  const cur = (await (await request.get(`/api/requests/${rid}`)).json()).items.find((i: any) => i.id === itemId);
  const ext = await request.patch(`/api/items/${itemId}`, { data: { version: cur.version, content: '외부에서 바꾼 요구사항 내용' } });
  expect(ext.ok()).toBeTruthy();
  // 화면이 새로고침되도록 다른 항목을 삭제한다(수정 창은 열려 있다).
  await page.getByRole('button', { name: '삭제: 다른 요구사항 항목' }).click();
  await expect(page.getByText('항목을 삭제했어요.')).toBeVisible();
  const patches: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'PATCH' && r.url().includes('/api/items/')) patches.push(r.postData() ?? '');
  });
  await page.getByRole('button', { name: '적용', exact: true }).click(); // 고치지 않고 적용
  await page.waitForTimeout(500);
  expect(patches).toEqual([]);
  const after = (await (await request.get(`/api/requests/${rid}`)).json()).items.find((i: any) => i.id === itemId);
  expect(after.content).toBe('외부에서 바꾼 요구사항 내용');
});
