import { Copy, FileDown, Plus, Trash2, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button, Callout, Card, CardHeader, Empty, Field, SegTabs, Select, Textarea, useToast } from '@/components/ui';
import { must, useBugs, usePOs, useWrite } from '@/lib/api';
import { coWarnings, CULMINATING_POS, DELIVERY, DOMAIN_LEVELS, impliedKpa, KPA, kpaAfterPoChange, sortKpa, TOOLS } from '@/lib/obe';
import { supabase } from '@/lib/supabase';
import type { CourseOutcome } from '@/lib/types';
import CoPoBoard from './CoPoBoard';
import { coRows, poRefs, save as saveFile } from './docData';
import { Chips, type ObeProps } from './shared';
import { useCourseInfo } from './useDocInputs';

type Draft = { id?: string; tmp?: string; statement: string; domain_levels: string[]; delivery: string[]; tools: string[]; kpa: string[]; pos: string[] };
const DOMAIN_OF: Record<string, CourseOutcome['domain']> = { C: 'cognitive', PS: 'psychomotor', AF: 'affective' };

/** COs and their mapping, laid out like CO-PO Mapping.docx: statements, then a CO × PO table, then CO × K/P/A. */
export default function CoMapping({ offering, course, data, obe, canEdit, isAdmin }: ObeProps) {
  const toast = useToast();
  const info = useCourseInfo({ offering, course, data, obe });
  const pos = usePOs();
  const bugs = useBugs();
  const initial = useMemo<Draft[]>(() => obe.cos.map((c) => ({ id: c.id, statement: c.statement, domain_levels: c.domain_levels ?? [], delivery: c.delivery ?? [], tools: c.tools ?? [], kpa: c.kpa ?? [],
    pos: obe.coPo.filter((m) => m.co_id === c.id).map((m) => m.po_code) })), [obe.cos, obe.coPo]);
  const [cos, setCos] = useState<Draft[]>(initial);
  const [view, setView] = useState<'connect' | 'table'>('connect');
  useEffect(() => setCos(initial), [initial]);
  const dirty = JSON.stringify(cos) !== JSON.stringify(initial);
  const set = (i: number, patch: Partial<Draft>) => setCos((x) => x.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const toggleKpa = (i: number, v: string) => set(i, { kpa: cos[i].kpa.includes(v) ? cos[i].kpa.filter((x) => x !== v) : sortKpa([...cos[i].kpa, v]) });
  /** Changing a CO's POs also ticks (or unticks) the knowledge profile, complex problem and complex activity attributes those POs imply. */
  const setPos = (i: number, next: string[]) => setCos((x) => x.map((c, j) => (j === i ? { ...c, pos: next, kpa: kpaAfterPoChange(c.kpa, c.pos, next, pos.data?.pos ?? []) } : c)));
  const togglePo = (i: number, po: string) => setPos(i, cos[i].pos.includes(po) ? cos[i].pos.filter((x) => x !== po) : [...cos[i].pos, po]);

  const save = useWrite(async (list: Draft[]) => {
    const keep = list.filter((c) => c.id).map((c) => c.id!);
    const drop = initial.filter((c) => !keep.includes(c.id!)).map((c) => c.id!);
    if (drop.length) await must(supabase.from('course_outcomes').delete().in('id', drop));
    for (const [i, c] of list.entries()) {
      const first = c.domain_levels[0]?.match(/^(C|PS|AF)(\d)$/);
      const row = { offering_id: offering.id, code: `CO${i + 1}`, statement: c.statement.trim(), domain_levels: c.domain_levels, delivery: c.delivery, tools: c.tools, kpa: c.kpa,
        domain: first ? DOMAIN_OF[first[1]] : 'cognitive', level: first ? Math.min(6, Number(first[2])) : 3, sort: i + 1 };
      // Codes are renumbered in order via temporary CO9xx codes, so the (offering, code) key never collides mid-save.
      const saved = c.id ? await must(supabase.from('course_outcomes').update({ ...row, code: `CO${900 + i}` }).eq('id', c.id).select().single())
        : await must(supabase.from('course_outcomes').insert({ ...row, code: `CO${900 + i}` }).select().single());
      const id = (saved as CourseOutcome).id;
      await must(supabase.from('co_po_map').delete().eq('co_id', id));
      if (c.pos.length) await must(supabase.from('co_po_map').insert(c.pos.map((po) => ({ co_id: id, po_code: po, strength: 1 }))));
    }
    const fresh = await must(supabase.from('course_outcomes').select('id, sort').eq('offering_id', offering.id)) as { id: string; sort: number }[];
    for (const r of fresh) await must(supabase.from('course_outcomes').update({ code: `CO${r.sort}` }).eq('id', r.id));
  });
  const setResolution = useWrite((id: string | null) => must(supabase.from('offerings').update({ co_resolution_id: id }).eq('id', offering.id)));

  if (!pos.data) return null;
  const poList = pos.data.pos;
  const impliedOf = (c: Draft) => sortKpa(c.pos.flatMap((code) => { const p = poList.find((x) => x.code === code); return p ? impliedKpa(p) : []; }));
  const whyTicked = (c: Draft, k: string) => c.pos.filter((code) => { const p = poList.find((x) => x.code === code); return p && impliedKpa(p).includes(k); });
  const unfilled = cos.filter((c) => impliedOf(c).some((k) => !c.kpa.includes(k))).length;
  const fillKpa = () => setCos((x) => x.map((c) => ({ ...c, kpa: sortKpa([...c.kpa, ...impliedOf(c)]) })));
  const fromPrev = () => obe.prev && setCos(obe.prev.cos.map((c) => ({ tmp: crypto.randomUUID(), statement: c.statement, domain_levels: c.domain_levels ?? [], delivery: c.delivery ?? [], tools: c.tools ?? [],
    kpa: c.kpa ?? [], pos: obe.prev!.coPo.filter((m) => m.co_id === c.id).map((m) => m.po_code) })));
  const warnings = coWarnings(course, cos.map((c, i) => ({ id: c.id ?? c.tmp ?? String(i), statement: c.statement, kpa: c.kpa, domain_levels: c.domain_levels })),
    cos.flatMap((c, i) => c.pos.map((po) => ({ co_id: c.id ?? c.tmp ?? String(i), po_code: po, strength: 1 as const }))), poList);
  const add = () => setCos((x) => [...x, { tmp: crypto.randomUUID(), statement: '', domain_levels: [], delivery: [], tools: [], kpa: [], pos: [] }]);
  const res = bugs.data?.find((b) => b.id === offering.co_resolution_id);
  const downloadPdf = async () => {
    const { mappingPdf } = await import('@/lib/pdf/obeDocs');
    saveFile(mappingPdf({ course: info, cos: coRows(obe), pos: poRefs(poList), approval: res ? `BUGS meeting ${res.meeting_no}${res.held_on ? `, ${res.held_on}` : ''}` : null }),
      `${course.code} CO-PO Mapping ${data.term.name}.pdf`);
  };
  const pdfButton = <Button size="sm" icon={<FileDown className="size-4" aria-hidden />} disabled={dirty || !obe.cos.length}
    title={dirty ? 'Save first: the PDF uses the saved COs and mapping' : undefined} onClick={() => downloadPdf().catch((e) => toast('bad', e.message))}>CO-PO mapping PDF</Button>;
  const saveButton = <Button size="sm" variant="primary" disabled={!dirty || cos.some((c) => !c.statement.trim())} loading={save.isPending}
    onClick={() => save.mutate(cos, { onSuccess: () => toast('ok', 'COs and mapping saved'), onError: (e) => toast('bad', e.message) })}>Save</Button>;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Course outcomes (COs)" subtitle="At most 12. Start each statement with an action verb. Pick one or more domain and taxonomy levels."
          actions={<>{pdfButton}{canEdit && <>
            {obe.prev && obe.prev.cos.length > 0 && cos.length === 0 && <Button size="sm" icon={<Copy className="size-4" aria-hidden />} onClick={fromPrev}>Copy from {obe.prev.termName}</Button>}
            <Button size="sm" icon={<Plus className="size-4" aria-hidden />} disabled={cos.length >= 12} onClick={add}>Add CO</Button>
            {saveButton}</>}</>} />
        {cos.length === 0 ? <Empty title="No COs yet">{obe.prev?.cos.length ? `Copy last term's ${obe.prev.cos.length} COs from ${obe.prev.termName}, then revise them.` : 'Add the COs approved for this course.'}</Empty> : (
          <ol className="divide-y divide-line">{cos.map((c, i) => (
            <li key={c.id ?? c.tmp} className="px-4 py-3 grid gap-3 md:grid-cols-[48px_1fr_auto]">
              <span className="font-mono text-sm font-semibold pt-2">CO{i + 1}</span>
              <div className="space-y-2.5 min-w-0">
                <Field label={<span className="sr-only">Statement for CO{i + 1}</span>} htmlFor={`co-s-${i}`}>
                  <Textarea id={`co-s-${i}`} className="min-h-14" disabled={!canEdit} value={c.statement} onChange={(e) => set(i, { statement: e.target.value })} placeholder="e.g. Analyze biomedical signals using…" /></Field>
                <div className="grid gap-2.5 lg:grid-cols-2">
                  <div><div className="text-2xs font-semibold text-subtle mb-1">Domain and taxonomy level</div>
                    <Chips label={`Taxonomy levels for CO${i + 1}`} disabled={!canEdit} options={DOMAIN_LEVELS.flatMap((d) => d.codes)} value={c.domain_levels} onChange={(v) => set(i, { domain_levels: v })} /></div>
                  <div><div className="text-2xs font-semibold text-subtle mb-1">Delivery methods and activities</div>
                    <Chips label={`Delivery for CO${i + 1}`} disabled={!canEdit} options={DELIVERY} value={c.delivery} onChange={(v) => set(i, { delivery: v })} /></div>
                  <div className="lg:col-span-2"><div className="text-2xs font-semibold text-subtle mb-1">Assessment tools</div>
                    <Chips label={`Assessment tools for CO${i + 1}`} disabled={!canEdit} options={TOOLS} value={c.tools} onChange={(v) => set(i, { tools: v })} /></div>
                </div>
              </div>
              {canEdit && <Button variant="ghost" aria-label={`Remove CO${i + 1}`} onClick={() => setCos((x) => x.filter((_, j) => j !== i))}><Trash2 className="size-4" aria-hidden /></Button>}
            </li>))}</ol>
        )}
      </Card>

      {cos.length > 0 && <Card>
        <CardHeader title="CO–PO mapping" subtitle="Connect each CO to the POs it addresses. A PO no CO maps to is NA for this course."
          actions={<>
            <SegTabs label="Mapping view" value={view} onChange={setView} options={[{ value: 'connect', label: 'Connect' }, { value: 'table', label: 'Table' }]} />
            {canEdit && dirty && saveButton}</>} />
        {view === 'connect'
          ? <CoPoBoard cos={cos.map((c, i) => ({ key: c.id ?? c.tmp ?? String(i), code: `CO${i + 1}`, statement: c.statement, pos: c.pos }))} pos={poList}
              expected={CULMINATING_POS[course.code]} disabled={!canEdit} onChange={setPos} />
          : <div className="overflow-x-auto"><table className="table">
          <thead><tr><th>CO</th>{poList.map((p) => <th key={p.code} className="text-center" title={`${p.title} (${p.k_profiles ?? '—'})`}>{p.code}</th>)}</tr></thead>
          <tbody>{cos.map((c, i) => (
            <tr key={c.id ?? c.tmp}><td className="font-mono font-semibold">CO{i + 1}</td>
              {poList.map((p) => (
                <td key={p.code} className="text-center p-1">
                  <input type="checkbox" className="size-4 accent-[rgb(var(--brand))] cursor-pointer disabled:cursor-default" disabled={!canEdit} checked={c.pos.includes(p.code)}
                    onChange={() => togglePo(i, p.code)} aria-label={`CO${i + 1} maps to ${p.code}`} />
                </td>))}
            </tr>))}</tbody>
        </table></div>}
      </Card>}

      {cos.length > 0 && <Card>
        <CardHeader title="Knowledge profile, complex problem and complex activity" subtitle="The “Mapping of Knowledge Profile, CEP and CEA” table. Ticked from the CO–PO mapping as you map: each PO's knowledge profiles (e.g. PO1 → K1–K4), P1 for a PO on complex engineering problems (PO1–PO7) and A1 for complex engineering activities (PO10). Add or remove ticks by hand as needed."
          actions={canEdit && <>
            {unfilled > 0 && <Button size="sm" icon={<Wand2 className="size-4" aria-hidden />} onClick={fillKpa} title="Adds the ticks the mapped POs imply; ticks already set stay">Tick from mapping ({unfilled} CO{unfilled === 1 ? '' : 's'})</Button>}
            {dirty && saveButton}</>} />
        <div className="overflow-x-auto"><table className="table">
          <thead>
            <tr><th />{KPA.map((g) => <th key={g.group} colSpan={g.items.length} className="text-center border-l border-line">{g.group}</th>)}</tr>
            <tr><th>CO</th>{KPA.flatMap((g) => g.items.map(([k, label], j) => <th key={k} className={`text-center ${j === 0 ? 'border-l border-line' : ''}`} title={label}>{k}</th>))}</tr>
          </thead>
          <tbody>{cos.map((c, i) => (
            <tr key={c.id ?? c.tmp}><td className="font-mono font-semibold">CO{i + 1}</td>
              {KPA.flatMap((g) => g.items.map(([k, label], j) => (
                <td key={k} className={`text-center p-1 ${j === 0 ? 'border-l border-line' : ''}`}>
                  <input type="checkbox" className="size-4 accent-[rgb(var(--brand))] cursor-pointer disabled:cursor-default" disabled={!canEdit} checked={c.kpa.includes(k)}
                    onChange={() => toggleKpa(i, k)} aria-label={`CO${i + 1}: ${k} ${label}`}
                    title={whyTicked(c, k).length ? `${k} ${label}: implied by ${whyTicked(c, k).join(', ')}` : `${k} ${label}`} />
                </td>)))}
            </tr>))}</tbody>
        </table></div>
      </Card>}

      <Card>
        <CardHeader title="Approval" subtitle="The BUGS resolution that approved these COs and this mapping." />
        <div className="p-4 flex flex-wrap items-end gap-3">
          {isAdmin ? <Field label="BUGS resolution" htmlFor="co-res" className="min-w-72">
            <Select id="co-res" value={offering.co_resolution_id ?? ''} onChange={(e) => setResolution.mutate(e.target.value || null, { onSuccess: () => toast('ok', 'Approval saved'), onError: (er) => toast('bad', er.message) })}>
              <option value="">Not linked yet</option>{(bugs.data ?? []).map((b) => <option key={b.id} value={b.id}>Meeting {b.meeting_no}{b.held_on ? ` · ${b.held_on}` : ''}{b.title ? ` · ${b.title}` : ''}</option>)}
            </Select></Field>
            : <p className="text-sm">{res ? <>Meeting {res.meeting_no}{res.held_on ? `, ${res.held_on}` : ''}{res.link && <> · <a className="link" href={res.link} target="_blank" rel="noreferrer">resolution</a></>}</> : <span className="text-muted">Not linked yet. The OBE Cell links it.</span>}</p>}
          {isAdmin && !bugs.data?.length && <p className="text-2xs text-subtle">Add resolutions on the OBE page under “BUGS & CQI”.</p>}
        </div>
      </Card>

      {warnings.length > 0 && <Callout tone="warn" title="Check the COs and mapping"><ul className="list-disc pl-5">{warnings.map((w) => <li key={w}>{w}</li>)}</ul></Callout>}
    </div>
  );
}
