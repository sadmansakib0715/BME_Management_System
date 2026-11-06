import { clsx } from 'clsx';
import { Download, FileCheck2, GripVertical, Plus, Trash2, Upload, X } from 'lucide-react';
import { createContext, useContext, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Button, Callout, Input, Spinner, Textarea, useToast } from '@/components/ui';
import { applyDrop, draftGaps, emptyDraft, type DraftPart, type OutlineDraft } from '@/lib/outlineDraft';
import { autoFill } from '@/lib/outlineAutoFill';
import { blockText, docxBlocks, pdfBlocks, type SourceBlock } from '@/lib/sourceDoc';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Which part the dragged text is over, and what to do on a drop: shared by the drop zones. */
const DropCtx = createContext<{ over: DraftPart | null; setOver: (p: DraftPart | null) => void; drop: (part: DraftPart) => (e: DragEvent) => void }>({ over: null, setOver: () => {}, drop: () => () => {} });

/** A part of the template that takes dropped text (lit up while text is dragged over it). */
function Zone({ part, label, hint, children, className }: { part: DraftPart; label: string; hint?: string; children: ReactNode; className?: string }) {
  const { over, setOver, drop } = useContext(DropCtx);
  return (
    <section onDragOver={(e) => { e.preventDefault(); if (over !== part) setOver(part); }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); }}
      onDrop={drop(part)} aria-label={label}
      className={clsx('rounded-md border-2 border-dashed p-2 transition-colors duration-100', over === part ? 'border-brand bg-brand-soft/60' : 'border-transparent hover:border-line', className)}>
      <div className="flex items-baseline justify-between gap-2 mb-1"><h3 className="text-sm font-bold">{label}</h3>{hint && <span className="text-2xs text-subtle">{hint}</span>}</div>
      {children}
    </section>
  );
}

/** A list part (objectives, outcomes, textbooks): one box per item. */
function List({ items, onChange, placeholder, numbered }: { items: string[]; onChange: (v: string[]) => void; placeholder: string; numbered?: boolean }) {
  return (
    <ol className="space-y-1">
      {items.map((x, i) => (
        <li key={i} className="flex items-start gap-1.5">
          <span className="w-5 pt-1.5 text-right text-2xs text-muted tabular">{numbered ? `${i + 1}.` : '●'}</span>
          <Textarea aria-label={`${placeholder} ${i + 1}`} className="min-h-0 h-auto py-1 text-sm flex-1" rows={Math.max(1, Math.ceil(x.length / 80))} placeholder={placeholder} value={x}
            onChange={(e) => onChange(items.map((y, j) => (j === i ? e.target.value : y)))} />
          <Remove onClick={() => onChange(items.length > 1 ? items.filter((_, j) => j !== i) : [''])} />
        </li>
      ))}
      <li><Add onClick={() => onChange([...items, ''])} /></li>
    </ol>
  );
}

/** The outline converter: the teacher's own outline on the left, the department's template on the right. Text selected (or a whole
    block, by its handle) on the left is dragged onto a part of the template, and shaped to it: lists become items, "Lab test (x2): 40%"
    an assessment row, "3 Topic" a schedule row, a teachers table its rows. Every part can also be typed in. */
export function OutlineConverter({ open, onClose, onUse }: { open: boolean; onClose: () => void; onUse: (file: File) => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [blocks, setBlocks] = useState<SourceBlock[] | null>(null);
  const [reading, setReading] = useState(false);
  const [draft, setDraft] = useState<OutlineDraft>(emptyDraft);
  const [over, setOver] = useState<DraftPart | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', esc); document.body.style.overflow = ''; };
  }, [open, onClose]);
  if (!open) return null;

  const load = async (f: File | undefined) => {
    if (!f) return;
    setReading(true);
    try {
      const data = await f.arrayBuffer();
      const b = /\.pdf$/i.test(f.name) ? await pdfBlocks(data) : await docxBlocks(data);
      setBlocks(b); setFileName(f.name);
      setDraft(autoFill(b));   // a first pass with the same rules as dragging; the teacher checks and completes it
      if (!b.length) toast('bad', `No text found in ${f.name}. A scanned PDF has no text: type the parts instead.`);
    } catch (e) { toast('bad', `Could not read ${f.name}: ${(e as Error).message}`); }
    finally { setReading(false); if (input.current) input.current.value = ''; }
  };

  const drop = (part: DraftPart) => (e: DragEvent) => {
    setOver(null);
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;   // dropped straight into a box: the browser inserts the text there
    e.preventDefault();
    const text = e.dataTransfer.getData('text/plain');
    if (text.trim()) setDraft((d) => applyDrop(d, part, text));
  };
  const set = <K extends keyof OutlineDraft>(k: K, v: OutlineDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const gaps = draftGaps(draft);
  const makeDocx = async () => { const { outlineDocx } = await import('@/lib/outlineDocx'); return outlineDocx(draft); };
  const outName = `${draft.courseNo.trim() || 'Course'}_Course outline.docx`.replace(/[\\/:*?"<>|]+/g, '-');
  const download = async () => {
    setBusy(true);
    try {
      const url = URL.createObjectURL(new Blob([await makeDocx()], { type: DOCX }));
      const a = Object.assign(document.createElement('a'), { href: url, download: outName });
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { toast('bad', (e as Error).message); } finally { setBusy(false); }
  };
  const use = async () => {
    setBusy(true);
    try { onUse(new File([await makeDocx()], outName, { type: DOCX })); onClose(); toast('ok', `${outName} is now the course outline in step 1`); }
    catch (e) { toast('bad', (e as Error).message); } finally { setBusy(false); }
  };

  return (
    <DropCtx.Provider value={{ over, setOver, drop }}>
    <div className="fixed inset-0 z-50 flex flex-col bg-bg" role="dialog" aria-modal="true" aria-label="Convert an outline to the department template">
      <header className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2">
        <h2 className="text-base font-semibold mr-2">Convert an outline</h2>
        <input ref={input} type="file" accept=".docx,.pdf" className="sr-only" id="conv-file" onChange={(e) => load(e.target.files?.[0])} />
        <Button size="sm" icon={<Upload className="size-4" aria-hidden />} loading={reading} onClick={() => input.current?.click()}>{fileName ? 'Another file' : 'Teacher’s outline (.docx or .pdf)'}</Button>
        {fileName && <span className="text-2xs text-muted truncate max-w-56">{fileName}</span>}
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" icon={<Download className="size-4" aria-hidden />} loading={busy} onClick={download}>Download outline (.docx)</Button>
          <Button size="sm" variant="primary" icon={<FileCheck2 className="size-4" aria-hidden />} loading={busy} onClick={use}>Use in course folder</Button>
          <button type="button" className="size-9 grid place-items-center rounded hover:bg-sunken cursor-pointer" aria-label="Close" onClick={onClose}><X className="size-5" aria-hidden /></button>
        </div>
      </header>
      <div className="grid flex-1 min-h-0 lg:grid-cols-2">
        {/* left: the teacher's document */}
        <div className="min-h-0 overflow-y-auto border-r border-line bg-sunken/40 p-4">
          {reading ? <Spinner label="Reading the outline" /> : !blocks ? (
            <div className="grid h-full place-items-center text-center text-sm text-muted">
              <div className="max-w-sm space-y-2">
                <p>Upload the teacher's outline in any layout (.docx or .pdf).</p>
                <p className="text-2xs">The parts found are filled in on the right. Then select text here and drag it onto a part of the template, or drag a whole paragraph or table by its handle <GripVertical className="inline size-3.5" aria-hidden />.</p>
              </div>
            </div>
          ) : (
            <article className="mx-auto max-w-2xl rounded bg-surface p-6 shadow-card text-sm leading-relaxed space-y-1.5">
              {blocks.map((b, i) => (
                <div key={i} className="group flex gap-1.5">
                  <span draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', blockText(b)); e.dataTransfer.effectAllowed = 'copy'; }}
                    className="mt-0.5 shrink-0 cursor-grab text-subtle opacity-40 group-hover:opacity-100" title="Drag this whole block" aria-label="Drag this block"><GripVertical className="size-4" aria-hidden /></span>
                  {b.kind === 'p'
                    ? <p className={clsx('flex-1 select-text', b.bold && 'font-semibold', b.list && 'pl-4 -indent-3')}>{b.list && <span aria-hidden>• </span>}{b.text}</p>
                    : <table className="flex-1 border-collapse text-2xs select-text"><tbody>{b.rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci} className="border border-line px-1.5 py-1 align-top whitespace-pre-line">{c}</td>)}</tr>)}</tbody></table>}
                </div>
              ))}
            </article>
          )}
        </div>

        {/* right: the department's template */}
        <div className="min-h-0 overflow-y-auto p-4">
          <article className="mx-auto max-w-2xl rounded bg-surface p-6 shadow-card space-y-3">
            <div className="text-center leading-tight">
              <div className="text-2xs">Bangladesh University of Engineering and Technology</div>
              <div className="text-base font-semibold tracking-wide">DEPARTMENT OF BIOMEDICAL ENGINEERING</div>
              <div className="text-sm mt-1">Course Outline</div>
            </div>
            {gaps.length > 0 && <Callout tone="warn" title="Still to fill">{gaps.join(' · ')}</Callout>}
            <div className="grid gap-1 sm:grid-cols-2">
              {([['courseNo', 'Course No', 'BME 310'], ['title', 'Course Title', 'Course title'], ['credit', 'Credit hours', '1.5'], ['contact', 'Contact hours', '3'],
                ['levelTerm', 'Level/Term', '3/1'], ['session', 'Academic Session', '2023-2024']] as const).map(([k, label, ph]) => (
                <Zone key={k} part={k} label={label} className={k === 'title' ? 'sm:col-span-2 order-first sm:order-none' : undefined}>
                  <Input aria-label={label} className="h-8" placeholder={ph} value={draft[k]} onChange={(e) => set(k, e.target.value)} />
                </Zone>
              ))}
            </div>
            <Zone part="teachers" label="Course Teacher(s)" hint="drop a teachers table or names / emails / phones">
              <div className="space-y-1.5">
                {draft.teachers.map((x, i) => (
                  <div key={i} className="grid grid-cols-[1.4fr_0.8fr_1.4fr_1fr_auto] gap-1">
                    {(['name', 'room', 'email', 'phone'] as const).map((f) => (
                      <Input key={f} aria-label={`Teacher ${i + 1} ${f}`} className="h-8 text-2xs" placeholder={{ name: 'Name', room: 'Office/Room', email: 'Email', phone: 'Telephone' }[f]} value={x[f]}
                        onChange={(e) => set('teachers', draft.teachers.map((y, j) => (j === i ? { ...y, [f]: e.target.value } : y)))} />
                    ))}
                    <Remove onClick={() => set('teachers', draft.teachers.length > 1 ? draft.teachers.filter((_, j) => j !== i) : [{ name: '', room: '', email: '', phone: '' }])} />
                  </div>
                ))}
                <Add onClick={() => set('teachers', [...draft.teachers, { name: '', room: '', email: '', phone: '' }])} />
              </div>
            </Zone>
            <Zone part="routine" label="Class routine" hint="one line each, e.g. Wednesday (A1): 11:00 AM - 01:30 PM">
              <Textarea aria-label="Class routine" className="text-sm min-h-16" value={draft.routine} onChange={(e) => set('routine', e.target.value)} />
            </Zone>
            <Zone part="contents" label="Course Contents"><Textarea aria-label="Course contents" className="text-sm min-h-20" value={draft.contents} onChange={(e) => set('contents', e.target.value)} /></Zone>
            <Zone part="objectives" label="Course Objectives" hint="drop bullet points: one item each"><List items={draft.objectives} onChange={(v) => set('objectives', v)} placeholder="Objective" /></Zone>
            <Zone part="outcomes" label="Course Outcomes" hint="drop the CO list: one CO each"><List items={draft.outcomes} onChange={(v) => set('outcomes', v)} placeholder="CO statement" numbered /></Zone>
            <Zone part="assessment" label="Assessment" hint={'e.g. "Lab test (x2): 40%"'}>
              <div className="space-y-1">
                {draft.assessment.map((x, i) => (
                  <div key={i} className="flex items-center gap-1">
                    <Input aria-label={`Assessment ${i + 1}`} className="h-8 flex-1" placeholder="Assessment" value={x.name} onChange={(e) => set('assessment', draft.assessment.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
                    <span className="text-2xs text-muted">×</span>
                    <Input aria-label={`How many ${x.name || 'assessments'}`} type="number" min={1} className="h-8 w-14 text-right" value={x.count} onChange={(e) => set('assessment', draft.assessment.map((y, j) => (j === i ? { ...y, count: Math.max(1, Math.floor(Number(e.target.value) || 1)) } : y)))} />
                    <Input aria-label={`Weight of ${x.name || 'assessment'}`} className="h-8 w-16 text-right" placeholder="%" value={x.pct} onChange={(e) => set('assessment', draft.assessment.map((y, j) => (j === i ? { ...y, pct: e.target.value } : y)))} />
                    <span className="text-2xs text-muted">%</span>
                    <Remove onClick={() => set('assessment', draft.assessment.length > 1 ? draft.assessment.filter((_, j) => j !== i) : [{ name: '', pct: '', count: 1 }])} />
                  </div>
                ))}
                <Add onClick={() => set('assessment', [...draft.assessment, { name: '', pct: '', count: 1 }])} />
              </div>
            </Zone>
            <Zone part="textbooks" label="Textbooks and References"><List items={draft.textbooks} onChange={(v) => set('textbooks', v)} placeholder="Author, Title, edition, publisher (year)" numbered /></Zone>
            <Zone part="schedule" label="Weekly Schedule" hint="drop the schedule: a row per week; a row without a week number is a break">
              <div className="space-y-1">
                {draft.schedule.map((x, i) => (
                  <div key={i} className="grid grid-cols-[3.5rem_1fr_9rem_auto] gap-1">
                    {(['week', 'topic', 'basis'] as const).map((f) => (
                      <Input key={f} aria-label={`Row ${i + 1} ${f}`} className="h-8 text-2xs" placeholder={{ week: 'Week', topic: 'Topics', basis: 'Evaluation basis' }[f]} value={x[f]}
                        onChange={(e) => set('schedule', draft.schedule.map((y, j) => (j === i ? { ...y, [f]: e.target.value } : y)))} />
                    ))}
                    <Remove onClick={() => set('schedule', draft.schedule.length > 1 ? draft.schedule.filter((_, j) => j !== i) : [{ week: '1', topic: '', basis: '' }])} />
                  </div>
                ))}
                <Add onClick={() => set('schedule', [...draft.schedule, { week: String(draft.schedule.filter((x) => x.week.trim()).length + 1), topic: '', basis: '' }])} />
              </div>
            </Zone>
            <p className="text-2xs text-subtle">“Prepared by” lists the course teachers. The Word file uses the department's layout (US Letter, BUET crest); empty parts keep a grey placeholder.</p>
          </article>
        </div>
      </div>
    </div>
    </DropCtx.Provider>
  );
}

function Remove({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} className="size-8 shrink-0 grid place-items-center rounded text-subtle hover:text-bad hover:bg-sunken cursor-pointer" aria-label="Remove"><Trash2 className="size-3.5" aria-hidden /></button>;
}
function Add({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-2xs font-medium text-muted hover:text-brand-ink cursor-pointer"><Plus className="size-3.5" aria-hidden />Add</button>;
}
