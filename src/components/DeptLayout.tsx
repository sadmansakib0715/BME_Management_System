import { clsx } from 'clsx';
import { NavLink, Outlet } from 'react-router-dom';

/** The department area: one place for the overview, every course and the shared calendar. OBE has its own sidebar entry. */
export const DEPT_PATHS = ['/dashboard', '/courses', '/calendar', '/tree'];
const TABS = [
  { to: '/dashboard', label: 'Overview' },
  { to: '/courses', label: 'All courses' },
  { to: '/calendar', label: 'Calendar' },
  { to: '/tree', label: 'Progress tree' },
];

export function DeptLayout() {
  return (
    <>
      <nav aria-label="Department" className="-mx-4 sm:mx-0 px-4 sm:px-0 mb-5 overflow-x-auto">
        <ul className="flex gap-1 border-b border-line min-w-max">
          {TABS.map((t) => (
            <li key={t.to}>
              <NavLink to={t.to} end={false} className={({ isActive }) => clsx('inline-flex items-center h-10 px-3 -mb-px border-b-2 text-sm font-medium transition-colors duration-150 cursor-pointer',
                isActive ? 'border-brand text-brand-ink' : 'border-transparent text-muted hover:text-ink')}>{t.label}</NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Outlet />
    </>
  );
}
