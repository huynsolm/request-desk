import type {
  AnalysisItem,
  AnalysisRunSummary,
  ApiErrorBody,
  ConfirmPreview,
  CreateTasksInput,
  CreateTasksResult,
  ItemKind,
  RequestDetail,
  RequestListResponse,
  TaskDetail,
  TaskListResponse,
  TaskStatus,
} from '../../shared/types.ts';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fieldErrors?: Record<string, string>,
  ) {
    super(message);
  }
  /** 네트워크 끊김·서버 오류: 다시 시도하면 될 수 있는 실패 */
  get retryable() {
    return this.status === 0 || this.status >= 500;
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', '서버에 연결하지 못했어요.');
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const e = (json ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(res.status, e.code ?? 'error', e.message ?? '요청을 처리하지 못했어요.', e.fieldErrors);
  }
  return json as T;
}

const qs = (o: Record<string, string>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  summary: () => call<{ requests: number; tasks: number }>('GET', '/api/summary'),
  listRequests: (q: string, status: string) => call<RequestListResponse>('GET', `/api/requests${qs({ q, status })}`),
  createRequest: (b: { title: string; customerName: string; originalText: string }) => call<RequestDetail>('POST', '/api/requests', b),
  getRequest: (id: string) => call<RequestDetail>('GET', `/api/requests/${id}`),
  updateRequest: (id: string, b: { version: number; title?: string; customerName?: string; originalText?: string }) =>
    call<RequestDetail>('PATCH', `/api/requests/${id}`, b),
  analyze: (id: string, confirmReanalysis: boolean) =>
    call<{ run: AnalysisRunSummary }>('POST', `/api/requests/${id}/analyze`, { confirmReanalysis }),
  reopen: (id: string) => call<RequestDetail>('POST', `/api/requests/${id}/reopen`),
  addItem: (rid: string, b: { kind: ItemKind; content: string; quote?: string | null }) =>
    call<AnalysisItem>('POST', `/api/requests/${rid}/items`, b),
  updateItem: (id: string, b: { version: number; content?: string; quote?: string | null }) => call<AnalysisItem>('PATCH', `/api/items/${id}`, b),
  deleteItem: (id: string, version: number) => call<{ ok: true }>('DELETE', `/api/items/${id}`, { version }),
  restoreItem: (id: string) => call<AnalysisItem>('POST', `/api/items/${id}/restore`),
  reviewItem: (id: string, version: number) => call<AnalysisItem>('POST', `/api/items/${id}/review`, { version }),
  resolveItem: (id: string, b: { version: number; resolution: 'open' | 'answered' | 'decided'; text?: string }) =>
    call<AnalysisItem>('POST', `/api/items/${id}/resolve`, b),
  convertItem: (id: string, b: { version: number; content: string; basis: string }) =>
    call<AnalysisItem>('POST', `/api/items/${id}/convert`, b),
  confirmPreview: (id: string) => call<ConfirmPreview>('GET', `/api/requests/${id}/confirm-preview`),
  confirm: (id: string, contentSeq: number) => call<RequestDetail>('POST', `/api/requests/${id}/confirm`, { contentSeq }),
  createTasks: (rid: string, b: CreateTasksInput) => call<CreateTasksResult>('POST', `/api/requests/${rid}/tasks`, b),
  listTasks: (status: string) => call<TaskListResponse>('GET', `/api/tasks${qs({ status })}`),
  getTask: (id: string) => call<TaskDetail>('GET', `/api/tasks/${id}`),
  updateTask: (id: string, b: { version: number; title?: string; description?: string; status?: TaskStatus }) =>
    call<TaskDetail>('PATCH', `/api/tasks/${id}`, b),
  addCriterion: (taskId: string, text: string) => call<TaskDetail>('POST', `/api/tasks/${taskId}/criteria`, { text }),
  updateCriterion: (id: string, b: { done?: boolean; text?: string }) => call<TaskDetail>('PATCH', `/api/criteria/${id}`, b),
  deleteCriterion: (id: string) => call<TaskDetail>('DELETE', `/api/criteria/${id}`),
};
