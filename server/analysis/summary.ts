import type { AnalysisRunSummary } from '../../shared/types.ts';

type Row = Record<string, any>;

export function runFromRow(r: Row): AnalysisRunSummary {
  return {
    id: r.id,
    status: r.status,
    provider: r.provider,
    reanalysis: r.reanalysis === 1,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    itemCount: r.item_count,
    skippedCount: r.skipped_count,
    errorCode: r.error_code,
    errorMessage: r.error_message,
    model: r.model ?? null,
    inputTokens: r.input_tokens ?? null,
    outputTokens: r.output_tokens ?? null,
  };
}
