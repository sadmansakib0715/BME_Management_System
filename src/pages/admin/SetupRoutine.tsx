import { CalendarDays, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, CardHeader, Empty, SegTabs, Select, useToast } from '@/components/ui';
import { must, rpc, useWrite } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { useTerm } from '@/lib/TermContext';
import type { AssessmentComponent, AssessmentItem } from '@/lib/types';
import { RescheduleDialog } from '../course/AssessmentsTab';

/** The term's class-test routine in one table: set or move any date. Same rules as the course page (no two class tests for a cohort on one day). */
export default function SetupRoutine() {
  const { data, courseOf } = useTerm();
  const toast = useToast();
  const [scope, setScope] = useState<'ct' | 'all'>('ct');
  const [cohort, setCohort] = useState('');
  const [moving, setMoving] = useState<AssessmentItem | null>(null);
  const kindOf = (i: AssessmentItem) => data!.components.find((c) => c.id === i.component_id)?.kind;

  const planCts = useWrite(async (offering: string) => {
    const c = await must(supabase.from('assessment_components').insert({ offering_id: offering, kind: 'class_test', name: 'Class Test', item_count: 4, marks_each: 20, weight: 20, best_n: 3, per_section: false, sort: 2 }).select().single());
    await rpc.generateItems((c as AssessmentComponent).id);
  });

  const offer = (id: string) => data!.offerings.find((o) => o.id === id);
  const cohorts = [...new Set(data!.offerings.map((o) => o.batch).filter(Boolean))].sort() as string[];
  const rows = data!.items
    .filter((i) => i.status !== 'cancelled' && (scope === 'all' || kindOf(i) === 'class_test') && (!cohort || offer(i.offering_id)?.batch === cohort))
    .map((i) => ({ i, o: offer(i.offering_id)!, c: courseOf(i.offering_id)! })).filter((r) => r.o && r.c)
    .sort((a, b) => (a.i.held_on ?? '9999').localeCompare(b.i.held_on ?? '9999') || a.c.code.localeCompare(b.c.code) || a.i.seq - b.i.seq);
  const clashWith = (r: (typeof rows)[number]) => kindOf(r.i) !== 'class_test' || !r.i.held_on ? [] : data!.items.filter((x) => x.id !== r.i.id && x.held_on === r.i.held_on
    && x.status !== 'cancelled' && kindOf(x) === 'class_test' && offer(x.offering_id)?.batch && offer(x.offering_id)?.batch === r.o.batch);
  const unplanned = data!.offerings.filter((o) => courseOf(o)?.course_type === 'theory' && !data!.components.some((c) => c.offering_id === o.id && c.kind === 'class_test'))
    .sort((a, b) => courseOf(a)!.code.localeCompare(courseOf(b)!.code));
  const undated = rows.filter((r) => !r.i.held_on).length;
  const sec = (id: string | null) => data!.sections.find((s) => s.id === id)?.name;

  return (
    <div className="space-y-5">
      {unplanned.length > 0 && <Card>
        <CardHeader title="Theory courses without class tests" subtitle="Adds the standard four class tests (best three counted). Adjust the count on the course page if needed." />
        <ul className="flex flex-wrap gap-2 p-4">{unplanned.map((o) => (
          <li key={o.id}><Button size="sm" icon={<Plus className="size-4" aria-hidden />} loading={planCts.isPending && planCts.variables === o.id}
            onClick={() => planCts.mutate(o.id, { onSuccess: () => toast('ok', `${courseOf(o)?.code}: four class tests added`), onError: (e) => toast('bad', e.message) })}>{courseOf(o)?.code}</Button></li>))}
        </ul>
      </Card>}

      <Card className="overflow-hidden">
        <CardHeader title="Class-test routine" subtitle={undated ? `${undated} still without a date. Click a date to set or change it.` : 'Click a date to set or change it. Changes appear on everyone’s calendar.'}
          actions={<div className="flex flex-wrap items-center gap-2">
            <label htmlFor="r-cohort" className="sr-only">Cohort</label>
            <Select id="r-cohort" className="h-8 w-36" value={cohort} onChange={(e) => setCohort(e.target.value)}><option value="">All cohorts</option>{cohorts.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
            <SegTabs label="Which items" value={scope} onChange={setScope} options={[{ value: 'ct', label: 'Class tests' }, { value: 'all', label: 'All assessments' }]} />
          </div>} />
        {rows.length === 0 ? <Empty title="Nothing to schedule yet">Add class tests above, or build an assessment plan on a course page.</Empty> : (
          <div className="overflow-x-auto"><table className="table">
            <thead><tr><th>Date</th><th>Course</th><th>Cohort</th><th>Item</th><th>Time</th><th>Note</th></tr></thead>
            <tbody>{rows.map((r) => {
              const clash = clashWith(r);
              return (
                <tr key={r.i.id}>
                  <td>
                    <button type="button" onClick={() => setMoving(r.i)} className="inline-flex items-center gap-1.5 text-sm rounded px-1.5 py-1 -mx-1.5 hover:bg-sunken cursor-pointer" aria-label={`Set date for ${r.c.code} ${r.i.title}`}>
                      <CalendarDays className="size-3.5 text-subtle" aria-hidden />{r.i.held_on ? fmtDate(r.i.held_on, { weekday: 'short', day: 'numeric', month: 'short' }) : <span className="text-brand-ink font-medium">Set date</span>}
                    </button>
                  </td>
                  <td><Link to={`/courses/${r.o.id}/assessments`} className="link font-mono text-sm">{r.c.code}</Link></td>
                  <td className="text-muted text-sm">{r.o.batch ?? '—'}</td>
                  <td className="text-sm">{r.i.title}{sec(r.i.section_id) ? <span className="text-subtle"> · {sec(r.i.section_id)}</span> : null}</td>
                  <td className="text-sm text-muted">{r.i.held_time ?? ''}</td>
                  <td className="text-2xs">{clash.length > 0 && <span className="text-warn font-medium">Same day as {clash.map((x) => `${courseOf(x.offering_id)?.code} ${x.title}`).join(', ')}</span>}</td>
                </tr>);
            })}</tbody>
          </table></div>
        )}
      </Card>
      <RescheduleDialog item={moving} onClose={() => setMoving(null)} admin />
    </div>
  );
}
