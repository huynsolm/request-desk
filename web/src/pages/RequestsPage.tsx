import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.ts';
import { notifyChanged } from '../App.tsx';
import type { RequestListResponse } from '../../../shared/types.ts';
import { ReqBadge, fmtDate, useToast } from '../ui.tsx';
import { RequestPanel } from './RequestPanel.tsx';

const FILTERS = [
  { key: 'all', label: '전체' },
  { key: 'received', label: '접수' },
  { key: 'reviewing', label: '검토 중' },
  { key: 'confirmed', label: '확정' },
] as const;

export function RequestsPage() {
  const nav = useNavigate();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all');
  const [data, setData] = useState<RequestListResponse | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [panel, setPanel] = useState(false);
  const newBtn = useRef<HTMLButtonElement>(null);

  const load = useCallback(() => {
    api
      .listRequests(q.trim(), filter)
      .then((d) => {
        setData(d);
        setLoadError(false);
      })
      .catch(() => setLoadError(true));
  }, [q, filter]);

  useEffect(() => {
    const t = window.setTimeout(load, q ? 200 : 0);
    return () => window.clearTimeout(t);
  }, [load, q]);

  const hasRequests = !!data && data.total > 0;
  const statusLabel = FILTERS.find((f) => f.key === filter)!.label;
  const noResultsTitle = q.trim()
    ? filter === 'all'
      ? `‘${q.trim()}’에 맞는 요청이 없어요`
      : `‘${statusLabel}’ 상태에서 ‘${q.trim()}’에 맞는 요청이 없어요`
    : `‘${statusLabel}’ 상태인 요청이 없어요`;

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>고객 요청</h1>
            <p>메신저나 이메일로 받은 요청을 붙여 넣고 요구사항으로 정리해요.</p>
          </div>
          <button ref={newBtn} type="button" className="btn btn-primary" onClick={() => setPanel(true)}>
            + 새 요청
          </button>
        </div>

        {loadError && (
          <div className="notice notice-err" role="alert">
            <strong>목록을 불러오지 못했어요.</strong> 서버가 켜져 있는지 확인한 뒤{' '}
            <button type="button" className="btn-link" style={{ textDecoration: 'underline', color: 'inherit' }} onClick={load}>
              다시 불러오기
            </button>
            를 눌러 주세요.
          </div>
        )}

        {hasRequests && (
          <div className="toolbar">
            <input
              className="input search"
              type="search"
              aria-label="요청 검색"
              placeholder="요청 제목이나 고객명으로 검색"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="seg" role="group" aria-label="상태 필터">
              {FILTERS.map((f) => (
                <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
                  {f.label}
                  <span className="count">{data!.counts[f.key]}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {data && data.items.length > 0 && (
          <div className="card table" role="table" aria-label="고객 요청 목록">
            <div className="thead req-cols" role="row">
              <div role="columnheader">요청 제목</div>
              <div role="columnheader">고객명</div>
              <div role="columnheader">상태</div>
              <div role="columnheader">등록일</div>
            </div>
            {data.items.map((r) => (
              <div key={r.id} className="trow req-cols" role="row">
                <div style={{ minWidth: 0 }} role="cell">
                  <button type="button" className="row-title" onClick={() => nav(`/requests/${r.id}`)}>
                    {r.title}
                  </button>
                  <div className="row-sub">{r.preview}</div>
                </div>
                <div className="row-cell" role="cell">
                  {r.customerName}
                </div>
                <div role="cell">
                  <ReqBadge status={r.status} />
                  {r.status === 'reviewing' && r.unreviewedCount > 0 && (
                    <div className="t-sub" style={{ marginTop: 2 }}>
                      검토 전 {r.unreviewedCount}개
                    </div>
                  )}
                </div>
                <div className="row-date" role="cell">
                  {fmtDate(r.createdAt)}
                </div>
              </div>
            ))}
          </div>
        )}

        {data && hasRequests && data.items.length === 0 && (
          <div className="card empty">
            <h2>{noResultsTitle}</h2>
            <p>검색어를 줄이거나 상태 필터를 ‘전체’로 바꿔 보세요.</p>
            <button
              type="button"
              className="btn"
              style={{ marginTop: 10 }}
              onClick={() => {
                setQ('');
                setFilter('all');
              }}
            >
              검색 조건 초기화
            </button>
          </div>
        )}

        {data && !hasRequests && (
          <div className="card empty empty-first">
            <h2>아직 등록된 요청이 없어요</h2>
            <p>고객이 보낸 메시지나 이메일을 그대로 붙여 넣으면, 요구사항과 확인할 질문으로 나눠 정리할 수 있어요.</p>
            <ol className="steps-pills">
              <li>1 요청 붙여 넣기</li>
              <li>2 분석 결과 검토·확정</li>
              <li>3 작업 만들기</li>
            </ol>
            <button type="button" className="btn btn-primary" onClick={() => setPanel(true)}>
              첫 요청 등록하기
            </button>
          </div>
        )}
      </div>

      {panel && (
        <RequestPanel
          mode="new"
          initial={{ title: '', customerName: '', originalText: '' }}
          hasAnalysis={false}
          confirmed={false}
          onClose={() => {
            setPanel(false);
          }}
          onSubmit={async (v) => {
            const created = await api.createRequest(v);
            notifyChanged();
            setPanel(false);
            toast('요청을 등록했어요. 분석 항목을 직접 작성해 보세요.');
            nav(`/requests/${created.request.id}`);
          }}
        />
      )}
    </div>
  );
}
