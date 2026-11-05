import { ClipboardPaste } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button, Callout, Card, CardHeader, Dialog, Field, Input, Textarea, useToast } from '@/components/ui';
import { must, usePOs, useWrite } from '@/lib/api';
import { fmtPct, mappedPos, parseAttainment, PO_CODES, valueOf } from '@/lib/obe';
import { supabase } from '@/lib/supabase';
import MarksheetCalc from './MarksheetCalc';
import { PctBar, YesNo, type ObeProps } from './shared';

type Values = Record<string, string>; // 'CO1' | 'PO5' → typed text

/** Cohort CO% and PO% for this offering: calculated from an uploaded marksheet, or imported from the course workbook / typed in. Y/N uses ≥ on the unrounded value. */
export default function Attainment({ offering, course, data, obe, canEdit, isAdmin }: ObeProps) {
  const toast = useToast();
  const pos = usePOs();
  const coT = Number(offering.cohort_threshold ?? 0.4), poT = Number(offering.po_threshold ?? 0.4);
  const mapped = mappedPos(obe.cos, obe.coPo);
  const initial = useMemo<Values>(() => Object.fromEntries(obe.attainment.filter((a) => a.value !== null).map((a) => [a.code, String(Number(a.value))])), [obe.attainment]);
  const [vals, setVals] = useState<Values>(initial);
  useEffect(() => setVals(initial), [initial]);
  const [paste, setPaste] = useState<string | null>(null);
  const [settings, setSettings] = useState({ student_batch: offering.student_batch ?? '', co: String(Number(offering.co_threshold ?? 0.4) * 100), cohort: String(coT * 100), po: String(poT * 100) });
  const num = (code: string) => (vals[code] === undefined || vals[code].trim() === '' ? null : Number(vals[code]));
  const bad = Object.entries(vals).filter(([, v]) => v.trim() !== '' && !(Number(v) >= 0 && Number(v) <= 100)).map(([k]) => k);
  const dirty = JSON.stringify(vals) !== JSON.stringify(initial);

  const save = useWrite(async (a: { v: Values; source: 'manual' | 'import' }) => {
    const codes = [...obe.cos.map((_, i) => `CO${i + 1}`), ...PO_CODES];
    const rows = codes.filter((c) => (a.v[c] ?? '').trim() !== '').map((c) => ({ offering_id: offering.id, outcome_type: c.slice(0, 2), code: c, value: Number(a.v[c]), source: a.source, updated_at: new Date().toISOString() }));
    const cleared = codes.filter((c) => (a.v[c] ?? '').trim() === '' && initial[c] !== undefined);
    if (rows.length) await must(supabase.from('obe_attainment').upsert(rows, { onConflict: 'offering_id,outcome_type,code' }));
    if (cleared.length) await must(supabase.from('obe_attainment').delete().eq('offering_id', offering.id).in('code', cleared));
  });
  const saveSettings = useWrite(() => must(supabase.from('offerings').update({ student_batch: settings.student_batch.trim() || null,
    co_threshold: Number(settings.co) / 100, cohort_threshold: Number(settings.cohort) / 100, po_threshold: Number(settings.po) / 100 }).eq('id', offering.id)));

  const parsed = paste === null ? [] : parseAttainment(paste);
  const prev = obe.prev;
  const prevVal = (type: 'CO' | 'PO', code: string) => (prev ? valueOf(prev.attainment, type, code) : null);
  const missing = obe.cos.map((_, i) => `CO${i + 1}`).filter((c) => num(c) === null);

  const computed = obe.attainment.some((a) => a.source === 'computed');
  return (
    <div className="space-y-5">
      <MarksheetCalc offering={offering} course={course} obe={obe} canEdit={canEdit} isAdmin={isAdmin} data={data} />
      <Card>
        <CardHeader title="Thresholds" subtitle="A student attains a CO at the student threshold; the cohort attains it when that share of students do. Stored with this offering so past terms stay as they were." />
        <div className="p-4 flex flex-wrap items-end gap-3">
          <Field label="Student CO (%)" htmlFor="t-co" className="w-32"><Input id="t-co" type="number" min={0} max={100} disabled={!isAdmin} value={settings.co} onChange={(e) => setSettings({ ...settings, co: e.target.value })} /></Field>
          <Field label="Cohort CO (%)" htmlFor="t-cohort" className="w-32"><Input id="t-cohort" type="number" min={0} max={100} disabled={!isAdmin} value={settings.cohort} onChange={(e) => setSettings({ ...settings, cohort: e.target.value })} /></Field>
          <Field label="PO (%)" htmlFor="t-po" className="w-32"><Input id="t-po" type="number" min={0} max={100} disabled={!isAdmin} value={settings.po} onChange={(e) => setSettings({ ...settings, po: e.target.value })} /></Field>
          {course.is_culminating && <Field label="Student batch" htmlFor="t-batch" hint="For program PO, e.g. BME 20" className="w-40"><Input id="t-batch" disabled={!isAdmin} value={settings.student_batch} onChange={(e) => setSettings({ ...settings, student_batch: e.target.value })} /></Field>}
          {isAdmin && <Button loading={saveSettings.isPending} onClick={() => saveSettings.mutate(undefined, { onSuccess: () => toast('ok', 'Settings saved'), onError: (e) => toast('bad', e.message) })}>Save settings</Button>}
        </div>
      </Card>

      <Card>
        <CardHeader title="CO attainment (cohort)" subtitle={`Share of students who reached ${Number(offering.co_threshold ?? 0.4) * 100}% on each CO. Attained at ≥ ${coT * 100}%.${computed ? ' Calculated from the uploaded marksheet; editing a value here overrides it.' : ''}${prev ? ` Previous: ${prev.termName}.` : ''}`}
          actions={canEdit && <>
            <Button size="sm" icon={<ClipboardPaste className="size-4" aria-hidden />} onClick={() => setPaste('')}>Paste from workbook</Button>
            <Button size="sm" variant="primary" disabled={!dirty || bad.length > 0} loading={save.isPending}
              onClick={() => save.mutate({ v: vals, source: 'manual' }, { onSuccess: () => toast('ok', 'Attainment saved'), onError: (e) => toast('bad', e.message) })}>Save</Button></>} />
        {obe.cos.length === 0 ? <p className="px-4 py-5 text-sm text-muted">Add the COs first (COs & mapping).</p> : (
          <div className="overflow-x-auto"><table className="table">
            <thead><tr><th>CO</th><th className="min-w-48">Statement</th><th className="w-28">Cohort %</th><th className="min-w-40">Against threshold</th><th>Y/N</th>{prev && <th className="text-right">{prev.termName}</th>}</tr></thead>
            <tbody>{obe.cos.map((c, i) => { const code = `CO${i + 1}`; return (
              <tr key={c.id}>
                <td className="font-mono font-semibold">{code}</td>
                <td className="text-2xs text-muted"><span className="line-clamp-2">{c.statement}</span></td>
                <td><label htmlFor={`a-${code}`} className="sr-only">{code} cohort percent</label>
                  <Input id={`a-${code}`} className="h-8 w-24 text-right tabular" inputMode="decimal" disabled={!canEdit} value={vals[code] ?? ''} placeholder="—" onChange={(e) => setVals((v) => ({ ...v, [code]: e.target.value }))} /></td>
                <td><PctBar value={num(code)} threshold={coT} label={code} /></td>
                <td>{num(code) === null ? <span className="text-2xs text-warn font-medium">Info missing</span> : <YesNo value={num(code)} threshold={coT} />}</td>
                {prev && <td className="text-right text-2xs tabular text-muted">{fmtPct(prevVal('CO', code))}</td>}
              </tr>); })}</tbody>
          </table></div>
        )}
      </Card>

      <Card>
        <CardHeader title="PO attainment (cohort-course)" subtitle={`Share of students whose course PO% reached the threshold. Attained at ≥ ${poT * 100}%. POs no CO maps to are NA.`} />
        <div className="overflow-x-auto"><table className="table">
          <thead><tr><th>PO</th><th className="min-w-40">Attribute</th><th className="w-28">Cohort %</th><th className="min-w-40">Against threshold</th><th>Y/N</th>{prev && <th className="text-right">{prev.termName}</th>}</tr></thead>
          <tbody>{(pos.data?.pos ?? []).map((p) => { const na = !mapped.has(p.code); return (
            <tr key={p.code} className={na ? 'opacity-60' : undefined}>
              <td className="font-mono font-semibold">{p.code}</td>
              <td className="text-2xs text-muted">{p.title}</td>
              <td>{na ? <span className="text-2xs text-subtle">NA</span> : <><label htmlFor={`a-${p.code}`} className="sr-only">{p.code} cohort percent</label>
                <Input id={`a-${p.code}`} className="h-8 w-24 text-right tabular" inputMode="decimal" disabled={!canEdit} value={vals[p.code] ?? ''} placeholder="—" onChange={(e) => setVals((v) => ({ ...v, [p.code]: e.target.value }))} /></>}</td>
              <td>{!na && <PctBar value={num(p.code)} threshold={poT} label={p.code} />}</td>
              <td><YesNo value={na ? null : num(p.code)} threshold={poT} /></td>
              {prev && <td className="text-right text-2xs tabular text-muted">{fmtPct(prevVal('PO', p.code))}</td>}
            </tr>); })}</tbody>
        </table></div>
      </Card>

      {bad.length > 0 && <Callout tone="bad">{bad.join(', ')}: enter a percentage between 0 and 100.</Callout>}
      {obe.cos.length > 0 && missing.length > 0 && <Callout tone="warn" title="Info missing">{missing.join(', ')} {missing.length === 1 ? 'has' : 'have'} no result yet. The CAR cannot be finalised until every CO has one.</Callout>}

      <Dialog open={paste !== null} onClose={() => setPaste(null)} title="Paste attainment from the workbook" wide
        footer={<><Button onClick={() => setPaste(null)}>Cancel</Button><Button variant="primary" disabled={!parsed.length} loading={save.isPending}
          onClick={() => { const v = { ...vals }; for (const p of parsed) if (p.type === 'CO' || mapped.has(p.code)) v[p.code] = String(p.value);
            save.mutate({ v, source: 'import' }, { onSuccess: () => { toast('ok', `${parsed.length} results imported`); setPaste(null); }, onError: (e) => toast('bad', e.message) }); }}>Import {parsed.length || ''}</Button></>}>
        <p className="text-sm text-muted">Copy the cohort row from the “Cohort Attainment” sheet (a header row of CO1, CO2… and a row of values), or lines such as <span className="font-mono">CO1 78.43</span>. Fractions like 0.7843 become 78.43%.</p>
        <Textarea className="min-h-32 font-mono text-2xs" value={paste ?? ''} onChange={(e) => setPaste(e.target.value)} aria-label="Pasted attainment" />
        {parsed.length > 0 && <p className="text-2xs text-muted">Found: {parsed.map((p) => `${p.code} ${p.value.toFixed(2)}%${p.type === 'PO' && !mapped.has(p.code) ? ' (NA, skipped)' : ''}`).join(' · ')}</p>}
      </Dialog>
    </div>
  );
}
