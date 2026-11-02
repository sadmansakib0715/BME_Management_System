import { useAuth } from '@/auth/AuthProvider';
import { DueLabel } from '@/components/bits';
import { Card, CardHeader, Select, useToast } from '@/components/ui';
import { must, useWrite } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { milestone } from '@/lib/tasks';
import { useTerm } from '@/lib/TermContext';
import { CAR_STATUS, FEEDBACK_STATUS, OUTLINE_STATUS, type StatusOption } from '@/lib/workflow';
import type { MilestoneKind } from '@/lib/types';
import type { TabProps } from './shared';

const MILESTONES: [MilestoneKind, string][] = [['outline_sharing', 'Outline shared with students'], ['question_submission', 'Question submission'],
  ['feedback_deadline', 'Student feedback'], ['theory_gradesheet', 'Theory gradesheet to HOD'], ['sessional_gradesheet', 'Sessional gradesheet'], ['car_deadline', 'Course File and CAR']];

export default function Overview({ offering, course, data }: TabProps) {
  const { me, isAdmin } = useAuth();
  const { teachersOf, nameOf } = useTerm();
  const toast = useToast();
  const canEdit = isAdmin || teachersOf(offering.id).includes(me?.facultyId ?? '');
  const rec = data.records.find((r) => r.offering_id === offering.id);
  const save = useWrite((patch: Record<string, string>) => must(supabase.from('course_records').update({ ...patch, updated_at: new Date().toISOString() }).eq('offering_id', offering.id)));
  const sections = data.sections.filter((s) => s.offering_id === offering.id).sort((a, b) => a.name.localeCompare(b.name));
  const relevant = MILESTONES.filter(([k]) => course.course_type === 'theory' ? k !== 'sessional_gradesheet' : !['question_submission', 'theory_gradesheet'].includes(k));

  const StatusRow = ({ label, field, opts }: { label: string; field: 'outline_status' | 'feedback_status' | 'car_status'; opts: StatusOption[] }) => (
    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
      <label htmlFor={field} className="text-sm">{label}</label>
      <Select id={field} className="w-56 h-8" disabled={!canEdit || !rec || save.isPending} value={rec?.[field] ?? 'not_started'}
        onChange={(e) => save.mutate({ [field]: e.target.value }, { onSuccess: () => toast('ok', `${label} updated`), onError: (er) => toast('bad', er.message) })}>
        {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
    </div>
  );

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader title="Course" />
        <dl className="grid grid-cols-[140px_1fr] gap-y-2 px-4 py-3 text-sm">
          <dt className="text-muted">Credits</dt><dd className="tabular">{course.credits ?? '—'}</dd>
          <dt className="text-muted">Contact hours</dt><dd className="tabular">{course.contact_hours ?? '—'} per week</dd>
          <dt className="text-muted">Level-term</dt><dd>{course.level ? `Level ${course.level}${course.term_no ? `, Term ${course.term_no}` : ''}` : '—'}{course.elective_group && ` · Elective group ${course.elective_group}`}</dd>
          {sections.map((s) => [<dt key={s.id + 'l'} className="text-muted">Section {s.name}</dt>,
            <dd key={s.id}>{teachersOf(offering.id, s.id).map(nameOf).join(', ') || 'No teachers'}</dd>])}
        </dl>
      </Card>
      <Card>
        <CardHeader title="Course records" subtitle={canEdit ? 'Course teachers update these.' : 'Read only'} />
        <div className="divide-y divide-line">
          <StatusRow label="Course outline" field="outline_status" opts={OUTLINE_STATUS} />
          <StatusRow label="Student feedback" field="feedback_status" opts={FEEDBACK_STATUS} />
          <StatusRow label="Course File / CAR" field="car_status" opts={CAR_STATUS} />
        </div>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader title="Deadlines" subtitle="Term-wide dates set by the department; a course-specific date overrides them." />
        <ul className="divide-y divide-line">{relevant.map(([k, label]) => (
          <li key={k} className="flex items-center justify-between px-4 py-2.5 text-sm"><span>{label}</span><DueLabel date={milestone(data, k, offering.id)} /></li>))}
        </ul>
      </Card>
    </div>
  );
}
