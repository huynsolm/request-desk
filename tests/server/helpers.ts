import { openDb, type Db } from '../../server/db/open.ts';
import { migrate } from '../../server/db/migrate.ts';
import { createApp } from '../../server/app.ts';
import * as svc from '../../server/service.ts';

export const ORIGINAL =
  '홈페이지에서 촬영 예약을 받았으면 좋겠어요. 가능한 날짜를 보고 신청하게 하고, 예약이 들어오면 제가 확인할 수 있으면 좋겠어요.';
export const Q1 = '가능한 날짜를 보고';
export const Q2 = '홈페이지에서 촬영 예약을 받았으면 좋겠어요';
export const Q3 = '예약이 들어오면 제가 확인할 수 있으면 좋겠어요';

export interface Env {
  db: Db;
  api: (method: string, path: string, body?: unknown) => Promise<{ status: number; json: any }>;
}

export function makeEnv(db?: Db): Env {
  const database = db ?? openDb(':memory:');
  migrate(database);
  const app = createApp(database);
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  };
  return { db: database, api };
}

export async function newRequest(env: Env, over: Record<string, unknown> = {}) {
  const r = await env.api('POST', '/api/requests', {
    title: '홈페이지 예약 기능 추가',
    customerName: '모닝 스튜디오',
    originalText: ORIGINAL,
    ...over,
  });
  if (r.status !== 201) throw new Error(`요청 생성 실패: ${JSON.stringify(r.json)}`);
  return r.json.request.id as string;
}

/** 담당자가 직접 추가한 항목(검토 완료로 간주) */
export async function addManual(env: Env, rid: string, kind: string, content: string, quote?: string) {
  const r = await env.api('POST', `/api/requests/${rid}/items`, { kind, content, quote });
  if (r.status !== 201) throw new Error(`항목 추가 실패: ${JSON.stringify(r.json)}`);
  return r.json as { id: string; version: number };
}

/** 모의 제안(검토 전) 항목을 직접 넣는다. */
export function addProposal(env: Env, rid: string, kind: 'requirement' | 'question' | 'undecided', content: string, quote?: string) {
  return svc.insertItem(env.db, { requestId: rid, kind, content, quote, origin: 'mock' });
}

export async function detail(env: Env, rid: string) {
  return (await env.api('GET', `/api/requests/${rid}`)).json;
}

export async function confirm(env: Env, rid: string) {
  const p = (await env.api('GET', `/api/requests/${rid}/confirm-preview`)).json;
  return env.api('POST', `/api/requests/${rid}/confirm`, { contentSeq: p.contentSeq });
}

/** 요구사항 3 + 질문 1 + 미확정 1 을 만들어 확정까지 마친 요청 */
export async function confirmedRequest(env: Env) {
  const rid = await newRequest(env);
  await addManual(env, rid, 'requirement', '예약 가능한 날짜 조회', Q1);
  await addManual(env, rid, 'requirement', '고객의 촬영 예약 신청', Q2);
  await addManual(env, rid, 'requirement', '운영자의 예약 내역 확인', Q3);
  await addManual(env, rid, 'question', '결제가 필요한가요?');
  await addManual(env, rid, 'undecided', '로그인 필요 여부');
  const res = await confirm(env, rid);
  if (res.status !== 200) throw new Error(`확정 실패: ${JSON.stringify(res.json)}`);
  return { rid, detail: res.json };
}

export function snapshotItems(d: any, kind: string) {
  return d.confirmations[0].items.filter((i: any) => i.kind === kind) as { id: string; sourceItemId: string; content: string }[];
}

export const CRITERIA = ['고객이 홈페이지에서 예약 가능한 날짜를 볼 수 있다'];
