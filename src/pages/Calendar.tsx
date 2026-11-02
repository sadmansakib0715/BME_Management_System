import { clsx } from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { Button, Card, ErrorNote, PageHeader, SegTabs, Select, Spinner } from '@/components/ui';
import { fmtDateLong, todayISO } from '@/lib/format';
import { useTerm } from '@/lib/TermContext';

interface Ev { date: string; label: string; sub: string; href: string; kind: 'ct' | 'assess' | 'deadline' }

export default function Calendar() {
  const { me } = useAuth();
  const { data, loading, error, courseOf, teachersOf } = useTerm();
  const [scope, setScope] = useState<'all' | 'mine'>('all');
  const [cohort, setCohort] = useState('');
  const [month, setMonth] = useState(() => todayISO().slice(0, 7));

  const events = useMemo<Ev[]>(() => {
    if (!data) return [];
    const out: Ev[] = [];
    for (const i of data.items) {
      if (!i.held_on || i.status === 'cancelled') continue;
      const o = data.offerings.find((x) => x.id === i.offering_id)!;
      if (scope === 'mine' && !teachersOf(o.id).includes(me?.facultyId ?? '')) continue;
      if (cohort && o.batch !== cohort) continue;
      const isCt = data.components.find((c) => c.id === i.component_id)?.kind === 'class_test';
      out.push({ date: i.held_on, label: `${courseOf(o)?.code} ${i.title}`, sub: [o.batch, i.held_time].filter(Boolean).join(' · '), href: `/courses/${o.id}/assessments`, kind: isCt ? 'ct' : 'assess' });
    }
    for (const m of data.milestones.filter((x) => !x.offering_id && x.kind === 'exam_start')) out.push({ date: m.due_on, label: 'Term final exams begin', sub: 'Department', href: '/calendar', kind: 'deadline' });
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
  }, [data, scope, cohort, me, courseOf, teachersOf]);

  if (loading) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;
  const cohorts = [...new Set(data.offerings.map((o) => o.batch).filter(Boolean))].sort() as string[];

  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() + 1) % 7; // weeks start on Saturday, as at BUET
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = Array.from({ length: Math.ceil((lead + days) / 7) * 7 }, (_, i) => {
    const d = i - lead + 1;
    return d >= 1 && d <= days ? `${month}-${String(d).padStart(2, '0')}` : null;
  });
  const shift = (n: number) => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); setMonth(d.toISOString().slice(0, 7)); };
  const today = todayISO();
  const inMonth = events.filter((e) => e.date.startsWith(month));
  const dot = { ct: 'bg-brand', assess: 'bg-wash', deadline: 'bg-info' };

  return (
    <>
      <PageHeader eyebrow={data.term.name} title="Calendar" description="Class tests, sessional assessments and term finals across the department. Weeks start on Saturday." />
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft className="size-4" aria-hidden /></Button>
          <h2 className="text-base font-semibold w-36 text-center" aria-live="polite">{first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</h2>
          <Button size="sm" variant="ghost" aria-label="Next month" onClick={() => shift(1)}><ChevronRight className="size-4" aria-hidden /></Button>
          <Button size="sm" onClick={() => setMonth(today.slice(0, 7))}>Today</Button>
        </div>
        <SegTabs label="Whose events" value={scope} onChange={setScope} options={[{ value: 'all', label: 'Department' }, { value: 'mine', label: 'My courses' }]} />
        <label htmlFor="cohort" className="sr-only">Cohort</label>
        <Select id="cohort" className="w-40 h-8" value={cohort} onChange={(e) => setCohort(e.target.value)}><option value="">All cohorts</option>{cohorts.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
        <div className="flex items-center gap-3 text-2xs text-muted ml-auto">
          <span className="flex items-center gap-1"><span className={`size-2 rounded-full ${dot.ct}`} />Class test</span>
          <span className="flex items-center gap-1"><span className={`size-2 rounded-full ${dot.assess}`} />Sessional</span>
          <span className="flex items-center gap-1"><span className={`size-2 rounded-full ${dot.deadline}`} />Term finals</span>
        </div>
      </div>
      <Card className="hidden md:block overflow-hidden">
        <div className="grid grid-cols-7 text-2xs font-semibold uppercase tracking-wide text-subtle bg-sunken/60 border-b border-line">
          {['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d) => <div key={d} className="px-2 py-2">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            const list = d ? events.filter((e) => e.date === d) : [];
            return (
              <div key={i} className={clsx('min-h-28 border-b border-r border-line p-1.5', !d && 'bg-sunken/40', (i + 1) % 7 === 0 && 'border-r-0')}>
                {d && <div className={clsx('text-2xs tabular mb-1 w-6 h-6 grid place-items-center rounded-full', d === today ? 'bg-brand text-brand-fg font-semibold' : 'text-muted')}>{Number(d.slice(8))}</div>}
                <ul className="space-y-0.5">{list.slice(0, 4).map((e, j) => (
                  <li key={j}><Link to={e.href} title={`${e.label} · ${e.sub}`} className="flex items-center gap-1 rounded px-1 py-0.5 text-2xs hover:bg-sunken cursor-pointer">
                    <span className={`size-1.5 rounded-full shrink-0 ${dot[e.kind]}`} aria-hidden /><span className="truncate">{e.label}</span></Link></li>))}
                  {list.length > 4 && <li className="text-2xs text-subtle px-1">+{list.length - 4} more</li>}
                </ul>
              </div>);
          })}
        </div>
      </Card>
      <Card className="md:hidden">
        {inMonth.length ? <ul className="divide-y divide-line">{inMonth.map((e, i) => (
          <li key={i}><Link to={e.href} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer">
            <span className={`size-2 rounded-full ${dot[e.kind]}`} aria-hidden />
            <span className="flex-1 min-w-0"><span className="block text-sm font-medium truncate">{e.label}</span><span className="block text-2xs text-subtle">{fmtDateLong(e.date)} · {e.sub}</span></span>
          </Link></li>))}</ul> : <p className="px-4 py-6 text-sm text-muted">Nothing scheduled this month.</p>}
      </Card>
    </>
  );
}
