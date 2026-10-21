import type { Db } from '../db/open.ts';
import type { UsageInfo } from '../../shared/types.ts';
import type { AnalysisProvider } from './types.ts';

/**
 * 이 제공자의 호출 횟수(하루=서버 PC의 현지 날짜, 한 달=현지 달력 기준)를 분석 기록으로 센다.
 * 실패한 호출도 비용이 들 수 있으므로 상태와 상관없이 센다. 상한이 없는 제공자(모의)는 null.
 */
export function usageOf(db: Db, provider: AnalysisProvider, at: Date = new Date()): UsageInfo | null {
  if (!provider.limits) return null;
  const dayStart = new Date(at.getFullYear(), at.getMonth(), at.getDate()).toISOString();
  const monthStart = new Date(at.getFullYear(), at.getMonth(), 1).toISOString();
  const count = (since: string) =>
    (db.prepare('SELECT count(*) AS n FROM analysis_runs WHERE provider = ? AND started_at >= ?').get(provider.id, since) as { n: number }).n;
  return {
    daily: { used: count(dayStart), limit: provider.limits.daily },
    monthly: { used: count(monthStart), limit: provider.limits.monthly },
  };
}
