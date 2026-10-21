export type RequestStatus = 'received' | 'reviewing' | 'confirmed';
export type TaskStatus = 'todo' | 'doing' | 'done';
export type ItemKind = 'requirement' | 'question' | 'undecided';
export type ItemOrigin = 'ai' | 'mock' | 'manual';
export type ReviewState = 'unreviewed' | 'reviewed';
export type Resolution = 'open' | 'answered' | 'decided';

export interface ApiErrorBody {
  code: string;
  message: string;
  fieldErrors?: Record<string, string>;
}

export interface RequestRow {
  id: string;
  title: string;
  customerName: string;
  preview: string;
  status: RequestStatus;
  createdAt: string;
  unreviewedCount: number;
}
export interface RequestListResponse {
  items: RequestRow[];
  counts: { all: number; received: number; reviewing: number; confirmed: number };
  total: number; // 검색·필터와 무관한 전체 요청 수 (첫 사용 vs 결과 없음 구분)
}

export interface ItemTaskRef {
  id: string;
  status: TaskStatus;
  sourceChanged: boolean;
}
export interface AnalysisItem {
  id: string;
  requestId: string;
  kind: ItemKind;
  position: number;
  content: string;
  quote: string | null;
  quoteValid: boolean; // 인용이 현재 원문에 있는가
  note: string | null;
  origin: ItemOrigin;
  humanEdited: boolean;
  reviewState: ReviewState;
  resolution: Resolution | null;
  resolutionText: string | null;
  derivedFromItemId: string | null;
  derivedBasis: string | null;
  version: number;
  task: ItemTaskRef | null;
}

export interface ConfirmationItemSnapshot {
  id: string;
  sourceItemId: string;
  kind: ItemKind;
  content: string;
  quote: string | null;
  resolution: Resolution | null;
  resolutionText: string | null;
}
export interface Confirmation {
  id: string;
  analysisRev: number;
  originalRev: number;
  includedCount: number;
  excludedQuestions: number;
  excludedUndecided: number;
  confirmedAt: string;
  items: ConfirmationItemSnapshot[];
}
export interface RequestDetail {
  request: {
    id: string;
    title: string;
    customerName: string;
    originalText: string;
    originalRev: number;
    analysisRev: number;
    phase: 'reviewing' | 'confirmed';
    status: RequestStatus;
    version: number;
    contentSeq: number;
    createdAt: string;
    updatedAt: string;
  };
  items: AnalysisItem[];
  analysis: { provider: ProviderInfo | null; latestRun: AnalysisRunSummary | null };
  confirmations: Confirmation[]; // 최신순
  tasks: { id: string; title: string; status: TaskStatus; sourceChanged: boolean }[];
}

export interface ProviderInfo {
  id: 'mock' | 'ai';
  label: string;
  isMock: boolean;
}
export interface AnalysisRunSummary {
  id: string;
  status: 'running' | 'succeeded' | 'failed';
  provider: 'mock' | 'ai';
  reanalysis: boolean; // 시작할 때 이미 분석 항목이 있었는가
  startedAt: string;
  finishedAt: string | null;
  itemCount: number | null; // 새로 추가한 제안 수
  skippedCount: number | null; // 검증을 통과하지 못해 제외한 제안 수
  errorCode: string | null;
  errorMessage: string | null;
}

export interface ConfirmPreview {
  contentSeq: number;
  analysisRev: number;
  included: { id: string; content: string }[];
  excludedQuestions: number;
  excludedUndecided: number;
  unresolvedQuestions: number;
  unresolvedUndecided: number;
  blockers: { code: string; message: string; itemIds?: string[] }[];
}

export interface TaskCriterion {
  id: string;
  text: string;
  done: boolean;
  position: number;
}
export interface TaskRow {
  id: string;
  title: string;
  status: TaskStatus;
  version: number;
  requestId: string;
  requestTitle: string;
  customerName: string;
  criteriaDone: number;
  criteriaTotal: number;
  sourceChanged: boolean;
  createdAt: string;
}
export interface TaskListResponse {
  items: TaskRow[];
  counts: { all: number; todo: number; doing: number; done: number };
}
export interface TaskDetail extends TaskRow {
  description: string;
  requirementText: string; // 확정 당시 요구사항
  requirementQuote: string | null;
  criteria: TaskCriterion[];
  changeReasons: string[];
}

export interface CreateTasksInput {
  tasks: { confirmationItemId: string; title: string; description?: string; criteria: string[] }[];
}
export interface CreateTasksResult {
  created: TaskRow[];
  existing: TaskRow[]; // 이미 작업이 있어 새로 만들지 않은 항목
}
