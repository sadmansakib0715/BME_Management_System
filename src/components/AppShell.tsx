import { clsx } from 'clsx';
import { Building2, ClipboardList, Compass, FileUp, LogOut, Menu, Monitor, Moon, Settings2, Sun, Unlock, UserRound, Users, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { DEPT_PATHS } from './DeptLayout';
import { useTerm } from '@/lib/TermContext';
import { useTheme, type ThemePref } from '@/lib/theme';
import { Select } from './ui';

const DEPT = (import.meta.env.VITE_DEPT_NAME as string | undefined) ?? 'Department of BME, BUET';

function Item({ to, icon, children, end, also }: { to: string; icon: ReactNode; children: ReactNode; end?: boolean; also?: string[] }) {
  const { pathname } = useLocation();
  const extra = also?.some((p) => pathname === p);
  return (
    <NavLink to={to} end={end} aria-current={extra ? 'page' : undefined} className={({ isActive }) => clsx('flex items-center gap-2.5 h-9 px-2.5 rounded text-sm font-medium transition-colors duration-150 cursor-pointer',
      isActive || extra ? 'bg-brand text-brand-fg shadow-card' : 'text-muted hover:text-brand-ink hover:bg-brand-soft')}>
      <span className="size-4 shrink-0" aria-hidden>{icon}</span>{children}
    </NavLink>
  );
}

function ThemeSwitch() {
  const { pref, setPref } = useTheme();
  const opts: { value: ThemePref; label: string; icon: ReactNode }[] = [
    { value: 'light', label: 'Light', icon: <Sun className="size-4" /> },
    { value: 'dark', label: 'Dark', icon: <Moon className="size-4" /> },
    { value: 'system', label: 'System', icon: <Monitor className="size-4" /> },
  ];
  const idx = opts.findIndex((o) => o.value === pref);
  return (
    <div role="radiogroup" aria-label="Colour theme" className="relative grid grid-cols-3 rounded-lg border border-line bg-sunken p-0.5">
      <span aria-hidden className="absolute top-0.5 bottom-0.5 left-0.5 w-[calc((100%-0.25rem)/3)] rounded bg-surface shadow-card transition-transform duration-300 ease-[cubic-bezier(.34,1.56,.64,1)]"
        style={{ transform: `translateX(${idx * 100}%)` }} />
      {opts.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={pref === o.value} onClick={() => setPref(o.value)} title={`${o.label} theme`}
          className={clsx('relative h-8 flex items-center justify-center gap-1.5 rounded text-2xs font-medium transition-colors duration-150 cursor-pointer',
            pref === o.value ? 'text-brand-ink' : 'text-muted hover:text-ink')}>
          <span aria-hidden className={clsx('transition-transform duration-300', pref === o.value && 'rotate-[360deg]')}>{o.icon}</span>{o.label}
        </button>
      ))}
    </div>
  );
}

function Sidebar() {
  const { me, isAdmin, signOut, session, openAccess, setActingAs } = useAuth();
  const { terms, termId, setTermId, nameOf, faculty } = useTerm();
  return (
    <div className="flex flex-col h-full">
      <div className="h-1 shrink-0 bg-gradient-to-r from-hero via-wash to-mist" aria-hidden />
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <div className="size-8 rounded-lg bg-gradient-to-br from-hero to-wash text-hero-fg grid place-items-center shadow-card" aria-hidden>
            <svg viewBox="0 0 32 32" className="size-5"><path d="M6 17h5l2.5-7 5 14 2.5-7h5" stroke="currentColor" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <div className="leading-tight"><div className="text-sm font-semibold">BME Workflow</div><div className="text-2xs text-subtle">{DEPT}</div></div>
        </div>
        <label htmlFor="term-select" className="sr-only">Term</label>
        <Select id="term-select" className="mt-3 h-8" value={termId ?? ''} onChange={(e) => setTermId(e.target.value)}>
          {terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
      </div>
      <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 space-y-0.5">
        <Item to="/" end icon={<UserRound className="size-4" />}>My courses</Item>
        <Item to="/dashboard" also={DEPT_PATHS} icon={<Building2 className="size-4" />}>Department</Item>
        {isAdmin && <>
          <div className="pt-4 pb-1 px-2.5 text-2xs font-semibold uppercase tracking-wider text-subtle">Administration</div>
          <Item to="/admin/assignments" icon={<ClipboardList className="size-4" />}>Assignments</Item>
          <Item to="/admin/term" icon={<Settings2 className="size-4" />}>Term setup</Item>
          <Item to="/admin/people" icon={<Users className="size-4" />}>People & access</Item>
          <Item to="/admin/import" icon={<FileUp className="size-4" />}>Import workbook</Item>
        </>}
      </nav>
      <div className="px-3 pt-3 pb-2 space-y-2">
        <Link to="/guide" className="flex items-center gap-2 px-2.5 h-8 rounded text-2xs font-medium text-muted hover:text-ink hover:bg-sunken transition-colors duration-150">
          <Compass className="size-3.5" aria-hidden />How it works
        </Link>
        <ThemeSwitch />
      </div>
      {openAccess ? (
        <div className="border-t border-line p-3 space-y-2">
          <div className="flex items-start gap-1.5 rounded border border-warn/30 bg-warn-soft px-2 py-1.5 text-2xs text-warn">
            <Unlock className="size-3.5 shrink-0 mt-px" aria-hidden />
            <span>Open access: no sign-in, everyone can edit.</span>
          </div>
          <label htmlFor="acting-as" className="block text-2xs font-semibold uppercase tracking-wider text-subtle">Viewing as</label>
          <Select id="acting-as" className="h-8" value={me?.facultyId ?? ''} onChange={(e) => setActingAs(e.target.value || null)}>
            <option value="">Choose your name</option>
            {faculty.filter((f) => f.status !== 'former').map((f) => <option key={f.id} value={f.id}>{f.display_name}</option>)}
          </Select>
        </div>
      ) : (
      <div className="border-t border-line p-3 flex items-center gap-2">
        <div className="size-8 rounded-full bg-brand-soft grid place-items-center text-2xs font-semibold text-brand-ink" aria-hidden>
          {nameOf(me?.facultyId).replace(/^(Dr|Mr|Ms|Mrs|Prof)\.?\s+/, '').split(' ').map((p) => p[0]).slice(0, 2).join('')}
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-sm font-medium truncate">{me?.facultyId ? nameOf(me.facultyId) : session?.user.email}</div>
          <div className="text-2xs text-subtle">{{ hod: 'Head of Department', admin: 'Admin', faculty: 'Faculty' }[me?.role ?? 'faculty']}</div>
        </div>
        <button onClick={signOut} className="size-9 grid place-items-center rounded text-muted hover:text-ink hover:bg-sunken cursor-pointer" aria-label="Sign out" title="Sign out">
          <LogOut className="size-4" aria-hidden />
        </button>
      </div>
      )}
    </div>
  );
}

export function AppShell() {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:px-3 focus:py-2 focus:bg-surface focus:rounded">Skip to content</a>
      <aside className="hidden lg:block sticky top-0 h-dvh border-r border-line bg-surface bg-gradient-to-b from-brand-soft/60 via-surface to-surface"><Sidebar /></aside>
      <header className="lg:hidden sticky top-0 z-30 flex items-center gap-2 h-12 px-3 border-b border-line bg-surface/95 backdrop-blur" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <button onClick={() => setOpen(true)} className="size-10 grid place-items-center rounded hover:bg-sunken cursor-pointer" aria-label="Open menu" aria-expanded={open}><Menu className="size-5" aria-hidden /></button>
        <span className="text-sm font-semibold">BME Workflow</span>
      </header>
      {open && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-hero/50 backdrop-blur-[2px]" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85%] bg-surface bg-gradient-to-b from-brand-soft/60 via-surface to-surface border-r border-line shadow-pop">
            <button onClick={() => setOpen(false)} className="absolute right-2 top-2 size-10 grid place-items-center rounded hover:bg-sunken cursor-pointer" aria-label="Close menu"><X className="size-5" aria-hidden /></button>
            <Sidebar />
          </div>
        </div>
      )}
      <main id="main" className="min-w-0 px-4 sm:px-6 lg:px-8 py-6 max-w-[1400px]"><Outlet /></main>
    </div>
  );
}
