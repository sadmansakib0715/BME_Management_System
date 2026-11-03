import { CalendarDays, History, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { Badge, Button, Callout, Card, CardHeader, Dialog, Empty, Field, Input, Select, SegTabs, StatusSelect, Textarea, useToast } from '@/components/ui';
import { must, rpc, useItemHistory, useWrite } from '@/lib/api';
import { fmtDate, fmtDateLong } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { useTerm } from '@/lib/TermContext';
import type { AssessmentComponent, AssessmentItem, ComponentKind, Course } from '@/lib/types';
import { COMPONENT_KINDS, ITEM_STATUS, labelOf, MARKS_LEGACY, MARKS_STATE } from '@/lib/workflow';
import type { TabProps } from './shared';

export type Draft = Omit<AssessmentComponent, 'id' | 'offering_id' | 'sort'> & { id?: string };

/** A blank component, as the Add component button starts it. */
export const newComponentDraft = (course: Course): Draft =>
  ({ kind: 'other', name: '', item_count: 1, marks_each: 10, weight: 0, best_n: null, per_section: course.course_type !== 'theory' });

/** Saves a component and regenerates its items. Shared by this tab and the progress tree. Theory components are always whole-course. */
export function useSaveComponent(offeringId: string, componentCount: number, isTheory: boolean) {
  return useWrite(async (d: Draft) => {
    const row = { offering_id: offeringId, kind: d.kind, name: d.name.trim(), item_count: d.item_count, marks_each: d.marks_each, weight: d.weight,
      best_n: d.best_n || null, per_section: d.per_section && !isTheory, sort: d.id ? undefined : componentCount + 1 };
    const saved = d.id ? await must(supabase.from('assessment_components').update(row).eq('id', d.id).select().single())
      : await must(supabase.from('assessment_components').insert(row).select().single());
    await rpc.generateItems((saved as AssessmentComponent).id);
  });
}

const THEORY_DEFAULTS: Draft[] = [
  { kind: 'attendance', name: 'Attendance', item_count: 1, marks_each: 30, weight: 10, best_n: null, per_section: false },
  { kind: 'class_test', name: 'Class Test', item_count: 4, marks_each: 20, weight: 20, best_n: 3, per_section: false },
  { kind: 'term_final', name: 'Term Final', item_count: 1, marks_each: 210, weight: 70, best_n: null, per_section: false },
];

export default function AssessmentsTab({ offering, course, data }: TabProps) {
  const { me, isAdmin } = useAuth();
  const { teachersOf, nameOf } = useTerm();
  const toast = useToast();
  const canEdit = isAdmin || teachersOf(offering.id).includes(me?.facultyId ?? '');
  const comps = data.components.filter((c) => c.offering_id === offering.id).sort((a, b) => a.sort - b.sort);
  // Theory sub-sections (A1, A2) share one class, so only sessional courses split by sub-section.
  const sections = course.course_type === 'theory' ? [] : data.sections.filter((s) => s.offering_id === offering.id).sort((a, b) => a.name.localeCompare(b.name));
  const [section, setSection] = useState<string>('all');
  const [edit, setEdit] = useState<Draft | null>(null);
  const [moving, setMoving] = useState<AssessmentItem | null>(null);
  const weight = comps.reduce((s, c) => s + Number(c.weight), 0);

  const saveComp = useSaveComponent(offering.id, comps.length, course.course_type === 'theory');
  const delComp = useWrite((id: string) => must(supabase.from('assessment_components').delete().eq('id', id)));
  const updItem = useWrite((a: { id: string; patch: Partial<AssessmentItem> }) => must(supabase.from('assessment_items').update(a.patch).eq('id', a.id)));
  const seed = useWrite(async () => { for (const d of THEORY_DEFAULTS) await saveComp.mutateAsync(d); });

  const items = useMemo(() => data.items.filter((i) => i.offering_id === offering.id && (section === 'all' || !i.section_id || i.section_id === section)), [data.items, offering.id, section]);
  const secName = (id: string | null) => sections.find((s) => s.id === id)?.name;

  return (
    <div className="space-y-5 min-w-0">
      <Card>
        <CardHeader title="Assessment plan" subtitle="Components, how many of each, and their weight in the final grade."
          actions={canEdit && <Button size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => setEdit(newComponentDraft(course))}>Add component</Button>} />
        {comps.length === 0 ? (
          <Empty title="No assessment plan yet" action={canEdit && course.course_type === 'theory' ? <Button variant="primary" loading={seed.isPending} onClick={() => seed.mutate(undefined, { onError: (e) => toast('bad', e.message), onSuccess: () => toast('ok', 'Standard theory plan created') })}>Use standard theory plan</Button> : undefined}>
            {course.course_type === 'theory' ? 'Start from the standard plan (attendance 10, class tests 20 with best 3 of 4, term final 70) and adjust it.' : 'Add components such as lab reports, lab tests, quiz and viva. Choose “per sub-section” to track A1 and A2 separately.'}
          </Empty>
        ) : (
          <div className="overflow-x-auto"><table className="table">
            <thead><tr><th>Component</th><th>Type</th><th className="text-right">Items</th><th className="text-right">Marks each</th><th className="text-right">Counted</th><th className="text-right">Weight</th><th>Scope</th>{canEdit && <th className="w-24"><span className="sr-only">Actions</span></th>}</tr></thead>
            <tbody>{comps.map((c) => (
              <tr key={c.id}>
                <td className="font-medium">{c.name}</td><td className="text-muted">{labelOf(COMPONENT_KINDS, c.kind)}</td>
                <td className="text-right tabular">{c.item_count}</td><td className="text-right tabular">{Number(c.marks_each)}</td>
                <td className="text-right tabular">{c.best_n ? `Best ${c.best_n}` : 'All'}</td><td className="text-right tabular">{Number(c.weight)}%</td>
                <td className="text-muted text-2xs">{c.per_section && sections.length > 1 ? 'Per sub-section' : 'Whole course'}</td>
                {canEdit && <td><div className="flex gap-1 justify-end">
                  <Button size="sm" variant="ghost" aria-label={`Edit ${c.name}`} onClick={() => setEdit({ ...c })}><Pencil className="size-4" aria-hidden /></Button>
                  <Button size="sm" variant="ghost" aria-label={`Delete ${c.name}`} onClick={() => {
                    if (confirm(`Delete "${c.name}" and its items?`)) delComp.mutate(c.id, { onSuccess: () => toast('ok', 'Component deleted'), onError: (e) => toast('bad', e.message) });
                  }}><Trash2 className="size-4" aria-hidden /></Button></div></td>}
              </tr>))}</tbody>
            <tfoot><tr><td colSpan={5} className="px-3 py-2 text-right text-2xs text-subtle">Total weight</td>
              <td className={`px-3 py-2 text-right tabular font-semibold ${weight === 100 ? 'text-ok' : 'text-warn'}`}>{weight}%</td><td colSpan={2} className="px-3 py-2 text-2xs text-subtle">{weight === 100 ? 'Complete' : 'Must total 100%'}</td></tr></tfoot>
          </table></div>
        )}
      </Card>

      {comps.length > 0 && <Card>
        <CardHeader title={course.course_type === 'theory' ? 'Class tests and assessments' : 'Assessments by sub-section'}
          subtitle="Dates feed the department calendar. Class tests for the same cohort cannot share a day."
          actions={sections.length > 1 && <SegTabs label="Sub-section" value={section} onChange={setSection} options={[{ value: 'all', label: 'All' }, ...sections.map((s) => ({ value: s.id, label: s.name }))]} />} />
        <div className="overflow-x-auto"><table className="table">
          <thead><tr><th>Item</th>{sections.length > 1 && <th>Section</th>}<th>Date</th><th>Status</th><th>Marks</th><th>Responsible</th></tr></thead>
          <tbody>{items.sort((a, b) => (a.held_on ?? '9').localeCompare(b.held_on ?? '9') || a.seq - b.seq).map((i) => (
            <tr key={i.id}>
              <td><div className="font-medium">{i.title}</div><div className="text-2xs text-subtle tabular">{Number(i.total_marks)} marks</div></td>
              {sections.length > 1 && <td>{secName(i.section_id) ?? 'All'}</td>}
              <td>
                <button disabled={!canEdit} onClick={() => setMoving(i)} className="inline-flex items-center gap-1.5 text-sm rounded px-1.5 py-1 -mx-1.5 hover:bg-sunken disabled:hover:bg-transparent cursor-pointer disabled:cursor-default" aria-label={`Change date of ${i.title}`}>
                  <CalendarDays className="size-3.5 text-subtle" aria-hidden />{i.held_on ? fmtDate(i.held_on, { weekday: 'short', day: 'numeric', month: 'short' }) : i.date_later ? <span className="date-later px-1.5 py-0.5">To be set later</span> : <span className="text-warn">Set date</span>}
                </button>
              </td>
              <td>
                <label className="sr-only" htmlFor={`is-${i.id}`}>Status of {i.title}</label>
                <StatusSelect id={`is-${i.id}`} className="h-8 w-36" disabled={!canEdit} opts={ITEM_STATUS} done="held" value={i.status}
                  onChange={(e) => updItem.mutate({ id: i.id, patch: { status: e.target.value as AssessmentItem['status'] } }, { onError: (er) => toast('bad', er.message) })} />
              </td>
              <td>
                <label className="sr-only" htmlFor={`im-${i.id}`}>Marks for {i.title}</label>
                <StatusSelect id={`im-${i.id}`} className="h-8 w-44" disabled={!canEdit} value={i.marks_status}
                  opts={[...MARKS_STATE, ...MARKS_LEGACY.filter((m) => m.value === i.marks_status)]} done="published"
                  onChange={(e) => updItem.mutate({ id: i.id, patch: { marks_status: e.target.value as AssessmentItem['marks_status'] } }, { onError: (er) => toast('bad', er.message) })} />
              </td>
              <td>
                <label className="sr-only" htmlFor={`ir-${i.id}`}>Responsible teacher for {i.title}</label>
                <Select id={`ir-${i.id}`} className="h-8 w-56" disabled={!canEdit} value={i.responsible ?? ''}
                  onChange={(e) => updItem.mutate({ id: i.id, patch: { responsible: e.target.value || null } }, { onError: (er) => toast('bad', er.message) })}>
                  <option value="">All course teachers</option>{teachersOf(offering.id).map((f) => <option key={f} value={f}>{nameOf(f)}</option>)}
                </Select>
              </td>
            </tr>))}</tbody>
        </table></div>
      </Card>}

      <ComponentDialog key={edit ? edit.id ?? 'new' : 'closed'} draft={edit} onClose={() => setEdit(null)} busy={saveComp.isPending} hasSections={sections.length > 1}
        onSave={(d) => saveComp.mutate(d, { onSuccess: () => { toast('ok', 'Plan saved and items generated'); setEdit(null); }, onError: (e) => toast('bad', e.message) })} />
      <RescheduleDialog item={moving} onClose={() => setMoving(null)} admin={isAdmin} />
    </div>
  );
}

export function ComponentDialog({ draft, onClose, onSave, busy, hasSections }: { draft: Draft | null; onClose: () => void; onSave: (d: Draft) => void; busy: boolean; hasSections: boolean }) {
  const [d, setD] = useState<Draft | null>(draft);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => (x ? { ...x, [k]: v } : x));
  const err = d && (!d.name.trim() ? 'Give the component a name.' : d.best_n && d.best_n > d.item_count ? 'Counted items cannot exceed the number of items.' : null);
  return (
    <Dialog open={!!draft} onClose={onClose} title={draft?.id ? 'Edit component' : 'Add component'}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!!err} onClick={() => d && onSave(d)}>Save and generate items</Button></>}>
      {d && <div className="grid grid-cols-2 gap-3">
        <Field className="col-span-2" label="Name" htmlFor="c-name"><Input id="c-name" value={d.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Lab Report" /></Field>
        <Field label="Type" htmlFor="c-kind"><Select id="c-kind" value={d.kind} onChange={(e) => set('kind', e.target.value as ComponentKind)}>{COMPONENT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</Select></Field>
        <Field label="Weight (%)" htmlFor="c-w"><Input id="c-w" type="number" min={0} max={100} value={d.weight} onChange={(e) => set('weight', Number(e.target.value))} /></Field>
        <Field label="Number of items" htmlFor="c-n"><Input id="c-n" type="number" min={1} max={40} value={d.item_count} onChange={(e) => set('item_count', Math.max(1, Number(e.target.value)))} /></Field>
        <Field label="Marks per item" htmlFor="c-m"><Input id="c-m" type="number" min={1} value={d.marks_each} onChange={(e) => set('marks_each', Number(e.target.value))} /></Field>
        <Field label="Count best" htmlFor="c-b" hint="Leave empty to count every item."><Input id="c-b" type="number" min={1} value={d.best_n ?? ''} onChange={(e) => set('best_n', e.target.value ? Number(e.target.value) : null)} /></Field>
        {hasSections && <Field label="Scope" htmlFor="c-s"><Select id="c-s" value={d.per_section ? '1' : '0'} onChange={(e) => set('per_section', e.target.value === '1')}>
          <option value="1">Separate items per sub-section</option><option value="0">One item for the whole course</option></Select></Field>}
        {err && <p role="alert" className="col-span-2 text-2xs text-bad">{err}</p>}
        <p className="col-span-2 text-2xs text-subtle">Items are created or removed to match the count.</p>
      </div>}
    </Dialog>
  );
}

export function RescheduleDialog({ item, onClose, admin }: { item: AssessmentItem | null; onClose: () => void; admin: boolean }) {
  const toast = useToast();
  const { nameOf } = useTerm();
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [time, setTime] = useState('');
  const [conflicts, setConflicts] = useState<{ course: string; title: string }[]>([]);
  const [seen, setSeen] = useState<string | null>(null);
  const history = useItemHistory(item?.id);
  if (item && seen !== item.id) { setSeen(item.id); setDate(item.held_on ?? ''); setTime(item.held_time ?? ''); setReason(''); setConflicts([]); }
  const move = useWrite(async (force: boolean) => {
    const r = await rpc.reschedule({ item: item!.id, date: date || null, reason, force });
    if (r.ok && time !== (item!.held_time ?? '')) await must(supabase.from('assessment_items').update({ held_time: time || null }).eq('id', item!.id));
    return r;
  });
  // "To be set later": clear any date (kept in the history, with the reason) and flag the item so it glows until dated.
  const later = useWrite(async () => {
    if (item!.held_on) await rpc.reschedule({ item: item!.id, date: null, reason, force: false });
    await must(supabase.from('assessment_items').update({ date_later: true }).eq('id', item!.id));
  });
  const go = (force: boolean) => move.mutate(force, {
    onSuccess: (r) => { if (!r.ok) { setConflicts(r.conflicts); return; } toast('ok', 'Date saved'); onClose(); },
    onError: (e) => toast('bad', e.message),
  });
  const changed = item && date !== (item.held_on ?? '');
  return (
    <Dialog open={!!item} onClose={onClose} title={item ? `Date for ${item.title}` : ''}
      footer={<><Button className="mr-auto" loading={later.isPending} disabled={(!!item?.date_later && !item.held_on) || (!!item?.held_on && !reason.trim())}
          title={item?.held_on ? 'Give a reason first; the current date is cleared.' : undefined}
          onClick={() => later.mutate(undefined, { onSuccess: () => { toast('ok', 'Marked to be set later'); onClose(); }, onError: (e) => toast('bad', e.message) })}>To be set later</Button>
        <Button onClick={onClose}>Cancel</Button>
        {conflicts.length > 0 && admin && <Button variant="danger" loading={move.isPending} disabled={!reason.trim()} onClick={() => go(true)}>Override clash</Button>}
        <Button variant="primary" loading={move.isPending} disabled={!!item?.held_on && !!changed && !reason.trim()} onClick={() => go(false)}>Save</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date" htmlFor="r-date"><Input id="r-date" type="date" value={date} onChange={(e) => { setDate(e.target.value); setConflicts([]); }} /></Field>
        <Field label="Time or slot" htmlFor="r-time" hint="Optional"><Input id="r-time" value={time} onChange={(e) => setTime(e.target.value)} placeholder="e.g. 2:30 pm" /></Field>
      </div>
      {item?.date_later && !item.held_on && <p className="text-sm"><span className="date-later px-1.5 py-0.5">To be set later</span> <span className="text-muted">Pick a date when it is known.</span></p>}
      {item?.held_on && <Field label="Reason for the change" htmlFor="r-reason" hint="Kept in the history and sent to co-teachers."><Textarea id="r-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
      {conflicts.length > 0 && <Callout tone="bad" title="Same cohort already has a class test that day">
        <ul className="list-disc pl-5">{conflicts.map((c, i) => <li key={i}>{c.course} · {c.title}</li>)}</ul>
        <p className="mt-1">{admin ? 'Pick another date, or override with a reason.' : 'Pick another date, or ask a department admin to override.'}</p></Callout>}
      {!!history.data?.length && <div>
        <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-1"><History className="size-4" aria-hidden />Date history</h3>
        <ul className="text-2xs text-muted space-y-1">{history.data.map((h) => (
          <li key={h.id}><Badge>{fmtDate(h.old_date)} → {fmtDate(h.new_date)}</Badge> {nameOf(h.changed_by)} · {fmtDateLong(h.changed_at.slice(0, 10))}{h.reason ? ` · ${h.reason}` : ''}</li>))}</ul>
      </div>}
    </Dialog>
  );
}
