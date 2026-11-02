import { CheckCircle2, Circle, ExternalLink } from 'lucide-react';
import { Card, CardHeader, Input, Meter, useToast } from '@/components/ui';
import { must, useWrite } from '@/lib/api';
import { courseFile } from '@/lib/obe';
import { supabase } from '@/lib/supabase';
import { useTerm } from '@/lib/TermContext';
import type { FileSlot } from '@/lib/types';
import type { ObeProps } from './shared';

/** The course file of spec section 4: derived artefacts tick themselves, the rest are ticked here with a link to the file. */
export default function CourseFile({ offering, obe, canEdit }: ObeProps) {
  const toast = useToast();
  const { teachersOf } = useTerm();
  const items = courseFile({ ...obe, hasTeachers: teachersOf(offering.id).length > 0, hasResolution: !!offering.co_resolution_id });
  const done = items.filter((i) => i.done).length;
  const save = useWrite((a: { slot: FileSlot; done?: boolean; link?: string }) => {
    const cur = obe.files.find((f) => f.slot === a.slot);
    return must(supabase.from('course_file_items').upsert({ offering_id: offering.id, slot: a.slot, done: a.done ?? cur?.done ?? false, link: a.link ?? cur?.link ?? null, updated_at: new Date().toISOString() }));
  });
  const err = (e: Error) => toast('bad', e.message);

  return (
    <Card>
      <CardHeader title={`Course file · ${done} of ${items.length}`} subtitle="Items marked “from the data” complete themselves. Add a link (OneDrive or Drive) to the others." />
      <div className="px-4 pt-3"><Meter value={done} max={items.length} label="Course file completeness" /></div>
      <ul className="divide-y divide-line mt-2">{items.map((i) => (
        <li key={i.slot} className="px-4 py-2.5 flex flex-wrap items-center gap-3">
          {i.auto ? (i.done ? <CheckCircle2 className="size-5 text-ok shrink-0" aria-hidden /> : <Circle className="size-5 text-line-strong shrink-0" aria-hidden />)
            : <input type="checkbox" className="size-5 accent-[rgb(var(--brand))] cursor-pointer disabled:cursor-default shrink-0" disabled={!canEdit} checked={i.done} aria-label={`${i.label} done`}
                onChange={(e) => save.mutate({ slot: i.slot as FileSlot, done: e.target.checked }, { onError: err })} />}
          <span className="flex-1 min-w-48 text-sm">{i.label}{i.auto && <span className="text-2xs text-subtle"> · from the data</span>}
            <span className="sr-only">{i.done ? ', done' : ', not done'}</span></span>
          {!i.auto && (canEdit
            ? <><label htmlFor={`cf-${i.slot}`} className="sr-only">Link for {i.label}</label>
              <Input id={`cf-${i.slot}`} className="h-8 w-72 max-w-full" placeholder="Link to the file" defaultValue={i.link ?? ''}
                onBlur={(e) => e.target.value.trim() !== (i.link ?? '') && save.mutate({ slot: i.slot as FileSlot, link: e.target.value.trim(), done: e.target.value.trim() ? true : undefined }, { onError: err })} /></>
            : i.link ? <a href={i.link} target="_blank" rel="noreferrer" className="link text-sm inline-flex items-center gap-1">Open<ExternalLink className="size-3.5" aria-hidden /></a> : null)}
        </li>))}</ul>
    </Card>
  );
}
