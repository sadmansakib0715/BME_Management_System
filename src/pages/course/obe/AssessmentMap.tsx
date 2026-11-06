import { Copy, FileDown, Plus, Printer, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import ConnectBoard from '@/components/ConnectBoard';
import { Button, Callout, Card, CardHeader, Empty, Input, SegTabs, useToast } from '@/components/ui';
import { must, rpc, useWrite } from '@/lib/api';
import { ASSESSMENTS, byAssessment, coCoverage, criteriaWarnings } from '@/lib/obe';
import { supabase } from '@/lib/supabase';
import type { ObeCriterion } from '@/lib/types';
import { useTerm } from '@/lib/TermContext';
import { moderationSections, save as saveFile } from './docData';
import { Chips, PctBar, type ObeProps } from './shared';
import { useCourseInfo } from './useDocInputs';

type Row = { key: string; id?: string; assessment: string; label: string; max: string; cos: string[] };
const newKey = () => crypto.randomUUID();

/** Assessment map: every exam question part or marking criterion with its marks and the COs it assesses — the item-to-CO sheet of the
    CO-PO-Assessment workbook, without student marks. Rubric bands for presentations, demos and reports are written under Rubrics. */
export default function AssessmentMap({ offering, course, data, obe, canEdit }: ObeProps) {
  const toast = useToast();
  const info = useCourseInfo({ offering, course, data, obe });
  const { nameOf } = useTerm();
  const initial = useMemo<Row[]>(() => obe.criteria.map((c) => ({ key: c.id, id: c.id, assessment: c.assessment, label: c.label, max: String(Number(c.max_marks)),
    cos: obe.criterionCos.filter((l) => l.criterion_id === c.id).map((l) => l.co_id) })), [obe.criteria, obe.criterionCos]);
  const [rows, setRows] = useState<Row[]>(initial);
  const [view, setView] = useState<'table' | 'connect'>('table');
  const [newGroup, setNewGroup] = useState('');
  useEffect(() => setRows(initial), [initial]);
  const dirty = JSON.stringify(rows) !== JSON.stringify(initial);
  const set = (key: string, patch: Partial<Row>) => setRows((x) => x.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const bad = rows.filter((r) => !r.label.trim() || !(Number(r.max) > 0) || !r.assessment.trim());

  const save = useWrite(async (list: Row[]) => {
    const keep = list.filter((r) => r.id).map((r) => r.id!);
    const drop = initial.filter((r) => !keep.includes(r.id!)).map((r) => r.id!);
    if (drop.length) await must(supabase.from('obe_criteria').delete().in('id', drop));
    const ids: string[] = [];
    for (const [i, r] of list.entries()) {
      const row = { offering_id: offering.id, assessment: r.assessment.trim(), label: r.label.trim(), max_marks: Number(r.max), sort: i };
      const saved = (r.id ? await must(supabase.from('obe_criteria').update(row).eq('id', r.id).select().single())
        : await must(supabase.from('obe_criteria').insert(row).select().single())) as ObeCriterion;
      ids.push(saved.id);
    }
    if (ids.length) await must(supabase.from('obe_criterion_cos').delete().in('criterion_id', ids));
    const links = list.flatMap((r, i) => r.cos.filter((co) => obe.cos.some((c) => c.id === co)).map((co) => ({ criterion_id: ids[i], co_id: co })));
    if (links.length) await must(supabase.from('obe_criterion_cos').insert(links));
  });
  const fill = useWrite(() => rpc.copyForward(offering.id));

  // Grouped order is the saved order, so the Connect view numbers rows the same way as the table.
  const groups = byAssessment(rows.map((r, i) => ({ ...r, sort: i })));
  const ordered = groups.flatMap((g) => g.items);
  const asLinks = rows.flatMap((r) => r.cos.map((co) => ({ criterion_id: r.key, co_id: co })));
  const cover = coCoverage(obe.cos, rows.map((r) => ({ id: r.key, max_marks: Number(r.max) || 0 })), asLinks);
  const warnings = criteriaWarnings(obe.cos, rows.map((r) => ({ id: r.key, assessment: r.assessment, label: r.label, max_marks: Number(r.max) || 0 })), asLinks);
  const coOpts = obe.cos.map((_, i) => `CO${i + 1}`);
  const idOf = (code: string) => obe.cos[Number(code.slice(2)) - 1]?.id;
  const codesOf = (ids: string[]) => obe.cos.map((c, i) => (ids.includes(c.id) ? `CO${i + 1}` : null)).filter(Boolean) as string[];
  const addRow = (assessment: string) => setRows((x) => {
    const last = x.map((r) => r.assessment).lastIndexOf(assessment);
    const row: Row = { key: newKey(), assessment, label: '', max: '', cos: [] };
    return last < 0 ? [...x, row] : [...x.slice(0, last + 1), row, ...x.slice(last + 1)];
  });
  const renameGroup = (from: string, to: string) => setRows((x) => x.map((r) => (r.assessment === from ? { ...r, assessment: to } : r)));
  const docs = obe.docs;
  const finals = rows.filter((r) => /final/i.test(r.assessment));
  /** Question Moderation Form (department template) from the term-final rows, with the question setters of sections A and B. */
  const moderationPdf = async () => {
    const { moderationPdf: build } = await import('@/lib/pdf/obeDocs');
    const exam = data.exam.find((e) => e.offering_id === offering.id);
    const all = info.teachers.map((t) => t.name).join(', ');
    const setter = (id: string | null | undefined) => (id ? nameOf(id) : all);
    saveFile(build({ course: info, sections: moderationSections(rows, obe.cos, { A: setter(exam?.qp_a), B: setter(exam?.qp_b), all }) }),
      `${course.code} Question moderation form ${data.term.name}.pdf`);
  };
  const saveButton = canEdit && <Button size="sm" variant="primary" disabled={!dirty || bad.length > 0} loading={save.isPending}
    onClick={() => save.mutate(rows, { onSuccess: () => toast('ok', 'Assessment map saved'), onError: (e) => toast('bad', e.message) })}>Save</Button>;

  if (!obe.cos.length) return <Card><Empty title="Add the COs first">The assessment map tags each question or criterion to the course's COs (COs & mapping).</Empty></Card>;

  return (
    <div className="space-y-5">
      <Card className="car-print">
        <CardHeader title={`Assessment map · ${course.code}`}
          subtitle={<>One row per exam question part or marking criterion: its marks and the COs it assesses. Write mark bands for presentations, demos and reports under <Link className="link" to="?s=rubrics">Rubrics</Link>.</>}
          actions={<>
            <SegTabs label="Assessment map view" value={view} onChange={setView} options={[{ value: 'table', label: 'Table' }, { value: 'connect', label: 'Connect' }]} />
            {canEdit && !rows.length && obe.prev && <Button size="sm" icon={<Copy className="size-4" aria-hidden />} loading={fill.isPending}
              onClick={() => fill.mutate(undefined, { onSuccess: (r) => toast('ok', r.criteria ? `${r.criteria} rows copied from ${obe.prev!.termName}` : `${obe.prev!.termName} has no assessment map to copy`), onError: (e) => toast('bad', e.message) })}>
              Fill from {obe.prev.termName}</Button>}
            <Button size="sm" icon={<FileDown className="size-4" aria-hidden />} disabled={!finals.length} title={finals.length ? 'Question Moderation Form for the term final' : 'Add a Term Final group with its question parts first'}
              onClick={() => moderationPdf().catch((e) => toast('bad', e.message))}>Moderation form PDF</Button>
            <Button size="sm" icon={<Printer className="size-4" aria-hidden />} onClick={() => window.print()}>Print</Button>
            {saveButton}
          </>} />
        {!groups.length && <Empty title="No questions or criteria yet">Add an assessment below (for example Term Final or Presentation 01), then its question parts or criteria.</Empty>}

        {view === 'connect' && groups.length > 0 && <ConnectBoard nouns={{ left: 'question', right: 'CO' }} disabled={!canEdit}
          onChange={(i, links) => set(ordered[i].key, { cos: links })}
          left={ordered.map((r, i) => ({ key: r.key, code: `#${i + 1}`, label: `${r.assessment} · ${r.label || 'untitled'}`, badge: `${Number(r.max) || 0} marks`, links: r.cos }))}
          right={obe.cos.map((c, i) => ({ key: c.id, code: `CO${i + 1}`, label: c.statement, meta: cover[i].items ? `${Math.round(cover[i].marks * 100) / 100} marks` : undefined }))} />}

        {view === 'table' && groups.map((g) => {
          const subtotal = g.items.reduce((n, r) => n + (Number(r.max) || 0), 0);
          return (
            <section key={g.assessment} className="border-b border-line last:border-b-0">
              <div className="px-4 py-2.5 flex flex-wrap items-center gap-2 bg-sunken/60">
                {canEdit ? <><label htmlFor={`g-${g.assessment}`} className="sr-only">Assessment name</label>
                  <Input id={`g-${g.assessment}`} className="h-8 w-64 font-semibold" list="obe-assessments" defaultValue={g.assessment}
                    onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== g.assessment && renameGroup(g.assessment, e.target.value.trim())} /></>
                  : <h3 className="text-sm font-semibold">{g.assessment}</h3>}
                <span className="text-2xs text-muted tabular">{g.items.length} {g.items.length === 1 ? 'item' : 'items'} · {Math.round(subtotal * 100) / 100} marks</span>
                {canEdit && <Button size="sm" variant="ghost" className="ml-auto" icon={<Plus className="size-4" aria-hidden />} onClick={() => addRow(g.assessment)}>Add question or criterion</Button>}
              </div>
              <div className="overflow-x-auto"><table className="table">
                <thead><tr><th className="min-w-56">Question part or criterion</th><th className="w-24 text-right">Marks</th><th className="min-w-48">COs assessed</th>{canEdit && <th className="w-10" />}</tr></thead>
                <tbody>{g.items.map((r) => (
                  <tr key={r.key}>
                    <td>{canEdit ? <><label htmlFor={`l-${r.key}`} className="sr-only">Question part or criterion</label>
                      <Input id={`l-${r.key}`} className="h-8" value={r.label} placeholder="e.g. Q01 (a) or Clinical need identification" onChange={(e) => set(r.key, { label: e.target.value })} /></>
                      : <span className="text-sm">{r.label}</span>}</td>
                    <td className="text-right">{canEdit ? <><label htmlFor={`m-${r.key}`} className="sr-only">Marks</label>
                      <Input id={`m-${r.key}`} className="h-8 w-20 text-right tabular ml-auto" inputMode="decimal" value={r.max} onChange={(e) => set(r.key, { max: e.target.value })} /></>
                      : <span className="tabular text-sm">{r.max}</span>}</td>
                    <td><Chips label={`COs assessed by ${r.label}`} disabled={!canEdit} options={coOpts} value={codesOf(r.cos)} onChange={(v) => set(r.key, { cos: v.map(idOf).filter(Boolean) as string[] })} /></td>
                    {canEdit && <td className="p-1"><Button variant="ghost" size="sm" aria-label={`Remove ${r.label || 'row'}`} onClick={() => setRows((x) => x.filter((y) => y.key !== r.key))}><Trash2 className="size-4" aria-hidden /></Button></td>}
                  </tr>))}</tbody>
              </table></div>
            </section>);
        })}
        {canEdit && view === 'table' && <div className="px-4 py-3 flex flex-wrap items-end gap-2 border-t border-line print:hidden">
          <label htmlFor="new-group" className="sr-only">New assessment</label>
          <Input id="new-group" className="h-8 w-64" list="obe-assessments" placeholder="New assessment, e.g. Term Final" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} />
          <Button size="sm" icon={<Plus className="size-4" aria-hidden />} disabled={!newGroup.trim()} onClick={() => { addRow(newGroup.trim()); setNewGroup(''); }}>Add assessment</Button>
          <datalist id="obe-assessments">{ASSESSMENTS.map((a) => <option key={a} value={a} />)}</datalist>
        </div>}
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="How much each CO is assessed" subtitle="Marks from every question or criterion tagged to the CO, and their share of all the marks in this map." />
          <div className="overflow-x-auto"><table className="table">
            <thead><tr><th>CO</th><th className="min-w-48">Statement</th><th className="text-right">Items</th><th className="text-right">Marks</th><th className="min-w-32">Share</th></tr></thead>
            <tbody>{obe.cos.map((c, i) => { const x = cover[i]; return (
              <tr key={c.id}><td className="font-mono font-semibold">CO{i + 1}</td><td className="text-2xs text-muted"><span className="line-clamp-2">{c.statement}</span></td>
                <td className="text-right tabular text-sm">{x.items}</td><td className="text-right tabular text-sm">{Math.round(x.marks * 100) / 100}</td>
                <td>{x.items ? <div className="flex items-center gap-2"><PctBar value={x.share} threshold={0} label={`CO${i + 1} share`} /><span className="text-2xs tabular w-12 text-right">{x.share.toFixed(1)}%</span></div>
                  : <span className="text-2xs text-warn font-medium">Not assessed</span>}</td></tr>); })}</tbody>
          </table></div>
        </Card>
        {docs && (docs.components.length > 0 || docs.marks_distribution.length > 0) && <Card>
          <CardHeader title="Marks distribution" subtitle="From the course outline and the CO-PO-assessment workbook." />
          {docs.marks_distribution.length > 0 && <table className="table"><thead><tr><th>Outline component</th><th className="text-right">Share</th></tr></thead>
            <tbody>{docs.marks_distribution.map((m) => <tr key={m.component}><td className="text-sm">{m.component}</td><td className="text-right tabular text-sm">{m.percent}%</td></tr>)}</tbody></table>}
          {docs.components.length > 0 && <table className="table"><thead><tr><th>Workbook component</th><th className="text-right">Weight</th><th className="text-right">Marks</th></tr></thead>
            <tbody>{docs.components.filter((c) => c.component !== 'Total').map((c) => <tr key={c.component}><td className="text-sm">{c.component}</td>
              <td className="text-right tabular text-sm">{Math.round(c.weight * 1000) / 10}%</td><td className="text-right tabular text-sm">{c.marks}</td></tr>)}</tbody></table>}
        </Card>}
      </div>

      {bad.length > 0 && <Callout tone="bad">Every row needs a name and marks above zero ({bad.length} to fix).</Callout>}
      {warnings.length > 0 && <Callout tone="warn" title="Check the assessment map"><ul className="list-disc pl-5">{warnings.slice(0, 12).map((w) => <li key={w}>{w}</li>)}</ul>
        {warnings.length > 12 && <p className="text-2xs mt-1">…and {warnings.length - 12} more.</p>}</Callout>}
    </div>
  );
}
