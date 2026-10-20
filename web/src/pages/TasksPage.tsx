import { useCallback, useEffect, useRef, useState } from 'react';
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
  const saver = useSaver((e) => toast(e.message));
  const [t, setT] = useState<TaskDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [newCrit, setNewCrit] = useState('');
  const [critError, setCritError] = useState<string | null>(null);
  const [editCrit, setEditCrit] = useState<{ id: string; text: string; error?: string; busy?: boolean } | null>(null);

  // 재시도(다시 저장)가 "실패 당시의 값"이 아니라 "지금의 값"을 쓰도록, 항상 최신 상태를 ref 로 읽는다.
  const tRef = useRef<TaskDetail | null>(null);
  tRef.current = t;
  const titleRef = useRef('');
  titleRef.current = title;
  const descRef = useRef('');
  descRef.current = desc;
  const editCritRef = useRef(editCrit);
  editCritRef.current = editCrit;
  // 사용자가 "실제로 입력한" 필드. 오래된 화면값(서버가 먼저 바뀐 경우)과 사용자의 수정 초안을 구분한다.
  const dirtyRef = useRef({ title: false, desc: false });

  /**
   * 서버 응답을 화면에 반영한다. 입력 중인 제목·설명 초안은 덮어쓰지 않는다.
   * tRef 도 즉시 갱신한다: 대기 중인 저장 여러 개를 연달아 다시 보낼 때, 다음 저장이 렌더를 기다리지 않고
   * 방금 받은 최신 version 을 쓰도록 하기 위해서다.
   */
  const applyKeepDrafts = (d: TaskDetail) => {
    tRef.current = d;
    setT(d);
    // 사용자가 고치지 않은 칸은 서버의 최신 값으로 맞춘다(오래된 값이 남아 있다가 나중에 덮어쓰는 일을 막는다).
    // 사용자가 고친 칸(dirty)의 초안만 그대로 둔다.
    if (!dirtyRef.current.title) {
      titleRef.current = d.title;
      setTitle(d.title);
    }
    if (!dirtyRef.current.desc) {
      descRef.current = d.description;
      setDesc(d.description);
    }
  };

  useEffect(() => {
    api
      .getTask(taskId)
      .then((d) => {
        dirtyRef.current = { title: false, desc: false };
        setT(d);
        setTitle(d.title);
        setDesc(d.description);
      })
      .catch((e: ApiError) => setErr(e.code === 'not_found' ? '작업을 찾을 수 없어요.' : '작업을 불러오지 못했어요.'));
  }, [taskId]);

  /**
   * 작업 변경 저장. build 는 실행하는 시점에 호출되어 그때의 최신 초안으로 패치를 만든다(다시 저장 때도 마찬가지).
   * 성공 응답은 최초 실행과 재시도 모두 같은 경로로 반영되므로 version 이 항상 최신으로 유지된다.
   * 충돌(409, 다른 곳에서 먼저 바뀜)이면 최신 서버 상태만 받아 오고 저장 실패 상태를 유지한다:
   * 사용자의 초안은 그대로 남고, "다시 저장"을 누르면 최신 버전으로 지금 입력을 저장한다.
   */
  const save = async (key: string, build: () => { title?: string; description?: string; status?: TaskStatus } | null) => {
    await saver.track(key, async () => {
      const cur = tRef.current;
      const patch = build();
      if (!cur || !patch) return null;
      try {
        const d = await api.updateTask(cur.id, { version: cur.version, ...patch });
        // 저장한 내용과 지금 입력이 같으면 더는 "고친 상태"가 아니다. 저장하는 동안 더 입력했다면 계속 고친 상태로 둔다.
        if (patch.title !== undefined && titleRef.current.trim() === patch.title) dirtyRef.current.title = false;
        if (patch.description !== undefined && descRef.current === patch.description) dirtyRef.current.desc = false;
        applyKeepDrafts(d);
        onChanged();
        notifyChanged();
        return d;
      } catch (e) {
        if (e instanceof ApiError && e.code === 'version_conflict') {
          const fresh = await api.getTask(cur.id).catch(() => null);
          if (fresh) applyKeepDrafts(fresh);
          throw new ApiError(0, 'conflict_retry', '다른 곳에서 먼저 바뀐 내용이에요. 다시 저장하면 지금 입력한 내용으로 덮어써요.');
        }
        throw e;
      }
    });
  };

  /** 완료 조건 변경. 성공하면 최초·재시도 모두 서버 응답을 반영한다. */
  const crit = async (key: string, fn: () => Promise<TaskDetail>) => {
    const r = await saver.track(
      key,
      async () => {
        const d = await fn();
        applyKeepDrafts(d);
        onChanged();
        return d;
      },
      { inline: true },
    );
    if (!r.ok) {
      if (!r.error.retryable) setCritError(r.error.message);
      return false;
    }
    return true;
  };

  /** 기존 완료 조건 문구 수정(같은 ID 유지). 실패해도 입력창과 입력값을 남기고, 다시 저장은 현재 입력을 보낸다. */
  const commitCritEdit = async () => {
    const cur = editCritRef.current;
    if (!cur || cur.busy) return;
    const msg = checkCriterion(cur.text);
    if (msg) return setEditCrit({ ...cur, error: msg });
    const submitted = cur.text;
    setEditCrit({ ...cur, busy: true, error: undefined });
    const r = await saver.track(
      `crit-edit:${cur.id}`,
      async () => {
        const d = await api.updateCriterion(cur.id, { text: cur.text.trim() });
        applyKeepDrafts(d);
        onChanged();
        return d;
      },
      {
        inline: true,
        onOk: () => {
          const now = editCritRef.current;
          if (now && now.id === cur.id && now.text === submitted) setEditCrit(null);
          else if (now) setEditCrit({ ...now, busy: false });
        },
        retry: async () => {
          if (editCritRef.current) await commitCritEditRef.current();
          else saver.dismiss(`crit-edit:${cur.id}`);
        },
      },
    );
    if (!r.ok) {
      const now = editCritRef.current;
      if (now) setEditCrit({ ...now, busy: false, error: r.error.retryable ? '저장하지 못했어요. 입력한 내용은 그대로 남아 있어요.' : r.error.message });
    }
  };
  const commitCritEditRef = useRef(commitCritEdit);
  commitCritEditRef.current = commitCritEdit;

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
  const onlyOne = t.criteria.length <= 1;
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
            <strong>저장하지 못했어요.</strong> 입력한 내용은 그대로 남아 있어요.
            {saver.message && <div style={{ margin: '2px 0 6px' }}>{saver.message}</div>}{' '}
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
              dirtyRef.current.title = true;
              setTitle(e.target.value);
              setTitleError(null);
            }}
            onBlur={() => {
              // 사용자가 고치지 않은 칸은 포커스만 옮겨도 저장하지 않는다.
              if (!dirtyRef.current.title) return;
              if (!title.trim()) return setTitleError('작업 제목을 입력해 주세요.');
              if (title.trim() === tRef.current?.title) {
                dirtyRef.current.title = false;
                return;
              }
              void save('title', () => (titleRef.current.trim() ? { title: titleRef.current.trim() } : null));
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
              <button key={s} type="button" aria-pressed={t.status === s} onClick={() => t.status !== s && void save('status', () => ({ status: s }))}>
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
            onChange={(e) => {
              dirtyRef.current.desc = true;
              setDesc(e.target.value);
            }}
            onBlur={() => {
              if (!dirtyRef.current.desc) return;
              if (desc === tRef.current?.description) {
                dirtyRef.current.desc = false;
                return;
              }
              void save('desc', () => ({ description: descRef.current }));
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
                {editCrit && editCrit.id === c.id ? (
                  <div className="inline-form" style={{ flex: 1 }}>
                    <textarea
                      autoFocus
                      className="edit-area"
                      aria-label="완료 조건 문구"
                      rows={2}
                      value={editCrit.text}
                      onChange={(e) => setEditCrit({ ...editCrit, text: e.target.value, error: undefined })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          void commitCritEdit();
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          saver.dismiss(`crit-edit:${c.id}`);
                          setEditCrit(null);
                        }
                      }}
                    />
                    {editCrit.error && (
                      <div className="field-error" role="alert">
                        {editCrit.error}
                      </div>
                    )}
                    <div className="row">
                      <button type="button" className="btn btn-sm btn-apply" disabled={editCrit.busy} onClick={() => void commitCritEdit()}>
                        적용
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => {
                          saver.dismiss(`crit-edit:${c.id}`);
                          setEditCrit(null);
                        }}
                      >
                        취소
                      </button>
                      <span className="hint">Enter 적용 · Esc 취소</span>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={c.done}
                      aria-label={`완료 조건 확인: ${c.text}`}
                      className="cb"
                      onClick={() => void crit(`crit:${c.id}`, () => api.updateCriterion(c.id, { done: !c.done }))}
                    >
                      {c.done ? '✓' : ''}
                    </button>
                    <span className={`tx${c.done ? ' done' : ''}`}>{c.text}</span>
                    <button
                      type="button"
                      className="btn btn-sm btn-text"
                      aria-label={`완료 조건 수정: ${c.text}`}
                      onClick={() => {
                        saver.dismiss(`crit-edit:${editCrit?.id ?? ''}`);
                        setEditCrit({ id: c.id, text: c.text });
                      }}
                    >
                      수정
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-text btn-danger-text"
                      aria-label={`완료 조건 삭제: ${c.text}`}
                      disabled={onlyOne}
                      title={onlyOne ? '작업에는 완료 조건이 하나 이상 있어야 해요.' : undefined}
                      onClick={() => void crit(`critdel:${c.id}`, () => api.deleteCriterion(c.id))}
                    >
                      삭제
                    </button>
                  </>
                )}
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
              if (await crit('critadd', () => api.addCriterion(t.id, text))) setNewCrit('');
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
