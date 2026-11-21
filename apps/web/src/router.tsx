import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router';
import { Shell } from './components/Shell.js';
import { CvsPage } from './features/cvs/CvsPage.js';
import { InboxPage } from './features/inbox/InboxPage.js';
import { type DrawerTab, JobDrawer } from './features/inbox/JobDrawer.js';
import { Placeholder } from './features/Placeholder.js';
import { PipelinePage } from './features/pipeline/PipelinePage.js';
import { RunsPage } from './features/runs/RunsPage.js';

export const NAV_ITEMS = [
  { to: '/inbox', label: 'Inbox' },
  { to: '/pipeline', label: 'Pipeline' },
  { to: '/cvs', label: 'CVs' },
  { to: '/settings', label: 'Settings' },
  { to: '/runs', label: 'Runs' },
] as const;

/** Pages that are built; the rest show a placeholder until their milestone. */
const BUILT = new Set(['/inbox', '/pipeline', '/cvs', '/runs']);

/** /job/:groupId — the detail drawer over whichever page you came from (the Inbox when linked directly). */
function JobRoute() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const state = useLocation().state as { from?: string; tab?: DrawerTab } | null;
  const from = state?.from;
  const back = from === '/pipeline' ? '/pipeline' : '/inbox';
  return (
    <>
      {back === '/pipeline' ? <PipelinePage /> : <InboxPage paused />}
      {groupId ? (
        <JobDrawer
          groupId={groupId}
          onClose={() => navigate(back)}
          initialTab={state?.tab ?? 'Overview'}
        />
      ) : null}
    </>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Navigate to="/inbox" replace />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/job/:groupId" element={<JobRoute />} />
        <Route path="/pipeline" element={<PipelinePage />} />
        <Route path="/cvs" element={<CvsPage />} />
        <Route path="/runs" element={<RunsPage />} />
        {NAV_ITEMS.filter((item) => !BUILT.has(item.to)).map((item) => (
          <Route key={item.to} path={item.to} element={<Placeholder title={item.label} />} />
        ))}
        <Route path="*" element={<Placeholder title="Not found" />} />
      </Route>
    </Routes>
  );
}
