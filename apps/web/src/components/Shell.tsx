import { NavLink, Outlet } from 'react-router';
import { useStats } from '../api/queries.js';
import { formatNextScan } from '../lib/triage.js';
import { NAV_ITEMS } from '../router.js';
import { ThemeToggle } from './ThemeToggle.js';

export function Shell() {
  const stats = useStats();
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside
        className="border-b p-4 md:w-56 md:border-r md:border-b-0"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <h1 className="mb-4 text-lg font-bold">Job Scout</h1>
        <nav aria-label="Main" className="flex gap-1 md:flex-col">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `rounded-md px-3 py-2 text-sm font-medium ${isActive ? 'underline' : ''}`
              }
              style={({ isActive }) => ({ color: isActive ? 'var(--accent)' : 'var(--text)' })}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex flex-1 flex-col">
        <header
          className="flex items-center justify-between border-b px-6 py-3"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          {stats.data ? (
            <ul
              aria-label="Today"
              className="flex flex-wrap gap-x-5 gap-y-1 text-sm"
              style={{ color: 'var(--muted)' }}
            >
              <li>
                <strong style={{ color: 'var(--text)' }}>{stats.data.newToday}</strong> new today
              </li>
              <li>
                <strong style={{ color: 'var(--text)' }}>{stats.data.shortlisted}</strong>{' '}
                shortlisted
              </li>
              <li>
                <strong style={{ color: 'var(--text)' }}>{stats.data.appliedThisWeek}</strong>{' '}
                applied this week
              </li>
              <li>Next scan {formatNextScan(stats.data.nextScanAt)}</li>
              <li>AI today {stats.data.aiBudgetPercent}%</li>
            </ul>
          ) : (
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              &nbsp;
            </p>
          )}
          <ThemeToggle />
        </header>
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
