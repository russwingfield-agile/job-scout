import { Navigate, Route, Routes } from 'react-router';
import { Shell } from './components/Shell.js';
import { CvsPage } from './features/cvs/CvsPage.js';
import { Placeholder } from './features/Placeholder.js';
import { RunsPage } from './features/runs/RunsPage.js';

export const NAV_ITEMS = [
  { to: '/inbox', label: 'Inbox' },
  { to: '/pipeline', label: 'Pipeline' },
  { to: '/cvs', label: 'CVs' },
  { to: '/settings', label: 'Settings' },
  { to: '/runs', label: 'Runs' },
] as const;

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Navigate to="/inbox" replace />} />
        <Route path="/cvs" element={<CvsPage />} />
        <Route path="/runs" element={<RunsPage />} />
        {NAV_ITEMS.filter((item) => item.to !== '/cvs' && item.to !== '/runs').map((item) => (
          <Route key={item.to} path={item.to} element={<Placeholder title={item.label} />} />
        ))}
        <Route path="*" element={<Placeholder title="Not found" />} />
      </Route>
    </Routes>
  );
}
