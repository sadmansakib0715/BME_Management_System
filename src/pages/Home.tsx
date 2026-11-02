import { clsx } from 'clsx';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { TypeBadge } from '@/components/bits';
import TermTree from '@/components/TermTree';
import { Button, Card, CardHeader, Empty, ErrorNote, Meter, PageHeader, SegTabs, Spinner } from '@/components/ui';
import type { TermData } from '@/lib/api';
import { fmtDate, todayISO } from '@/lib/format';
import { useTerm } from '@/lib/TermContext';
import type { Course, ExamAssignment, Offering } from '@/lib/types';
import { blockers, EXAM_STEPS, examProgress, marksPublished, marksUnderEvaluation, stepDef, stepOwner, stepState } from '@/lib/workflow';

/** Start page: my courses and how each is going, then my calendar of class tests and exams. No deadlines or delay counts by design. */

type Kind = 'ct' | 'exam' | 'assess';
interface Ev { date: string; time: string | null; code: string; title: string; kind: Kind; href: string }
const KIND: Record<Kind, { label: string; dot: string }> = {
  ct: { label: 'Class test', dot: 'bg-brand' },
  exam: { label: 'Exam', dot: 'bg-info' },
  assess: { label: 'Assessment', dot: 'bg-wash' },
};
const ROLE: Partial<Record<keyof ExamAssignment, string>> = { qp_a: 'Question setter A', qp_b: 'Question setter B', mod_1: 'Moderator 1', mod_2: 'Moderator 2', scrutinizer: 'Scrutinizer' };

export default function Home() {
  const { me } = useAuth();
  const { data, loading, error, courseOf, nameOf, teachersOf } = useTerm();
  const fid = me?.facultyId ?? null;
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'tree' ? 'tree' : 'cards';

  const mine = useMemo(() => {
    if (!data || !fid) return [];
    return data.offerings.map((o) => {
      const c = courseOf(o);
      const a = data.exam.find((x) => x.offering_id === o.id);
      const teaches = teachersOf(o.id).includes(fid);
      const examRoles = a ? (Object.keys(ROLE) as (keyof ExamAssignment)[]).filter((k) => a[k] === fid) : [];
      const g = data.gradesheets.find((x) => x.offering_id === o.id);
      const gsRole = g?.preparer === fid ? 'Gradesheet preparer' : g?.scrutinizer === fid ? 'Gradesheet scrutinizer' : null;
      return { o, c, a, teaches, examRoles, gsRole };
    }).filter((x): x is typeof x & { c: Course } => !!x.c && (x.teaches || x.examRoles.length > 0 || !!x.gsRole))
      .sort((x, y) => Number(y.teaches) - Number(x.teaches) || x.c.code.localeCompare(y.c.code));
  }, [data, fid, courseOf, teachersOf]);

  const events = useMemo<Ev[]>(() => {
    if (!data) return [];
    const out: Ev[] = [];
    for (const { o, c, teaches } of mine) {
      if (!teaches) continue;
      for (const i of data.items) {
        if (i.offering_id !== o.id || !i.held_on || i.status === 'cancelled') continue;
        const k = data.components.find((x) => x.id === i.component_id)?.kind;
        out.push({ date: i.held_on, time: i.held_time, code: c.code, title: i.title, kind: k === 'class_test' ? 'ct' : k === 'term_final' ? 'exam' : 'assess', href: `/courses/${o.id}/assessments` });
      }
      const start = examStart(data, o);
      if (start && c.course_type === 'theory') out.push({ date: start, time: null, code: c.code, title: 'Term final exams begin', kind: 'exam', href: `/courses/${o.id}/exam` });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''));
  }, [data, mine]);

  if (loading) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Empty title="No term set up yet">Create a term in Term setup, or import the department workbook.</Empty>;

  const t = data.term;
  const week = t.calendar_status === 'paused' ? 'Classes paused' : t.latest_completed_week >= t.total_weeks ? 'Teaching weeks complete' : `Week ${t.latest_completed_week + 1} of ${t.total_weeks}`;
  if (!fid) return (
    <>
      <PageHeader eyebrow={`${t.name} · ${week}`} title="My courses" />
      <Card><Empty title="Choose your name to see your courses">Pick yourself under “Viewing as” at the bottom of the sidebar.</Empty></Card>
    </>
  );
  const first = nameOf(fid).replace(/^(Dr|Mr|Ms|Mrs|Prof)\.?\s+/, '').split(' ')[0];

  return (
    <>
      <PageHeader eyebrow={`${t.name} · ${week}`} title={`Hello, ${first}`}
        actions={<Link to="/dashboard" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-ink hover:underline underline-offset-2">Department overview<ArrowRight className="size-4" aria-hidden /></Link>} />
      <div className={clsx('grid gap-6 [&>*]:min-w-0', view === 'cards' && 'xl:grid-cols-[1fr_380px]')}>
        <section aria-labelledby="my-courses">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 id="my-courses" className="text-base font-semibold">My courses</h2>
            {mine.length > 0 && <SegTabs label="Show my courses as" value={view} onChange={(v) => setParams(v === 'tree' ? { view: 'tree' } : {})}
              options={[{ value: 'cards', label: 'Cards' }, { value: 'tree', label: 'Tree view' }]} />}
          </div>
          {mine.length && view === 'tree' ? (
            <TermTree data={data} offerings={mine.map((m) => m.o)} label="My courses" hint={nameOf(fid)} />
          ) : mine.length ? (
            <ul className="grid gap-3 md:grid-cols-2">
              {mine.map((m) => <li key={m.o.id}><CourseCard data={data} me={fid} {...m} /></li>)}
            </ul>
          ) : <Card><Empty title="No courses this term">Courses you teach or examine will appear here.</Empty></Card>}
        </section>
        {view === 'cards' && <section aria-labelledby="my-cal">
          <h2 id="my-cal" className="text-base font-semibold mb-3">My calendar</h2>
          <MyCalendar events={events} />
        </section>}
      </div>
    </>
  );
}

function examStart(d: TermData, o: Offering) {
  return (d.milestones.find((m) => m.kind === 'exam_start' && m.offering_id === o.id) ?? d.milestones.find((m) => m.kind === 'exam_start' && !m.offering_id))?.due_on ?? null;
}

function CourseCard({ data, me, o, c, a, teaches, examRoles, gsRole }: {
  data: TermData; me: string; o: Offering; c: Course; a: ExamAssignment | undefined; teaches: boolean; examRoles: (keyof ExamAssignment)[]; gsRole: string | null;
}) {
  const tasks = data.tasks.filter((t) => t.offering_id === o.id);
  const p = a ? examProgress(tasks) : null;
  const items = data.items.filter((i) => i.offering_id === o.id && i.status !== 'cancelled');
  const held = items.filter((i) => i.status === 'held').length;
  const pub = items.filter((i) => marksPublished(i.marks_status)).length;
  const evaluating = items.filter((i) => marksUnderEvaluation(i.marks_status)).length;
  const today = todayISO();
  const next = items.filter((i) => i.held_on && i.held_on >= today && i.status !== 'held').sort((x, y) => x.held_on!.localeCompare(y.held_on!))[0];
  const roles = [teaches && 'Teacher', ...examRoles.map((k) => ROLE[k]), gsRole].filter(Boolean) as string[];

  // My exam step, described plainly: what it is and whether it is open yet.
  const myStep = a && EXAM_STEPS.find((d) => stepOwner(a, d.key) === me && stepState(tasks, d.key) !== 'done');
  const part = !a || !examRoles.length ? null : !myStep ? 'Your exam steps are complete'
    : stepState(tasks, myStep.key) === 'locked' ? `${myStep.label} · opens after ${blockers(tasks, myStep.key).map((k) => stepDef(k).short).join(', ')}`
    : `${myStep.label} · ${stepState(tasks, myStep.key) === 'active' ? 'in progress' : 'ready for you'}`;

  return (
    <Link to={`/courses/${o.id}${!teaches && a ? '/exam' : ''}`} className="group card p-4 flex flex-col gap-3 h-full hover:border-brand/40 hover:shadow-pop transition-shadow duration-200">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-2xs text-subtle">{c.code}{o.batch ? ` · ${o.batch}` : ''}</div>
          <div className="text-sm font-semibold leading-snug line-clamp-2">{c.title}</div>
        </div>
        <TypeBadge type={c.course_type} />
      </div>
      <div className="flex flex-wrap gap-1">{roles.map((r) => <span key={r} className="text-2xs font-medium rounded px-1.5 py-0.5 bg-sunken text-muted">{r}</span>)}</div>
      <div className="space-y-2.5">
        {p && (
          <div>
            <div className="flex justify-between text-2xs text-muted mb-1"><span>Term final{p.current ? ` · now at ${p.current.short}` : ' · complete'}</span><span className="tabular">{p.done}/{p.total}</span></div>
            <Meter value={p.done} max={p.total} label={`${c.code} term-final progress`} />
          </div>
        )}
        {teaches && items.length > 0 && (
          <div>
            <div className="flex justify-between text-2xs text-muted mb-1"><span>Class tests & assessments held</span><span className="tabular">{held}/{items.length}</span></div>
            <Meter value={held} max={items.length} label={`${c.code} assessments held`} />
            <p className="text-2xs text-muted mt-1.5"><span className="text-subtle">Marks: </span>{pub} published{evaluating ? `, ${evaluating} under evaluation` : ''}</p>
          </div>
        )}
        {teaches && !items.length && <p className="text-2xs text-subtle">No assessment plan yet</p>}
        {part && <p className="text-2xs text-ink"><span className="text-subtle">Your part: </span>{part}</p>}
        {teaches && next && <p className="text-2xs text-ink"><span className="text-subtle">Next: </span>{next.title} · {fmtDate(next.held_on, { weekday: 'short', day: 'numeric', month: 'short' })}</p>}
      </div>
    </Link>
  );
}

function MyCalendar({ events }: { events: Ev[] }) {
  const today = todayISO();
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() + 1) % 7; // weeks start on Saturday, as at BUET
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = Array.from({ length: Math.ceil((lead + days) / 7) * 7 }, (_, i) => {
    const d = i - lead + 1;
    return d >= 1 && d <= days ? `${month}-${String(d).padStart(2, '0')}` : null;
  });
  const shift = (n: number) => setMonth(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7));
  const upcoming = events.filter((e) => e.date >= today).slice(0, 6);

  return (
    <Card>
      <div className="flex items-center justify-between px-3 pt-3">
        <Button size="sm" variant="ghost" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft className="size-4" aria-hidden /></Button>
        <button type="button" onClick={() => setMonth(today.slice(0, 7))} className="text-sm font-semibold rounded px-2 h-8 hover:bg-sunken cursor-pointer" aria-live="polite" title="Back to this month">
          {first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
        </button>
        <Button size="sm" variant="ghost" aria-label="Next month" onClick={() => shift(1)}><ChevronRight className="size-4" aria-hidden /></Button>
      </div>
      <div className="grid grid-cols-7 px-3 pt-2 text-center text-2xs font-semibold text-subtle" aria-hidden>
        {['Sa', 'Su', 'Mo', 'Tu', 'We', 'Th', 'Fr'].map((d) => <div key={d} className="py-1">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-0.5 px-3 pb-3">
        {cells.map((d, i) => {
          const list = d ? events.filter((e) => e.date === d) : [];
          const label = d ? `${fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' })}${list.length ? `: ${list.map((e) => `${e.code} ${e.title}`).join(', ')}` : ''}` : undefined;
          return (
            <div key={i} title={label} className={clsx('h-11 rounded flex flex-col items-center justify-center gap-0.5 text-2xs tabular',
              !d && 'invisible', d === today ? 'bg-brand text-brand-fg font-semibold' : list.length ? 'bg-sunken text-ink font-medium' : 'text-muted')}>
              {d && Number(d.slice(8))}
              {list.length > 0 && <span className="sr-only">{label}</span>}
              {list.length > 0 && <span className="flex gap-0.5" aria-hidden>{[...new Set(list.map((e) => e.kind))].map((k) =>
                <span key={k} className={clsx('size-1.5 rounded-full', d === today ? 'bg-brand-fg' : KIND[k].dot)} />)}</span>}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3 px-4 pb-3 text-2xs text-muted">
        {(Object.keys(KIND) as Kind[]).map((k) => <span key={k} className="flex items-center gap-1"><span className={clsx('size-2 rounded-full', KIND[k].dot)} aria-hidden />{KIND[k].label}</span>)}
      </div>
      <CardHeader title="Coming up" />
      {upcoming.length ? (
        <ul className="divide-y divide-line">{upcoming.map((e, i) => (
          <li key={i}><Link to={e.href} className="flex items-center gap-3 px-4 py-2.5 hover:bg-sunken/60 transition-colors duration-150">
            <span className="w-11 shrink-0 text-center leading-tight">
              <span className="block text-2xs uppercase text-subtle">{fmtDate(e.date, { month: 'short' })}</span>
              <span className="block text-base font-semibold tabular">{Number(e.date.slice(8))}</span>
            </span>
            <span className={clsx('size-2 rounded-full shrink-0', KIND[e.kind].dot)} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium truncate">{e.code} · {e.title}</span>
              <span className="block text-2xs text-subtle">{KIND[e.kind].label}{e.time ? ` · ${e.time}` : ''}</span>
            </span>
          </Link></li>))}
        </ul>
      ) : <p className="px-4 py-5 text-sm text-muted">No class tests or exams scheduled yet.</p>}
    </Card>
  );
}
