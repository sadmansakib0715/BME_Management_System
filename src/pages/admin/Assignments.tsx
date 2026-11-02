import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, CardHeader, Empty, ErrorNote, PageHeader, SegTabs, Select, Spinner, useToast } from '@/components/ui';
import { must, useWrite } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useTerm } from '@/lib/TermContext';
import type { ExamAssignment, Offering, SessionalGradesheet } from '@/lib/types';
import { validateAssignment } from '@/lib/workflow';

type Tab = 'exam' | 'teachers' | 'gradesheets';

export default function Assignments() {
  const { data, loading, error } = useTerm();
  const [tab, setTab] = useState<Tab>('exam');
  if (loading) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;
  return (
    <>
      <PageHeader eyebrow={data.term.name} title="Assignments" description="Who teaches each course and who holds each exam role. The database rejects rule violations, and so does this page before you save."
        actions={<SegTabs label="Assignment type" value={tab} onChange={setTab} options={[{ value: 'exam', label: 'Exam roles' }, { value: 'teachers', label: 'Teachers' }, { value: 'gradesheets', label: 'Sessional gradesheets' }]} />} />
      {tab === 'exam' && <ExamRoles />}
      {tab === 'teachers' && <Teachers />}
      {tab === 'gradesheets' && <Gradesheets />}
    </>
  );
}

function PersonSelect({ id, value, onChange, label }: { id: string; value: string | null; onChange: (v: string | null) => void; label: string }) {
  const { faculty } = useTerm();
  return <>
    <label htmlFor={id} className="sr-only">{label}</label>
    <Select id={id} className="h-8 w-36 pl-2 text-[13px]" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">Unassigned</option>{faculty.filter((f) => f.status !== 'former').map((f) => <option key={f.id} value={f.id}>{f.display_name}</option>)}
    </Select></>;
}

const ROLE_COLS: [keyof Omit<ExamAssignment, 'offering_id'>, string][] = [['qp_a', 'QP A'], ['qp_b', 'QP B'], ['mod_1', 'Moderator 1'], ['mod_2', 'Moderator 2'], ['scrutinizer', 'Scrutinizer']];

function ExamRoles() {
  const { data, courseOf, nameOf, faculty } = useTerm();
  const toast = useToast();
  const [drafts, setDrafts] = useState<Record<string, ExamAssignment>>({});
  const save = useWrite((a: ExamAssignment) => must(supabase.from('exam_assignments').upsert({ ...a, updated_at: new Date().toISOString() })));
  const theory = data!.offerings.filter((o) => courseOf(o)?.course_type === 'theory').sort((a, b) => courseOf(a)!.code.localeCompare(courseOf(b)!.code));
  const current = (o: Offering): ExamAssignment => drafts[o.id] ?? data!.exam.find((x) => x.offering_id === o.id) ?? { offering_id: o.id, qp_a: null, qp_b: null, mod_1: null, mod_2: null, scrutinizer: null };
  const count = (id: string) => theory.reduce((n, o) => n + ROLE_COLS.filter(([k]) => current(o)[k] === id).length, 0);
  const busiest = faculty.map((f) => ({ f, n: count(f.id) })).filter((x) => x.n).sort((a, b) => b.n - a.n).slice(0, 6);

  if (!theory.length) return <Card><Empty title="No theory courses this term" /></Card>;
  return (
    <div className="space-y-4">
      <Card className="overflow-hidden"><div className="overflow-x-auto"><table className="table">
        <thead><tr><th>Course</th>{ROLE_COLS.map(([, l]) => <th key={l}>{l}</th>)}<th>Rules</th><th><span className="sr-only">Save</span></th></tr></thead>
        <tbody>{theory.map((o) => {
          const a = current(o); const issues = validateAssignment(a, nameOf); const dirty = !!drafts[o.id];
          return (
            <tr key={o.id}>
              <td className="font-mono text-sm whitespace-nowrap">{courseOf(o)?.code}</td>
              {ROLE_COLS.map(([k, l]) => <td key={k} className="p-1"><PersonSelect id={`${o.id}-${k}`} label={`${l} for ${courseOf(o)?.code}`} value={a[k]} onChange={(v) => setDrafts((d) => ({ ...d, [o.id]: { ...a, [k]: v } }))} /></td>)}
              <td className="max-w-48">{issues.length ? <ul className="space-y-0.5">{issues.map((i) => <li key={i.message} className={`text-2xs ${i.level === 'error' ? 'text-bad' : 'text-warn'}`}>{i.message}</li>)}</ul> : <Badge tone="ok">OK</Badge>}</td>
              <td><Button size="sm" variant="primary" disabled={!dirty || issues.some((i) => i.level === 'error')} loading={save.isPending && save.variables?.offering_id === o.id}
                onClick={() => save.mutate(a, { onSuccess: () => { toast('ok', `${courseOf(o)?.code} roles saved`); setDrafts((d) => { const n = { ...d }; delete n[o.id]; return n; }); }, onError: (e) => toast('bad', e.message) })}>Save</Button></td>
            </tr>);
        })}</tbody>
      </table></div></Card>
      {busiest.length > 0 && <Card><CardHeader title="Exam roles per person" subtitle="Including unsaved changes." />
        <div className="flex flex-wrap gap-2 p-4">{busiest.map(({ f, n }) => <Badge key={f.id} tone={n >= 5 ? 'warn' : 'neutral'}>{f.display_name}: {n}</Badge>)}</div></Card>}
    </div>
  );
}

function Teachers() {
  const { data, courseOf, nameOf } = useTerm();
  const toast = useToast();
  const [adding, setAdding] = useState<Record<string, string>>({});
  const add = useWrite((a: { section: string; faculty: string; position: number }) => must(supabase.from('section_teachers').insert({ section_id: a.section, faculty_id: a.faculty, position: a.position })));
  const remove = useWrite((a: { section: string; faculty: string }) => must(supabase.from('section_teachers').delete().eq('section_id', a.section).eq('faculty_id', a.faculty)));
  const sections = data!.sections.map((s) => ({ s, c: courseOf(s.offering_id) })).filter((x) => x.c).sort((a, b) => a.c!.code.localeCompare(b.c!.code) || a.s.name.localeCompare(b.s.name));
  return (
    <Card className="overflow-hidden"><div className="overflow-x-auto"><table className="table">
      <thead><tr><th>Course</th><th>Section</th><th>Teachers (in order)</th><th className="min-w-72">Add</th></tr></thead>
      <tbody>{sections.map(({ s, c }) => {
        const list = data!.teachers.filter((t) => t.section_id === s.id).sort((a, b) => a.position - b.position);
        return (
          <tr key={s.id}><td className="font-mono text-sm">{c!.code}</td><td>{s.name}</td>
            <td><div className="flex flex-wrap gap-1.5">{list.map((t) => (
              <span key={t.faculty_id} className="inline-flex items-center gap-1 rounded border border-line bg-sunken pl-2 pr-0.5 py-0.5 text-2xs">
                {nameOf(t.faculty_id)}
                <button className="size-6 grid place-items-center rounded hover:bg-surface cursor-pointer" aria-label={`Remove ${nameOf(t.faculty_id)} from ${c!.code} ${s.name}`}
                  onClick={() => remove.mutate({ section: s.id, faculty: t.faculty_id }, { onError: (e) => toast('bad', e.message) })}><X className="size-3" aria-hidden /></button>
              </span>))}{!list.length && <span className="text-2xs text-warn">No teachers</span>}</div></td>
            <td><div className="flex gap-2"><PersonSelect id={`add-${s.id}`} label={`Add teacher to ${c!.code} ${s.name}`} value={adding[s.id] ?? null} onChange={(v) => setAdding((x) => ({ ...x, [s.id]: v ?? '' }))} />
              <Button size="sm" icon={<Plus className="size-4" aria-hidden />} disabled={!adding[s.id] || list.some((t) => t.faculty_id === adding[s.id])}
                onClick={() => add.mutate({ section: s.id, faculty: adding[s.id], position: list.length + 1 }, { onSuccess: () => setAdding((x) => ({ ...x, [s.id]: '' })), onError: (e) => toast('bad', e.message) })}>Add</Button></div></td>
          </tr>);
      })}</tbody>
    </table></div></Card>
  );
}

function Gradesheets() {
  const { data, courseOf } = useTerm();
  const toast = useToast();
  const [drafts, setDrafts] = useState<Record<string, Pick<SessionalGradesheet, 'preparer' | 'scrutinizer'>>>({});
  const save = useWrite((a: { offering_id: string; preparer: string | null; scrutinizer: string | null }) => must(supabase.from('sessional_gradesheets').upsert(a)));
  const list = data!.offerings.filter((o) => courseOf(o) && courseOf(o)!.course_type !== 'theory').sort((a, b) => courseOf(a)!.code.localeCompare(courseOf(b)!.code));
  if (!list.length) return <Card><Empty title="No sessional courses this term" /></Card>;
  return (
    <Card className="overflow-hidden"><div className="overflow-x-auto"><table className="table">
      <thead><tr><th>Course</th><th>Gradesheet preparer</th><th>Gradesheet scrutinizer</th><th><span className="sr-only">Save</span></th></tr></thead>
      <tbody>{list.map((o) => {
        const g = drafts[o.id] ?? data!.gradesheets.find((x) => x.offering_id === o.id) ?? { preparer: null, scrutinizer: null };
        const same = !!g.preparer && g.preparer === g.scrutinizer;
        return (
          <tr key={o.id}><td className="font-mono text-sm">{courseOf(o)?.code}</td>
            <td className="p-1.5"><PersonSelect id={`p-${o.id}`} label="Preparer" value={g.preparer} onChange={(v) => setDrafts((d) => ({ ...d, [o.id]: { ...g, preparer: v } }))} /></td>
            <td className="p-1.5"><PersonSelect id={`s-${o.id}`} label="Scrutinizer" value={g.scrutinizer} onChange={(v) => setDrafts((d) => ({ ...d, [o.id]: { ...g, scrutinizer: v } }))} />
              {same && <p className="text-2xs text-bad mt-1">Must differ from the preparer.</p>}</td>
            <td><Button size="sm" variant="primary" disabled={!drafts[o.id] || same} loading={save.isPending}
              onClick={() => save.mutate({ offering_id: o.id, preparer: g.preparer, scrutinizer: g.scrutinizer }, { onSuccess: () => { toast('ok', 'Saved'); setDrafts((d) => { const n = { ...d }; delete n[o.id]; return n; }); }, onError: (e) => toast('bad', e.message) })}>Save</Button></td>
          </tr>);
      })}</tbody>
    </table></div></Card>
  );
}
