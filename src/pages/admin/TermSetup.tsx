import { clsx } from 'clsx';
import { FileSpreadsheet, Minus, Pause, Play, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { Link, NavLink, useParams } from 'react-router-dom';
import { Button, Card, CardHeader, Dialog, ErrorNote, Field, Input, PageHeader, Spinner, useToast } from '@/components/ui';
import { WeekTracker } from '@/components/WeekTracker';
import { must, useWrite } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useTerm } from '@/lib/TermContext';
import type { MilestoneKind, Term } from '@/lib/types';

/** Term setup: two equal routes. Import the workbook to fill everything at once, or build the term by hand tab by tab. */

const SetupCourses = lazy(() => import('./SetupCourses'));
const Assignments = lazy(() => import('./Assignments'));
const SetupRoutine = lazy(() => import('./SetupRoutine'));
const ImportPanel = lazy(() => import('./Import'));

const TABS = [
  { key: '', label: 'Term & dates' },
  { key: 'courses', label: 'Courses' },
  { key: 'people', label: 'Teachers & roles' },
  { key: 'routine', label: 'Class-test routine' },
  { key: 'import', label: 'Import workbook' },
];

const KINDS: [MilestoneKind, string][] = [['exam_start', 'Term finals begin'], ['outline_sharing', 'Course outlines shared'], ['question_submission', 'Question papers submitted'],
  ['theory_gradesheet', 'Theory gradesheets to HOD'], ['sessional_gradesheet', 'Sessional gradesheets'], ['feedback_deadline', 'Student feedback collected'], ['car_deadline', 'Course File and CAR']];

export default function TermSetup() {
  const { tab = '' } = useParams();
  const { data, loading, error, setTermId } = useTerm();
  const toast = useToast();
  const [newTerm, setNewTerm] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', starts_on: '', ends_on: '', total_weeks: 14 });
  const createTerm = useWrite(async () => {
    const t = await must(supabase.from('terms').insert({ ...form, starts_on: form.starts_on || null, ends_on: form.ends_on || null }).select().single()) as { id: string };
    return t.id;
  });

  if (loading) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  const t = data?.term;

  return (
    <>
      <PageHeader eyebrow={t?.name ?? 'Department'} title="Term setup"
        actions={<Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setNewTerm(true)}>New term</Button>} />

      <div className="grid gap-3 sm:grid-cols-2 mb-5">
        <Link to="/admin/term/import" className={clsx('card p-4 flex gap-3 hover:border-brand/40 transition-colors duration-150', tab === 'import' && 'border-brand/60')}>
          <span className="size-10 shrink-0 rounded-full bg-brand-soft text-brand-ink grid place-items-center" aria-hidden><FileSpreadsheet className="size-5" /></span>
          <span><span className="block text-sm font-semibold">Option 1 · Import the workbook</span>
            <span className="block text-sm text-muted mt-0.5">Upload the Activity Tracker .xlsx and everything is filled in at once. You can still adjust it by hand afterwards.</span></span>
        </Link>
        <Link to="/admin/term/courses" className={clsx('card p-4 flex gap-3 hover:border-brand/40 transition-colors duration-150', tab !== 'import' && 'border-brand/60')}>
          <span className="size-10 shrink-0 rounded-full bg-brand-soft text-brand-ink grid place-items-center" aria-hidden><SlidersHorizontal className="size-5" /></span>
          <span><span className="block text-sm font-semibold">Option 2 · Set up by hand</span>
            <span className="block text-sm text-muted mt-0.5">Term & dates → Courses → Teachers & roles → Class-test routine. Each tab saves as you go.</span></span>
        </Link>
      </div>

      <nav aria-label="Term setup" className="-mx-4 sm:mx-0 px-4 sm:px-0 mb-5 overflow-x-auto">
        <ul className="flex gap-1 border-b border-line min-w-max">
          {TABS.map((x) => (
            <li key={x.key}>
              <NavLink to={`/admin/term${x.key ? `/${x.key}` : ''}`} end className={({ isActive }) => clsx('inline-flex items-center h-10 px-3 -mb-px border-b-2 text-sm font-medium transition-colors duration-150',
                isActive ? 'border-brand text-brand-ink' : 'border-transparent text-muted hover:text-ink')}>{x.label}</NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <Suspense fallback={<Spinner />}>
        {tab === 'import' ? <ImportPanel />
          : !t ? <Card className="p-6 text-sm text-muted">No term yet. Create one with “New term”, or import the workbook.</Card>
          : tab === 'courses' ? <SetupCourses />
          : tab === 'people' ? <Assignments />
          : tab === 'routine' ? <SetupRoutine />
          : <TermDates key={t.id} term={t} />}
      </Suspense>

      <Dialog open={newTerm} onClose={() => setNewTerm(false)} title="New term"
        footer={<><Button onClick={() => setNewTerm(false)}>Cancel</Button><Button variant="primary" disabled={!form.code.trim() || !form.name.trim()} loading={createTerm.isPending}
          onClick={() => createTerm.mutate(undefined, { onSuccess: (id) => { toast('ok', 'Term created. Add its courses next.'); setNewTerm(false); setTermId(id as string); }, onError: (e) => toast('bad', e.message) })}>Create term</Button></>}>
        <TermFields form={form} setForm={setForm} prefix="n" />
      </Dialog>
    </>
  );
}

type TermForm = { code: string; name: string; starts_on: string; ends_on: string; total_weeks: number };
function TermFields({ form, setForm, prefix }: { form: TermForm; setForm: (f: TermForm) => void; prefix: string }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Code" htmlFor={`${prefix}-code`} hint="e.g. 2026-07"><Input id={`${prefix}-code`} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
      <Field label="Name" htmlFor={`${prefix}-name`} hint="e.g. July 2026"><Input id={`${prefix}-name`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <Field label="Starts" htmlFor={`${prefix}-s`}><Input id={`${prefix}-s`} type="date" value={form.starts_on} onChange={(e) => setForm({ ...form, starts_on: e.target.value })} /></Field>
      <Field label="Ends" htmlFor={`${prefix}-e`}><Input id={`${prefix}-e`} type="date" value={form.ends_on} onChange={(e) => setForm({ ...form, ends_on: e.target.value })} /></Field>
      <Field label="Teaching weeks" htmlFor={`${prefix}-w`}><Input id={`${prefix}-w`} type="number" min={1} max={30} value={form.total_weeks} onChange={(e) => setForm({ ...form, total_weeks: Number(e.target.value) })} /></Field>
    </div>
  );
}

function TermDates({ term: t }: { term: Term }) {
  const { data } = useTerm();
  const toast = useToast();
  const [pause, setPause] = useState('');
  const initial: TermForm = { code: t.code, name: t.name, starts_on: t.starts_on ?? '', ends_on: t.ends_on ?? '', total_weeks: t.total_weeks };
  const [form, setForm] = useState(initial);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const err = (e: Error) => toast('bad', e.message);

  const updTerm = useWrite((patch: Record<string, unknown>) => must(supabase.from('terms').update(patch).eq('id', t.id)));
  const makeCurrent = useWrite(async () => {
    await must(supabase.from('terms').update({ is_current: false }).eq('is_current', true));
    await must(supabase.from('terms').update({ is_current: true }).eq('id', t.id));
  });
  const setMilestone = useWrite((a: { kind: MilestoneKind; due_on: string }) => a.due_on
    ? must(supabase.from('term_milestones').upsert({ term_id: t.id, offering_id: null, kind: a.kind, due_on: a.due_on }, { onConflict: 'term_id,offering_id,kind' }))
    : must(supabase.from('term_milestones').delete().eq('term_id', t.id).eq('kind', a.kind).is('offering_id', null)));
  // Everything belonging to the term (courses, sections, roles, workflow, plans, dates, outcomes) cascades in the database.
  const deleteTerm = useWrite(() => must(supabase.from('terms').delete().eq('id', t.id)));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typed, setTyped] = useState('');

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <div className="xl:col-span-2"><WeekTracker term={t} /></div>
      <Card>
        <CardHeader title="Term details" subtitle={t.is_current ? 'This is the current term.' : 'Not the current term.'}
          actions={!t.is_current && <Button size="sm" onClick={() => makeCurrent.mutate(undefined, { onSuccess: () => toast('ok', 'Now the current term'), onError: err })}>Make current</Button>} />
        <div className="p-4 space-y-4">
          <TermFields form={form} setForm={setForm} prefix="t" />
          <div className="flex justify-end gap-2">
            {dirty && <Button onClick={() => setForm(initial)}>Undo</Button>}
            <Button variant="primary" disabled={!dirty || !form.code.trim() || !form.name.trim() || form.total_weeks < t.latest_completed_week} loading={updTerm.isPending}
              onClick={() => updTerm.mutate({ ...form, starts_on: form.starts_on || null, ends_on: form.ends_on || null }, { onSuccess: () => toast('ok', 'Term details saved'), onError: err })}>Save details</Button>
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Teaching weeks" subtitle="Move the counter on as each week finishes." />
        <div className="p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm">Weeks completed</span>
            <Button size="sm" aria-label="One week fewer" disabled={t.latest_completed_week <= 0} onClick={() => updTerm.mutate({ latest_completed_week: t.latest_completed_week - 1 }, { onError: err })}><Minus className="size-4" aria-hidden /></Button>
            <span className="text-lg font-semibold tabular w-16 text-center">{t.latest_completed_week} / {t.total_weeks}</span>
            <Button size="sm" aria-label="One more week completed" disabled={t.latest_completed_week >= t.total_weeks} onClick={() => updTerm.mutate({ latest_completed_week: t.latest_completed_week + 1 }, { onError: err })}><Plus className="size-4" aria-hidden /></Button>
          </div>
          {t.calendar_status === 'active' ? (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Pause classes" htmlFor="pause" hint="For closures; everyone sees the reason." className="flex-1 min-w-48"><Input id="pause" value={pause} onChange={(e) => setPause(e.target.value)} placeholder="Reason" /></Field>
              <Button icon={<Pause className="size-4" aria-hidden />} disabled={!pause.trim()} onClick={() => updTerm.mutate({ calendar_status: 'paused', pause_reason: pause }, { onSuccess: () => setPause(''), onError: err })}>Pause</Button>
            </div>
          ) : <Button icon={<Play className="size-4" aria-hidden />} onClick={() => updTerm.mutate({ calendar_status: 'active', pause_reason: null }, { onError: err })}>Resume classes</Button>}
        </div>
      </Card>
      <Card className="xl:col-span-2">
        <CardHeader title="Department dates" subtitle="The term-finals date appears on everyone's calendar. The others are kept for the department office." />
        <ul className="divide-y divide-line sm:grid sm:grid-cols-2 sm:divide-y-0">{KINDS.map(([k, l]) => (
          <li key={k} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 sm:border-b sm:border-line">
            <label htmlFor={`m-${k}`} className="text-sm">{l}</label>
            <Input id={`m-${k}`} type="date" className="w-44 h-8" defaultValue={data!.milestones.find((m) => m.kind === k && !m.offering_id)?.due_on ?? ''}
              onBlur={(e) => { const prev = data!.milestones.find((m) => m.kind === k && !m.offering_id)?.due_on ?? '';
                if (e.target.value !== prev) setMilestone.mutate({ kind: k, due_on: e.target.value }, { onSuccess: () => toast('ok', `${l}: saved`), onError: err }); }} />
          </li>))}</ul>
      </Card>
      <Card className="xl:col-span-2 border-bad/30">
        <div className="p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Delete this term</h2>
            <p className="text-sm text-muted mt-0.5">Removes {t.name} and everything in it: {data!.offerings.length} course{data!.offerings.length === 1 ? '' : 's'}, their sections, roles, exam workflow, plans, class-test dates and course outcomes. This cannot be undone.</p>
          </div>
          <Button variant="danger" icon={<Trash2 className="size-4" aria-hidden />} onClick={() => { setTyped(''); setConfirmDelete(true); }}>Delete term</Button>
        </div>
      </Card>
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title={`Delete ${t.name}?`}
        footer={<><Button onClick={() => setConfirmDelete(false)}>Keep the term</Button><Button variant="danger" disabled={typed.trim() !== t.code} loading={deleteTerm.isPending}
          onClick={() => deleteTerm.mutate(undefined, { onSuccess: () => { toast('ok', `${t.name} deleted`); setConfirmDelete(false); }, onError: err })}>Delete permanently</Button></>}>
        <p className="text-sm text-muted">All {data!.offerings.length} course{data!.offerings.length === 1 ? '' : 's'} of this term and their workflow, plans, dates and outcomes will be deleted. The course catalog and faculty list are not affected.{t.is_current ? ' This is the current term; make another term current afterwards.' : ''}</p>
        <Field label={<>Type <span className="font-mono font-semibold">{t.code}</span> to confirm</>} htmlFor="del-code">
          <Input id="del-code" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </Field>
      </Dialog>
    </div>
  );
}
