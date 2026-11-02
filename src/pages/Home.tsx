import { CalendarClock, CheckCircle2 } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { TaskRow, TypeBadge } from '@/components/bits';
import { Card, CardHeader, Empty, ErrorNote, PageHeader, Spinner, Stat } from '@/components/ui';
import { WeekTracker } from '@/components/WeekTracker';
import { daysUntil, fmtDateLong } from '@/lib/format';
import { buildTasks, type Bucket } from '@/lib/tasks';
import { useTerm } from '@/lib/TermContext';
import { examProgress } from '@/lib/workflow';

const GROUPS: { key: Bucket; title: string; subtitle: string }[] = [
  { key: 'overdue', title: 'Needs attention', subtitle: 'Overdue or returned to you' },
  { key: 'soon', title: 'Due this week', subtitle: 'Next 7 days' },
  { key: 'later', title: 'Coming up', subtitle: 'Later this term' },
  { key: 'waiting', title: 'Waiting on others', subtitle: 'Unlocks when someone else finishes' },
];

export default function Home() {
  const { me, isAdmin } = useAuth();
  const { data, loading, error, courseOf, nameOf, teachersOf } = useTerm();
  const tasks = useMemo(() => (data && me?.facultyId ? buildTasks(data, me.facultyId, courseOf, nameOf, isAdmin) : []), [data, me, courseOf, nameOf, isAdmin]);
  if (loading) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Empty title="No term set up yet">Create a term in Term setup, or import the department workbook.</Empty>;
  if (!me?.facultyId) return (
    <>
      <PageHeader eyebrow={data.term.name} title="My work" description="Your tasks across exams, class tests, marks and gradesheets." />
      <div className="mb-5"><WeekTracker term={data.term} /></div>
      <Card><Empty title="Choose your name to see your tasks">Pick yourself under “Viewing as” at the bottom of the sidebar. Everything else in the system is available without it.</Empty></Card>
    </>
  );

  const my = data.offerings.filter((o) => me?.facultyId && teachersOf(o.id).includes(me.facultyId));
  const myItems = data.items.filter((i) => my.some((o) => o.id === i.offering_id) && i.held_on && (daysUntil(i.held_on) ?? -1) >= 0 && (daysUntil(i.held_on) ?? 99) <= 7 && i.status !== 'cancelled')
    .sort((a, b) => a.held_on!.localeCompare(b.held_on!));
  const count = (b: Bucket) => tasks.filter((t) => t.bucket === b).length;
  const first = nameOf(me?.facultyId ?? null).replace(/^(Dr|Mr|Ms|Mrs|Prof)\.?\s+/, '').split(' ')[0];

  return (
    <>
      <PageHeader eyebrow={data.term.name} title={`Hello, ${first}`} description="Everything assigned to you this term, ordered by what needs you first." />
      <div className="grid gap-3 mb-5"><WeekTracker term={data.term} /></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Stat label="Needs attention" value={count('overdue')} tone={count('overdue') ? 'bad' : undefined} />
        <Stat label="Due this week" value={count('soon')} tone={count('soon') ? 'warn' : undefined} />
        <Stat label="Waiting on others" value={count('waiting')} />
        <Stat label="My courses" value={my.length} sub={`${data.offerings.length} in the department`} />
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_360px] [&>*]:min-w-0">
        <div className="space-y-5 min-w-0">
          {tasks.length === 0 && <Card><Empty icon={<CheckCircle2 className="size-6" />} title="Nothing assigned to you right now">New tasks appear here as soon as they are assigned or unlocked.</Empty></Card>}
          {GROUPS.map((g) => {
            const list = tasks.filter((t) => t.bucket === g.key);
            if (!list.length) return null;
            return (
              <Card key={g.key}>
                <CardHeader title={`${g.title} · ${list.length}`} subtitle={g.subtitle} />
                <ul className="divide-y divide-line">{list.map((t) => <TaskRow key={t.id} t={t} />)}</ul>
              </Card>
            );
          })}
        </div>
        <div className="space-y-5 min-w-0">
          <Card>
            <CardHeader title="This week in my courses" subtitle="Class tests and assessments" />
            {myItems.length ? (
              <ul className="divide-y divide-line">{myItems.map((i) => (
                <li key={i.id} className="px-4 py-2.5 flex items-center gap-3">
                  <CalendarClock className="size-4 text-subtle shrink-0" aria-hidden />
                  <div className="min-w-0 flex-1"><div className="text-sm font-medium truncate">{courseOf(i.offering_id)?.code} · {i.title}</div>
                    <div className="text-2xs text-subtle">{fmtDateLong(i.held_on)}{i.held_time ? ` · ${i.held_time}` : ''}</div></div>
                </li>))}</ul>
            ) : <p className="px-4 py-6 text-sm text-muted">No assessments in the next 7 days.</p>}
          </Card>
          <Card>
            <CardHeader title="My courses" />
            {my.length ? <ul className="divide-y divide-line">{my.map((o) => {
              const c = courseOf(o)!; const p = examProgress(data.tasks.filter((t) => t.offering_id === o.id));
              const hasExam = data.exam.some((x) => x.offering_id === o.id);
              return (
                <li key={o.id}><Link to={`/courses/${o.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-sunken/60 cursor-pointer transition-colors duration-150">
                  <span className="font-mono text-2xs text-muted w-16">{c.code}</span>
                  <span className="min-w-0 flex-1 text-sm truncate">{c.title}</span>
                  {hasExam ? <span className="text-2xs text-subtle tabular">{p.done}/{p.total}</span> : <TypeBadge type={c.course_type} />}
                </Link></li>);
            })}</ul> : <p className="px-4 py-6 text-sm text-muted">You are not teaching a course this term.</p>}
          </Card>
        </div>
      </div>
    </>
  );
}
