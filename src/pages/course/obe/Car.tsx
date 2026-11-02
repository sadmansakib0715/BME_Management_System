import { ListPlus, Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Callout, Card, CardHeader, Field, StatusBadge, Textarea, useToast } from '@/components/ui';
import { must, useWrite } from '@/lib/api';
import { attained, coCodes, fmtPct, mappedPos, nearThreshold, PO_CODES, valueOf } from '@/lib/obe';
import { supabase } from '@/lib/supabase';
import { useTerm } from '@/lib/TermContext';
import type { CarStatus, CoPo, CourseOutcome, ObeAttainment } from '@/lib/types';
import type { StatusOption } from '@/lib/workflow';
import type { ObeProps } from './shared';

const CAR_STATES: StatusOption[] = [{ value: 'draft', label: 'Draft' }, { value: 'submitted', label: 'Submitted' }, { value: 'reviewed', label: 'Reviewed' }, { value: 'final', label: 'Final' }];

/** Course Assessment Report (spec section 9): parts A and B come from the data; teachers write C–E. */
export default function Car({ offering, course, data, obe, canEdit, isAdmin }: ObeProps) {
  const toast = useToast();
  const { teachersOf, nameOf } = useTerm();
  const car = obe.car;
  const status: CarStatus = car?.status ?? 'draft';
  const blank = { part_c: car?.part_c ?? '', part_d: car?.part_d ?? '', part_e: car?.part_e ?? '' };
  const [parts, setParts] = useState(blank);
  useEffect(() => setParts({ part_c: car?.part_c ?? '', part_d: car?.part_d ?? '', part_e: car?.part_e ?? '' }), [car]);
  const dirty = JSON.stringify(parts) !== JSON.stringify(blank);
  const locked = status === 'final' || (!isAdmin && status !== 'draft');
  const editable = canEdit && !locked;

  const coT = Number(offering.cohort_threshold ?? 0.4), poT = Number(offering.po_threshold ?? 0.4);
  const mapped = mappedPos(obe.cos, obe.coPo);
  const flags = [
    ...obe.cos.map((_, i) => `CO${i + 1}`).filter((c) => { const v = valueOf(obe.attainment, 'CO', c); return attained(v, coT) === false || nearThreshold(v, coT); }),
    ...[...mapped].filter((p) => { const v = valueOf(obe.attainment, 'PO', p); return attained(v, poT) === false || nearThreshold(v, poT); }),
  ];
  const missing = obe.cos.map((_, i) => `CO${i + 1}`).filter((c) => valueOf(obe.attainment, 'CO', c) === null);
  const needText = flags.length > 0 && (!parts.part_c.trim() || !parts.part_e.trim());

  const write = useWrite((patch: Record<string, unknown>) => must(supabase.from('car_reports').upsert({ offering_id: offering.id, ...parts, status, ...patch, updated_at: new Date().toISOString() })));
  const toCqi = useWrite(() => must(supabase.from('cqi_items').insert({ loop: 'CO', source: 'CAR', offering_id: offering.id, course_code: course.code,
    finding: flags.length ? `Below or near threshold: ${flags.join(', ')}` : 'CAR recommendation', action: parts.part_e.trim(), effective_term: 'Next offering' })));
  const go = (patch: Record<string, unknown>, msg: string) => write.mutate(patch, { onSuccess: () => toast('ok', msg), onError: (e) => toast('bad', e.message) });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">Status</span><StatusBadge opts={CAR_STATES} value={status} />
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" icon={<Printer className="size-4" aria-hidden />} onClick={() => window.print()}>Print or save as PDF</Button>
          {editable && <Button size="sm" disabled={!dirty} loading={write.isPending} onClick={() => go({}, 'CAR saved')}>Save draft</Button>}
          {canEdit && status === 'draft' && <Button size="sm" variant="primary" disabled={needText || missing.length > 0} loading={write.isPending} onClick={() => go({ status: 'submitted' }, 'CAR submitted for review')}>Submit</Button>}
          {isAdmin && status === 'submitted' && <Button size="sm" variant="primary" onClick={() => go({ status: 'reviewed' }, 'Marked reviewed')}>Mark reviewed</Button>}
          {isAdmin && status === 'reviewed' && <Button size="sm" variant="primary" disabled={missing.length > 0} onClick={() => go({ status: 'final' }, 'CAR is final')}>Finalise</Button>}
          {isAdmin && status !== 'draft' && <Button size="sm" variant="ghost" onClick={() => go({ status: 'draft' }, 'Reopened as draft')}>Reopen</Button>}
        </div>
      </div>
      {missing.length > 0 && <Callout tone="warn" title="Info missing">{missing.join(', ')} {missing.length === 1 ? 'has' : 'have'} no attainment result. Add it in Attainment before submitting.</Callout>}
      {flags.length > 0 && <Callout tone="info" title="Comment and action needed">{flags.join(', ')} {flags.length === 1 ? 'is' : 'are'} below or within 10 points of the threshold, so Part C needs a comment and Part E an action.</Callout>}

      <Card className="car-print">
        <CardHeader title={`Course Assessment Report · ${course.code}`} subtitle={data.term.name} />
        <div className="p-4 space-y-6">
          <section>
            <h3 className="text-sm font-semibold mb-2">A. Course information</h3>
            <dl className="grid grid-cols-[160px_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted">Course</dt><dd>{course.code} · {course.title}</dd>
              <dt className="text-muted">Level and term</dt><dd>{course.level ? `Level ${course.level}${course.term_no ? `, Term ${course.term_no}` : ''}` : '—'}{offering.batch ? ` · Cohort ${offering.batch}` : ''}</dd>
              <dt className="text-muted">Academic term</dt><dd>{data.term.name}</dd>
              <dt className="text-muted">Teachers</dt><dd>{teachersOf(offering.id).map(nameOf).join(', ') || '—'}</dd>
              <dt className="text-muted">Last term offered</dt><dd>{obe.prev?.termName ?? '—'}</dd>
            </dl>
          </section>
          <section>
            <h3 className="text-sm font-semibold mb-2">B. Attainment for the previous and current terms</h3>
            {obe.prev && <PartB title={`Previous · ${obe.prev.termName}`} att={obe.prev.attainment} cos={obe.prev.cos} coPo={obe.prev.coPo} coT={coT} poT={poT} />}
            <PartB title={`Current · ${data.term.name}`} att={obe.attainment} cos={obe.cos} coPo={obe.coPo} coT={coT} poT={poT} />
          </section>
          <section className="space-y-4">
            <Field label="C. Comments: on attainment, on the BSFS student feedback, and on teaching and learning" htmlFor="car-c">
              <Textarea id="car-c" className="min-h-28 print:hidden" disabled={!editable} value={parts.part_c} onChange={(e) => setParts({ ...parts, part_c: e.target.value })} />
              <p className="hidden print:block whitespace-pre-wrap text-sm">{parts.part_c}</p></Field>
            <Field label="D. CQI implemented: changes made because of the last CAR or BUGS resolution" htmlFor="car-d"
              hint={obe.prev?.car?.part_e ? <>Last CAR's planned actions: “{obe.prev.car.part_e.slice(0, 160)}{obe.prev.car.part_e.length > 160 ? '…' : ''}”
                {editable && !parts.part_d.trim() && <> · <button type="button" className="link" onClick={() => setParts({ ...parts, part_d: `Planned last term: ${obe.prev!.car!.part_e}\n\nDone: ` })}>Start from them</button></>}</> : undefined}>
              <Textarea id="car-d" className="min-h-24 print:hidden" disabled={!editable} value={parts.part_d} onChange={(e) => setParts({ ...parts, part_d: e.target.value })} />
              <p className="hidden print:block whitespace-pre-wrap text-sm">{parts.part_d}</p></Field>
            <Field label="E. Recommendation: major issues and the plan for future actions" htmlFor="car-e">
              <Textarea id="car-e" className="min-h-24 print:hidden" disabled={!editable} value={parts.part_e} onChange={(e) => setParts({ ...parts, part_e: e.target.value })} />
              <p className="hidden print:block whitespace-pre-wrap text-sm">{parts.part_e}</p></Field>
            {canEdit && parts.part_e.trim() && <Button size="sm" variant="ghost" icon={<ListPlus className="size-4" aria-hidden />} loading={toCqi.isPending}
              onClick={() => toCqi.mutate(undefined, { onSuccess: () => toast('ok', 'Added to the CQI log for the next offering'), onError: (e) => toast('bad', e.message) })}>Send Part E to the CQI log</Button>}
          </section>
          <section>
            <h3 className="text-sm font-semibold mb-2">Signatures</h3>
            <div className="grid sm:grid-cols-2 gap-4">{teachersOf(offering.id).map((t) => (
              <div key={t} className="text-sm"><div className="h-10 border-b border-line-strong" /><div className="mt-1">{nameOf(t)}</div></div>))}</div>
          </section>
        </div>
      </Card>
    </div>
  );
}

function PartB({ title, att, cos, coPo, coT, poT }: { title: string; att: ObeAttainment[]; cos: CourseOutcome[]; coPo: CoPo[]; coT: number; poT: number }) {
  const mapped = mappedPos(cos, coPo);
  const cell = (type: 'CO' | 'PO', code: string, used: boolean, t: number) => {
    const v = used ? valueOf(att, type, code) : null;
    const a = attained(v, t);
    return { pct: used ? fmtPct(v) : 'NA', yn: !used || a === null ? 'NA' : a ? 'Y' : 'N', cls: !used || a === null ? 'text-subtle' : a ? 'text-ok' : 'text-bad' };
  };
  const block = (type: 'CO' | 'PO', codes: string[], used: (c: string, i: number) => boolean, t: number) => (
    <table className="table text-2xs mb-2">
      <thead><tr><th>{title}</th>{codes.map((c) => <th key={c} className="text-center">{c}</th>)}</tr></thead>
      <tbody>
        <tr><td className="font-semibold">{type} %</td>{codes.map((c, i) => <td key={c} className="text-center tabular">{cell(type, c, used(c, i), t).pct}</td>)}</tr>
        <tr><td className="font-semibold">Attained</td>{codes.map((c, i) => { const x = cell(type, c, used(c, i), t); return <td key={c} className={`text-center font-semibold ${x.cls}`}>{x.yn}</td>; })}</tr>
      </tbody>
    </table>
  );
  return (
    <div className="overflow-x-auto">
      {block('CO', coCodes(), (_, i) => i < cos.length, coT)}
      {block('PO', PO_CODES, (c) => mapped.has(c), poT)}
    </div>
  );
}
