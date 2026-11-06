import { useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { ActivityLog } from '@/components/ActivityLog';
import { PageHeader, Select, SegTabs } from '@/components/ui';
import { useTerm } from '@/lib/TermContext';

/** The department's activity log: who scheduled, changed or removed what, filterable by person and course. */
export default function Log() {
  const { me } = useAuth();
  const { data, faculty, courseOf, termId } = useTerm();
  const [scope, setScope] = useState<'term' | 'all'>('term');
  const [actor, setActor] = useState('');
  const [offering, setOffering] = useState('');
  const offerings = (data?.offerings ?? []).map((o) => ({ o, c: courseOf(o) })).filter((x) => x.c).sort((a, b) => a.c!.code.localeCompare(b.c!.code));

  return (
    <>
      <PageHeader eyebrow={data?.term.name} title="Activity log" description="Who scheduled, changed or removed what, and when. Newest first. Department-wide changes (people, courses, terms) appear under Everything." />
      <div className="flex flex-wrap items-end gap-3 mb-5">
        <SegTabs label="Which changes" value={scope} onChange={(v) => { setScope(v); if (v === 'all') setOffering(''); }}
          options={[{ value: 'term', label: 'This term' }, { value: 'all', label: 'Everything' }]} />
        <div>
          <label htmlFor="log-person" className="block text-2xs font-medium text-muted mb-1">Person</label>
          <Select id="log-person" className="h-9 w-56" value={actor} onChange={(e) => setActor(e.target.value)}>
            <option value="">Everyone</option>
            {me?.facultyId && <option value={me.facultyId}>Only my changes</option>}
            {faculty.map((f) => <option key={f.id} value={f.id}>{f.display_name}</option>)}
          </Select>
        </div>
        {scope === 'term' && <div>
          <label htmlFor="log-course" className="block text-2xs font-medium text-muted mb-1">Course</label>
          <Select id="log-course" className="h-9 w-56" value={offering} onChange={(e) => setOffering(e.target.value)}>
            <option value="">All courses</option>
            {offerings.map(({ o, c }) => <option key={o.id} value={o.id}>{c!.code} · {c!.title}</option>)}
          </Select>
        </div>}
      </div>
      <ActivityLog filter={{ termId: scope === 'term' && !offering ? termId ?? undefined : undefined, offeringId: offering || undefined, actor: actor || undefined }} />
    </>
  );
}
