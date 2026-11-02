import { ExternalLink, Plus } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { Button, Card, CardHeader, Dialog, Empty, Field, Input, Select, StatusSelect, Textarea, useToast } from '@/components/ui';
import { must, useBugs, useCqi, useWrite } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import type { CqiItem, CqiStatus } from '@/lib/types';
import type { StatusOption } from '@/lib/workflow';

const CQI_STATES: StatusOption[] = [{ value: 'proposed', label: 'Proposed' }, { value: 'approved', label: 'Approved' }, { value: 'implemented', label: 'Implemented' }, { value: 'verified', label: 'Verified' }];

/** BUGS resolutions (replacing Meeting Resolution.xlsx) and the CQI log for the CO, PO and PEO loops (spec section 11). */
export default function BugsCqi() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const bugs = useBugs();
  const cqi = useCqi();
  const [loop, setLoop] = useState<'' | CqiItem['loop']>('');
  const [newRes, setNewRes] = useState(false);
  const [newCqi, setNewCqi] = useState(false);
  const [r, setR] = useState({ meeting_no: '', held_on: '', title: '', tags: [] as string[], link: '', effective_term: '' });
  const [q, setQ] = useState({ loop: 'CO' as CqiItem['loop'], source: 'other' as CqiItem['source'], course_code: '', finding: '', action: '', owner: '', effective_term: '', resolution_id: '' });
  const err = (e: Error) => toast('bad', e.message);
  const addRes = useWrite(() => must(supabase.from('bugs_resolutions').insert({ meeting_no: r.meeting_no.trim(), held_on: r.held_on || null, title: r.title.trim() || null, agenda_tags: r.tags, link: r.link.trim() || null, effective_term: r.effective_term.trim() || null })));
  const addCqi = useWrite(() => must(supabase.from('cqi_items').insert({ loop: q.loop, source: q.source, course_code: q.course_code.trim() || null, finding: q.finding.trim(), action: q.action.trim() || null,
    owner: q.owner.trim() || null, effective_term: q.effective_term.trim() || null, resolution_id: q.resolution_id || null })));
  const setStatus = useWrite((a: { id: string; status: CqiStatus }) => must(supabase.from('cqi_items').update({ status: a.status }).eq('id', a.id)));
  const items = (cqi.data ?? []).filter((x) => !loop || x.loop === loop);
  const resName = (id: string | null) => { const b = bugs.data?.find((x) => x.id === id); return b ? `Meeting ${b.meeting_no}` : null; };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="CQI log" subtitle="Each finding, its action, who owns it and when it takes effect. CAR Part E actions arrive here too."
          actions={<div className="flex flex-wrap gap-2">
            <label htmlFor="cqi-loop" className="sr-only">Loop</label>
            <Select id="cqi-loop" className="h-8 w-32" value={loop} onChange={(e) => setLoop(e.target.value as typeof loop)}><option value="">All loops</option><option value="CO">CO loop</option><option value="PO">PO loop</option><option value="PEO">PEO loop</option></Select>
            {isAdmin && <Button size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => setNewCqi(true)}>Add item</Button>}
          </div>} />
        {!items.length ? <Empty title="No CQI items yet">Send a CAR's Part E here, or add a finding from a BUGS review.</Empty> : (
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">{CQI_STATES.map((s) => (
            <section key={s.value} aria-label={s.label} className="rounded-lg bg-sunken/60 p-2">
              <h3 className="text-2xs font-semibold uppercase tracking-wide text-subtle px-1 pb-2">{s.label} · {items.filter((x) => x.status === s.value).length}</h3>
              <ul className="space-y-2">{items.filter((x) => x.status === s.value).map((x) => (
                <li key={x.id} className="card p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2 text-2xs"><span className="font-semibold">{x.loop} loop{x.course_code ? ` · ${x.course_code}` : ''}</span><span className="text-subtle">{x.source}</span></div>
                  <p className="text-sm">{x.finding}</p>
                  {x.action && <p className="text-2xs text-muted"><span className="text-subtle">Action: </span>{x.action}</p>}
                  <p className="text-2xs text-subtle">{[x.owner, x.effective_term && `Takes effect ${x.effective_term}`, resName(x.resolution_id)].filter(Boolean).join(' · ')}</p>
                  {isAdmin && <><label htmlFor={`cq-${x.id}`} className="sr-only">Status</label>
                    <StatusSelect id={`cq-${x.id}`} className="h-8 w-full" opts={CQI_STATES} value={x.status} onChange={(e) => setStatus.mutate({ id: x.id, status: e.target.value as CqiStatus }, { onError: err })} /></>}
                </li>))}</ul>
            </section>))}</div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title="BUGS resolutions" subtitle="Meetings that approved COs, mappings and curriculum changes."
          actions={isAdmin && <Button size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => setNewRes(true)}>Add meeting</Button>} />
        {!bugs.data?.length ? <Empty title="No resolutions yet">Add the BUGS meetings (number, date, agenda and the resolution link).</Empty> : (
          <div className="overflow-x-auto"><table className="table">
            <thead><tr><th>Meeting</th><th>Date</th><th>Agenda</th><th>Title</th><th>Takes effect</th><th>Resolution</th></tr></thead>
            <tbody>{bugs.data.map((b) => (
              <tr key={b.id}><td className="font-semibold">{b.meeting_no}</td><td className="text-sm tabular">{b.held_on ?? '—'}</td><td className="text-2xs">{b.agenda_tags.join(', ') || '—'}</td>
                <td className="text-sm">{b.title ?? '—'}</td><td className="text-sm">{b.effective_term ?? '—'}</td>
                <td>{b.link ? <a href={b.link} target="_blank" rel="noreferrer" className="link text-sm inline-flex items-center gap-1">Open<ExternalLink className="size-3.5" aria-hidden /></a> : '—'}</td></tr>))}</tbody>
          </table></div>
        )}
      </Card>

      <Dialog open={newRes} onClose={() => setNewRes(false)} title="Add a BUGS meeting"
        footer={<><Button onClick={() => setNewRes(false)}>Cancel</Button><Button variant="primary" disabled={!r.meeting_no.trim()} loading={addRes.isPending}
          onClick={() => addRes.mutate(undefined, { onSuccess: () => { toast('ok', 'Meeting added'); setNewRes(false); setR({ meeting_no: '', held_on: '', title: '', tags: [], link: '', effective_term: '' }); }, onError: err })}>Add</Button></>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Meeting number" htmlFor="r-no"><Input id="r-no" value={r.meeting_no} onChange={(e) => setR({ ...r, meeting_no: e.target.value })} /></Field>
          <Field label="Date" htmlFor="r-date"><Input id="r-date" type="date" value={r.held_on} onChange={(e) => setR({ ...r, held_on: e.target.value })} /></Field>
          <Field label="Title" htmlFor="r-title" className="col-span-2"><Input id="r-title" value={r.title} onChange={(e) => setR({ ...r, title: e.target.value })} /></Field>
          <fieldset className="col-span-2"><legend className="text-sm font-medium mb-1">Agenda</legend><div className="flex gap-4">{['CO', 'PO', 'PEO'].map((t) => (
            <label key={t} className="inline-flex items-center gap-1.5 text-sm"><input type="checkbox" className="size-4 accent-[rgb(var(--brand))]" checked={r.tags.includes(t)}
              onChange={(e) => setR({ ...r, tags: e.target.checked ? [...r.tags, t] : r.tags.filter((x) => x !== t) })} />{t}</label>))}</div></fieldset>
          <Field label="Resolution link" htmlFor="r-link" className="col-span-2"><Input id="r-link" value={r.link} onChange={(e) => setR({ ...r, link: e.target.value })} placeholder="OneDrive or Drive link" /></Field>
          <Field label="Takes effect" htmlFor="r-eff" hint="e.g. Jul 2025"><Input id="r-eff" value={r.effective_term} onChange={(e) => setR({ ...r, effective_term: e.target.value })} /></Field>
        </div>
      </Dialog>

      <Dialog open={newCqi} onClose={() => setNewCqi(false)} title="Add a CQI item"
        footer={<><Button onClick={() => setNewCqi(false)}>Cancel</Button><Button variant="primary" disabled={!q.finding.trim()} loading={addCqi.isPending}
          onClick={() => addCqi.mutate(undefined, { onSuccess: () => { toast('ok', 'CQI item added'); setNewCqi(false); }, onError: err })}>Add</Button></>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Loop" htmlFor="q-loop"><Select id="q-loop" value={q.loop} onChange={(e) => setQ({ ...q, loop: e.target.value as CqiItem['loop'] })}><option value="CO">CO / curriculum</option><option value="PO">PO</option><option value="PEO">PEO</option></Select></Field>
          <Field label="Source" htmlFor="q-src"><Select id="q-src" value={q.source} onChange={(e) => setQ({ ...q, source: e.target.value as CqiItem['source'] })}>
            <option value="CAR">CAR</option><option value="attainment">Attainment flag</option><option value="survey">Survey</option><option value="IAP">IAP</option><option value="other">Other</option></Select></Field>
          <Field label="Finding" htmlFor="q-find" className="col-span-2"><Textarea id="q-find" value={q.finding} onChange={(e) => setQ({ ...q, finding: e.target.value })} /></Field>
          <Field label="Proposed action" htmlFor="q-act" className="col-span-2"><Textarea id="q-act" value={q.action} onChange={(e) => setQ({ ...q, action: e.target.value })} /></Field>
          <Field label="Course" htmlFor="q-course" hint="Optional, e.g. BME 400"><Input id="q-course" value={q.course_code} onChange={(e) => setQ({ ...q, course_code: e.target.value })} /></Field>
          <Field label="Owner" htmlFor="q-owner"><Input id="q-owner" value={q.owner} onChange={(e) => setQ({ ...q, owner: e.target.value })} /></Field>
          <Field label="Takes effect" htmlFor="q-eff" hint="e.g. Jul 2025, Batch 20 on L4-T2"><Input id="q-eff" value={q.effective_term} onChange={(e) => setQ({ ...q, effective_term: e.target.value })} /></Field>
          <Field label="BUGS resolution" htmlFor="q-res"><Select id="q-res" value={q.resolution_id} onChange={(e) => setQ({ ...q, resolution_id: e.target.value })}>
            <option value="">None yet</option>{(bugs.data ?? []).map((b) => <option key={b.id} value={b.id}>Meeting {b.meeting_no}</option>)}</Select></Field>
        </div>
      </Dialog>
    </div>
  );
}
