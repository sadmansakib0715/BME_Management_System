import { clsx } from 'clsx';
import type { TextareaHTMLAttributes } from 'react';
import { Plus, Rows3, Trash2, X } from 'lucide-react';
import ConnectBoard from '@/components/ConnectBoard';
import { Badge, Button, Callout, Field, Input, Select, Textarea } from '@/components/ui';
import { bands, blankCriterion, marksPerCo, rubricChecks, total, type RubricDraft } from '@/lib/rubric';
import type { AssessmentComponent, CourseOutcome, RubricCriterion } from '@/lib/types';

const num = (v: string) => (v.trim() === '' ? null : Number(v));

/** A textarea that grows with its text, so whole band descriptions stay readable in the grid. */
function Grow({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const fit = (el: HTMLTextAreaElement | null) => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px`; } };
  return <textarea {...rest} ref={fit} rows={1} onInput={(e) => fit(e.currentTarget)} className={clsx('resize-none overflow-hidden', className)} />;
}

/** The rubric grid (criteria × levels with mark bands) and the criteria → CO board. Pure: the caller owns the draft and saving. */
export function RubricEditor({ value: r, onChange, cos, components, disabled }: {
  value: RubricDraft; onChange: (r: RubricDraft) => void; cos: Pick<CourseOutcome, 'id' | 'statement'>[]; components: Pick<AssessmentComponent, 'id' | 'name'>[]; disabled?: boolean;
}) {
  const setC = (i: number, patch: Partial<RubricCriterion>) => onChange({ ...r, criteria: r.criteria.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const setBand = (i: number, k: number, patch: Partial<RubricCriterion['levels'][number]>) =>
    setC(i, { levels: r.criteria[i].levels.map((l, j) => (j === k ? { ...l, ...patch } : l)) });
  const renameLevel = (k: number, label: string) =>
    onChange({ ...r, levels: r.levels.map((l, j) => (j === k ? label : l)), criteria: r.criteria.map((c) => ({ ...c, levels: c.levels.map((l, j) => (j === k ? { ...l, label } : l)) })) });
  const addLevel = () => onChange({ ...r, levels: [...r.levels, 'New level'], criteria: r.criteria.map((c) => ({ ...c, levels: [...c.levels, { label: 'New level', min: null, max: null, text: '' }] })) });
  const dropLevel = (k: number) => onChange({ ...r, levels: r.levels.filter((_, j) => j !== k), criteria: r.criteria.map((c) => ({ ...c, levels: c.levels.filter((_, j) => j !== k) })) });
  const spread = (i: number) => setC(i, { levels: r.criteria[i].levels.map((l, k) => ({ ...l, ...bands(r.criteria[i].max, r.levels.length)[k] })) });

  const valid = new Set(cos.map((c) => c.id));
  const live = { ...r, criteria: r.criteria.map((c) => ({ ...c, cos: c.cos.filter((id) => valid.has(id)) })) };
  const checks = rubricChecks(live);
  const perCo = marksPerCo(live);

  return (
    <div className="space-y-4">
      <div className="px-4 pt-4 grid gap-3 sm:grid-cols-[1fr_16rem_auto] items-end">
        <Field label="Title" htmlFor="rb-title"><Input id="rb-title" disabled={disabled} value={r.title} onChange={(e) => onChange({ ...r, title: e.target.value })} placeholder="e.g. Project presentation" /></Field>
        <Field label="Used for" htmlFor="rb-comp" hint="The assessment this rubric marks.">
          <Select id="rb-comp" disabled={disabled} value={r.component_id ?? ''} onChange={(e) => onChange({ ...r, component_id: e.target.value || null })}>
            <option value="">Not linked</option>{components.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select></Field>
        <div className="pb-1.5"><Badge tone="neutral">Total {total(r)} marks</Badge></div>
      </div>

      <div className="overflow-x-auto px-4">
        <table className="w-full min-w-[56rem] border-collapse text-sm">
          <thead>
            <tr className="bg-sunken/60">
              <th className="text-left text-2xs font-semibold uppercase tracking-wide text-subtle px-2 py-2 border border-line w-48">Criterion</th>
              <th className="text-left text-2xs font-semibold uppercase tracking-wide text-subtle px-2 py-2 border border-line w-20">Marks</th>
              {r.levels.map((l, k) => (
                <th key={k} className="px-1.5 py-1.5 border border-line">
                  <div className="flex items-center gap-1">
                    <label className="sr-only" htmlFor={`lv-${k}`}>Level {k + 1} name</label>
                    <input id={`lv-${k}`} disabled={disabled} value={l} onChange={(e) => renameLevel(k, e.target.value)}
                      className="w-full min-w-0 bg-transparent text-2xs font-semibold uppercase tracking-wide text-muted px-1 py-1 rounded focus:bg-surface focus:outline-none focus:ring-2 focus:ring-brand/30" />
                    {!disabled && r.levels.length > 2 && <button type="button" aria-label={`Remove level ${l}`} onClick={() => dropLevel(k)} className="text-subtle hover:text-bad cursor-pointer"><X className="size-3.5" aria-hidden /></button>}
                  </div>
                </th>))}
              {!disabled && <th className="border border-line w-10 px-1"><button type="button" aria-label="Add a level" title="Add a level" onClick={addLevel} className="text-subtle hover:text-ink cursor-pointer"><Plus className="size-4 mx-auto" aria-hidden /></button></th>}
            </tr>
          </thead>
          <tbody>
            {r.criteria.map((c, i) => (
              <tr key={c.id} className="align-top">
                <td className="border border-line p-1.5">
                  <div className="flex items-start gap-1.5">
                    <span className="font-mono text-2xs font-semibold text-subtle pt-1.5">R{i + 1}</span>
                    <label className="sr-only" htmlFor={`cn-${c.id}`}>Criterion {i + 1}</label>
                    <Grow id={`cn-${c.id}`} disabled={disabled} value={c.name} onChange={(e) => setC(i, { name: e.target.value })} placeholder="Criterion"
                      className="w-full min-w-0 rounded border border-transparent bg-transparent px-1.5 py-1 font-medium hover:border-line focus:border-brand focus:outline-none" />
                  </div>
                </td>
                <td className="border border-line p-1.5">
                  <label className="sr-only" htmlFor={`cm-${c.id}`}>Marks for criterion {i + 1}</label>
                  <Input id={`cm-${c.id}`} type="number" min={0} disabled={disabled} className="h-8 w-16" value={c.max} onChange={(e) => setC(i, { max: Number(e.target.value) })} />
                  {!disabled && <div className="flex gap-1 mt-1.5">
                    <button type="button" title="Split the marks evenly into bands" aria-label={`Split marks into bands for criterion ${i + 1}`} onClick={() => spread(i)} className="p-1 rounded text-subtle hover:text-ink hover:bg-sunken cursor-pointer"><Rows3 className="size-3.5" aria-hidden /></button>
                    <button type="button" title="Remove criterion" aria-label={`Remove criterion ${i + 1}`} onClick={() => onChange({ ...r, criteria: r.criteria.filter((_, j) => j !== i) })} className="p-1 rounded text-subtle hover:text-bad hover:bg-sunken cursor-pointer"><Trash2 className="size-3.5" aria-hidden /></button>
                  </div>}
                </td>
                {c.levels.map((l, k) => (
                  <td key={k} className="border border-line p-1.5">
                    <div className="flex items-center gap-1 mb-1 text-2xs text-muted">
                      <label className="sr-only" htmlFor={`b-${c.id}-${k}-lo`}>{l.label} lowest mark</label>
                      <input id={`b-${c.id}-${k}-lo`} type="number" min={0} disabled={disabled} value={l.min ?? ''} onChange={(e) => setBand(i, k, { min: num(e.target.value) })}
                        className="w-11 h-6 rounded border border-line bg-surface px-1 tabular text-ink" />
                      <span aria-hidden>–</span>
                      <label className="sr-only" htmlFor={`b-${c.id}-${k}-hi`}>{l.label} highest mark</label>
                      <input id={`b-${c.id}-${k}-hi`} type="number" min={0} disabled={disabled} value={l.max ?? ''} onChange={(e) => setBand(i, k, { max: num(e.target.value) })}
                        className="w-11 h-6 rounded border border-line bg-surface px-1 tabular text-ink" />
                    </div>
                    <label className="sr-only" htmlFor={`b-${c.id}-${k}`}>{l.label} description</label>
                    <Grow id={`b-${c.id}-${k}`} disabled={disabled} value={l.text} onChange={(e) => setBand(i, k, { text: e.target.value })}
                      className="w-full min-w-[9rem] rounded border border-transparent bg-transparent px-1 py-0.5 text-2xs leading-relaxed text-muted hover:border-line focus:border-brand focus:text-ink focus:outline-none" />
                  </td>))}
                {!disabled && <td className="border border-line" />}
              </tr>))}
          </tbody>
        </table>
      </div>
      {!disabled && <div className="px-4"><Button size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => onChange({ ...r, criteria: [...r.criteria, blankCriterion(r.levels)] })}>Add criterion</Button></div>}
      <div className="px-4"><Field label="Note to students" htmlFor="rb-note"><Textarea id="rb-note" disabled={disabled} className="min-h-14" value={r.note} onChange={(e) => onChange({ ...r, note: e.target.value })} /></Field></div>

      <div className="border-t border-line">
        <div className="px-4 pt-3"><h3 className="text-sm font-semibold">Criteria → COs</h3>
          <p className="text-2xs text-muted">Each criterion's marks count toward the COs it links to.</p></div>
        <ConnectBoard nouns={{ left: 'criterion', right: 'CO' }} disabled={disabled} onChange={(i, links) => setC(i, { cos: links })}
          left={live.criteria.map((c, i) => ({ key: c.id, code: `R${i + 1}`, label: c.name, badge: `${c.max} marks`, links: c.cos }))}
          right={cos.map((c, i) => ({ key: c.id, code: `CO${i + 1}`, label: c.statement, meta: perCo[c.id] ? `${perCo[c.id]} marks` : undefined }))}
          empty={<p className="px-4 py-4 text-sm text-muted">Add the COs first (COs & mapping).</p>} />
      </div>
      {checks.length > 0 && <div className="px-4 pb-4"><Callout tone="warn" title="Check before using">
        <ul className="list-disc pl-4 space-y-0.5">{checks.slice(0, 8).map((w) => <li key={w}>{w}</li>)}{checks.length > 8 && <li>and {checks.length - 8} more</li>}</ul></Callout></div>}
    </div>
  );
}
