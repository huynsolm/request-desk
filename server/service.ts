import { randomUUID } from 'node:crypto';
import type { Db } from './db/open.ts';
import { tx } from './db/open.ts';
import { AppError, translateDbError } from './errors.ts';
import {
  checkCriterion,
  checkCustomer,
  checkItemContent,
  checkNote,
  checkOriginal,
  checkTitle,
  normalizeNewlines,
} from '../shared/validation.ts';
import type {
  AnalysisItem,
  ConfirmPreview,
  Confirmation,
  CreateTasksInput,
  CreateTasksResult,
  ItemKind,
  ItemOrigin,
  RequestDetail,
  RequestListResponse,
  RequestStatus,
  TaskDetail,
  TaskListResponse,
  TaskRow,
  TaskStatus,
} from '../shared/types.ts';

type Row = Record<string, any>;

const now = () => new Date().toISOString();
const id = () => randomUUID();

/** 트랜잭션 + DB 오류 번역. 서비스 쓰기 함수는 모두 이 안에서 실행한다. */
function write<T>(db: Db, fn: () => T): T {
  try {
    return tx(db, fn);
  } catch (err) {
    if (err instanceof AppError) throw err;
    const translated = translateDbError(err);
    if (translated) throw translated;
    throw err;
  }
}

const notFound = (what: string) => new AppError(404, 'not_found', `${what}을 찾을 수 없어요.`);
const conflict = () =>
  new AppError(409, 'version_conflict', '다른 곳에서 먼저 바뀐 내용이에요. 화면을 새로 불러온 뒤 다시 시도해 주세요.');

function getRequestRow(db: Db, requestId: string): Row {
  const row = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId) as Row | undefined;
  if (!row) throw notFound('요청');
  return row;
}
function getItemRow(db: Db, itemId: string): Row {
  const row = db.prepare('SELECT * FROM analysis_items WHERE id = ?').get(itemId) as Row | undefined;
  if (!row) throw notFound('분석 항목');
  return row;
}

// ───────────────────────── 요청 ─────────────────────────

export interface CreateRequestInput {
  title: string;
  customerName: string;
  originalText: string;
  createdAt?: string; // 시드용
}

export function createRequest(db: Db, input: CreateRequestInput): RequestDetail {
  const title = String(input.title ?? '').trim();
  const customerName = String(input.customerName ?? '').trim();
  const originalText = normalizeNewlines(String(input.originalText ?? ''));
  const fieldErrors: Record<string, string> = {};
  const e1 = checkTitle(title);
  if (e1) fieldErrors.title = e1;
  const e2 = checkCustomer(customerName);
  if (e2) fieldErrors.customerName = e2;
  const e3 = checkOriginal(originalText);
  if (e3) fieldErrors.originalText = e3;
  if (Object.keys(fieldErrors).length) throw new AppError(422, 'validation', '입력한 내용을 확인해 주세요.', fieldErrors);

  const rid = id();
  const ts = input.createdAt ?? now();
  write(db, () => {
    db.prepare(
      `INSERT INTO requests (id, title, customer_name, original_text, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(rid, title, customerName, originalText, ts, ts);
    db.prepare('INSERT INTO request_originals (request_id, rev, text, saved_at) VALUES (?, 1, ?, ?)').run(
      rid,
      originalText,
      ts,
    );
  });
  return getRequestDetail(db, rid);
}

export function listRequests(db: Db, q: string, status: string): RequestListResponse {
  const like = `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
  const where = q ? "WHERE (title LIKE ? ESCAPE '\\' OR customer_name LIKE ? ESCAPE '\\')" : '';
  const params = q ? [like, like] : [];
  const rows = db
    .prepare(`SELECT * FROM v_request_list ${where} ORDER BY created_at DESC, id DESC`)
    .all(...params) as Row[];
  const counts = { all: rows.length, received: 0, reviewing: 0, confirmed: 0 };
  for (const r of rows) counts[r.status as RequestStatus]++;
  const filtered = status && status !== 'all' ? rows.filter((r) => r.status === status) : rows;
  const total = (db.prepare('SELECT count(*) AS n FROM requests').get() as Row).n as number;
  return {
    items: filtered.map((r) => ({
      id: r.id,
      title: r.title,
      customerName: r.customer_name,
      preview: String(r.original_text).replace(/\s+/g, ' ').slice(0, 160),
      status: r.status,
      createdAt: r.created_at,
      unreviewedCount: r.unreviewed_count,
    })),
    counts,
    total,
  };
}

function mapItem(row: Row, originalText: string, task: Row | undefined): AnalysisItem {
  return {
    id: row.id,
    requestId: row.request_id,
    kind: row.kind,
    position: row.position,
    content: row.content,
    quote: row.quote,
    quoteValid: row.quote == null || originalText.includes(row.quote),
    note: row.note,
    origin: row.origin,
    humanEdited: row.human_edited === 1,
    reviewState: row.review_state,
    resolution: row.resolution,
    resolutionText: row.resolution_text,
    derivedFromItemId: row.derived_from_item_id,
    derivedBasis: row.derived_basis,
    version: row.version,
    task: task ? { id: task.id, status: task.status, sourceChanged: taskChange(task).length > 0 } : null,
  };
}

// 작업 + 확정 당시 스냅숏 + 원 항목 현재 상태를 한 번에 읽는 공통 쿼리
const TASK_SELECT = `
  SELECT t.*, ci.content AS snap_content, ci.quote AS snap_quote, c.original_rev AS snap_original_rev,
         c.request_id AS request_id, r.title AS request_title, r.customer_name AS customer_name,
         r.original_rev AS cur_original_rev, i.content AS cur_content, i.quote AS cur_quote,
         i.deleted_at AS cur_deleted,
         (SELECT count(*) FROM task_criteria k WHERE k.task_id = t.id) AS criteria_total,
         (SELECT count(*) FROM task_criteria k WHERE k.task_id = t.id AND k.done = 1) AS criteria_done
  FROM tasks t
  JOIN confirmation_items ci ON ci.id = t.confirmation_item_id
  JOIN confirmations c ON c.id = ci.confirmation_id
  JOIN requests r ON r.id = c.request_id
  JOIN analysis_items i ON i.id = t.source_item_id`;

/** 원본이 바뀐 이유 목록. 비어 있으면 변경 없음. 저장하지 않고 매번 계산한다. */
function taskChange(t: Row): string[] {
  const reasons: string[] = [];
  if (t.cur_original_rev !== t.snap_original_rev) reasons.push('고객 요청 원문이 바뀌었어요.');
  if (t.cur_deleted) reasons.push('연결된 요구사항이 삭제됐어요.');
  else if (t.cur_content !== t.snap_content || (t.cur_quote ?? null) !== (t.snap_quote ?? null)) {
    reasons.push('연결된 요구사항 내용이 바뀌었어요.');
  }
  return reasons;
}

function mapTaskRow(t: Row): TaskRow {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    version: t.version,
    requestId: t.request_id,
    requestTitle: t.request_title,
    customerName: t.customer_name,
    criteriaDone: t.criteria_done,
    criteriaTotal: t.criteria_total,
    sourceChanged: taskChange(t).length > 0,
    createdAt: t.created_at,
  };
}

export function getRequestDetail(db: Db, requestId: string): RequestDetail {
  const req = getRequestRow(db, requestId);
  const statusRow = db.prepare('SELECT status FROM v_request_list WHERE id = ?').get(requestId) as Row;
  const taskRows = db.prepare(`${TASK_SELECT} WHERE c.request_id = ? ORDER BY t.created_at, t.rowid`).all(requestId) as Row[];
  const taskBySource = new Map(taskRows.map((t) => [t.source_item_id as string, t]));
  const itemRows = db
    .prepare(
      `SELECT * FROM analysis_items WHERE request_id = ? AND deleted_at IS NULL
       ORDER BY CASE kind WHEN 'requirement' THEN 0 WHEN 'question' THEN 1 ELSE 2 END, position`,
    )
    .all(requestId) as Row[];
  const confRows = db
    .prepare('SELECT * FROM confirmations WHERE request_id = ? ORDER BY analysis_rev DESC')
    .all(requestId) as Row[];
  const confirmations: Confirmation[] = confRows.map((c) => ({
    id: c.id,
    analysisRev: c.analysis_rev,
    originalRev: c.original_rev,
    includedCount: c.included_count,
    excludedQuestions: c.excluded_questions,
    excludedUndecided: c.excluded_undecided,
    confirmedAt: c.confirmed_at,
    items: (
      db.prepare('SELECT * FROM confirmation_items WHERE confirmation_id = ? ORDER BY rowid').all(c.id) as Row[]
    ).map((ci) => ({
      id: ci.id,
      sourceItemId: ci.source_item_id,
      kind: ci.kind,
      content: ci.content,
      quote: ci.quote,
      resolution: ci.resolution,
      resolutionText: ci.resolution_text,
    })),
  }));
  return {
    request: {
      id: req.id,
      title: req.title,
      customerName: req.customer_name,
      originalText: req.original_text,
      originalRev: req.original_rev,
      analysisRev: req.analysis_rev,
      phase: req.phase,
      status: statusRow.status,
      version: req.version,
      contentSeq: req.content_seq,
      createdAt: req.created_at,
      updatedAt: req.updated_at,
    },
    items: itemRows.map((r) => mapItem(r, req.original_text, taskBySource.get(r.id))),
    confirmations,
    tasks: taskRows.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      sourceChanged: taskChange(t).length > 0,
    })),
  };
}

export interface UpdateRequestInput {
  version: number;
  title?: string;
  customerName?: string;
  originalText?: string;
}

/** 요청 정보 수정. 원문이 바뀌면 새 개정판을 만들고, 확정 상태였다면 새 검토 버전으로 전환한다. */
export function updateRequest(db: Db, requestId: string, input: UpdateRequestInput): RequestDetail {
  const fieldErrors: Record<string, string> = {};
  const next: { title?: string; customerName?: string; originalText?: string } = {};
  if (input.title !== undefined) {
    next.title = String(input.title).trim();
    const e = checkTitle(next.title);
    if (e) fieldErrors.title = e;
  }
  if (input.customerName !== undefined) {
    next.customerName = String(input.customerName).trim();
    const e = checkCustomer(next.customerName);
    if (e) fieldErrors.customerName = e;
  }
  if (input.originalText !== undefined) {
    next.originalText = normalizeNewlines(String(input.originalText));
    const e = checkOriginal(next.originalText);
    if (e) fieldErrors.originalText = e;
  }
  if (Object.keys(fieldErrors).length) throw new AppError(422, 'validation', '입력한 내용을 확인해 주세요.', fieldErrors);

  write(db, () => {
    const req = getRequestRow(db, requestId);
    if (req.version !== input.version) throw conflict();
    const title = next.title ?? req.title;
    const customer = next.customerName ?? req.customer_name;
    const textChanged = next.originalText !== undefined && next.originalText !== req.original_text;
    const text = textChanged ? (next.originalText as string) : req.original_text;
    const ts = now();
    let originalRev = req.original_rev;
    let analysisRev = req.analysis_rev;
    let phase = req.phase;
    let contentSeq = req.content_seq;
    if (textChanged) {
      originalRev += 1;
      contentSeq += 1;
      db.prepare('INSERT INTO request_originals (request_id, rev, text, saved_at) VALUES (?, ?, ?, ?)').run(
        requestId,
        originalRev,
        text,
        ts,
      );
      if (phase === 'confirmed') {
        // 확정 후 원문 변경 → 새 검토 버전. 기존 확정 기록과 작업은 그대로 둔다.
        phase = 'reviewing';
        analysisRev += 1;
      }
    }
    db.prepare(
      `UPDATE requests SET title = ?, customer_name = ?, original_text = ?, original_rev = ?, analysis_rev = ?,
         phase = ?, content_seq = ?, version = version + 1, updated_at = ? WHERE id = ?`,
    ).run(title, customer, text, originalRev, analysisRev, phase, contentSeq, ts, requestId);
  });
  return getRequestDetail(db, requestId);
}

/** 다시 검토하기: 확정 상태에서 새 검토 버전을 시작한다. 이전 확정 기록과 작업은 보존된다. */
export function reopenRequest(db: Db, requestId: string): RequestDetail {
  write(db, () => {
    const req = getRequestRow(db, requestId);
    if (req.phase !== 'confirmed') throw new AppError(409, 'not_confirmed', '확정된 요청만 다시 검토할 수 있어요.');
    db.prepare(
      `UPDATE requests SET phase = 'reviewing', analysis_rev = analysis_rev + 1, content_seq = content_seq + 1,
         version = version + 1, updated_at = ? WHERE id = ?`,
    ).run(now(), requestId);
  });
  return getRequestDetail(db, requestId);
}

// ───────────────────────── 분석 항목 ─────────────────────────

export interface InsertItemInput {
  requestId: string;
  kind: ItemKind;
  content: string;
  quote?: string | null;
  note?: string | null;
  origin: ItemOrigin;
  reviewState?: 'unreviewed' | 'reviewed';
  derivedFromItemId?: string | null;
  derivedBasis?: string | null;
}

/** 검증 없이 항목을 넣는 내부 함수(시드·모의 분석 제공자용). API 는 addItem 을 쓴다. */
export function insertItem(db: Db, input: InsertItemInput): string {
  const iid = id();
  const ts = now();
  const pos =
    ((db
      .prepare('SELECT coalesce(max(position), 0) AS p FROM analysis_items WHERE request_id = ? AND kind = ?')
      .get(input.requestId, input.kind) as Row).p as number) + 1;
  db.prepare(
    `INSERT INTO analysis_items (id, request_id, kind, position, content, quote, note, origin, review_state,
       resolution, derived_from_item_id, derived_basis, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    iid,
    input.requestId,
    input.kind,
    pos,
    input.content.trim(),
    input.quote ?? null,
    input.note ?? null,
    input.origin,
    input.reviewState ?? 'unreviewed',
    input.kind === 'requirement' ? null : 'open',
    input.derivedFromItemId ?? null,
    input.derivedBasis ?? null,
    ts,
    ts,
  );
  return iid;
}

const KINDS: ItemKind[] = ['requirement', 'question', 'undecided'];

function normalizeQuote(q: unknown): string | null {
  if (q === undefined || q === null) return null;
  const s = normalizeNewlines(String(q)).trim();
  return s === '' ? null : s;
}

function assertReviewing(req: Row) {
  if (req.phase === 'confirmed') {
    throw new AppError(409, 'locked_confirmed', '확정된 요청이에요. 먼저 ‘다시 검토하기’로 새 검토 버전을 시작해 주세요.');
  }
}

/** 담당자가 직접 항목을 추가한다. 직접 추가한 항목은 검토 완료로 본다. */
export function addItem(
  db: Db,
  requestId: string,
  input: { kind: ItemKind; content: string; quote?: string | null; note?: string | null },
): AnalysisItem {
  if (!KINDS.includes(input.kind)) throw new AppError(422, 'validation', '항목 종류가 올바르지 않아요.');
  const content = String(input.content ?? '').trim();
  const err = checkItemContent(content);
  if (err) throw new AppError(422, 'validation', err, { content: err });
  const quote = input.kind === 'requirement' ? normalizeQuote(input.quote) : null;
  const iid = write(db, () => {
    const req = getRequestRow(db, requestId);
    assertReviewing(req);
    if (quote && !req.original_text.includes(quote)) {
      throw new AppError(422, 'quote_not_in_original', '근거 문장이 원문에 그대로 있어야 해요.', {
        quote: '근거 문장이 원문에 그대로 있어야 해요.',
      });
    }
    return insertItem(db, {
      requestId,
      kind: input.kind,
      content,
      quote,
      note: input.note ? String(input.note).trim() || null : null,
      origin: 'manual',
      reviewState: 'reviewed',
    });
  });
  return getItem(db, iid);
}

export function getItem(db: Db, itemId: string): AnalysisItem {
  const row = getItemRow(db, itemId);
  const req = getRequestRow(db, row.request_id);
  const task = db.prepare(`${TASK_SELECT} WHERE t.source_item_id = ?`).get(itemId) as Row | undefined;
  return mapItem(row, req.original_text, task);
}

function lockItem(db: Db, itemId: string, version: number): { item: Row; req: Row } {
  const item = getItemRow(db, itemId);
  const req = getRequestRow(db, item.request_id);
  assertReviewing(req);
  if (item.version !== version) throw conflict();
  return { item, req };
}

/** 항목 내용 수정. 내용이 실제로 바뀌면 사람이 고친 항목이 되고 다시 검토가 필요해진다. */
export function updateItem(
  db: Db,
  itemId: string,
  input: { version: number; content?: string; quote?: string | null; note?: string | null },
): AnalysisItem {
  write(db, () => {
    const { item, req } = lockItem(db, itemId, input.version);
    const content = input.content !== undefined ? String(input.content).trim() : item.content;
    const err = checkItemContent(content);
    if (err) throw new AppError(422, 'validation', err, { content: err });
    const quote = input.quote !== undefined ? (item.kind === 'requirement' ? normalizeQuote(input.quote) : null) : item.quote;
    const note = input.note !== undefined ? (input.note ? String(input.note).trim() || null : null) : item.note;
    if (item.kind === 'requirement' && item.origin !== 'manual' && !quote) {
      throw new AppError(422, 'quote_required', 'AI·모의 제안 요구사항은 원문 근거를 지울 수 없어요.', {
        quote: '원문 근거가 필요해요.',
      });
    }
    if (quote && quote !== item.quote && !req.original_text.includes(quote)) {
      throw new AppError(422, 'quote_not_in_original', '근거 문장이 원문에 그대로 있어야 해요.', {
        quote: '근거 문장이 원문에 그대로 있어야 해요.',
      });
    }
    const changed = content !== item.content || (quote ?? null) !== (item.quote ?? null) || (note ?? null) !== (item.note ?? null);
    if (!changed) return;
    db.prepare(
      `UPDATE analysis_items SET content = ?, quote = ?, note = ?, human_edited = 1, review_state = 'unreviewed',
         version = version + 1, updated_at = ? WHERE id = ?`,
    ).run(content, quote, note, now(), itemId);
  });
  return getItem(db, itemId);
}

export function reviewItem(db: Db, itemId: string, version: number): AnalysisItem {
  write(db, () => {
    const { item } = lockItem(db, itemId, version);
    if (item.review_state === 'reviewed') return;
    db.prepare(`UPDATE analysis_items SET review_state = 'reviewed', version = version + 1, updated_at = ? WHERE id = ?`).run(
      now(),
      itemId,
    );
  });
  return getItem(db, itemId);
}

export function deleteItem(db: Db, itemId: string, version: number): void {
  write(db, () => {
    const { item } = lockItem(db, itemId, version);
    if (item.deleted_at) return;
    db.prepare('UPDATE analysis_items SET deleted_at = ?, version = version + 1, updated_at = ? WHERE id = ?').run(
      now(),
      now(),
      itemId,
    );
  });
}

export function restoreItem(db: Db, itemId: string): AnalysisItem {
  write(db, () => {
    const item = getItemRow(db, itemId);
    assertReviewing(getRequestRow(db, item.request_id));
    if (!item.deleted_at) return;
    db.prepare('UPDATE analysis_items SET deleted_at = NULL, version = version + 1, updated_at = ? WHERE id = ?').run(
      now(),
      itemId,
    );
  });
  return getItem(db, itemId);
}

/**
 * 질문 답변 / 미확정 사항 결정 기록. 검토 여부(review_state)와는 별개이며 바꾸지 않는다.
 * 'open' 으로 되돌리면 답변·결정 내용을 지운다.
 */
export function resolveItem(
  db: Db,
  itemId: string,
  input: { version: number; resolution: 'open' | 'answered' | 'decided'; text?: string },
): AnalysisItem {
  write(db, () => {
    const { item } = lockItem(db, itemId, input.version);
    if (item.kind === 'requirement') throw new AppError(422, 'validation', '요구사항에는 답변·결정을 기록할 수 없어요.');
    const allowed = item.kind === 'question' ? ['open', 'answered'] : ['open', 'decided'];
    if (!allowed.includes(input.resolution)) {
      throw new AppError(422, 'validation', '이 항목에는 사용할 수 없는 상태예요.');
    }
    if (input.resolution === 'open') {
      db.prepare(
        `UPDATE analysis_items SET resolution = 'open', resolution_text = NULL, resolved_at = NULL,
           version = version + 1, updated_at = ? WHERE id = ?`,
      ).run(now(), itemId);
      return;
    }
    const label = item.kind === 'question' ? '고객 답변' : '결정 내용';
    const text = String(input.text ?? '').trim();
    const err = checkNote(text, label);
    if (err) throw new AppError(422, 'validation', err, { text: err });
    db.prepare(
      `UPDATE analysis_items SET resolution = ?, resolution_text = ?, resolved_at = ?,
         version = version + 1, updated_at = ? WHERE id = ?`,
    ).run(input.resolution, text, now(), now(), itemId);
  });
  return getItem(db, itemId);
}

/** 답변·결정을 받은 항목을 사람이 명시적으로 요구사항으로 전환한다. 근거(basis)가 필수. */
export function convertToRequirement(
  db: Db,
  itemId: string,
  input: { version: number; content: string; basis: string; quote?: string | null },
): AnalysisItem {
  const content = String(input.content ?? '').trim();
  const basis = String(input.basis ?? '').trim();
  const fieldErrors: Record<string, string> = {};
  const e1 = checkItemContent(content);
  if (e1) fieldErrors.content = e1;
  const e2 = checkNote(basis, '전환 근거');
  if (e2) fieldErrors.basis = e2;
  if (Object.keys(fieldErrors).length) throw new AppError(422, 'validation', '입력한 내용을 확인해 주세요.', fieldErrors);
  const quote = normalizeQuote(input.quote);
  const newId = write(db, () => {
    const { item, req } = lockItem(db, itemId, input.version);
    if (item.kind === 'requirement') throw new AppError(422, 'validation', '이미 요구사항이에요.');
    if (item.resolution === 'open') {
      throw new AppError(409, 'source_unresolved', '답변 또는 결정 내용을 먼저 기록해야 요구사항으로 전환할 수 있어요.');
    }
    if (quote && !req.original_text.includes(quote)) {
      throw new AppError(422, 'quote_not_in_original', '근거 문장이 원문에 그대로 있어야 해요.', {
        quote: '근거 문장이 원문에 그대로 있어야 해요.',
      });
    }
    // 사람이 만든 항목이지만 내용을 한 번 더 확인하도록 검토 전 상태로 만든다.
    return insertItem(db, {
      requestId: item.request_id,
      kind: 'requirement',
      content,
      quote,
      origin: 'manual',
      reviewState: 'unreviewed',
      derivedFromItemId: itemId,
      derivedBasis: basis,
    });
  });
  return getItem(db, newId);
}

// ───────────────────────── 확정 ─────────────────────────

export function confirmPreview(db: Db, requestId: string): ConfirmPreview {
  const req = getRequestRow(db, requestId);
  const items = db
    .prepare('SELECT * FROM analysis_items WHERE request_id = ? AND deleted_at IS NULL ORDER BY kind, position')
    .all(requestId) as Row[];
  const reqs = items.filter((i) => i.kind === 'requirement');
  const questions = items.filter((i) => i.kind === 'question');
  const unknowns = items.filter((i) => i.kind === 'undecided');
  const blockers: ConfirmPreview['blockers'] = [];
  if (req.phase === 'confirmed') {
    blockers.push({ code: 'already_confirmed', message: '이미 확정된 요청이에요.' });
  }
  const unreviewed = items.filter((i) => i.review_state === 'unreviewed');
  if (unreviewed.length) {
    blockers.push({
      code: 'unreviewed_items',
      message: `검토 전 항목이 ${unreviewed.length}개 남아 있어요. 모두 검토해야 확정할 수 있어요.`,
      itemIds: unreviewed.map((i) => i.id),
    });
  }
  if (reqs.length === 0) {
    blockers.push({ code: 'no_requirements', message: '확정할 요구사항이 없어요. 요구사항을 추가해 주세요.' });
  }
  const origErr = checkOriginal(req.original_text);
  if (origErr) blockers.push({ code: 'meaningless_original', message: '요청 원문이 의미 있는 내용이 아니라 확정할 수 없어요.' });
  const meaningless = items.filter((i) => checkItemContent(i.content));
  if (meaningless.length) {
    blockers.push({
      code: 'meaningless_content',
      message: '의미를 알 수 없는 항목이 있어요. 내용을 고치거나 삭제해 주세요.',
      itemIds: meaningless.map((i) => i.id),
    });
  }
  const badQuotes = reqs.filter((i) => i.quote != null && !req.original_text.includes(i.quote));
  if (badQuotes.length) {
    blockers.push({
      code: 'quote_mismatch',
      message: '원문에서 근거 문장을 찾을 수 없는 요구사항이 있어요. 근거를 고치거나 삭제해 주세요.',
      itemIds: badQuotes.map((i) => i.id),
    });
  }
  return {
    contentSeq: req.content_seq,
    analysisRev: req.analysis_rev,
    included: reqs.map((i) => ({ id: i.id, content: i.content })),
    excludedQuestions: questions.length,
    excludedUndecided: unknowns.length,
    unresolvedQuestions: questions.filter((i) => i.resolution === 'open').length,
    unresolvedUndecided: unknowns.filter((i) => i.resolution === 'open').length,
    blockers,
  };
}

/** 확정. contentSeq 는 확인창을 연 시점의 내용 버전(사람의 최종 승인 대상)이다. */
export function confirmRequest(db: Db, requestId: string, contentSeq: number): RequestDetail {
  write(db, () => {
    const req = getRequestRow(db, requestId);
    if (req.content_seq !== contentSeq) {
      throw new AppError(409, 'stale_confirmation', '확인창을 연 뒤에 내용이 바뀌었어요. 확정 내용을 다시 확인해 주세요.');
    }
    const preview = confirmPreview(db, requestId);
    if (preview.blockers.length) {
      throw new AppError(422, preview.blockers[0].code, preview.blockers[0].message);
    }
    const cid = id();
    db.prepare(
      `INSERT INTO confirmations (id, request_id, analysis_rev, original_rev, included_count, excluded_questions,
         excluded_undecided, confirmed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      cid,
      requestId,
      req.analysis_rev,
      req.original_rev,
      preview.included.length,
      preview.excludedQuestions,
      preview.excludedUndecided,
      now(),
    );
    const active = db
      .prepare(
        `SELECT * FROM analysis_items WHERE request_id = ? AND deleted_at IS NULL
         ORDER BY CASE kind WHEN 'requirement' THEN 0 WHEN 'question' THEN 1 ELSE 2 END, position`,
      )
      .all(requestId) as Row[];
    const ins = db.prepare(
      `INSERT INTO confirmation_items (id, confirmation_id, source_item_id, kind, content, quote, resolution, resolution_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const i of active) ins.run(id(), cid, i.id, i.kind, i.content, i.quote, i.resolution, i.resolution_text);
    db.prepare(`UPDATE requests SET phase = 'confirmed', version = version + 1, updated_at = ? WHERE id = ?`).run(
      now(),
      requestId,
    );
  });
  return getRequestDetail(db, requestId);
}

// ───────────────────────── 작업 ─────────────────────────

function getTaskRow(db: Db, taskId: string): Row {
  const row = db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(taskId) as Row | undefined;
  if (!row) throw notFound('작업');
  return row;
}

/**
 * 확정된 요구사항으로 작업을 만든다. 같은 요구사항으로 다시 요청하면 새로 만들지 않고 기존 작업을 돌려준다.
 * (서버 로직 + tasks.confirmation_item_id / source_item_id UNIQUE 로 이중 방지)
 */
export function createTasks(db: Db, requestId: string, input: CreateTasksInput): CreateTasksResult {
  if (!input || !Array.isArray(input.tasks) || input.tasks.length === 0) {
    throw new AppError(422, 'validation', '작업으로 만들 요구사항을 하나 이상 선택해 주세요.');
  }
  // 입력 검증(모두 통과해야 하나도 만들지 않고 실패한다)
  const errors: Record<string, string> = {};
  const seen = new Set<string>();
  input.tasks.forEach((t, idx) => {
    if (seen.has(t.confirmationItemId)) errors[`tasks.${idx}`] = '같은 요구사항이 두 번 들어 있어요.';
    seen.add(t.confirmationItemId);
    if (!String(t.title ?? '').trim()) errors[`tasks.${idx}.title`] = '작업 제목을 입력해 주세요.';
    const criteria = (t.criteria ?? []).map((c) => String(c).trim()).filter(Boolean);
    if (criteria.length === 0) errors[`tasks.${idx}.criteria`] = '완료 조건을 한 줄 이상 적어 주세요.';
    for (const c of criteria) {
      const e = checkCriterion(c);
      if (e) {
        errors[`tasks.${idx}.criteria`] = e;
        break;
      }
    }
  });
  if (Object.keys(errors).length) throw new AppError(422, 'validation', '작업 내용을 확인해 주세요.', errors);

  const createdIds: string[] = [];
  const existingIds: string[] = [];
  write(db, () => {
    const req = getRequestRow(db, requestId);
    if (req.phase !== 'confirmed') {
      throw new AppError(409, 'not_confirmed', '요구사항을 확정한 뒤에 작업을 만들 수 있어요.');
    }
    const latest = db
      .prepare('SELECT id FROM confirmations WHERE request_id = ? AND analysis_rev = ?')
      .get(requestId, req.analysis_rev) as Row | undefined;
    if (!latest) throw new AppError(409, 'not_confirmed', '현재 검토 버전의 확정 기록이 없어요.');
    for (const t of input.tasks) {
      const ci = db
        .prepare('SELECT * FROM confirmation_items WHERE id = ? AND confirmation_id = ?')
        .get(t.confirmationItemId, latest.id) as Row | undefined;
      if (!ci) throw new AppError(422, 'not_in_confirmation', '현재 확정 버전의 요구사항이 아니에요.');
      if (ci.kind !== 'requirement') {
        throw new AppError(422, 'task_requires_requirement', '질문과 미확정 사항은 작업으로 만들 수 없어요.');
      }
      const dup = db.prepare('SELECT id FROM tasks WHERE source_item_id = ?').get(ci.source_item_id) as Row | undefined;
      if (dup) {
        existingIds.push(dup.id);
        continue;
      }
      const tid = id();
      const ts = now();
      const description =
        String(t.description ?? '').trim() ||
        `요청 ‘${req.title}’에서 확정한 요구사항 ‘${ci.content}’을 구현해요.`;
      db.prepare(
        `INSERT INTO tasks (id, confirmation_item_id, source_item_id, title, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(tid, ci.id, ci.source_item_id, String(t.title).trim(), description, ts, ts);
      const insC = db.prepare('INSERT INTO task_criteria (id, task_id, position, text) VALUES (?, ?, ?, ?)');
      (t.criteria ?? [])
        .map((c) => String(c).trim())
        .filter(Boolean)
        .forEach((c, i) => insC.run(id(), tid, i + 1, c));
      createdIds.push(tid);
    }
  });
  return {
    created: createdIds.map((tid) => mapTaskRow(getTaskRow(db, tid))),
    existing: existingIds.map((tid) => mapTaskRow(getTaskRow(db, tid))),
  };
}

export function listTasks(db: Db, status: string): TaskListResponse {
  const rows = db.prepare(`${TASK_SELECT} ORDER BY t.created_at DESC, t.rowid DESC`).all() as Row[];
  const counts = { all: rows.length, todo: 0, doing: 0, done: 0 };
  for (const r of rows) counts[r.status as TaskStatus]++;
  const filtered = status && status !== 'all' ? rows.filter((r) => r.status === status) : rows;
  return { items: filtered.map(mapTaskRow), counts };
}

export function getTaskDetail(db: Db, taskId: string): TaskDetail {
  const t = getTaskRow(db, taskId);
  const criteria = db.prepare('SELECT * FROM task_criteria WHERE task_id = ? ORDER BY position').all(taskId) as Row[];
  return {
    ...mapTaskRow(t),
    description: t.description,
    requirementText: t.snap_content,
    requirementQuote: t.snap_quote,
    criteria: criteria.map((c) => ({ id: c.id, text: c.text, done: c.done === 1, position: c.position })),
    changeReasons: taskChange(t),
  };
}

export function updateTask(
  db: Db,
  taskId: string,
  input: { version: number; title?: string; description?: string; status?: TaskStatus },
): TaskDetail {
  write(db, () => {
    const t = getTaskRow(db, taskId);
    if (t.version !== input.version) throw conflict();
    const title = input.title !== undefined ? String(input.title).trim() : t.title;
    if (!title) throw new AppError(422, 'validation', '작업 제목을 입력해 주세요.', { title: '작업 제목을 입력해 주세요.' });
    const status = input.status ?? t.status;
    if (!['todo', 'doing', 'done'].includes(status)) throw new AppError(422, 'validation', '작업 상태가 올바르지 않아요.');
    const description = input.description !== undefined ? String(input.description) : t.description;
    db.prepare(
      'UPDATE tasks SET title = ?, description = ?, status = ?, version = version + 1, updated_at = ? WHERE id = ?',
    ).run(title, description, status, now(), taskId);
  });
  return getTaskDetail(db, taskId);
}

export function addCriterion(db: Db, taskId: string, text: string): TaskDetail {
  const t = String(text ?? '').trim();
  const err = checkCriterion(t);
  if (err) throw new AppError(422, 'validation', err, { text: err });
  write(db, () => {
    getTaskRow(db, taskId);
    const pos =
      ((db.prepare('SELECT coalesce(max(position), 0) AS p FROM task_criteria WHERE task_id = ?').get(taskId) as Row).p as number) + 1;
    db.prepare('INSERT INTO task_criteria (id, task_id, position, text) VALUES (?, ?, ?, ?)').run(id(), taskId, pos, t);
  });
  return getTaskDetail(db, taskId);
}

export function updateCriterion(db: Db, criterionId: string, input: { done?: boolean; text?: string }): TaskDetail {
  let taskId = '';
  write(db, () => {
    const c = db.prepare('SELECT * FROM task_criteria WHERE id = ?').get(criterionId) as Row | undefined;
    if (!c) throw notFound('완료 조건');
    taskId = c.task_id;
    let text = c.text as string;
    if (input.text !== undefined) {
      text = String(input.text).trim();
      const err = checkCriterion(text);
      if (err) throw new AppError(422, 'validation', err, { text: err });
    }
    const done = input.done !== undefined ? (input.done ? 1 : 0) : c.done;
    db.prepare('UPDATE task_criteria SET text = ?, done = ? WHERE id = ?').run(text, done, criterionId);
  });
  return getTaskDetail(db, taskId);
}

export function deleteCriterion(db: Db, criterionId: string): TaskDetail {
  let taskId = '';
  write(db, () => {
    const c = db.prepare('SELECT * FROM task_criteria WHERE id = ?').get(criterionId) as Row | undefined;
    if (!c) throw notFound('완료 조건');
    taskId = c.task_id;
    db.prepare('DELETE FROM task_criteria WHERE id = ?').run(criterionId);
  });
  return getTaskDetail(db, taskId);
}

export function summary(db: Db): { requests: number; tasks: number } {
  return {
    requests: (db.prepare('SELECT count(*) AS n FROM requests').get() as Row).n,
    tasks: (db.prepare('SELECT count(*) AS n FROM tasks').get() as Row).n,
  };
}
