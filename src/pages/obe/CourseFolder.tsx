import { CheckCircle2, Download, FileArchive, FileSpreadsheet, FileText, FolderTree, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Badge, Button, Callout, Card, CardHeader, Field, Input, Spinner, useToast } from '@/components/ui';
import { DEPT_CODE, parseMissing, studentIds as rollIds } from '@/lib/attainment';
import type { BuildResult, RollInput, Sources } from '@/lib/courseFolder/build';
import { isSessional, type CO, type CourseInfo, type Outline } from '@/lib/courseFolder/model';
import { checkPlan, type Plan } from '@/lib/courseFolder/plan';
import { AssessmentTree } from './AssessmentTree';
import carUrl from '@/assets/course-folder/car.docx?url';
import coPoUrl from '@/assets/course-folder/co_po_mapping.docx?url';
import instructorsUrl from '@/assets/course-folder/instructors_and_schedule.docx?url';
import outlineTemplateUrl from '@/assets/course-folder/course_outline_template.docx?url';

/** Course folder generator: the faculty fills the course information and the outline, downloads the marks sheet, uploads it
    filled, and gets the whole course file (CAR, CO-PO mapping, instructors & schedule, attainment workbook and report,
    assessment and lecture folders) as a zip. Everything runs in the browser; nothing is stored. */

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
function save(bytes: Uint8Array, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const fetchBytes = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer());
const lib = () => import('@/lib/courseFolder/build');

function FilePick({ id, label, accept, file, onFile }: { id: string; label: string; accept: string; file: File | null; onFile: (f: File | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input ref={ref} id={id} type="file" accept={accept} className="sr-only" onChange={(e) => { onFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
      <Button size="sm" icon={<Upload className="size-4" aria-hidden />} onClick={() => ref.current?.click()}>{label}</Button>
      {file ? <span className="text-2xs text-muted inline-flex items-center gap-1"><CheckCircle2 className="size-3.5 text-ok" aria-hidden />{file.name}
        <button type="button" className="link ml-1" onClick={() => onFile(null)}>Remove</button></span>
        : <span className="text-2xs text-subtle">No file chosen</span>}
    </div>
  );
}

function Step({ n, title, subtitle, children }: { n: number; title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={<span className="inline-flex items-center gap-2"><span className="grid place-items-center size-5 rounded-full bg-brand-soft text-brand-ink text-2xs font-bold">{n}</span>{title}</span>} subtitle={subtitle} />
      <div className="p-4 space-y-3">{children}</div>
    </Card>
  );
}

function Warnings({ list }: { list: string[] }) {
  if (!list.length) return null;
  return (
    <Callout tone="warn" title={`${list.length} thing${list.length === 1 ? '' : 's'} to check`}>
      <ul className="list-disc pl-5 space-y-0.5 text-2xs max-h-48 overflow-y-auto">{list.map((w, i) => <li key={i}>{w}</li>)}</ul>
    </Callout>
  );
}

type Preview = { info: CourseInfo; outline: Outline; warnings: string[] };

export default function CourseFolder({ courseCode, siteCos, termName }: { courseCode?: string; siteCos?: CO[]; termName?: string }) {
  const toast = useToast();
  const [info, setInfo] = useState<File | null>(null);
  const [outline, setOutline] = useState<File | null>(null);
  const [mapping, setMapping] = useState<File | null>(null);
  const [marks, setMarks] = useState<File | null>(null);
  const [previous, setPrevious] = useState<File | null>(null);
  const [roll, setRoll] = useState({ semester: termName ?? '', batch: '', count: '50', missing: '' });
  const [busy, setBusy] = useState<'template' | 'build' | 'blank' | null>(null);
  const [tplWarnings, setTplWarnings] = useState<string[] | null>(null);
  const [result, setResult] = useState<BuildResult | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const fail = (e: unknown) => toast('bad', (e as Error).message ?? String(e));

  // Roll range typed on the page (used only when there is no course information workbook).
  const batch = roll.batch.trim(), count = Number(roll.count);
  const rollOk = /^\d{2}$/.test(batch) && Number.isInteger(count) && count >= 1 && count <= 999 && !!roll.semester.trim();
  const missing = useMemo(() => parseMissing(roll.missing, batch), [roll.missing, batch]);
  const rollInput: RollInput | null = rollOk ? { semester: roll.semester.trim(), batch, count, missingIds: [...missing.rolls].map((r) => `${batch}${DEPT_CODE}${String(r).padStart(3, '0')}`) } : null;
  const ids = rollOk ? rollIds(batch, count, missing.rolls) : [];

  const sources = async (): Promise<Sources> => ({ outline: await outline!.arrayBuffer(), mapping: mapping ? await mapping.arrayBuffer() : null,
    info: info ? await info.arrayBuffer() : null, roll: info ? null : rollInput, siteCos });
  const haveInputs = !!outline && (!!info || !!rollInput);

  // Read the outline (and mapping / course information) as soon as they are chosen, and show what was found.
  const filesKey = [outline, mapping, info].map((f) => (f ? `${f.name}:${f.size}:${f.lastModified}` : '')).join('|');
  const rollKey = info ? '' : JSON.stringify(rollInput);
  const lastFiles = useRef('');
  useEffect(() => {
    if (!haveInputs) { setPreview(null); setPreviewError(null); if (!outline) setPlan(null); return; }
    let live = true;
    setReading(true);
    (async () => {
      try {
        const { previewSources } = await lib();
        const r = await previewSources(await sources());
        if (!live) return;
        setPreview({ info: r.info, outline: r.outline, warnings: r.warnings });
        setPreviewError(null);
        // A new file starts the tree again from the outline; a change of roll range keeps the faculty's edits.
        if (lastFiles.current !== filesKey || !plan) { setPlan(r.plan); lastFiles.current = filesKey; }
      } catch (e) { if (live) { setPreview(null); setPreviewError((e as Error).message); } }
      finally { if (live) setReading(false); }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesKey, rollKey, haveInputs]);

  const check = plan && preview ? checkPlan(plan, preview.outline) : null;

  const blankInfo = async () => {
    setBusy('blank');
    try { const { courseInfoTemplate } = await import('@/lib/courseFolder/workbook'); save(await courseInfoTemplate(), 'course_information.xlsx', XLSX_MIME); }
    catch (e) { fail(e); } finally { setBusy(null); }
  };
  const template = async () => {
    if (!haveInputs || !plan) return;
    setBusy('template');
    try {
      const { buildMarksTemplate } = await lib();
      const t = await buildMarksTemplate(await sources(), plan);
      if (courseCode && t.info.courseNo.replace(/\s/g, '') !== courseCode.replace(/\s/g, '')) toast('bad', `These files are for ${t.info.courseNo}, not ${courseCode}`);
      save(t.bytes, t.fileName, XLSX_MIME);
      setTplWarnings(t.warnings.filter((x) => !preview?.warnings.includes(x)));
      toast('ok', `Marks sheet for ${t.info.courseNo} downloaded`);
    } catch (e) { fail(e); } finally { setBusy(null); }
  };
  const build = async () => {
    if (!haveInputs || !marks) return;
    setBusy('build');
    setResult(null);
    try {
      const { buildCourseFolder } = await lib();
      const [car, coPoMapping, instructors] = await Promise.all([fetchBytes(carUrl), fetchBytes(coPoUrl), fetchBytes(instructorsUrl)]);
      const r = await buildCourseFolder({ ...(await sources()), marks: await marks.arrayBuffer(),
        previous: previous ? await previous.arrayBuffer() : null, templates: { car, coPoMapping, instructors } });
      setResult(r);
      save(r.zip, r.fileName, 'application/zip');
      toast('ok', `${r.fileName} downloaded`);
    } catch (e) { fail(e); } finally { setBusy(null); }
  };

  const a = result?.attainment;
  const folders = result ? [...new Set(result.files.filter((f) => f.endsWith('/')).map((f) => f.split('/').slice(1, -1).join(' / ')).filter(Boolean))] : [];
  const docs = result ? result.files.filter((f) => !f.endsWith('/')).map((f) => f.split('/').slice(1).join(' / ')) : [];

  return (
    <div className="space-y-5">
      <Callout tone="info" title="Course folder generator">
        Upload the course outline (and the CO-PO mapping), check the assessments read from it, download the marks sheet, enter the marks, and upload it back. You get the course file as a zip:
        CAR, CO-PO mapping, instructors &amp; schedule, the CO-PO assessment marks workbook, an attainment report, and the assessment and lecture folders
        (with the highest / average / lowest students to upload scripts for). Files are read in this browser and never stored.
      </Callout>

      <Step n={1} title="Course outline and course information" subtitle="The outline gives the course details, the COs and the assessments with their weights. The department's CO-PO Mapping.docx gives each CO's POs and assessment tools when the outline has no CO table.">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div className="space-y-3">
            <FilePick id="cf-outline" label="Course outline (.docx)" accept=".docx" file={outline} onFile={(f) => { setOutline(f); setResult(null); }} />
            <FilePick id="cf-mapping" label="CO-PO mapping (.docx, optional)" accept=".docx" file={mapping} onFile={(f) => { setMapping(f); setResult(null); }} />
            <FilePick id="cf-info" label="Course information (.xlsx, optional)" accept=".xlsx" file={info} onFile={(f) => { setInfo(f); setResult(null); }} />
            {!info && <div className="rounded border border-line p-3 space-y-2">
              <p className="text-2xs text-muted">No course information workbook: the details come from the outline, and the student IDs from the roll range (batch + {DEPT_CODE} + roll).</p>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Term" htmlFor="cf-sem"><Input id="cf-sem" className="h-8" placeholder="e.g. July 2025" value={roll.semester} onChange={(e) => setRoll({ ...roll, semester: e.target.value })} /></Field>
                <Field label="Batch" htmlFor="cf-batch"><Input id="cf-batch" className="h-8" inputMode="numeric" maxLength={2} placeholder="e.g. 22" value={roll.batch} onChange={(e) => setRoll({ ...roll, batch: e.target.value.replace(/\D/g, '') })} /></Field>
                <Field label="Number of students" htmlFor="cf-count"><Input id="cf-count" className="h-8" type="number" min={1} max={999} value={roll.count} onChange={(e) => setRoll({ ...roll, count: e.target.value })} /></Field>
                <Field label="Missing rolls" htmlFor="cf-missing"><Input id="cf-missing" className="h-8" placeholder="e.g. 7, 23, 41-42" value={roll.missing} onChange={(e) => setRoll({ ...roll, missing: e.target.value })} /></Field>
              </div>
              <p className="text-2xs text-muted">{rollOk && ids.length ? <>Student IDs <span className="font-mono">{ids[0]}</span> to <span className="font-mono">{ids[ids.length - 1]}</span>, {ids.length} students.</> : 'Enter the term and batch.'}
                {missing.bad.length > 0 && <span className="text-warn"> Not understood: {missing.bad.join(', ')}</span>}</p>
            </div>}
            <div className="flex flex-wrap gap-2 pt-1">
              <a className="inline-flex items-center justify-center gap-1.5 rounded font-medium whitespace-nowrap h-8 px-2.5 text-sm bg-surface text-ink border border-line-strong hover:bg-sunken transition-colors duration-150" href={outlineTemplateUrl} download="course_outline_template.docx">
                <FileText className="size-4" aria-hidden />Outline template (.docx)</a>
              <Button size="sm" variant="ghost" icon={<FileSpreadsheet className="size-4" aria-hidden />} loading={busy === 'blank'} onClick={blankInfo}>Blank course_information.xlsx</Button>
            </div>
          </div>
          <div className="space-y-3 min-w-0">
            {!outline ? <p className="text-sm text-muted rounded border border-dashed border-line p-4">Choose the course outline: the course details, COs and assessment tree read from it appear here to check and edit.</p>
              : !haveInputs ? <p className="text-sm text-muted rounded border border-dashed border-line p-4">Add the course information workbook, or enter the term and batch.</p>
              : reading && !preview ? <Spinner label="Reading the outline" />
              : previewError ? <Callout tone="bad" title="Could not read the files">{previewError}</Callout>
              : preview && plan ? <>
                <OutlineSummary info={preview.info} outline={preview.outline} />
                <div>
                  <h3 className="text-2xs font-semibold uppercase tracking-wide text-subtle mb-1.5">Assessments (from the outline, editable)</h3>
                  <AssessmentTree plan={plan} onChange={setPlan} cos={preview.outline.cos} sessional={isSessional(preview.info)}
                    courseLabel={`${preview.info.courseNo} · ${preview.info.credit} credit${preview.info.credit === 1 ? '' : 's'}`} />
                </div>
                {plan && <button type="button" className="link text-2xs" onClick={async () => { const { previewSources } = await lib(); setPlan((await previewSources(await sources())).plan); }}>Reset to the outline</button>}
                <Warnings list={[...preview.warnings, ...(check?.warnings ?? [])]} />
                {check && check.errors.length > 0 && <Callout tone="bad" title="Fix before downloading"><ul className="list-disc pl-5 text-2xs">{check.errors.map((e) => <li key={e}>{e}</li>)}</ul></Callout>}
              </> : null}
          </div>
        </div>
      </Step>

      <Step n={2} title="Marks sheet" subtitle="Built from the assessment tree above: one column per assessment (per CO when it covers several), with its CO and marks. The department theory workbook is used for theory courses assessed by attendance, class tests and the term final. No Position columns.">
        <Button variant="primary" size="sm" icon={<Download className="size-4" aria-hidden />} disabled={!haveInputs || !plan || !preview || !!check?.errors.length} loading={busy === 'template'} onClick={template}>Download marks sheet</Button>
        {tplWarnings && <Warnings list={tplWarnings} />}
      </Step>

      <Step n={3} title="Upload the filled marks and build the folder" subtitle="Abs (or Absent) marks an absent student: absent in every item of a CO leaves them out of that CO; absent in some counts as 0. Thresholds: 40% for students and cohort.">
        <FilePick id="cf-marks" label="Filled marks sheet (.xlsx)" accept=".xlsx" file={marks} onFile={(f) => { setMarks(f); setResult(null); }} />
        <FilePick id="cf-prev" label="Last term's marks workbook (optional)" accept=".xlsx" file={previous} onFile={setPrevious} />
        <p className="text-2xs text-subtle">The optional file is last term's generated “…-CO-PO-Assessment-marks.xlsx”; it fills the CAR's previous-term table.</p>
        <Button variant="primary" icon={<FileArchive className="size-4" aria-hidden />} disabled={!haveInputs || !marks} loading={busy === 'build'} onClick={build}>Build course folder</Button>
      </Step>

      {result && a && (
        <Card>
          <CardHeader title={`${result.info.courseNo} · ${result.outline.title} · ${result.info.semester}`} subtitle={`${result.students} students. The zip has been downloaded.`}
            actions={<Button size="sm" icon={<Download className="size-4" aria-hidden />} onClick={() => save(result.zip, result.fileName, 'application/zip')}>Download again</Button>} />
          <div className="p-4 space-y-4">
            <div className="overflow-x-auto"><table className="table">
              <thead><tr><th>Outcome</th><th className="text-right">Assessed</th><th className="text-right">Attained</th><th className="text-right">Cohort %</th><th>Result</th></tr></thead>
              <tbody>
                {[...a.co].map(([c, x]) => <Row key={`co${c}`} code={`CO${c}`} {...x} />)}
                {[...a.po].map(([p, x]) => <Row key={`po${p}`} code={`PO${p}`} {...x} />)}
              </tbody>
            </table></div>
            <Warnings list={result.warnings} />
            <div className="grid gap-4 md:grid-cols-2">
              <div><h3 className="text-2xs font-semibold uppercase tracking-wide text-subtle mb-1.5 inline-flex items-center gap-1"><FileText className="size-3.5" aria-hidden />Files</h3>
                <ul className="text-2xs text-muted space-y-0.5">{docs.map((f) => <li key={f} className="font-mono">{f}</li>)}</ul></div>
              <div><h3 className="text-2xs font-semibold uppercase tracking-wide text-subtle mb-1.5 inline-flex items-center gap-1"><FolderTree className="size-3.5" aria-hidden />Folders for the teacher to fill</h3>
                <ul className="text-2xs text-muted space-y-0.5">{folders.map((f) => <li key={f} className="font-mono">{f}</li>)}</ul></div>
            </div>
            <p className="text-2xs text-subtle">CAR parts C–E are highlighted placeholders (the attainment comment is a draft). Upload the question papers, scripts and lecture materials into their folders.</p>
          </div>
        </Card>
      )}
    </div>
  );
}

function Row({ code, assessed, attained, pct, ok }: { code: string; assessed: number; attained: number; pct: number | null; ok: boolean | null }) {
  return (
    <tr>
      <td className="font-mono font-semibold">{code}</td>
      <td className="text-right tabular">{assessed}</td>
      <td className="text-right tabular">{attained}</td>
      <td className="text-right tabular">{pct === null ? 'NA' : pct.toFixed(2)}</td>
      <td>{ok === null ? <Badge>NA</Badge> : ok ? <Badge tone="ok">Attained</Badge> : <Badge tone="bad">Not attained</Badge>}</td>
    </tr>
  );
}

/** What was read: course details, teachers and the COs with their POs and assessment tools, to check against the outline. */
function OutlineSummary({ info, outline }: { info: CourseInfo; outline: Outline }) {
  return (
    <div className="rounded border border-line text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-3 py-2.5">
        <dt className="text-muted">Course</dt><dd><span className="font-mono">{info.courseNo}</span> · {outline.title || '—'}</dd>
        <dt className="text-muted">Credit / contact hours</dt><dd className="tabular">{info.credit} / {info.contactHours || '—'}</dd>
        <dt className="text-muted">Level/Term · Session</dt><dd>{info.level || '—'}/{info.term || '—'} · {info.session || '—'}</dd>
        <dt className="text-muted">Teachers</dt><dd>{info.faculties.map((f) => f.name).filter(Boolean).join(', ') || '—'}</dd>
      </dl>
      <ul className="border-t border-line divide-y divide-line">
        {outline.cos.map((c) => (
          <li key={c.no} className="px-3 py-1.5 text-2xs grid grid-cols-[3rem_1fr] gap-2">
            <span className="font-mono font-semibold">CO{c.no}</span>
            <span><span className="text-ink">{c.statement}</span>
              <span className="block text-muted">{c.pos.length ? c.pos.map((p) => `PO${p}`).join(', ') : <span className="text-warn">no PO</span>}{c.tools ? ` · assessed by ${c.tools}` : ''}</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}
