import { Minus, Pause, Play, Plus } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, CardHeader, Dialog, ErrorNote, Field, Input, PageHeader, Select, Spinner, useToast } from '@/components/ui';
import { WeekTracker } from '@/components/WeekTracker';
import { must, useWrite } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useTerm } from '@/lib/TermContext';
import type { MilestoneKind } from '@/lib/types';
import { DEFAULT_SETTINGS } from '../course/AttainmentTab';

const KINDS: [MilestoneKind, string][] = [['outline_sharing', 'Course outlines shared'], ['question_submission', 'Question papers submitted'], ['exam_start', 'Term finals begin'],
  ['theory_gradesheet', 'Theory gradesheets to HOD'], ['sessional_gradesheet', 'Sessional gradesheets'], ['feedback_deadline', 'Student feedback collected'], ['car_deadline', 'Course File and CAR']];

export default function TermSetup() {
  const { data, loading, error, courses, setTermId } = useTerm();
  const toast = useToast();
  const [newTerm, setNewTerm] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', starts_on: '', ends_on: '', total_weeks: 14 });
  const [addCourse, setAddCourse] = useState({ course: '', sections: 'X' });
  const [pause, setPause] = useState('');

  const updTerm = useWrite((patch: Record<string, unknown>) => must(supabase.from('terms').update(patch).eq('id', data!.term.id)));
  const createTerm = useWrite(async () => {
    const t = await must(supabase.from('terms').insert({ ...form, starts_on: form.starts_on || null, ends_on: form.ends_on || null }).select().single()) as { id: string };
    await must(supabase.from('attainment_settings').insert({ term_id: t.id }));
    return t.id;
  });
  const makeCurrent = useWrite(async () => {
    await must(supabase.from('terms').update({ is_current: false }).eq('is_current', true));
    await must(supabase.from('terms').update({ is_current: true }).eq('id', data!.term.id));
  });
  const setMilestone = useWrite((a: { kind: MilestoneKind; due_on: string }) => a.due_on
    ? must(supabase.from('term_milestones').upsert({ term_id: data!.term.id, offering_id: null, kind: a.kind, due_on: a.due_on }, { onConflict: 'term_id,offering_id,kind' }))
    : must(supabase.from('term_milestones').delete().eq('term_id', data!.term.id).eq('kind', a.kind).is('offering_id', null)));
  const saveSettings = useWrite((s: typeof DEFAULT_SETTINGS) => must(supabase.from('attainment_settings').upsert({ term_id: data!.term.id, ...s })));
  const addOffering = useWrite(async () => {
    const c = courses.find((x) => x.id === addCourse.course)!;
    const o = await must(supabase.from('offerings').insert({ term_id: data!.term.id, course_id: c.id, batch: c.level ? `L${c.level}${c.term_no ? `T${c.term_no}` : ''}` : null }).select().single()) as { id: string };
    const names = addCourse.sections.split(/[,\s]+/).filter(Boolean);
    await must(supabase.from('sections').insert(names.map((name) => ({ offering_id: o.id, name }))));
    await must(supabase.from('course_records').insert({ offering_id: o.id }));
  });
  const [s, setS] = useState<typeof DEFAULT_SETTINGS | null>(null);

  if (loading) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  const t = data?.term;
  const settings = s ?? (data?.settings ? { x_pct: Number(data.settings.x_pct), y_pct: Number(data.settings.y_pct), level1: Number(data.settings.level1), level2: Number(data.settings.level2), level3: Number(data.settings.level3) } : DEFAULT_SETTINGS);
  const used = new Set(data?.offerings.map((o) => o.course_id));
  const err = (e: Error) => toast('bad', e.message);

  return (
    <>
      <PageHeader eyebrow="Department" title="Term setup" description="Teaching weeks, department deadlines, attainment thresholds and which courses run this term."
        actions={<Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setNewTerm(true)}>New term</Button>} />
      {!t ? <Card className="p-6 text-sm text-muted">No term yet. Create one, or import the department workbook.</Card> : (
        <div className="grid gap-5 xl:grid-cols-2">
          <div className="xl:col-span-2"><WeekTracker term={t} /></div>
          <Card>
            <CardHeader title={t.name} subtitle={t.is_current ? 'Current term' : 'Not the current term'} actions={!t.is_current && <Button size="sm" onClick={() => makeCurrent.mutate(undefined, { onSuccess: () => toast('ok', 'Now the current term'), onError: err })}>Make current</Button>} />
            <div className="p-4 space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm">Weeks completed</span>
                <Button size="sm" aria-label="One week fewer" disabled={t.latest_completed_week <= 0} onClick={() => updTerm.mutate({ latest_completed_week: t.latest_completed_week - 1 }, { onError: err })}><Minus className="size-4" aria-hidden /></Button>
                <span className="text-lg font-semibold tabular w-16 text-center">{t.latest_completed_week} / {t.total_weeks}</span>
                <Button size="sm" aria-label="One more week completed" disabled={t.latest_completed_week >= t.total_weeks} onClick={() => updTerm.mutate({ latest_completed_week: t.latest_completed_week + 1 }, { onError: err })}><Plus className="size-4" aria-hidden /></Button>
              </div>
              {t.calendar_status === 'active' ? (
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="Pause classes" htmlFor="pause" hint="For closures; the week tracker shows the reason." className="flex-1 min-w-48"><Input id="pause" value={pause} onChange={(e) => setPause(e.target.value)} placeholder="Reason" /></Field>
                  <Button icon={<Pause className="size-4" aria-hidden />} disabled={!pause.trim()} onClick={() => updTerm.mutate({ calendar_status: 'paused', pause_reason: pause }, { onSuccess: () => setPause(''), onError: err })}>Pause</Button>
                </div>
              ) : <Button icon={<Play className="size-4" aria-hidden />} onClick={() => updTerm.mutate({ calendar_status: 'active', pause_reason: null }, { onError: err })}>Resume classes</Button>}
            </div>
          </Card>
          <Card>
            <CardHeader title="Attainment thresholds" subtitle="A CO is attained if X% of students score at least Y%." />
            <div className="p-4 grid grid-cols-2 sm:grid-cols-5 gap-3">
              {([['x_pct', 'X (% of students)'], ['y_pct', 'Y (% score)'], ['level1', 'Level 1 from'], ['level2', 'Level 2 from'], ['level3', 'Level 3 from']] as const).map(([k, l]) => (
                <Field key={k} label={l} htmlFor={k}><Input id={k} type="number" min={0} max={100} value={settings[k]} onChange={(e) => setS({ ...settings, [k]: Number(e.target.value) })} /></Field>))}
              <div className="col-span-full flex justify-end"><Button variant="primary" disabled={!s || !(settings.level1 <= settings.level2 && settings.level2 <= settings.level3)} loading={saveSettings.isPending}
                onClick={() => saveSettings.mutate(settings, { onSuccess: () => { toast('ok', 'Thresholds saved'); setS(null); }, onError: err })}>Save thresholds</Button></div>
            </div>
          </Card>
          <Card>
            <CardHeader title="Department deadlines" subtitle="Default for every course; reminders go out 7, 3 and 1 days before." />
            <ul className="divide-y divide-line">{KINDS.map(([k, l]) => (
              <li key={k} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <label htmlFor={`m-${k}`} className="text-sm">{l}</label>
                <Input id={`m-${k}`} type="date" className="w-44 h-8" defaultValue={data!.milestones.find((m) => m.kind === k && !m.offering_id)?.due_on ?? ''}
                  onBlur={(e) => { const prev = data!.milestones.find((m) => m.kind === k && !m.offering_id)?.due_on ?? '';
                    if (e.target.value !== prev) setMilestone.mutate({ kind: k, due_on: e.target.value }, { onSuccess: () => toast('ok', `${l}: saved`), onError: err }); }} />
              </li>))}</ul>
          </Card>
          <Card>
            <CardHeader title="Courses this term" subtitle={`${data!.offerings.length} offered`} />
            <div className="p-4 flex flex-wrap items-end gap-2">
              <Field label="Add a course" htmlFor="add-c" className="flex-1 min-w-56"><Select id="add-c" value={addCourse.course} onChange={(e) => setAddCourse((x) => ({ ...x, course: e.target.value, sections: courses.find((c) => c.id === e.target.value)?.course_type === 'theory' ? 'X' : 'A1, A2' }))}>
                <option value="">Choose from the catalog</option>{courses.filter((c) => !used.has(c.id) && c.code.startsWith('BME')).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.title}</option>)}</Select></Field>
              <Field label="Sections" htmlFor="add-s" className="w-32"><Input id="add-s" value={addCourse.sections} onChange={(e) => setAddCourse((x) => ({ ...x, sections: e.target.value }))} /></Field>
              <Button variant="primary" disabled={!addCourse.course || !addCourse.sections.trim()} loading={addOffering.isPending}
                onClick={() => addOffering.mutate(undefined, { onSuccess: () => { toast('ok', 'Course added. Assign teachers next.'); setAddCourse({ course: '', sections: 'X' }); }, onError: err })}>Add</Button>
            </div>
          </Card>
        </div>
      )}
      <Dialog open={newTerm} onClose={() => setNewTerm(false)} title="New term"
        footer={<><Button onClick={() => setNewTerm(false)}>Cancel</Button><Button variant="primary" disabled={!form.code.trim() || !form.name.trim()} loading={createTerm.isPending}
          onClick={() => createTerm.mutate(undefined, { onSuccess: (id) => { toast('ok', 'Term created'); setNewTerm(false); setTermId(id as string); }, onError: err })}>Create term</Button></>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code" htmlFor="t-code" hint="e.g. 2026-07"><Input id="t-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
          <Field label="Name" htmlFor="t-name" hint="e.g. July 2026"><Input id="t-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Starts" htmlFor="t-s"><Input id="t-s" type="date" value={form.starts_on} onChange={(e) => setForm({ ...form, starts_on: e.target.value })} /></Field>
          <Field label="Ends" htmlFor="t-e"><Input id="t-e" type="date" value={form.ends_on} onChange={(e) => setForm({ ...form, ends_on: e.target.value })} /></Field>
          <Field label="Teaching weeks" htmlFor="t-w"><Input id="t-w" type="number" min={1} max={30} value={form.total_weeks} onChange={(e) => setForm({ ...form, total_weeks: Number(e.target.value) })} /></Field>
        </div>
      </Dialog>
    </>
  );
}
