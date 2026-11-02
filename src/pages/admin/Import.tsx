import { FileSpreadsheet, Upload } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Callout, Card, CardHeader, Field, Input, PageHeader, Stat, useToast } from '@/components/ui';
import { rpc, useWrite } from '@/lib/api';
import type { ImportResult } from '@/lib/importer';
import { useTerm } from '@/lib/TermContext';

export default function ImportPage() {
  const toast = useToast();
  const { setTermId } = useTerm();
  const [file, setFile] = useState<File | null>(null);
  const [term, setTerm] = useState({ code: '', name: '', total_weeks: 14, latest_completed_week: 0 });
  const [res, setRes] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useWrite(() => rpc.importPlan({ ...res!.plan, term }));

  async function read(f: File) {
    setFile(f); setBusy(true); setRes(null);
    const guess = f.name.match(/(jan|jul)[a-z]*[\s_-]*(\d{2,4})/i);
    if (guess && !term.code) { const y = guess[2].length === 2 ? `20${guess[2]}` : guess[2]; const mon = guess[1].toLowerCase() === 'jan' ? 'January' : 'July';
      setTerm((t) => ({ ...t, code: `${y}-${mon === 'January' ? '01' : '07'}`, name: `${mon} ${y}` })); }
    try {
      const { parseWorkbook } = await import('@/lib/importer');
      setRes(parseWorkbook(await f.arrayBuffer(), term));
    } catch (e) { toast('bad', `Could not read the workbook: ${(e as Error).message}`); }
    setBusy(false);
  }

  return (
    <>
      <PageHeader eyebrow="Department" title="Import the Activity Tracker workbook" description="Reads the term spreadsheet in your browser, shows every correction it makes, and writes nothing until you confirm. Re-importing the same term updates it in place." />
      <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
        <Card>
          <CardHeader title="1. Choose the file and term" />
          <div className="p-4 space-y-3">
            <label className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-line-strong px-4 py-8 text-center cursor-pointer hover:bg-sunken/60 transition-colors duration-150">
              <FileSpreadsheet className="size-7 text-subtle" aria-hidden />
              <span className="text-sm font-medium">{file ? file.name : 'Choose the .xlsx workbook'}</span>
              <span className="text-2xs text-subtle">The file stays on this computer.</span>
              <input type="file" accept=".xlsx" className="sr-only" onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Term code" htmlFor="i-code"><Input id="i-code" value={term.code} onChange={(e) => setTerm({ ...term, code: e.target.value })} placeholder="2026-01" /></Field>
              <Field label="Term name" htmlFor="i-name"><Input id="i-name" value={term.name} onChange={(e) => setTerm({ ...term, name: e.target.value })} placeholder="January 2026" /></Field>
              <Field label="Teaching weeks" htmlFor="i-w"><Input id="i-w" type="number" value={term.total_weeks} onChange={(e) => setTerm({ ...term, total_weeks: Number(e.target.value) })} /></Field>
              <Field label="Weeks completed" htmlFor="i-c"><Input id="i-c" type="number" value={term.latest_completed_week} onChange={(e) => setTerm({ ...term, latest_completed_week: Number(e.target.value) })} /></Field>
            </div>
            <Button variant="primary" className="w-full" icon={<Upload className="size-4" aria-hidden />} loading={run.isPending || busy}
              disabled={!res || res.errors.length > 0 || !term.code.trim() || !term.name.trim()}
              onClick={() => run.mutate(undefined, { onSuccess: (r) => { toast('ok', `Imported ${r.offerings} courses and ${r.items} assessment items`); setTermId(r.term_id); }, onError: (e) => toast('bad', e.message) })}>
              Import into {term.name || 'term'}</Button>
            <p className="text-2xs text-subtle">Rosters, marks and course outcomes are not in the workbook; add them per course after importing.</p>
          </div>
        </Card>
        <div className="space-y-5">
          {!res ? <Card className="p-6 text-sm text-muted">The preview appears here after you choose a file.</Card> : <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Courses" value={res.plan.offerings.length} sub={`${res.plan.exam.length} with exam chains`} />
              <Stat label="Faculty" value={res.plan.faculty.length} />
              <Stat label="Assessment items" value={res.plan.class_tests.length + res.plan.sessional_items.length} />
              <Stat label="Deadlines" value={res.plan.milestones.length} />
            </div>
            {res.errors.length > 0 && <Callout tone="bad" title={`${res.errors.length} problem${res.errors.length > 1 ? 's' : ''} must be fixed in the workbook first`}>
              <ul className="list-disc pl-5">{res.errors.map((e, i) => <li key={i}>Sheet {e.sheet}: {e.message}</li>)}</ul></Callout>}
            <IssueList title="Needs your review" tone="warn" list={res.warnings} />
            <IssueList title="Fixed automatically" tone="ok" list={res.fixes} />
          </>}
        </div>
      </div>
    </>
  );
}

function IssueList({ title, tone, list }: { title: string; tone: 'warn' | 'ok'; list: ImportResult['fixes'] }) {
  if (!list.length) return null;
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2">{title}<Badge tone={tone}>{list.length}</Badge></span>} />
      <ul className="divide-y divide-line max-h-80 overflow-y-auto">{list.map((f, i) => (
        <li key={i} className="px-4 py-2 text-sm flex gap-3"><span className="font-mono text-2xs text-subtle w-16 shrink-0 pt-0.5">{f.sheet}{f.cell ? ` ${f.cell}` : ''}</span><span>{f.message}</span></li>))}</ul>
    </Card>
  );
}
