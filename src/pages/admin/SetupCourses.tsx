import { Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { TypeBadge } from '@/components/bits';
import { Button, Card, CardHeader, Dialog, Empty, Field, Input, Select, useToast } from '@/components/ui';
import { must, useWrite } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useTerm } from '@/lib/TermContext';
import type { Course, CourseType, Offering } from '@/lib/types';

/** Which courses run this term, their cohort and sections. Adding a course here is all the import would do for it. */

const TYPES: [CourseType, string][] = [['theory', 'Theory'], ['sessional', 'Sessional'], ['design', 'Design'], ['thesis', 'Thesis'], ['attachment', 'Attachment']];
const defaultSections = (c?: Course) => (c?.course_type === 'theory' ? 'X' : 'A1, A2');
const cohortOf = (c?: Course) => (c?.level ? `L${c.level}${c.term_no ? `T${c.term_no}` : ''}` : '');

export default function SetupCourses() {
  const { data, courses, courseOf, teachersOf, nameOf } = useTerm();
  const toast = useToast();
  const err = (e: Error) => toast('bad', e.message);
  const [pick, setPick] = useState({ course: '', sections: 'X' });
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<Offering | null>(null);
  const [newSec, setNewSec] = useState<Record<string, string>>({});

  const addOffering = useWrite(async (a: { course: Course; sections: string }) => {
    const o = await must(supabase.from('offerings').insert({ term_id: data!.term.id, course_id: a.course.id, batch: cohortOf(a.course) || null }).select().single()) as { id: string };
    const names = [...new Set(a.sections.split(/[,\s]+/).filter(Boolean))];
    await must(supabase.from('sections').insert(names.map((name) => ({ offering_id: o.id, name }))));
    await must(supabase.from('course_records').insert({ offering_id: o.id }));
  });
  const removeOffering = useWrite((id: string) => must(supabase.from('offerings').delete().eq('id', id)));
  const setBatch = useWrite((a: { id: string; batch: string }) => must(supabase.from('offerings').update({ batch: a.batch || null }).eq('id', a.id)));
  const addSection = useWrite((a: { offering: string; name: string }) => must(supabase.from('sections').insert({ offering_id: a.offering, name: a.name })));
  const removeSection = useWrite((id: string) => must(supabase.from('sections').delete().eq('id', id)));

  const used = new Set(data!.offerings.map((o) => o.course_id));
  const available = courses.filter((c) => !used.has(c.id)).sort((a, b) => a.code.localeCompare(b.code));
  const rows = data!.offerings.map((o) => ({ o, c: courseOf(o)! })).filter((r) => r.c).sort((a, b) => a.c.code.localeCompare(b.c.code));

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Add a course to this term" subtitle="Pick it from the catalog. If it is not there yet, create it first." />
        <div className="p-4 flex flex-wrap items-end gap-2">
          <Field label="Course" htmlFor="add-c" className="flex-1 min-w-64">
            <Select id="add-c" value={pick.course} onChange={(e) => setPick({ course: e.target.value, sections: defaultSections(courses.find((c) => c.id === e.target.value)) })}>
              <option value="">Choose from the catalog</option>{available.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.title}</option>)}
            </Select>
          </Field>
          <Field label="Sections" htmlFor="add-s" className="w-36" hint="Comma separated"><Input id="add-s" value={pick.sections} onChange={(e) => setPick((x) => ({ ...x, sections: e.target.value }))} /></Field>
          <Button variant="primary" icon={<Plus className="size-4" aria-hidden />} disabled={!pick.course || !pick.sections.trim()} loading={addOffering.isPending}
            onClick={() => addOffering.mutate({ course: courses.find((c) => c.id === pick.course)!, sections: pick.sections },
              { onSuccess: () => { toast('ok', 'Course added. Assign its teachers in “Teachers & roles”.'); setPick({ course: '', sections: 'X' }); }, onError: err })}>Add</Button>
          <Button onClick={() => setCreating(true)}>New catalog course</Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title={`Courses this term · ${rows.length}`} subtitle="Cohort and sections can be changed at any time. Removing a section also removes its teachers and its own assessment items." />
        {rows.length === 0 ? <Empty title="No courses yet">Add them above, or import the workbook.</Empty> : (
          <div className="overflow-x-auto"><table className="table">
            <thead><tr><th>Course</th><th>Type</th><th>Cohort</th><th className="min-w-72">Sections</th><th>Teachers</th><th><span className="sr-only">Remove</span></th></tr></thead>
            <tbody>{rows.map(({ o, c }) => {
              const secs = data!.sections.filter((s) => s.offering_id === o.id).sort((a, b) => a.name.localeCompare(b.name));
              return (
                <tr key={o.id}>
                  <td><Link to={`/courses/${o.id}`} className="link font-mono text-sm">{c.code}</Link><div className="text-2xs text-muted max-w-56 truncate">{c.title}</div></td>
                  <td><TypeBadge type={c.course_type} /></td>
                  <td>
                    <label htmlFor={`b-${o.id}`} className="sr-only">Cohort for {c.code}</label>
                    <Input id={`b-${o.id}`} className="h-8 w-24" defaultValue={o.batch ?? ''} placeholder="L3T1"
                      onBlur={(e) => e.target.value !== (o.batch ?? '') && setBatch.mutate({ id: o.id, batch: e.target.value.trim() }, { onSuccess: () => toast('ok', `${c.code} cohort saved`), onError: err })} />
                  </td>
                  <td>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {secs.map((s) => (
                        <span key={s.id} className="inline-flex items-center gap-1 rounded border border-line bg-sunken pl-2 pr-0.5 py-0.5 text-2xs font-medium">
                          {s.name}
                          <button type="button" className="size-6 grid place-items-center rounded hover:bg-surface cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed" disabled={secs.length <= 1}
                            aria-label={`Remove section ${s.name} from ${c.code}`} title={secs.length <= 1 ? 'A course needs at least one section' : undefined}
                            onClick={() => confirm(`Remove section ${s.name} from ${c.code}? Its teachers and its own assessment items go with it.`) && removeSection.mutate(s.id, { onError: err })}>
                            <X className="size-3" aria-hidden /></button>
                        </span>))}
                      <form className="inline-flex gap-1" onSubmit={(e) => { e.preventDefault(); const n = (newSec[o.id] ?? '').trim(); if (!n) return;
                        addSection.mutate({ offering: o.id, name: n }, { onSuccess: () => setNewSec((x) => ({ ...x, [o.id]: '' })), onError: err }); }}>
                        <label htmlFor={`ns-${o.id}`} className="sr-only">New section for {c.code}</label>
                        <Input id={`ns-${o.id}`} className="h-8 w-20" placeholder="New" value={newSec[o.id] ?? ''} onChange={(e) => setNewSec((x) => ({ ...x, [o.id]: e.target.value }))} />
                        <Button type="submit" size="sm" variant="ghost" aria-label={`Add section to ${c.code}`} disabled={!(newSec[o.id] ?? '').trim() || secs.some((s) => s.name === (newSec[o.id] ?? '').trim())}><Plus className="size-4" aria-hidden /></Button>
                      </form>
                    </div>
                  </td>
                  <td className="text-2xs text-muted max-w-56"><span className="line-clamp-2">{teachersOf(o.id).map(nameOf).join(', ') || <Link to="/admin/term/people" className="link">Assign</Link>}</span></td>
                  <td><Button size="sm" variant="ghost" aria-label={`Remove ${c.code} from this term`} onClick={() => setRemoving(o)}><Trash2 className="size-4" aria-hidden /></Button></td>
                </tr>);
            })}</tbody>
          </table></div>
        )}
      </Card>

      <Dialog open={!!removing} onClose={() => setRemoving(null)} title={removing ? `Remove ${courseOf(removing)?.code} from this term?` : ''}
        footer={<><Button onClick={() => setRemoving(null)}>Keep it</Button><Button variant="danger" loading={removeOffering.isPending}
          onClick={() => removeOffering.mutate(removing!.id, { onSuccess: () => { toast('ok', 'Course removed from the term'); setRemoving(null); }, onError: err })}>Remove course</Button></>}>
        <p className="text-sm text-muted">This deletes the course's sections, teachers, exam roles and workflow progress, assessment plan and class-test dates, and course outcomes for this term. The course stays in the catalog and can be added again.</p>
      </Dialog>

      <NewCourseDialog open={creating} onClose={() => setCreating(false)} onCreated={(c) => setPick({ course: c.id, sections: defaultSections(c) })} />
    </div>
  );
}

function NewCourseDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (c: Course) => void }) {
  const toast = useToast();
  const blank = { code: '', title: '', course_type: 'theory' as CourseType, level: '', term_no: '', credits: '' };
  const [f, setF] = useState(blank);
  const code = f.code.trim().toUpperCase().replace(/\s+/g, ' ').replace(/^([A-Z]+)\s*(\d{3})$/, '$1 $2');
  const codeOk = /^[A-Z]+ \d{3}$/.test(code);
  const create = useWrite(async () => must(supabase.from('courses').insert({
    code, title: f.title.trim(), course_type: f.course_type, level: f.level ? Number(f.level) : null, term_no: f.term_no ? Number(f.term_no) : null, credits: f.credits ? Number(f.credits) : null,
  }).select().single()) as Promise<Course>);
  return (
    <Dialog open={open} onClose={onClose} title="New catalog course"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!codeOk || !f.title.trim()} loading={create.isPending}
        onClick={() => create.mutate(undefined, { onSuccess: (c) => { toast('ok', `${c.code} added to the catalog`); onCreated(c); setF(blank); onClose(); }, onError: (e) => toast('bad', e.message) })}>Create course</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Code" htmlFor="nc-code" hint="e.g. BME 403" error={f.code && !codeOk ? 'Letters, a space, then three digits.' : null}><Input id="nc-code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
        <Field label="Type" htmlFor="nc-type"><Select id="nc-type" value={f.course_type} onChange={(e) => setF({ ...f, course_type: e.target.value as CourseType })}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        <Field label="Title" htmlFor="nc-title" className="col-span-2"><Input id="nc-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Level" htmlFor="nc-l"><Select id="nc-l" value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })}><option value="">—</option>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>Level {n}</option>)}</Select></Field>
        <Field label="Term" htmlFor="nc-t"><Select id="nc-t" value={f.term_no} onChange={(e) => setF({ ...f, term_no: e.target.value })}><option value="">—</option><option value="1">Term 1</option><option value="2">Term 2</option></Select></Field>
        <Field label="Credits" htmlFor="nc-cr"><Input id="nc-cr" type="number" min={0} step={0.25} value={f.credits} onChange={(e) => setF({ ...f, credits: e.target.value })} /></Field>
      </div>
    </Dialog>
  );
}
