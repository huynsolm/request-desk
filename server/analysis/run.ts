import { randomUUID } from 'node:crypto';
import type { Db } from '../db/open.ts';
import { tx } from '../db/open.ts';
import { AppError } from '../errors.ts';
import { insertItem } from '../service.ts';
import { checkItemContent, MAX, normalizeNewlines } from '../../shared/validation.ts';
import type { AnalysisRunSummary } from '../../shared/types.ts';
import { runFromRow } from './summary.ts';
import { AnalysisResultSchema, type AnalysisProvider } from './types.ts';

type Row = Record<string, any>;
const now = () => new Date().toISOString();

/** 서버가 다시 시작되면 진행 중이던 분석은 끝나지 않는다. 계속 "분석 중"으로 남아 재시도를 막지 않도록 실패로 닫는다. */
export function failStaleRuns(db: Db): number {
  const res = db
    .prepare(
      `UPDATE analysis_runs SET status = 'failed', error_code = 'interrupted',
         error_message = '서버가 다시 시작되어 분석이 중단됐어요. 다시 시도해 주세요.', finished_at = ?
       WHERE status = 'running'`,
    )
    .run(now());
  return Number(res.changes);
}

function markFailed(db: Db, runId: string, code: string, message: string) {
  db.prepare(
    `UPDATE analysis_runs SET status = 'failed', error_code = ?, error_message = ?, finished_at = ?
     WHERE id = ? AND status = 'running'`,
  ).run(code, message, now(), runId);
}

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/**
 * 제공자의 응답(구조 검증을 통과한 값)을 항목으로 반영한다. 한 트랜잭션에서 항목 추가와 실행 기록 갱신을 함께 한다.
 * - 기존 항목은 절대 수정·삭제하지 않는다(사람의 편집을 덮어쓰지 않는다). 새 제안만 "검토 전"으로 추가한다.
 * - 이미 있는 항목과 같은 제안은 건너뛴다(재분석 시 중복 방지).
 * - 요구사항은 원문에 실제로 있는 인용문이 있어야 한다(없으면 제외). 의미 없는 내용도 제외한다.
 */
function applyResult(db: Db, provider: AnalysisProvider, runId: string, result: ReturnType<typeof AnalysisResultSchema.parse>) {
  tx(db, () => {
    const run = db.prepare('SELECT * FROM analysis_runs WHERE id = ?').get(runId) as Row;
    if (run.status !== 'running') return;
    const req = db.prepare('SELECT * FROM requests WHERE id = ?').get(run.request_id) as Row;
    if (req.phase === 'confirmed') {
      return markFailed(db, runId, 'locked_confirmed', '분석하는 사이에 요구사항이 확정되어 결과를 반영하지 않았어요.');
    }
    if (req.original_rev !== run.original_rev) {
      return markFailed(db, runId, 'original_changed', '분석하는 사이에 원문이 바뀌어 결과를 반영하지 않았어요. 다시 분석해 주세요.');
    }
    const original = normalizeNewlines(req.original_text as string);
    const seen = new Set<string>();
    for (const e of db
      // 삭제한 항목도 포함한다: 사용자가 지운(거절한) 제안을 재분석이 다시 살려내지 않도록.
      .prepare('SELECT kind, content, quote FROM analysis_items WHERE request_id = ?')
      .all(run.request_id) as Row[]) {
      seen.add(`${e.kind}|${norm(e.content)}`);
      if (e.quote) seen.add(`quote|${norm(e.quote)}`);
    }
    let inserted = 0;
    let skipped = 0;
    const add = (kind: 'requirement' | 'question' | 'undecided', content: string, quote: string | null, note: string | null) => {
      const key = `${kind}|${norm(content)}`;
      if (seen.has(key) || (quote && seen.has(`quote|${norm(quote)}`))) return; // 이미 있는 제안
      seen.add(key);
      if (quote) seen.add(`quote|${norm(quote)}`);
      insertItem(db, { requestId: run.request_id, kind, content, quote, note, origin: provider.id, reviewState: 'unreviewed' });
      inserted += 1;
    };
    const okNote = (n: string | undefined) => {
      const t = (n ?? '').trim();
      return t.length <= MAX.note ? (t || null) : undefined; // 너무 길면 undefined → 제외
    };
    for (const r of result.requirements) {
      const content = r.content.trim();
      const quote = normalizeNewlines(r.quote).trim();
      if (checkItemContent(content) || !quote || !original.includes(quote)) {
        skipped += 1; // 의미 없는 내용이거나 원문에 없는 근거 → 제외
        continue;
      }
      add('requirement', content, quote, null);
    }
    for (const [kind, list] of [
      ['question', result.questions],
      ['undecided', result.undecided],
    ] as const) {
      for (const q of list) {
        const content = q.content.trim();
        const note = okNote(q.note);
        if (checkItemContent(content) || note === undefined) {
          skipped += 1;
          continue;
        }
        add(kind, content, null, note);
      }
    }
    if (inserted === 0 && !run.reanalysis) {
      return markFailed(
        db,
        runId,
        skipped > 0 ? 'invalid_response' : 'empty_result',
        skipped > 0 ? '분석 결과가 올바르지 않아 반영하지 않았어요.' : '분석 결과가 비어 있어요.',
      );
    }
    db.prepare(
      `UPDATE analysis_runs SET status = 'succeeded', item_count = ?, skipped_count = ?, finished_at = ?
       WHERE id = ? AND status = 'running'`,
    ).run(inserted, skipped, now(), runId);
  });
}

function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('aborted'));
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

async function execute(
  db: Db,
  provider: AnalysisProvider,
  runId: string,
  input: { title: string; customerName: string; originalText: string },
  timeoutMs: number,
): Promise<void> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    let raw: unknown;
    try {
      raw = await raceAbort(provider.analyze(input, { signal: ac.signal }), ac.signal);
    } catch {
      if (ac.signal.aborted) {
        return markFailed(db, runId, 'timeout', '분석 시간이 너무 오래 걸려 중단했어요. 다시 시도해 주세요.');
      }
      return markFailed(db, runId, 'provider_error', '분석을 하지 못했어요. 잠시 후 다시 시도해 주세요.'); // 제공자의 내부 오류 내용은 노출하지 않는다
    }
    const parsed = AnalysisResultSchema.safeParse(raw);
    if (!parsed.success) {
      return markFailed(db, runId, 'invalid_response', '분석 결과가 올바르지 않아 반영하지 않았어요.');
    }
    applyResult(db, provider, runId, parsed.data);
  } catch {
    try {
      markFailed(db, runId, 'internal', '분석 결과를 저장하지 못했어요. 다시 시도해 주세요.');
    } catch {
      /* 이미 끝난 실행 */
    }
  } finally {
    clearTimeout(timer);
  }
}

export interface StartOptions {
  confirmReanalysis?: boolean;
  timeoutMs: number;
}

/**
 * 분석을 시작한다. 실행 기록(running)을 만들고 곧바로 돌려주며, 실제 분석은 백그라운드에서 진행된다(done).
 * 서버 규칙: 확정된 요청은 분석할 수 없고, 이미 진행 중이면 거부하며, 이미 분석 항목이 있으면 사용자의 확인(confirmReanalysis)이 필요하다.
 */
export function startAnalysis(
  db: Db,
  provider: AnalysisProvider,
  requestId: string,
  opts: StartOptions,
): { run: AnalysisRunSummary; done: Promise<void> } {
  const started = tx(db, () => {
    const req = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId) as Row | undefined;
    if (!req) throw new AppError(404, 'not_found', '요청을 찾을 수 없어요.');
    if (req.phase === 'confirmed') {
      throw new AppError(409, 'locked_confirmed', '확정된 요청이에요. 먼저 ‘다시 검토하기’로 새 검토 버전을 시작해 주세요.');
    }
    const existing = (db
      .prepare('SELECT count(*) AS n FROM analysis_items WHERE request_id = ? AND deleted_at IS NULL')
      .get(requestId) as Row).n as number;
    if (existing > 0 && !opts.confirmReanalysis) {
      throw new AppError(
        409,
        'reanalysis_confirmation_required',
        `이미 분석 항목이 ${existing}개 있어요. 다시 분석하면 기존 항목은 그대로 두고 새 제안만 ‘검토 전’으로 추가해요.`,
      );
    }
    const id = randomUUID();
    try {
      db.prepare(
        `INSERT INTO analysis_runs (id, request_id, provider, status, original_rev, reanalysis, started_at)
         VALUES (?, ?, ?, 'running', ?, ?, ?)`,
      ).run(id, requestId, provider.id, req.original_rev, existing > 0 ? 1 : 0, now());
    } catch (e) {
      if (e instanceof Error && e.message.includes('UNIQUE constraint failed: analysis_runs.request_id')) {
        throw new AppError(409, 'analysis_running', '이미 분석이 진행 중이에요.');
      }
      throw e;
    }
    return { id, input: { title: req.title as string, customerName: req.customer_name as string, originalText: req.original_text as string } };
  });
  const run = runFromRow(db.prepare('SELECT * FROM analysis_runs WHERE id = ?').get(started.id) as Row);
  return { run, done: execute(db, provider, started.id, started.input, opts.timeoutMs) };
}
