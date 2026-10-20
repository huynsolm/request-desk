import { useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './api.ts';
import { RequestsPage } from './pages/RequestsPage.tsx';
import { RequestDetailPage } from './pages/RequestDetailPage.tsx';
import { TasksPage } from './pages/TasksPage.tsx';

/** 데이터가 바뀌었음을 사이드바 개수 등에 알린다. */
export const notifyChanged = () => window.dispatchEvent(new Event('rd:changed'));

export function App() {
  const [counts, setCounts] = useState<{ requests: number; tasks: number } | null>(null);
  const loc = useLocation();
  useEffect(() => {
    let alive = true;
    const load = () => {
      api
        .summary()
        .then((s) => alive && setCounts(s))
        .catch(() => {});
    };
    load();
    window.addEventListener('rd:changed', load);
    return () => {
      alive = false;
      window.removeEventListener('rd:changed', load);
    };
  }, [loc.pathname]);

  return (
    <div className="app">
      <a className="skip" href="#main">
        본문으로 건너뛰기
      </a>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            R
          </div>
          <div className="brand-name">리퀘스트 데스크</div>
        </div>
        <nav className="nav" aria-label="주 메뉴">
          <NavLink to="/requests">
            <span>요청</span>
            <span className="count">{counts?.requests ?? ''}</span>
          </NavLink>
          <NavLink to="/tasks">
            <span>작업</span>
            <span className="count">{counts?.tasks ?? ''}</span>
          </NavLink>
        </nav>
      </aside>
      <main id="main" className="main" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Navigate to="/requests" replace />} />
          <Route path="/requests" element={<RequestsPage />} />
          <Route path="/requests/:id" element={<RequestDetailPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/tasks/:taskId" element={<TasksPage />} />
          <Route path="*" element={<Navigate to="/requests" replace />} />
        </Routes>
      </main>
    </div>
  );
}
