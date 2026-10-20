import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api.ts';
import { notifyChanged } from '../App.tsx';
import type { TaskDetail, TaskListResponse, TaskStatus } from '../../../shared/types.ts';
import { checkCriterion } from '../../../shared/validation.ts';
import { Spinner, TASK_LABEL, TaskBadge, useToast } from '../ui.tsx';
import { useSaver } from './useSaver.ts';

const FILTERS = [
  { key: 'all', label: '전체' },
  { key: 'todo', label: '할 일' },
  { key: 'doing', label: '진행 중' },
  { key: 'done', label: '완료' },
] as const;
const STATUSES: TaskStatus[] = ['todo', 'doing', 'done'];

export function TasksPage() {
  const { taskId } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all');
  const [list, setList] = useState<TaskListResponse | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(() => {
    api
      .listTasks(filter)
      .then((l) => {
        setList(l);
        setLoadError(false);
      })
      .catch(() => setLoadError(true));
  }, [filter]);
  useEffect(load, [load]);

  const changeStatus = async (taskRowId: string, version: number, status: TaskStatus) => {
    try {
      await api.updateTask(taskRowId, { version, status });
      load();
      notifyChanged();
    } catch (e) {
      toast((e as ApiError).retryable ? '상태를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.' : (e as ApiError).message);
      load();
    }
  };

  const empty = list && list.counts.all === 0;
  return (
    <div className="tasks-wrap">
      <div className="tasks-list">
        <div className="page-inner">
          <div className="page-head">
            <div>
              <h1>작업</h1>
              <p>확정한 요구사항으로 만든 작업이에요. 작업을 누르면 설명과 완료 조건을 볼 수 있어요.</p>
            </div>
          </div>

          {loadError && (
            <div className="notice notice-err" role="alert">
              <strong>작업 목록을 불러오지 못했어요.</strong>{' '}
              <button type="button" className="btn-link" style={{ textDecoration: 'underline', color: 'inherit' }} onClick={load}>
                다시 불러오기
              </button>
            </div>
          )}

          {list && !empty && (
            <div className="toolbar">
              <div className="seg" role="group" aria-label="작업 상태 필터">
                {FILTERS.map((f) => (
                  <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
                    {f.label}
                    <span className="count">{list.counts[f.key]}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {list && list.items.length > 0 && (
            <div className="card table" role="table" aria-label="작업 목록">
              <div className="thead task-cols" role="row">
                <div role="columnheader">작업</div>
                <div role="columnheader">연결된 요청</div>
                <div role="columnheader">상태</div>
              </div>
              {list.items.map((t) => (
                <div
                  key={t.id}
                  className={`trow task-cols${taskId === t.id ? ' selected' : ''}`}
                  role="row"
                  aria-selected={taskId === t.id}
                >
                  <div style={{ minWidth: 0 }} role="cell">
                    <button type="button" className={`row-title t-title${t.status === 'done' ? ' done' : ''}`} onClick={() => nav(`/tasks/${t.id}`)}>
                      {t.title}
                    </button>
                    <div className="t-sub">
                      완료 조건 {t.criteriaDone}/{t.criteriaTotal}
                      {t.sourceChanged && (
                        <span className="lbl changed" style={{ marginLeft: 8 }}>
                          원본 변경됨
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ minWidth: 0 }} role="cell">
                    <button type="button" className="req-link" onClick={() => nav(`/requests/${t.requestId}`)}>
                      {t.requestTitle}
                    </button>
                    <div className="t-sub">{t.customerName}</div>
                  </div>
                  <div role="cell">
                    <label className="sr-only" htmlFor={`st-${t.id}`}>
                      {t.title} 상태
                    </label>
                    <select
                      id={`st-${t.id}`}
                      className={`status-select ${t.status}`}
                      value={t.status}
                      onChange={(e) => void changeStatus(t.id, t.version, e.target.value as TaskStatus)}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {TASK_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          )}

          {list && !empty && list.items.length === 0 && (
            <div className="card empty">
              <h2>‘{FILTERS.find((f) => f.key === filter)!.label}’ 상태인 작업이 없어요</h2>
              <button type="button" className="btn" style={{ marginTop: 10 }} onClick={() => setFilter('all')}>
                전체 작업 보기
              </button>
            </div>
          )}

          {empty && (
            <div className="card empty empty-first">
              <h2>아직 만든 작업이 없어요</h2>
              <p>요청을 분석하고 검토해 확정한 뒤, 요구사항을 선택해 작업으로 만들 수 있어요.</p>
              <button type="button" className="btn btn-primary" onClick={() => nav('/requests')}>
                고객 요청으로 이동
              </button>
            </div>
          )}
        </div>
      </div>

      {taskId && <TaskPanel key={taskId} taskId={taskId} onClose={() => nav('/tasks')} onChanged={load} />}
    </div>
  );
}

function TaskPanel({ taskId, onClose, onChanged }: { taskId: string; onClose: () => void; onChanged: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const saver = useSaver();
  const [t, setT] = useState<TaskDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [newCrit, setNewCrit] = useState('');
  const [critError, setCritError] = useState<string | null>(null);

  const apply = (d: TaskDetail, keepText = false) => {
    setT(d);
    if (!keepText) {
      setTitle(d.title);
      setDesc(d.description);
    }
  };

  useEffect(() => {
    api
      .getTask(taskId)
      .then((d) => apply(d))
      .catch((e: ApiError) => setErr(e.code === 'not_found' ? '작업을 찾을 수 없어요.' : '작업을 불러오지 못했어요.'));
  }, [taskId]);

  /** 작업 변경 저장. 실패하면 입력값은 그대로 두고 "다시 저장"으로 재시도한다. */
  const save = async (key: string, patch: { title?: string; description?: string; status?: TaskStatus }) => {
    if (!t) return;
    const r = await saver.track(
      key,
      () => api.updateTask(t.id, { version: t.version, ...patch }),
      () => {
        onChanged();
        notifyChanged();
      },
    );
    if (r.ok) apply(r.value, true);
    else if (!r.error.retryable) {
      toast(r.error.message);
      const fresh = await api.getTask(taskId).catch(() => null);
      if (fresh) apply(fresh);
    }
  };

  const crit = async (fn: () => Promise<TaskDetail>, key: string) => {
    const r = await saver.track(key, fn);
    if (r.ok) {
      apply(r.value, true);
      onChanged();
      return true;
    }
    if (!r.error.retryable) setCritError(r.error.message);
    return false;
  };

  if (err) {
    return (
      <aside className="tpanel" aria-label="작업 상세">
        <div className="tpanel-head">
          <span>작업 상세</span>
          <button type="button" className="icon-btn" aria-label="닫기" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="tpanel-body">
          <div className="notice notice-err">{err}</div>
        </div>
      </aside>
    );
  }
  if (!t) {
    return (
      <aside className="tpanel" aria-label="작업 상세">
        <div className="tpanel-body">
          <div className="hint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Spinner /> 불러오는 중…
          </div>
        </div>
      </aside>
    );
  }

  const done = t.criteria.filter((c) => c.done).length;
  return (
    <aside className="tpanel" aria-label="작업 상세">
      <div className="tpanel-head">
        <span>작업 상세</span>
        <button type="button" className="icon-btn" aria-label="닫기" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="tpanel-body">
        {saver.state === 'error' && (
          <div className="notice notice-err" role="alert">
            <strong>저장하지 못했어요.</strong> 입력한 내용은 그대로 남아 있어요.{' '}
            <button type="button" className="btn-retry" onClick={() => void saver.retry()}>
              다시 저장
            </button>
          </div>
        )}
        {t.changeReasons.length > 0 && (
          <div className="notice notice-warn" role="note">
            <strong>원본이 바뀌었어요.</strong> 이 작업은 바뀌기 전 확정 내용으로 만들어졌고, 자동으로 바뀌지 않아요.
            <ul className="summary-list" style={{ marginTop: 4 }}>
              {t.changeReasons.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="field">
          <label htmlFor="tp-title">작업 제목</label>
          <input
            id="tp-title"
            className={`input${titleError ? ' is-error' : ''}`}
            style={{ fontSize: 17, fontWeight: 600 }}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setTitleError(null);
            }}
            onBlur={() => {
              if (!title.trim()) return setTitleError('작업 제목을 입력해 주세요.');
              if (title.trim() !== t.title) void save('title', { title: title.trim() });
            }}
            aria-invalid={!!titleError}
          />
          {titleError && <div className="field-error">{titleError}</div>}
        </div>

        <div className="field">
          <span className="label" id="tp-status-label">
            상태
          </span>
          <div className="seg" role="group" aria-labelledby="tp-status-label">
            {STATUSES.map((s) => (
              <button key={s} type="button" aria-pressed={t.status === s} onClick={() => t.status !== s && void save('status', { status: s })}>
                {TASK_LABEL[s]}
              </button>
            ))}
          </div>
          <div>
            <TaskBadge status={t.status} />
          </div>
        </div>

        <div className="field">
          <span className="label">연결된 요청</span>
          <button type="button" className="link-card" onClick={() => nav(`/requests/${t.requestId}`)}>
            <span>
              <div className="t">{t.requestTitle}</div>
              <div className="s">
                {t.customerName} · 근거 요구사항: {t.requirementText}
              </div>
            </span>
            <span style={{ color: 'var(--primary)', fontSize: 14, whiteSpace: 'nowrap' }}>요청 보기 →</span>
          </button>
          {t.requirementQuote && <div className="hint">원문 “{t.requirementQuote}”</div>}
        </div>

        <div className="field">
          <label htmlFor="tp-desc">설명</label>
          <textarea
            id="tp-desc"
            className="textarea"
            rows={4}
            style={{ fontSize: 15.5, lineHeight: 1.6 }}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            onBlur={() => {
              if (desc !== t.description) void save('desc', { description: desc });
            }}
          />
        </div>

        <div className="field">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span className="label">완료 조건</span>
            <span className="hint" aria-live="polite">
              {done}/{t.criteria.length}
            </span>
          </div>
          <ul>
            {t.criteria.map((c) => (
              <li key={c.id} className="crit">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={c.done}
                  aria-label={`완료 조건 확인: ${c.text}`}
                  className="cb"
                  onClick={() => void crit(() => api.updateCriterion(c.id, { done: !c.done }), `crit:${c.id}`)}
                >
                  {c.done ? '✓' : ''}
                </button>
                <span className={`tx${c.done ? ' done' : ''}`}>{c.text}</span>
                <button
                  type="button"
                  className="btn btn-sm btn-text btn-danger-text"
                  aria-label={`완료 조건 삭제: ${c.text}`}
                  onClick={() => void crit(() => api.deleteCriterion(c.id), `critdel:${c.id}`)}
                >
                  삭제
                </button>
              </li>
            ))}
          </ul>
          <form
            style={{ display: 'flex', gap: 6 }}
            onSubmit={async (e) => {
              e.preventDefault();
              const text = newCrit.trim();
              if (!text) return;
              const msg = checkCriterion(text);
              if (msg) return setCritError(msg);
              setCritError(null);
              if (await crit(() => api.addCriterion(t.id, text), 'critadd')) setNewCrit('');
            }}
          >
            <input
              className="input"
              style={{ height: 40, fontSize: 15 }}
              aria-label="완료 조건 추가"
              placeholder="완료 조건 추가"
              value={newCrit}
              onChange={(e) => {
                setNewCrit(e.target.value);
                setCritError(null);
              }}
            />
            <button type="submit" className="btn">
              추가
            </button>
          </form>
          {critError && (
            <div className="field-error" role="alert">
              {critError}
            </div>
          )}
        </div>
      </div>
      <div className="tpanel-foot">변경 내용은 자동으로 저장돼요.</div>
    </aside>
  );
}
