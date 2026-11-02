import { useState } from 'react';
import { Card, CardHeader, Callout, Empty, ErrorNote, SegTabs, Spinner } from '@/components/ui';
import { usePOs, useProgramPo } from '@/lib/api';
import { attained, CULMINATING_POS, fmtPct } from '@/lib/obe';
import { PctBar, YesNo } from '../course/obe/shared';

/** Program PO per batch: the mean of BME 300, 350 and 400 cohort PO% (BAETE PO reference, level 4). */
export default function ProgramPo() {
  const prog = useProgramPo();
  const pos = usePOs();
  const batches = [...new Set((prog.data ?? []).map((r) => r.batch))].sort().reverse();
  const [pick, setPick] = useState<string | null>(null);
  if (prog.isLoading || pos.isLoading) return <Spinner />;
  if (prog.error) return <ErrorNote error={prog.error} />;
  if (!batches.length) return <Card><Empty title="No program PO results yet">They appear once BME 300, 350 or 400 have PO attainment and a student batch (set both on the course's OBE tab, under Attainment).</Empty></Card>;
  const batch = pick ?? batches[0];
  const rows = (prog.data ?? []).filter((r) => r.batch === batch);
  const done = new Set(rows.flatMap((r) => r.course_codes));
  const provisional = Object.keys(CULMINATING_POS).filter((c) => !done.has(c));

  return (
    <div className="space-y-4">
      {batches.length > 1 && <SegTabs label="Batch" value={batch} onChange={setPick} options={batches.map((b) => ({ value: b, label: b }))} />}
      {provisional.length > 0 && <Callout tone="info" title="Provisional">{batch} has no PO results yet for {provisional.join(', ')}. Program PO stays provisional until all three culminating courses are in.</Callout>}
      <Card className="overflow-hidden">
        <CardHeader title={`Program PO attainment · ${batch}`} subtitle="Mean of the culminating courses' cohort PO%. Attained at ≥ 40%." />
        <div className="overflow-x-auto"><table className="table">
          <thead><tr><th>PO</th><th className="min-w-40">Attribute</th><th className="text-right">Program %</th><th className="min-w-40">Against 40%</th><th>Y/N</th><th>From</th></tr></thead>
          <tbody>{(pos.data?.pos ?? []).map((p) => { const r = rows.find((x) => x.po_code === p.code); const v = r ? Number(r.value) : null; return (
            <tr key={p.code}>
              <td className="font-mono font-semibold">{p.code}</td><td className="text-2xs text-muted">{p.title}</td>
              <td className="text-right tabular text-sm">{fmtPct(v)}</td>
              <td>{v !== null && <PctBar value={v} label={p.code} />}</td>
              <td><YesNo value={v} /></td>
              <td className="text-2xs text-muted">{r ? r.course_codes.join(', ') : '—'}{r && attained(v) === false && <span className="text-bad"> · CQI needed</span>}</td>
            </tr>); })}</tbody>
        </table></div>
      </Card>
    </div>
  );
}
