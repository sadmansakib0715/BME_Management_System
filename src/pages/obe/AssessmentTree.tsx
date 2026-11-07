import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { Button, Input, Select } from '@/components/ui';
import type { CO } from '@/lib/courseFolder/model';
import { canUseTheory, kindOf, type Plan, type PlanItem } from '@/lib/courseFolder/plan';

const r2 = (x: number) => Math.round(x * 100) / 100;
const fmt = (x: number) => String(r2(x));

/** The assessments read from the outline, as a tree (course → assessment → its COs), editable before the marks sheet is made.
    Each assessment is one column of the marks sheet, however many COs it assesses. */
export function AssessmentTree({ plan, onChange, cos, courseLabel, sessional, disabled }: {
  plan: Plan; onChange: (p: Plan) => void; cos: CO[]; courseLabel: string; sessional: boolean; disabled?: boolean;
}) {
  const setItem = (k: number, it: PlanItem) => onChange({ ...plan, items: plan.items.map((x, j) => (j === k ? it : x)) });
  const toggleCo = (k: number, co: number) => {
    const it = plan.items[k];
    setItem(k, { ...it, cos: it.cos.includes(co) ? it.cos.filter((c) => c !== co) : [...it.cos, co].sort((a, b) => a - b) });
  };
  const setPct = (k: number, pct: number) => setItem(k, { ...plan.items[k], pct, marks: r2((plan.total * pct) / 100) });
  const add = () => onChange({ ...plan, items: [...plan.items, { name: '', pct: 0, kind: 'other', cos: [], marks: 0, count: 1 }] });
  /** Moves an assessment up or down: the marks sheet's columns follow this order. */
  const move = (k: number, d: -1 | 1) => {
    const j = k + d;
    if (j < 0 || j >= plan.items.length) return;
    const items = [...plan.items];
    [items[k], items[j]] = [items[j], items[k]];
    onChange({ ...plan, items });
  };
  const remove = (k: number) => onChange({ ...plan, items: plan.items.filter((_, j) => j !== k) });
  const pct = plan.items.reduce((a, i) => a + i.pct, 0), marks = plan.items.reduce((a, i) => a + i.marks, 0);
  const theoryOk = canUseTheory(plan.items);

  return (
    <div className="space-y-3">
      {!sessional && <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="tree-layout" className="text-muted">Marks sheet</label>
        <Select id="tree-layout" className="h-8 w-auto" disabled={disabled} value={plan.layout} onChange={(e) => onChange({ ...plan, layout: e.target.value as Plan['layout'] })}>
          <option value="theory" disabled={!theoryOk}>Department theory workbook (attendance, class tests, term final by question)</option>
          <option value="columns">One column per assessment</option>
        </Select>
      </div>}
      <div className="rounded border border-line">
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-line bg-sunken/50 text-sm">
          <span className="font-semibold">{courseLabel}</span>
          <span className={`tabular text-2xs ${Math.abs(pct - 100) > 0.01 || Math.abs(marks - plan.total) > 0.01 ? 'text-warn font-semibold' : 'text-muted'}`}>{fmt(pct)}% · {fmt(marks)} / {fmt(plan.total)} marks</span>
        </div>
        <div className="hidden sm:flex items-center gap-2 px-3 pt-2 text-2xs font-semibold uppercase tracking-wide text-subtle" aria-hidden>
          <span className="w-16">{plan.layout === 'columns' ? 'Column' : ''}</span><span className="flex-1 min-w-40">Assessment (from the outline)</span><span className="w-[5.5rem] text-right">Weight</span>
          <span className="w-20 text-right">Marks</span><span className="w-24 text-center">How many taken</span>{!disabled && <span className="w-8" />}
        </div>
        <ul className="divide-y divide-line">
          {plan.items.map((it, k) => (
            <li key={k} className="px-3 py-2.5 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="w-16 flex items-center gap-0.5">
                  <span className="w-5 text-2xs text-muted tabular text-right" title={plan.layout === 'columns' ? `Column ${k + 1} of the marks sheet` : undefined}>{k + 1}</span>
                  {!disabled && <div className="flex flex-col">
                    <button type="button" className="h-4 w-6 grid place-items-center rounded text-muted hover:text-ink hover:bg-sunken disabled:opacity-30 cursor-pointer disabled:cursor-default"
                      disabled={k === 0} aria-label={`Move ${it.name || 'assessment'} up`} title="Move up (earlier column)" onClick={() => move(k, -1)}><ChevronUp className="size-3.5" aria-hidden /></button>
                    <button type="button" className="h-4 w-6 grid place-items-center rounded text-muted hover:text-ink hover:bg-sunken disabled:opacity-30 cursor-pointer disabled:cursor-default"
                      disabled={k === plan.items.length - 1} aria-label={`Move ${it.name || 'assessment'} down`} title="Move down (later column)" onClick={() => move(k, 1)}><ChevronDown className="size-3.5" aria-hidden /></button>
                  </div>}
                </div>
                <label className="sr-only" htmlFor={`tree-name-${k}`}>Assessment name</label>
                <Input id={`tree-name-${k}`} className="h-8 flex-1 min-w-40" disabled={disabled} placeholder="Assessment, e.g. Quiz" value={it.name}
                  onChange={(e) => setItem(k, { ...it, name: e.target.value, kind: kindOf(e.target.value) })} />
                <label className="sr-only" htmlFor={`tree-pct-${k}`}>Weight (%)</label>
                <div className="w-[5.5rem] flex items-center justify-end gap-1"><Input id={`tree-pct-${k}`} type="number" min={0} max={100} step="any" className="h-8 w-20 text-right" disabled={disabled}
                  value={it.pct} onChange={(e) => setPct(k, Number(e.target.value) || 0)} /><span className="text-2xs text-muted">%</span></div>
                <span className="text-2xs text-muted tabular w-20 text-right">{fmt(it.marks)} marks</span>
                <div className="w-24 flex items-center justify-center gap-1" title="How many were taken, e.g. 2 lab tests. Marks are unaffected; the course folder gets a folder for each: Lab Test 01, Lab Test 02.">
                  <span className="text-2xs text-muted sm:hidden">How many taken</span><span className="text-2xs text-muted hidden sm:inline" aria-hidden>×</span>
                  <Input id={`tree-count-${k}`} type="number" min={1} max={30} step={1} className="h-8 w-14 text-right" disabled={disabled} aria-label={`How many ${it.name || 'assessments'} were taken`}
                    value={it.count ?? 1} onChange={(e) => setItem(k, { ...it, count: Math.min(30, Math.max(1, Math.floor(Number(e.target.value) || 1))) })} />
                </div>
                {!disabled && <button type="button" className="size-8 grid place-items-center rounded text-muted hover:text-bad hover:bg-sunken cursor-pointer" aria-label={`Remove ${it.name || 'assessment'}`} onClick={() => remove(k)}><Trash2 className="size-4" aria-hidden /></button>}
              </div>
              <div className="pl-5 flex flex-wrap items-center gap-1.5" role="group" aria-label={`COs assessed by ${it.name || 'this assessment'}`}>
                <span className="text-2xs text-subtle mr-1">COs</span>
                {cos.map((c) => { const on = it.cos.includes(c.no); return (
                  <button key={c.no} type="button" disabled={disabled} aria-pressed={on} title={c.statement} onClick={() => toggleCo(k, c.no)}
                    className={`h-6 px-2 rounded-full text-2xs font-mono font-semibold border transition-colors duration-150 cursor-pointer ${on ? 'bg-brand text-brand-fg border-brand' : 'bg-surface text-muted border-line hover:border-brand'}`}>CO{c.no}</button>); })}
                {!it.cos.length && <span className="text-2xs text-warn">{it.kind === 'attendance' ? 'no CO (not counted for attainment)' : 'pick a CO'}</span>}
                {it.cos.length > 1 && <span className="text-2xs text-muted">one column; its marks count for CO{it.cos.join(' and CO')}</span>}
              </div>
            </li>
          ))}
        </ul>
        <p className="px-3 pt-2 text-2xs text-subtle">{plan.layout === 'columns' ? 'Use the arrows to reorder: the marks sheet has the assessments in this order, left to right.' : 'The department theory workbook has its own fixed sheets (attendance, class tests, term final), so the order here does not change it.'}</p>
        {!disabled && <div className="px-3 py-2 border-t border-line"><Button size="sm" variant="ghost" icon={<Plus className="size-4" aria-hidden />} onClick={add}>Add assessment</Button></div>}
      </div>
    </div>
  );
}
