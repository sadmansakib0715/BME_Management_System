import { CheckCircle2, Download, FileArchive, FileSpreadsheet, FileText, FolderTree, Upload } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { Badge, Button, Callout, Card, CardHeader, useToast } from '@/components/ui';
import type { BuildResult } from '@/lib/courseFolder/build';
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

export default function CourseFolder({ courseCode }: { courseCode?: string }) {
  const toast = useToast();
  const [info, setInfo] = useState<File | null>(null);
  const [outline, setOutline] = useState<File | null>(null);
  const [marks, setMarks] = useState<File | null>(null);
  const [previous, setPrevious] = useState<File | null>(null);
  const [busy, setBusy] = useState<'template' | 'build' | 'blank' | null>(null);
  const [tplWarnings, setTplWarnings] = useState<string[] | null>(null);
  const [result, setResult] = useState<BuildResult | null>(null);
  const fail = (e: unknown) => toast('bad', (e as Error).message ?? String(e));

  const blankInfo = async () => {
    setBusy('blank');
    try { const { courseInfoTemplate } = await import('@/lib/courseFolder/workbook'); save(await courseInfoTemplate(), 'course_information.xlsx', XLSX_MIME); }
    catch (e) { fail(e); } finally { setBusy(null); }
  };
  const template = async () => {
    if (!info || !outline) return;
    setBusy('template');
    try {
      const { buildMarksTemplate } = await lib();
      const t = await buildMarksTemplate(await info.arrayBuffer(), await outline.arrayBuffer());
      if (courseCode && t.info.courseNo.replace(/\s/g, '') !== courseCode.replace(/\s/g, '')) toast('bad', `These files are for ${t.info.courseNo}, not ${courseCode}`);
      save(t.bytes, t.fileName, XLSX_MIME);
      setTplWarnings(t.warnings);
      toast('ok', `Marks sheet for ${t.info.courseNo} (${t.sessional ? 'sessional' : 'theory'}) downloaded`);
    } catch (e) { fail(e); } finally { setBusy(null); }
  };
  const build = async () => {
    if (!info || !outline || !marks) return;
    setBusy('build');
    setResult(null);
    try {
      const { buildCourseFolder } = await lib();
      const [car, coPoMapping, instructors] = await Promise.all([fetchBytes(carUrl), fetchBytes(coPoUrl), fetchBytes(instructorsUrl)]);
      const r = await buildCourseFolder({ info: await info.arrayBuffer(), outline: await outline.arrayBuffer(), marks: await marks.arrayBuffer(),
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
        Fill the course information and the course outline, download the marks sheet, enter the marks, and upload it back. You get the course file as a zip:
        CAR, CO-PO mapping, instructors &amp; schedule, the CO-PO assessment marks workbook, an attainment report, and the assessment and lecture folders
        (with the highest / average / lowest students to upload scripts for). Files are read in this browser and never stored.
      </Callout>

      <Step n={1} title="Course information and outline" subtitle="The course information workbook has a sections sheet with the roll range per section; the outline is the website outline format (CO table, distribution of marks).">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={<FileSpreadsheet className="size-4" aria-hidden />} loading={busy === 'blank'} onClick={blankInfo}>Blank course_information.xlsx</Button>
          <a className="inline-flex items-center justify-center gap-1.5 rounded font-medium whitespace-nowrap h-8 px-2.5 text-sm bg-surface text-ink border border-line-strong hover:bg-sunken transition-colors duration-150" href={outlineTemplateUrl} download="course_outline_template.docx">
            <FileText className="size-4" aria-hidden />Outline template (.docx)</a>
        </div>
        <FilePick id="cf-info" label="Course information (.xlsx)" accept=".xlsx" file={info} onFile={(f) => { setInfo(f); setResult(null); }} />
        <FilePick id="cf-outline" label="Course outline (.docx)" accept=".docx" file={outline} onFile={(f) => { setOutline(f); setResult(null); }} />
      </Step>

      <Step n={2} title="Marks sheet" subtitle="Student IDs come from the sections sheet (batch + 18 + roll). Theory courses use the BME 211 workbook: enter attendance, CTs, term-final sections, and each Q1/Q5 sub-part with its marks and CO. Sessional courses get one column per assessment.">
        <Button variant="primary" size="sm" icon={<Download className="size-4" aria-hidden />} disabled={!info || !outline} loading={busy === 'template'} onClick={template}>Download marks sheet</Button>
        {tplWarnings && <Warnings list={tplWarnings} />}
      </Step>

      <Step n={3} title="Upload the filled marks and build the folder" subtitle="Abs (or Absent) marks an absent student: absent in every item of a CO leaves them out of that CO; absent in some counts as 0. Thresholds: 40% for students and cohort.">
        <FilePick id="cf-marks" label="Filled marks sheet (.xlsx)" accept=".xlsx" file={marks} onFile={(f) => { setMarks(f); setResult(null); }} />
        <FilePick id="cf-prev" label="Last term's marks workbook (optional)" accept=".xlsx" file={previous} onFile={setPrevious} />
        <p className="text-2xs text-subtle">The optional file is last term's generated “…-CO-PO-Assessment-marks.xlsx”; it fills the CAR's previous-term table.</p>
        <Button variant="primary" icon={<FileArchive className="size-4" aria-hidden />} disabled={!info || !outline || !marks} loading={busy === 'build'} onClick={build}>Build course folder</Button>
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
