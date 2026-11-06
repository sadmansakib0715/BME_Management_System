import { Download, FileSpreadsheet, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Callout, Card, CardHeader, Dialog, Field, Input, useToast } from '@/components/ui';
import { rpc, useWrite } from '@/lib/api';
import { buildResultsWorkbook, buildTemplate, computeAttainment, coPoCodes, DEPT_CODE, mapFingerprint, marksheetColumns, parseIrregular, parseMarksheet, parseMissing, studentIds, withIrregular,
  type AttainmentResult, type Issue, type StudentResult, type Thresholds } from '@/lib/attainment';
import { criteriaWarnings, fmtPct } from '@/lib/obe';
import { YesNo, type ObeProps } from './shared';

type Preview = { fileName: string; issues: Issue[]; result: AttainmentResult | null };
const fileSafe = (s: string) => s.replace(/[^\w.-]+/g, '_');
const errorsOf = (xs: Issue[]) => xs.filter((i) => i.level === 'error');
const warningsOf = (xs: Issue[]) => xs.filter((i) => i.level === 'warning');
// The batch, student count and missing rolls are remembered per offering in this browser, as a convenience.
type Roll = { batch: string; count: string; missing: string; irregular: string };
const rollKey = (id: string) => `marksheet-rolls:${id}`;
const loadRoll = (id: string): Roll => { try { return { batch: '', count: '50', missing: '', irregular: '', ...JSON.parse(localStorage.getItem(rollKey(id)) ?? '{}') }; } catch { return { batch: '', count: '50', missing: '', irregular: '' }; } };

/** Calculate CO and PO attainment from a filled marksheet. The template comes from the assessment map, so once the COs, mapping and
    assessment map are set, uploading the marks is all that is left. Marks are read here in the browser and never stored. */
export default function MarksheetCalc({ offering, course, data, obe, canEdit }: ObeProps) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [roll, setRollState] = useState<Roll>(() => loadRoll(offering.id));
  const setRoll = (p: Partial<Roll>) => setRollState((r) => { const n = { ...r, ...p }; try { localStorage.setItem(rollKey(offering.id), JSON.stringify(n)); } catch { /* private window */ } return n; });
  const batchOk = /^\d{2}$/.test(roll.batch.trim());
  const countN = Number(roll.count);
  const countOk = Number.isInteger(countN) && countN >= 1 && countN <= 999;
  const missing = useMemo(() => parseMissing(roll.missing, roll.batch.trim()), [roll.missing, roll.batch]);
  const irregular = useMemo(() => parseIrregular(roll.irregular), [roll.irregular]);
  const ids = useMemo(() => (batchOk && countOk ? withIrregular(studentIds(roll.batch.trim(), countN, missing.rolls), irregular.ids) : []), [batchOk, countOk, roll.batch, countN, missing, irregular]);
  const t: Thresholds = { studentCo: Number(offering.co_threshold ?? 0.4), cohortCo: Number(offering.cohort_threshold ?? 0.4),
    studentPo: Number(offering.po_threshold ?? 0.4), cohortPo: Number(offering.po_threshold ?? 0.4) };
  const columns = useMemo(() => marksheetColumns(obe.cos, obe.criteria, obe.criterionCos), [obe.cos, obe.criteria, obe.criterionCos]);
  const coToPo = useMemo(() => coPoCodes(obe.cos, obe.coPo), [obe.cos, obe.coPo]);
  const coCodes = obe.cos.map((_, i) => `CO${i + 1}`);
  const mapWarnings = criteriaWarnings(obe.cos, obe.criteria, obe.criterionCos);
  const title = `${course.code} · ${course.title} · ${data.term.name}`;
  const run = obe.run;
  const stale = run && (run.map_hash !== mapFingerprint(columns, coToPo) || JSON.stringify(run.thresholds) !== JSON.stringify(t));

  const downloadTemplate = async () => {
    setBusy(true);
    try {
      const X = await import('xlsx');
      X.writeFile(buildTemplate(X, { title, columns, studentIds: ids }), fileSafe(`${course.code} ${data.term.name} marksheet.xlsx`));
    } catch (e) { toast('bad', (e as Error).message); } finally { setBusy(false); }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const X = await import('xlsx');
      const wb = X.read(await f.arrayBuffer(), { type: 'array' });
      const parsed = parseMarksheet(X, wb, columns);
      const result = errorsOf(parsed.issues).length ? null : computeAttainment({ columns, students: parsed.students, coCodes, coToPo, t });
      setPreview({ fileName: f.name, issues: [...parsed.issues, ...(result?.issues ?? [])], result });
    } catch (e) { toast('bad', `Could not read ${f.name}: ${(e as Error).message}`); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  };

  const save = useWrite((p: Preview) => {
    const r = p.result!;
    return rpc.saveComputed({
      offering: offering.id,
      cohort: [...coCodes.map((c) => ({ outcome_type: 'CO', code: c, value: r.co[c].value })),
        ...Object.entries(r.po).map(([c, v]) => ({ outcome_type: 'PO', code: c, value: v.value }))],
      students: r.students.flatMap((s) => [...Object.entries(s.co).map(([c, v]) => ({ student_no: s.studentNo, outcome_type: 'CO', code: c, value: v })),
        ...Object.entries(s.po).map(([c, v]) => ({ student_no: s.studentNo, outcome_type: 'PO', code: c, value: v }))]),
      run: { file_name: p.fileName, students: r.students.length, columns: columns.length, thresholds: t, map_hash: mapFingerprint(columns, coToPo),
        warnings: warningsOf(p.issues).map((i) => i.message), samples: r.samples },
    });
  });

  // Results workbook rebuilt from what was saved (per-student CO%/PO%), for the course file.
  const downloadResults = async () => {
    const X = await import('xlsx');
    const rt = run?.thresholds ?? t;
    const byStudent = new Map<string, StudentResult>();
    for (const s of obe.students) {
      const r = byStudent.get(s.student_no) ?? { studentNo: s.student_no, name: '', co: {}, po: {} };
      (s.outcome_type === 'CO' ? r.co : r.po)[s.code] = s.value === null ? null : Number(s.value);
      byStudent.set(s.student_no, r);
    }
    const students = [...byStudent.values()];
    const cohort = (pick: (s: StudentResult) => number | null | undefined, st: number, ct: number) => {
      const vals = students.map(pick).filter((v): v is number => v !== null && v !== undefined);
      const count = vals.filter((v) => v >= st * 100 - 1e-9).length;
      const value = vals.length ? (count / vals.length) * 100 : null;
      return { value, attained: value === null ? null : value >= ct * 100 - 1e-9, count, n: vals.length };
    };
    const poCodes = [...new Set(obe.students.filter((s) => s.outcome_type === 'PO').map((s) => s.code))].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
    const result: AttainmentResult = { students, issues: [], samples: run?.samples ?? [],
      co: Object.fromEntries(coCodes.map((c) => [c, cohort((s) => s.co[c], rt.studentCo, rt.cohortCo)])),
      po: Object.fromEntries(poCodes.map((p) => [p, cohort((s) => s.po[p], rt.studentPo, rt.cohortPo)])) };
    X.writeFile(buildResultsWorkbook(X, { title, result, coCodes, t: rt }), fileSafe(`${course.code} ${data.term.name} attainment.xlsx`));
  };

  const ready = obe.cos.length > 0 && columns.length > 0;
  const studentRows = useMemo(() => {
    const m = new Map<string, Record<string, number | null>>();
    for (const s of obe.students) m.set(s.student_no, { ...(m.get(s.student_no) ?? {}), [s.code]: s.value === null ? null : Number(s.value) });
    return [...m.entries()];
  }, [obe.students]);
  const poCols = [...new Set(obe.students.filter((s) => s.outcome_type === 'PO').map((s) => s.code))].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));

  return (
    <>
      <Card>
        <CardHeader title="Calculate from the marksheet"
          subtitle={<>Download the template (one column per question part or criterion in the <Link className="link" to="?s=assessment">assessment map</Link>, already tagged to COs), fill in the marks and upload it. CO and PO attainment are calculated at once. Marks stay on your computer; only the results are saved.</>}
          actions={<>
            {canEdit && <><input ref={input} type="file" accept=".xlsx,.xls,.csv" className="sr-only" id="marksheet-file" onChange={(e) => onFile(e.target.files?.[0])} />
              <Button size="sm" variant="primary" icon={<Upload className="size-4" aria-hidden />} disabled={!ready || busy} onClick={() => input.current?.click()}>Upload marksheet</Button></>}
          </>} />
        <div className="p-4 space-y-3 text-sm">
          {!obe.cos.length && <Callout tone="warn">Add the COs and their PO mapping first (COs & mapping).</Callout>}
          {obe.cos.length > 0 && !columns.length && <Callout tone="warn" title="The assessment map is empty">
            Add the question parts and rubric criteria with their marks and COs under <Link className="link" to="?s=assessment">Assessment map</Link>. The marksheet template is built from it.</Callout>}
          {ready && <div className="rounded border border-line p-3 space-y-3">
            <div className="grid gap-3 sm:grid-cols-[7rem_8rem_1fr_auto] sm:items-end">
              <Field label="Batch" htmlFor="ms-batch"><Input id="ms-batch" inputMode="numeric" maxLength={2} placeholder="e.g. 20" value={roll.batch} onChange={(e) => setRoll({ batch: e.target.value.replace(/\D/g, '') })} /></Field>
              <Field label="Number of students" htmlFor="ms-count"><Input id="ms-count" type="number" min={1} max={999} value={roll.count} onChange={(e) => setRoll({ count: e.target.value })} /></Field>
              <Field label="Missing rolls" htmlFor="ms-missing"><Input id="ms-missing" placeholder="e.g. 7, 23, 41-42 or 2018007" value={roll.missing} onChange={(e) => setRoll({ missing: e.target.value })} /></Field>
              <Button icon={<Download className="size-4" aria-hidden />} disabled={!batchOk || !countOk || busy} loading={busy && !preview} onClick={downloadTemplate}>Marksheet template</Button>
            </div>
            <Field label="Irregular students (full IDs)" htmlFor="ms-irregular" hint="Repeaters or students of other batches, added to the list."><Input id="ms-irregular" className="sm:max-w-md" placeholder="e.g. 1918045, 2018112" value={roll.irregular} onChange={(e) => setRoll({ irregular: e.target.value })} /></Field>
            <p className="text-muted">
              {batchOk && countOk && ids.length > 0
                ? <>Student IDs <span className="font-mono">{ids[0]}</span> to <span className="font-mono">{ids[ids.length - 1]}</span>, {ids.length} students{missing.rolls.size > 0 && <> ({[...missing.rolls].filter((r) => r <= countN).length} missing left out)</>}{irregular.ids.length > 0 && <>, including {irregular.ids.length} irregular</>}. </>
                : <>Enter the batch to fill in the student IDs (batch + {DEPT_CODE} + roll, e.g. 20{DEPT_CODE}001). </>}
              {columns.length} {columns.length === 1 ? 'column' : 'columns'} from the assessment map, CO1–CO{obe.cos.length}, student threshold {t.studentCo * 100}%, cohort threshold {t.cohortCo * 100}%.
            </p>
            {[...missing.bad, ...irregular.bad].length > 0 && <p className="text-2xs text-warn">Not understood, ignored: {[...missing.bad, ...irregular.bad].join(', ')}{irregular.bad.length > 0 && ' (irregular students need the full 7-digit ID)'}</p>}
          </div>}
          {ready && mapWarnings.length > 0 && <Callout tone="warn" title="Fix the assessment map first">
            <ul className="list-disc pl-5">{mapWarnings.slice(0, 6).map((w) => <li key={w}>{w}</li>)}</ul></Callout>}
          {run && <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded border border-line bg-sunken/50 px-3 py-2">
            <FileSpreadsheet className="size-4 text-muted" aria-hidden />
            <span>Last calculated {new Date(run.computed_at).toLocaleString()} from <span className="font-medium">{run.file_name ?? 'a marksheet'}</span>: {run.students} students, {run.columns} columns.</span>
            {studentRows.length > 0 && <Button size="sm" variant="ghost" icon={<Download className="size-4" aria-hidden />} onClick={downloadResults}>Results workbook</Button>}
            <Link className="link text-sm" to="?s=car">Open the CAR</Link>
          </div>}
          {stale && <Callout tone="warn" title="Results may be out of date">The assessment map, CO→PO mapping or thresholds changed after the last calculation. Upload the marksheet again (download a fresh template if columns changed).</Callout>}
          {run && run.samples.length > 0 && <div className="overflow-x-auto"><table className="table">
            <thead><tr><th>Sample scripts for the course file</th><th className="text-right">Max</th><th className="text-right">Mean</th><th>Highest</th><th>Average</th><th>Lowest</th></tr></thead>
            <tbody>{run.samples.map((s) => <tr key={s.assessment}><td className="text-sm">{s.assessment}</td><td className="text-right tabular text-sm">{s.max}</td>
              <td className="text-right tabular text-sm">{s.mean === null ? 'NA' : s.mean.toFixed(2)}</td>
              {[s.highest, s.average, s.lowest].map((x, i) => <td key={i} className="text-sm tabular">{x ? <><span className="font-mono">{x.studentNo}</span> <span className="text-muted">({x.total})</span></> : '—'}</td>)}
            </tr>)}</tbody></table></div>}
          {studentRows.length > 0 && <details className="rounded border border-line">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Individual attainment ({studentRows.length} students)</summary>
            <div className="overflow-x-auto max-h-[28rem]"><table className="table">
              <thead><tr><th>Student</th>{coCodes.map((c) => <th key={c} className="text-right">{c}</th>)}{poCols.map((p) => <th key={p} className="text-right">{p}</th>)}</tr></thead>
              <tbody>{studentRows.map(([no, v]) => <tr key={no}><td className="font-mono text-2xs">{no}</td>
                {[...coCodes, ...poCols].map((c) => { const x = v[c] ?? null; const low = x !== null && x < (c.startsWith('CO') ? t.studentCo : t.studentPo) * 100;
                  return <td key={c} className={`text-right tabular text-2xs ${low ? 'text-bad font-semibold' : ''}`}>{x === null ? 'NA' : x.toFixed(1)}</td>; })}</tr>)}</tbody>
            </table></div></details>}
        </div>
      </Card>

      <Dialog open={!!preview} onClose={() => setPreview(null)} title={`Check before saving · ${preview?.fileName ?? ''}`} wide
        footer={<><Button onClick={() => setPreview(null)}>Cancel</Button>
          <Button variant="primary" disabled={!preview?.result || save.isPending} loading={save.isPending}
            onClick={() => preview && save.mutate(preview, { onSuccess: () => { toast('ok', `Attainment calculated for ${preview.result!.students.length} students. Part B of the CAR is filled in.`); setPreview(null); }, onError: (e) => toast('bad', e.message) })}>
            Save results</Button></>}>
        {preview && <div className="space-y-3">
          {errorsOf(preview.issues).length > 0 && <Callout tone="bad" title="Fix these in the marksheet and upload again">
            <ul className="list-disc pl-5">{errorsOf(preview.issues).slice(0, 15).map((i) => <li key={i.message}>{i.message}</li>)}</ul>
            {errorsOf(preview.issues).length > 15 && <p className="text-2xs mt-1">…and {errorsOf(preview.issues).length - 15} more.</p>}</Callout>}
          {warningsOf(preview.issues).length > 0 && <Callout tone="warn" title="Check">
            <ul className="list-disc pl-5">{warningsOf(preview.issues).slice(0, 10).map((i) => <li key={i.message}>{i.message}</li>)}</ul></Callout>}
          {preview.result && <>
            <p className="text-sm text-muted">{preview.result.students.length} students. Saving replaces this offering's cohort CO/PO results and individual results.</p>
            <div className="grid gap-4 md:grid-cols-2">
              <table className="table"><thead><tr><th>CO</th><th className="text-right">% students</th><th className="text-right">Attained / n</th><th>Y/N</th></tr></thead>
                <tbody>{coCodes.map((c) => { const v = preview.result!.co[c]; return <tr key={c}><td className="font-mono font-semibold">{c}</td>
                  <td className="text-right tabular text-sm">{fmtPct(v.value)}</td><td className="text-right tabular text-2xs text-muted">{v.count} / {v.n}</td>
                  <td>{v.value === null ? <span className="text-2xs text-warn font-medium">Info missing</span> : <YesNo value={v.value} threshold={t.cohortCo} />}</td></tr>; })}</tbody></table>
              <table className="table"><thead><tr><th>PO</th><th className="text-right">% students</th><th className="text-right">Attained / n</th><th>Y/N</th></tr></thead>
                <tbody>{Object.entries(preview.result.po).map(([p, v]) => <tr key={p}><td className="font-mono font-semibold">{p}</td>
                  <td className="text-right tabular text-sm">{fmtPct(v.value)}</td><td className="text-right tabular text-2xs text-muted">{v.count} / {v.n}</td>
                  <td><YesNo value={v.value} threshold={t.cohortPo} /></td></tr>)}</tbody></table>
            </div>
          </>}
        </div>}
      </Dialog>
    </>
  );
}
