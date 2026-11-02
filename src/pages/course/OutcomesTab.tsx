import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { Button, Callout, Card, CardHeader, Empty, ErrorNote, Field, Select, Spinner, Textarea, useToast } from '@/components/ui';
import { must, useCourseObe, usePOs, useWrite } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useTerm } from '@/lib/TermContext';
import type { CourseOutcome } from '@/lib/types';
import type { TabProps } from './shared';

const LEVELS: Record<CourseOutcome['domain'], string[]> = {
  cognitive: ['C1 Remember', 'C2 Understand', 'C3 Apply', 'C4 Analyze', 'C5 Evaluate', 'C6 Create'],
  affective: ['A1 Receive', 'A2 Respond', 'A3 Value', 'A4 Organize', 'A5 Characterize'],
  psychomotor: ['P1 Perception', 'P2 Set', 'P3 Guided response', 'P4 Mechanism', 'P5 Complex response'],
};
type DraftCo = Pick<CourseOutcome, 'code' | 'statement' | 'domain' | 'level'> & { id?: string; tmp?: string; map: Record<string, number> };

export default function OutcomesTab({ offering }: TabProps) {
  const { me, isAdmin } = useAuth();
  const { teachersOf } = useTerm();
  const toast = useToast();
  const canEdit = isAdmin || teachersOf(offering.id).includes(me?.facultyId ?? '');
  const obe = useCourseObe(offering.id);
  const pos = usePOs();

  const initial = useMemo<DraftCo[]>(() => (obe.data?.cos ?? []).map((c) => ({ id: c.id, code: c.code, statement: c.statement, domain: c.domain, level: c.level,
    map: Object.fromEntries((obe.data?.coPo ?? []).filter((m) => m.co_id === c.id).map((m) => [m.po_code, m.strength])) })), [obe.data]);
  const [cos, setCos] = useState<DraftCo[]>(initial);
  useEffect(() => setCos(initial), [initial]);
  const dirty = JSON.stringify(cos) !== JSON.stringify(initial);

  const save = useWrite(async () => {
    const keep = cos.filter((c) => c.id).map((c) => c.id!);
    const drop = initial.filter((c) => !keep.includes(c.id!)).map((c) => c.id!);
    if (drop.length) await must(supabase.from('course_outcomes').delete().in('id', drop));
    for (const [i, c] of cos.entries()) {
      const row = { offering_id: offering.id, code: `CO${i + 1}`, statement: c.statement.trim(), domain: c.domain, level: c.level, sort: i + 1 };
      const saved = c.id ? await must(supabase.from('course_outcomes').update(row).eq('id', c.id).select().single())
        : await must(supabase.from('course_outcomes').insert(row).select().single());
      const id = (saved as CourseOutcome).id;
      await must(supabase.from('co_po_map').delete().eq('co_id', id));
      const maps = Object.entries(c.map).filter(([, v]) => v > 0).map(([po, strength]) => ({ co_id: id, po_code: po, strength }));
      if (maps.length) await must(supabase.from('co_po_map').insert(maps));
    }
  });

  if (obe.isLoading || pos.isLoading) return <Spinner />;
  if (obe.error || pos.error) return <ErrorNote error={obe.error ?? pos.error} />;
  const poList = pos.data!.pos;
  const warnings = cos.flatMap((c, i) => [
    !c.statement.trim() && `CO${i + 1} has no statement.`,
    Object.values(c.map).every((v) => !v) && `CO${i + 1} is not mapped to any PO.`,
  ].filter(Boolean) as string[]);
  const set = (i: number, patch: Partial<DraftCo>) => setCos((x) => x.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Course outcomes (COs)" subtitle="What the course aims to achieve, with the taxonomy level. Map each CO to the POs below."
          actions={canEdit && <>
            <Button size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => setCos((x) => [...x, { tmp: crypto.randomUUID(), code: `CO${x.length + 1}`, statement: '', domain: 'cognitive', level: 3, map: {} }])}>Add outcome</Button>
            <Button size="sm" variant="primary" disabled={!dirty || cos.some((c) => !c.statement.trim())} loading={save.isPending}
              onClick={() => save.mutate(undefined, { onSuccess: () => toast('ok', 'Outcomes and PO mapping saved'), onError: (e) => toast('bad', e.message) })}>Save</Button></>} />
        {cos.length === 0 ? <Empty title="No course outcomes yet">Most courses have 3 to 6. Start each statement with an action verb, for example “Analyze”, “Design”, “Explain”.</Empty> : (
          <ol className="divide-y divide-line">{cos.map((c, i) => (
            <li key={c.id ?? c.tmp} className="px-4 py-3 grid gap-3 md:grid-cols-[56px_1fr_200px_auto] items-start">
              <span className="font-mono text-sm font-semibold pt-2">CO{i + 1}</span>
              <Field label={<span className="sr-only">Statement for CO{i + 1}</span>} htmlFor={`co-s-${i}`}>
                <Textarea id={`co-s-${i}`} className="min-h-16" disabled={!canEdit} value={c.statement} onChange={(e) => set(i, { statement: e.target.value })} placeholder="Students will be able to…" /></Field>
              <div className="grid gap-2">
                <label className="sr-only" htmlFor={`co-d-${i}`}>Domain</label>
                <Select id={`co-d-${i}`} disabled={!canEdit} value={c.domain} onChange={(e) => set(i, { domain: e.target.value as DraftCo['domain'], level: 1 })}>
                  <option value="cognitive">Cognitive</option><option value="affective">Affective</option><option value="psychomotor">Psychomotor</option></Select>
                <label className="sr-only" htmlFor={`co-l-${i}`}>Level</label>
                <Select id={`co-l-${i}`} disabled={!canEdit} value={c.level} onChange={(e) => set(i, { level: Number(e.target.value) })}>
                  {LEVELS[c.domain].map((l, j) => <option key={l} value={j + 1}>{l}</option>)}</Select>
              </div>
              {canEdit && <Button variant="ghost" aria-label={`Remove CO${i + 1}`} onClick={() => setCos((x) => x.filter((_, j) => j !== i))}><Trash2 className="size-4" aria-hidden /></Button>}
            </li>))}</ol>
        )}
      </Card>

      {cos.length > 0 && <Card>
        <CardHeader title="CO–PO mapping" subtitle="Correlation strength: 1 low, 2 medium, 3 high. Leave blank where there is no link." />
        <div className="overflow-x-auto"><table className="table">
          <thead><tr><th>Outcome</th>{poList.map((p) => <th key={p.code} className="text-center" title={`${p.title}: ${p.statement}`}>{p.code}</th>)}</tr></thead>
          <tbody>{cos.map((c, i) => (
            <tr key={c.id ?? c.tmp}><td className="font-mono font-semibold">CO{i + 1}</td>
              {poList.map((p) => (
                <td key={p.code} className="text-center p-1">
                  <label className="sr-only" htmlFor={`m-${i}-${p.code}`}>CO{i + 1} to {p.code}</label>
                  <select id={`m-${i}-${p.code}`} disabled={!canEdit} value={c.map[p.code] ?? 0}
                    onChange={(e) => set(i, { map: { ...c.map, [p.code]: Number(e.target.value) } })}
                    className={`h-8 w-12 rounded border text-center text-sm tabular cursor-pointer disabled:cursor-default ${c.map[p.code] ? 'border-brand/40 bg-brand-soft text-brand-ink font-semibold' : 'border-line bg-surface text-subtle'}`}>
                    <option value={0}>–</option><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option>
                  </select>
                </td>))}
            </tr>))}</tbody>
        </table></div>
        <details className="px-4 py-3 border-t border-line text-sm"><summary className="cursor-pointer text-muted">Program outcome statements</summary>
          <dl className="mt-2 grid gap-2">{poList.map((p) => <div key={p.code}><dt className="font-semibold inline">{p.code} {p.title}.</dt> <dd className="inline text-muted">{p.statement}{p.k_profiles ? ` (${p.k_profiles})` : ''}</dd></div>)}</dl>
        </details>
      </Card>}
      {warnings.length > 0 && <Callout tone="warn" title="Check these outcomes"><ul className="list-disc pl-5">{warnings.map((w) => <li key={w}>{w}</li>)}</ul></Callout>}
    </div>
  );
}
