import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api.ts';
import { notifyChanged } from '../App.tsx';
import type { AnalysisItem, ItemKind, RequestDetail } from '../../../shared/types.ts';
import { checkItemContent, checkNote } from '../../../shared/validation.ts';
import { ReqBadge, Spinner, TaskBadge, fmtDate, useToast } from '../ui.tsx';
import { ConfirmDialog, ReopenDialog, TaskModal } from './Dialogs.tsx';
import { ItemSection, type FormState } from './ItemSection.tsx';
import { RequestPanel } from './RequestPanel.tsx';
import { useSaver } from './useSaver.ts';

type StepMsg = {
  step: 1 | 2 | 3;
  allDone?: boolean;
  msg: string;
  link?: { label: string; onClick: () => void };
  primary?: { label: string; onClick: () => void };
  disabled?: { label: string };
  secondary?: { label: string; onClick: () => void };
};

export function RequestDetailPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const reloadRef = useRef<() => Promise<void>>(async () => {});
  // 다시 시도로 해결되지 않는 오류는 최초 저장·다시 저장 어느 경로에서든 사용자에게 알린다.
  const saver = useSaver((e) => {
    toast(e.message);
    if (e.code === 'version_conflict' || e.code === 'locked_confirmed') void reloadRef.current();
  });
  const [d, setD] = useState<RequestDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [panel, setPanel] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const formRef = useRef<FormState | null>(null);
  formRef.current = form;
  const commitFormRef = useRef<() => Promise<void>>(async () => {});
  const dRef = useRef<RequestDetail | null>(null);

  const reload = useCallback(async () => {
    try {
      const data = await api.getRequest(id);
      dRef.current = data; // 바로 이어지는 코드가 최신 항목 version 을 읽을 수 있게 즉시 보관
      setD(data);
      setLoadError(null);
    } catch (e) {
      setLoadError((e as ApiError).code === 'not_found' ? 'not_found' : '요청을 불러오지 못했어요.');
    }
  }, [id]);

  reloadRef.current = reload;

  useEffect(() => {
    setD(null);
    setStarted(false);
    setForm(null);
    setSelected({});
    void reload();
  }, [id, reload]);

  const items = d?.items ?? [];
  const confirmed = d?.request.phase === 'confirmed';
  const reqs = useMemo(() => items.filter((i) => i.kind === 'requirement'), [items]);
  const questions = useMemo(() => items.filter((i) => i.kind === 'question'), [items]);
  const unknowns = useMemo(() => items.filter((i) => i.kind === 'undecided'), [items]);
  const reqNumbers = useMemo(() => new Map(reqs.map((r, i) => [r.id, i + 1])), [reqs]);
  const pendingCount = items.filter((i) => i.reviewState === 'unreviewed').length;
  const latest = d?.confirmations[0];
  const latestIsCurrent = !!d && !!latest && latest.analysisRev === d.request.analysisRev && confirmed;
  // 확정된 현재 검토 버전의 요구사항 중 아직 작업이 없는 것만 선택할 수 있다.
  const confirmItemBySource = useMemo(
    () => new Map((latestIsCurrent ? latest!.items : []).filter((i) => i.kind === 'requirement').map((i) => [i.sourceItemId, i.id])),
    [latest, latestIsCurrent],
  );
  const selectableIds = useMemo(
    () => new Set(reqs.filter((r) => !r.task && confirmItemBySource.has(r.id)).map((r) => r.id)),
    [reqs, confirmItemBySource],
  );
  const selectableKey = Array.from(selectableIds).join(',');
  useEffect(() => {
    // 확정 직후에는 작업이 아직 없는 요구사항을 기본으로 모두 선택한다.
    setSelected(Object.fromEntries(Array.from(selectableIds).map((i) => [i, true])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectableKey, d?.request.analysisRev]);
  const selectedCount = Array.from(selectableIds).filter((i) => selected[i]).length;
  const hasItems = items.length > 0;
  const badQuote = reqs.some((r) => !r.quoteValid);

  // ───── 저장(자동 저장) 래퍼 ─────
  const afterOk = useCallback(async () => {
    await reload();
    notifyChanged();
  }, [reload]);

  /** 서버에 변경을 보내고 성공하면 화면을 새로고침한다. 실패 사유가 검증 오류면 메시지를 돌려준다. */
  async function mutate<T>(
    key: string,
    fn: () => Promise<T>,
    onOk?: () => void | Promise<void>,
    retry?: () => Promise<unknown>,
  ): Promise<{ ok: true; value: T } | { ok: false; error: ApiError }> {
    const r = await saver.track(key, fn, {
      onOk: async () => {
        await afterOk();
        await onOk?.();
      },
      retry,
      inline: key === 'form', // 입력창 저장은 입력창 안에 오류를 보여준다
    });
    if (!r.ok && !r.error.retryable && key === 'form') {
      if (r.error.code === 'version_conflict' || r.error.code === 'locked_confirmed') await reload();
    }
    return r;
  }

  // ───── 항목 동작 ─────
  async function review(item: AnalysisItem) {
    await mutate(`review:${item.id}`, () => api.reviewItem(item.id, item.version));
  }
  async function remove(item: AnalysisItem) {
    await mutate(`delete:${item.id}`, () => api.deleteItem(item.id, item.version), () => {
      toast('항목을 삭제했어요.', '되돌리기', () => {
        void mutate(`restore:${item.id}`, () => api.restoreItem(item.id));
      });
    });
  }
  async function unresolve(item: AnalysisItem) {
    await mutate(`resolve:${item.id}`, () => api.resolveItem(item.id, { version: item.version, resolution: 'open' }));
  }

  // 다른 입력창을 열거나 취소하면, 이전 입력창의 저장 실패 대기열은 버린다(과거 입력이 새 입력을 덮어쓰지 않도록).
  const openForm = (f: FormState) => {
    saver.dismiss('form');
    setForm(f);
  };
  const startNew = (kind: ItemKind) => openForm({ mode: 'new', kind, text: '', text2: '' });
  const startEdit = (i: AnalysisItem) =>
    openForm({
      mode: 'edit',
      itemId: i.id,
      kind: i.kind,
      text: i.content,
      text2: i.quote ?? '',
      base: i.content,
      base2: i.quote ?? '',
      baseVersion: i.version,
    });
  const startResolve = (i: AnalysisItem) =>
    openForm({ mode: 'resolve', itemId: i.id, kind: i.kind, text: i.resolutionText ?? '', text2: '', baseVersion: i.version });
  const startConvert = (i: AnalysisItem) =>
    openForm({
      mode: 'convert',
      itemId: i.id,
      kind: i.kind,
      text: '',
      text2: `${i.kind === 'question' ? '고객 답변' : '결정'}: ${i.resolutionText ?? ''}`,
      baseVersion: i.version,
    });
  const cancelForm = () => {
    saver.dismiss('form');
    setForm(null);
  };
  const patchForm = (p: Partial<FormState>) => setForm((f) => (f ? { ...f, ...p } : f));

  /**
   * 항목 입력창의 "적용"/Enter. 항상 "지금 입력창에 있는" 내용을 저장한다.
   * - 실패해도 입력창과 입력값은 그대로 두고, "다시 저장"은 실패 당시 값이 아니라 현재 입력을 다시 보낸다.
   * - 저장이 끝났을 때 입력창 내용이 제출한 내용과 같을 때만 닫는다(저장 중에 더 입력했다면 닫지 않는다).
   */
  async function commitForm() {
    const f = formRef.current;
    if (!f || f.busy) return;
    const text = f.text.trim();
    if (f.mode === 'edit' || f.mode === 'new') {
      // README: 빈 값으로 적용하면 취소와 같다.
      if (!text) return cancelForm();
      const err = checkItemContent(text);
      if (err) return patchForm({ error: err });
    }
    const submitted = { mode: f.mode, itemId: f.itemId, kind: f.kind, text: f.text, text2: f.text2 };
    const unchanged = () => {
      const cur = formRef.current;
      return !!cur && cur.mode === submitted.mode && cur.itemId === submitted.itemId && cur.kind === submitted.kind && cur.text === submitted.text && cur.text2 === submitted.text2;
    };
    const finish = () => {
      if (unchanged()) setForm(null);
      else patchForm({ busy: false });
    };
    const retry = async () => {
      if (!formRef.current) saver.dismiss('form');
      else await commitFormRef.current();
    };
    const failMsg = (e: ApiError) =>
      e.retryable ? '저장하지 못했어요. 입력한 내용은 그대로 남아 있어요.' : (e.fieldErrors?.quote ?? e.fieldErrors?.content ?? e.message);
    /** 실패 처리. 그 사이 항목이 바뀌어 충돌(409)이면 입력은 그대로 두고, 최신 version 으로 다시 적용할 수 있게 한다. */
    const onFail = (e: ApiError, itemId?: string) => {
      if (e.code === 'version_conflict') {
        const fresh = itemId ? dRef.current?.items.find((i) => i.id === itemId) : undefined;
        patchForm({
          busy: false,
          baseVersion: fresh?.version,
          error: '다른 곳에서 먼저 바뀐 항목이에요. 입력한 내용은 그대로 두었어요. 바꾼 부분만 저장하려면 한 번 더 ‘적용’을 눌러 주세요.',
        });
      } else patchForm({ busy: false, error: failMsg(e) });
    };

    if (f.mode === 'edit') {
      const item = items.find((i) => i.id === f.itemId);
      if (!item) return cancelForm();
      // 창을 열었을 때의 값(base)과 비교해 사용자가 실제로 고친 필드만 저장한다. 고치지 않은 필드는 보내지 않으므로
      // 그 사이 서버에서 바뀐 최신 내용을 열 때의 오래된 값으로 덮어쓰지 않는다.
      const quoteVal = f.text2.trim() || null;
      const contentChanged = f.text !== f.base;
      const quoteChanged = item.kind === 'requirement' && quoteVal !== ((f.base2 ?? '').trim() || null);
      if (!contentChanged && !quoteChanged) return cancelForm();
      patchForm({ busy: true, error: undefined });
      const r = await mutate(
        'form',
        () =>
          api.updateItem(item.id, {
            version: f.baseVersion ?? item.version, // 창을 열 때 본 버전. 그 사이 바뀌었으면 서버가 충돌로 알려준다.
            ...(contentChanged ? { content: text } : {}),
            ...(quoteChanged ? { quote: quoteVal } : {}),
          }),
        finish,
        retry,
      );
      if (!r.ok) onFail(r.error, item.id);
    } else if (f.mode === 'new') {
      patchForm({ busy: true, error: undefined });
      const r = await mutate('form', () => api.addItem(id, { kind: f.kind, content: text }), finish, retry);
      if (!r.ok) onFail(r.error);
    } else if (f.mode === 'resolve') {
      const item = items.find((i) => i.id === f.itemId);
      if (!item) return cancelForm();
      const label = item.kind === 'question' ? '고객 답변' : '결정 내용';
      const err = checkNote(text, label);
      if (err) return patchForm({ error: err });
      patchForm({ busy: true, error: undefined });
      const r = await mutate(
        'form',
        () =>
          api.resolveItem(item.id, {
            version: f.baseVersion ?? item.version,
            resolution: item.kind === 'question' ? 'answered' : 'decided',
            text,
          }),
        finish,
        retry,
      );
      if (!r.ok) onFail(r.error, item.id);
    } else if (f.mode === 'convert') {
      const item = items.find((i) => i.id === f.itemId);
      if (!item) return cancelForm();
      const e1 = checkItemContent(text);
      const e2 = checkNote(f.text2, '전환 근거');
      if (e1 || e2) return patchForm({ error: e1 ?? e2 ?? undefined });
      patchForm({ busy: true, error: undefined });
      const r = await mutate(
        'form',
        () => api.convertItem(item.id, { version: f.baseVersion ?? item.version, content: text, basis: f.text2.trim() }),
        () => {
          finish();
          toast('요구사항으로 반영했어요. 검토한 뒤 확정할 수 있어요.');
        },
        retry,
      );
      if (!r.ok) onFail(r.error, item.id);
    }
  }
  commitFormRef.current = commitForm;

  async function reopen() {
    try {
      await api.reopen(id);
      setReopenOpen(false);
      await afterOk();
      toast('새 검토 버전을 시작했어요. 이전 확정 기록과 작업은 그대로 남아 있어요.');
    } catch (e) {
      setReopenOpen(false);
      toast((e as ApiError).message);
    }
  }

  // ───── 화면 계산 ─────
  const step: StepMsg = useMemo(() => {
    if (confirmed) {
      const reopenLink = { label: '다시 검토하기', onClick: () => setReopenOpen(true) };
      if (selectableIds.size === 0) {
        return { step: 3, allDone: true, msg: '모든 요구사항을 작업으로 만들었어요.', link: reopenLink, secondary: { label: '작업 목록 보기', onClick: () => nav('/tasks') } };
      }
      if (selectedCount > 0) {
        return { step: 3, msg: `작업으로 만들 요구사항을 선택하세요 · ${selectedCount}개 선택됨`, link: reopenLink, primary: { label: `작업 만들기 (${selectedCount})`, onClick: () => setTaskOpen(true) } };
      }
      return { step: 3, msg: '작업으로 만들 요구사항을 하나 이상 선택해 주세요.', link: reopenLink, disabled: { label: '작업 만들기' } };
    }
    if (!hasItems && !started) {
      return {
        step: 1,
        msg: '원문을 읽고 요구사항·확인할 질문·미확정 사항을 직접 나눠 적어요. 적은 내용은 검토하기 전까지 확정되지 않아요.',
        primary: { label: '분석 항목 직접 작성하기', onClick: () => setStarted(true) },
      };
    }
    if (pendingCount > 0) return { step: 2, msg: `검토 전 항목이 ${pendingCount}개 남아 있어요. 모두 검토해야 확정할 수 있어요.`, disabled: { label: '검토 완료하고 확정' } };
    if (reqs.length === 0) return { step: 2, msg: '확정할 요구사항이 없어요. 요구사항을 추가해 주세요.', disabled: { label: '검토 완료하고 확정' } };
    if (badQuote) return { step: 2, msg: '원문에서 근거 문장을 찾을 수 없는 요구사항이 있어요. 근거가 맞는지 확인하거나 수정해 주세요.', disabled: { label: '검토 완료하고 확정' } };
    return { step: 2, msg: '확정하면 요구사항이 고정돼요. 작업은 다음 단계에서 따로 만들어요.', primary: { label: '검토 완료하고 확정', onClick: () => setConfirmOpen(true) } };
  }, [confirmed, selectableIds, selectedCount, hasItems, started, pendingCount, reqs.length, badQuote, nav]);

  // 원문 하이라이트 조각
  const segments = useMemo(() => {
    if (!d) return [];
    const text = d.request.originalText;
    const spans: { start: number; end: number; id: string; num: number }[] = [];
    for (const r of reqs) {
      if (!r.quote || !r.quoteValid) continue;
      const start = text.indexOf(r.quote);
      if (start < 0) continue;
      const end = start + r.quote.length;
      if (spans.some((s) => start < s.end && end > s.start)) continue; // 겹치면 앞의 것만
      spans.push({ start, end, id: r.id, num: reqNumbers.get(r.id) ?? 0 });
    }
    spans.sort((a, b) => a.start - b.start);
    const out: { text: string; id?: string; num?: number }[] = [];
    let pos = 0;
    for (const s of spans) {
      if (s.start > pos) out.push({ text: text.slice(pos, s.start) });
      out.push({ text: text.slice(s.start, s.end), id: s.id, num: s.num });
      pos = s.end;
    }
    if (pos < text.length) out.push({ text: text.slice(pos) });
    return out;
  }, [d, reqs, reqNumbers]);

  if (loadError === 'not_found') {
    return (
      <div className="page">
        <div className="page-inner">
          <div className="card empty">
            <h2>요청을 찾을 수 없어요</h2>
            <p>삭제되었거나 주소가 잘못되었을 수 있어요.</p>
            <button type="button" className="btn" style={{ marginTop: 10 }} onClick={() => nav('/requests')}>
              고객 요청으로 돌아가기
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (!d) {
    return (
      <div className="page">
        <div className="page-inner">
          {loadError ? (
            <div className="notice notice-err" role="alert">
              {loadError}{' '}
              <button type="button" className="btn-link" style={{ textDecoration: 'underline', color: 'inherit' }} onClick={() => void reload()}>
                다시 불러오기
              </button>
            </div>
          ) : (
            <div className="hint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Spinner /> 불러오는 중…
            </div>
          )}
        </div>
      </div>
    );
  }

  const r = d.request;
  const showAnalysis = hasItems || started || confirmed;
  const sectionProps = {
    reqNumbers,
    confirmed,
    form,
    onFormChange: patchForm,
    onFormCommit: () => void commitForm(),
    onFormCancel: cancelForm,
    hover,
    setHover,
    onReview: (i: AnalysisItem) => void review(i),
    onDelete: (i: AnalysisItem) => void remove(i),
    onEdit: startEdit,
    onNew: startNew,
    onResolve: startResolve,
    onUnresolve: (i: AnalysisItem) => void unresolve(i),
    onConvert: startConvert,
    selectable: selectableIds,
    selected,
    onToggle: (i: AnalysisItem) => setSelected((s) => ({ ...s, [i.id]: !s[i.id] })),
    onGoTask: (taskId: string) => nav(`/tasks/${taskId}`),
  };

  const steps = ['분석', '검토·확정', '작업 만들기'].map((label, i) => {
    const n = i + 1;
    const done = step.allDone || n < step.step;
    const cur = !step.allDone && n === step.step;
    return { label, n, done, cur };
  });

  return (
    <div className="detail">
      <header className="d-head">
        <div className="left">
          <button type="button" className="btn-link" onClick={() => nav('/requests')}>
            ← 고객 요청
          </button>
          <span className="vsep" aria-hidden="true" />
          <h1>{r.title}</h1>
          <ReqBadge status={r.status} small />
          <span className="meta">
            {r.customerName} · {fmtDate(r.createdAt)} 등록
          </span>
        </div>
        <div
          className={`save-state${saver.state === 'error' ? ' err' : ''}`}
          title="편집한 내용은 자동으로 저장돼요. 확정과는 별개예요."
          role="status"
          aria-live="polite"
        >
          {saver.state === 'saved' && <span>✓ 편집 내용 자동 저장됨</span>}
          {saver.state === 'saving' && (
            <>
              <Spinner />
              <span>저장 중…</span>
            </>
          )}
          {saver.state === 'error' && <span>! 저장 실패</span>}
        </div>
      </header>

      <div className="stepbar">
        <ol className="steps" aria-label="진행 단계">
          {steps.map((s, idx) => (
            <li key={s.n} className={s.done ? 'done' : s.cur ? 'current' : ''} aria-current={s.cur ? 'step' : undefined}>
              <span className="dot" aria-hidden="true">
                {s.done ? '✓' : s.n}
              </span>
              {s.label}
              <span className="sr-only">{s.done ? ' (완료)' : s.cur ? ' (현재 단계)' : ''}</span>
              {idx < 2 && (
                <span className="sep" aria-hidden="true">
                  ›
                </span>
              )}
            </li>
          ))}
        </ol>
        <div className="step-msg">{step.msg}</div>
        <div className="step-actions">
          {step.link && (
            <button type="button" className="btn btn-text" onClick={step.link.onClick}>
              {step.link.label}
            </button>
          )}
          {step.primary && (
            <button type="button" className="btn btn-primary btn-lg" onClick={step.primary.onClick}>
              {step.primary.label}
            </button>
          )}
          {step.disabled && (
            <button type="button" className="btn btn-lg" disabled>
              {step.disabled.label}
            </button>
          )}
          {step.secondary && (
            <button type="button" className="btn btn-lg" onClick={step.secondary.onClick}>
              {step.secondary.label}
            </button>
          )}
        </div>
      </div>

      {saver.state === 'error' && (
        <div className="save-banner" role="alert">
          <div>
            <strong>편집 내용을 저장하지 못했어요.</strong> 입력한 내용은 이 화면에 그대로 남아 있어요.
            {saver.message && <div style={{ marginTop: 2 }}>{saver.message}</div>}
          </div>
          <button type="button" className="btn-retry" onClick={() => void saver.retry()}>
            다시 저장
          </button>
        </div>
      )}

      <div className="d-body">
        <section className="col-left" aria-label="고객 요청 원문">
          <div className="col-title">
            <div className="l">
              <h2>고객 요청 원문</h2>
              <span className="tag">고객이 말한 내용</span>
            </div>
            <button type="button" className="btn btn-sm btn-text" onClick={() => setPanel(true)}>
              요청 정보 수정
            </button>
          </div>
          <div className="raw" data-testid="raw-original">
            {segments.map((sg, i) =>
              sg.id ? (
                <span key={i}>
                  <span className={`seg-src has${hover === sg.id ? ' on' : ''}`} data-src-id={sg.id}>
                    {sg.text}
                  </span>
                  <sup aria-label={`요구사항 ${sg.num}의 근거`}>{sg.num}</sup>
                </span>
              ) : (
                <span key={i}>{sg.text}</span>
              ),
            )}
          </div>
          {reqs.some((x) => x.quote) && (
            <p className="help">밑줄과 번호는 ‘명시된 요구사항’의 근거 문장이에요. 요구사항에 마우스를 올리면 해당 문장이 강조돼요.</p>
          )}
          {d.tasks.length > 0 && (
            <div className="side-section">
              <h3>이 요청으로 만든 작업</h3>
              {d.tasks.map((t) => (
                <button key={t.id} type="button" className="task-chip" onClick={() => nav(`/tasks/${t.id}`)}>
                  <span>
                    {t.title}
                    {t.sourceChanged && <span className="lbl changed" style={{ marginLeft: 8 }}>원본 변경됨</span>}
                  </span>
                  <TaskBadge status={t.status} />
                </button>
              ))}
            </div>
          )}
          {d.confirmations.length > 0 && (
            <div className="side-section">
              <h3>확정 기록</h3>
              <div className="history">
                {d.confirmations.map((c) => (
                  <details key={c.id}>
                    <summary>
                      검토 버전 {c.analysisRev} · {fmtDate(c.confirmedAt)} 확정 · 요구사항 {c.includedCount}개
                    </summary>
                    <ul>
                      {c.items
                        .filter((i) => i.kind === 'requirement')
                        .map((i) => (
                          <li key={i.id}>• {i.content}</li>
                        ))}
                      <li style={{ color: 'var(--text-3)' }}>
                        제외: 질문 {c.excludedQuestions}개 · 미확정 사항 {c.excludedUndecided}개
                      </li>
                    </ul>
                  </details>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="col-right" aria-label="분석과 검토">
          {!showAnalysis && (
            <div className="a-card">
              <h3>아직 분석하지 않았어요</h3>
              <p>
                위의 ‘분석 항목 직접 작성하기’를 누르면 원문을 읽고 명시된 요구사항, 확인할 질문, 미확정 사항을 직접 적을 수 있어요. 적은 내용은 검토하기 전까지 확정되지 않아요.
              </p>
            </div>
          )}
          {showAnalysis && (
            <>
              <ItemSection kind="requirement" items={reqs} {...sectionProps} />
              <ItemSection kind="question" items={questions} {...sectionProps} />
              <ItemSection kind="undecided" items={unknowns} {...sectionProps} />
            </>
          )}
        </section>
      </div>

      {panel && (
        <RequestPanel
          mode="edit"
          initial={{ title: r.title, customerName: r.customerName, originalText: r.originalText }}
          hasAnalysis={hasItems}
          confirmed={confirmed}
          onClose={() => setPanel(false)}
          onSubmit={async (v) => {
            await api.updateRequest(id, { version: r.version, ...v });
            setPanel(false);
            await afterOk();
            toast('요청 정보를 저장했어요.');
          }}
        />
      )}
      {confirmOpen && (
        <ConfirmDialog
          requestId={id}
          onClose={() => setConfirmOpen(false)}
          onConfirmed={async () => {
            setConfirmOpen(false);
            await afterOk();
            toast('요구사항을 확정했어요. 작업은 아직 만들어지지 않았어요.');
          }}
        />
      )}
      {reopenOpen && <ReopenDialog onClose={() => setReopenOpen(false)} onConfirm={reopen} />}
      {taskOpen && latest && (
        <TaskModal
          request={r}
          confirmation={latest}
          requirements={reqs
            .filter((x) => selectableIds.has(x.id) && selected[x.id])
            .map((x) => ({ sourceItemId: x.id, confirmationItemId: confirmItemBySource.get(x.id)!, content: x.content }))}
          onClose={() => setTaskOpen(false)}
          onCreated={async (created, existingCount) => {
            setTaskOpen(false);
            await afterOk();
            const first = created[0]?.id;
            toast(
              created.length
                ? `작업 ${created.length}개를 만들었어요.${existingCount ? ` 이미 만든 작업 ${existingCount}개는 다시 만들지 않았어요.` : ''}`
                : `이미 만든 작업이에요. 새로 만들지 않았어요.`,
              first ? '작업 보기' : undefined,
              first ? () => nav(`/tasks/${first}`) : undefined,
            );
          }}
        />
      )}
    </div>
  );
}
