import { Navigate, Route, Routes } from 'react-router';
import { Shell } from './components/Shell.js';
import { CvsPage } from './features/cvs/CvsPage.js';
import { ShortlistPage } from './features/inbox/ShortlistPage.js';
import { Placeholder } from './features/Placeholder.js';
import { RunsPage } from './features/runs/RunsPage.js';

export const NAV_ITEMS = [
  { to: '/inbox', label: 'Shortlist' },
  { to: '/pipeline', label: 'Pipeline' },
  { to: '/cvs', label: 'CVs' },
  { to: '/settings', label: 'Settings' },
  { to: '/runs', label: 'Runs' },
] as const;

/** Pages that are built; the rest show a placeholder until their milestone. */
const BUILT = new Set(['/inbox', '/cvs', '/runs']);

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Navigate to="/inbox" replace />} />
        <Route path="/inbox" element={<ShortlistPage />} />
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
