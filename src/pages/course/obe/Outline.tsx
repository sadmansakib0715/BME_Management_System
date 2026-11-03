import { Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Callout, Card, CardHeader, Empty, Field, Textarea, useToast } from '@/components/ui';
import { must, rpc, useWrite } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import type { ObeProps } from './shared';

const FILE_LABEL: Record<string, string> = { co_po_mapping: 'CO-PO mapping', outline: 'Course outline', assessment_workbook: 'CO-PO-assessment workbook' };

/** The course outline of this offering (contents and objectives are edited here), with what the department folder holds for it. */
export default function Outline({ offering, obe, canEdit }: ObeProps) {
  const toast = useToast();
  const d = obe.docs;
  const blank = { contents: d?.contents ?? '', objectives: d?.objectives ?? '' };
  const [v, setV] = useState(blank);
  useEffect(() => setV({ contents: d?.contents ?? '', objectives: d?.objectives ?? '' }), [d]);
  const dirty = JSON.stringify(v) !== JSON.stringify(blank);
  const save = useWrite(() => must(supabase.from('obe_offering_docs').upsert({ offering_id: offering.id, contents: v.contents.trim() || null, objectives: v.objectives.trim() || null, updated_at: new Date().toISOString() })));
  const fill = useWrite(() => rpc.copyForward(offering.id));
  const files = Object.entries(d?.source?.files ?? {});

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Course contents and objectives" subtitle="As in the course outline. Objectives one per line. Carried into the next offering of the course."
          actions={canEdit && <>
            {!d && obe.prev && <Button size="sm" icon={<Copy className="size-4" aria-hidden />} loading={fill.isPending}
              onClick={() => fill.mutate(undefined, { onSuccess: () => toast('ok', `Filled from ${obe.prev!.termName}`), onError: (e) => toast('bad', e.message) })}>Fill from {obe.prev.termName}</Button>}
            <Button size="sm" variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: () => toast('ok', 'Outline saved'), onError: (e) => toast('bad', e.message) })}>Save</Button></>} />
        <div className="p-4 grid gap-4 lg:grid-cols-2">
          <Field label="Course contents" htmlFor="o-contents"><Textarea id="o-contents" className="min-h-48" disabled={!canEdit} value={v.contents} onChange={(e) => setV({ ...v, contents: e.target.value })} /></Field>
          <Field label="Course objectives" htmlFor="o-objectives"><Textarea id="o-objectives" className="min-h-48" disabled={!canEdit} value={v.objectives} onChange={(e) => setV({ ...v, objectives: e.target.value })} /></Field>
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Course teachers in the outline" subtitle="As written in the outline document. Teaching assignments for the term are set under Term setup." />
          {!d?.instructors.length ? <p className="px-4 py-4 text-sm text-muted">None recorded.</p> : (
            <table className="table"><thead><tr><th>Name</th><th>Room</th><th>Email</th></tr></thead>
              <tbody>{d.instructors.map((i, k) => <tr key={k}><td className="text-sm">{i.name}</td><td className="text-sm text-muted">{i.room ?? '—'}</td><td className="text-sm text-muted">{i.email ?? '—'}</td></tr>)}</tbody></table>)}
        </Card>
        <Card>
          <CardHeader title="In the department OBE folder" subtitle="BME BUET OBE Documents (SharePoint)." />
          {!d?.source?.folder && !files.length ? <p className="px-4 py-4 text-sm text-muted">Nothing recorded for this offering.</p> : (
            <dl className="divide-y divide-line">
              {d?.source?.folder && <div className="px-4 py-2 text-sm grid grid-cols-[140px_1fr] gap-2"><dt className="text-muted">Folder</dt><dd className="font-mono text-2xs break-all">{d.source.folder}</dd></div>}
              {files.map(([k, f]) => <div key={k} className="px-4 py-2 text-sm grid grid-cols-[140px_1fr] gap-2"><dt className="text-muted">{FILE_LABEL[k] ?? k}</dt><dd className="font-mono text-2xs break-all">{f}</dd></div>)}
            </dl>)}
        </Card>
      </div>

      {d && d.issues.length > 0 && <Callout tone="warn" title="Gaps found in the department folder"><ul className="list-disc pl-5">{d.issues.map((i) => <li key={i}>{i}</li>)}</ul></Callout>}

      {d?.outline_text ? <Card>
        <details><summary className="px-4 py-3 text-sm font-semibold cursor-pointer">Full text of the outline document</summary>
          <pre className="px-4 pb-4 text-2xs whitespace-pre-wrap font-sans text-muted">{d.outline_text}</pre></details>
      </Card> : !d && <Card><Empty title="No outline yet">{obe.prev ? `Fill it from ${obe.prev.termName}, or type the contents and objectives above.` : 'Type the contents and objectives above.'}</Empty></Card>}
    </div>
  );
}
