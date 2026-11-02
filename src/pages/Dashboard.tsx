import { Link } from 'react-router-dom';
import { Card, CardHeader, ErrorNote, PageHeader, Spinner, Stat, StatePill } from '@/components/ui';
import { WeekTracker } from '@/components/WeekTracker';
import { courseHealth } from '@/lib/tasks';
import { useTerm } from '@/lib/TermContext';
import { EXAM_STEPS, stepState } from '@/lib/workflow';

export default function Dashboard() {
  const { data, loading, error, courseOf, faculty, nameOf } = useTerm();
  if (loading) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;
  const health = data.offerings.map((o) => ({ o, c: courseOf(o)!, ...courseHealth(data, o) })).filter((x) => x.c);
  const theory = data.offerings.filter((o) => data.exam.some((a) => a.offering_id === o.id));
  const funnel = EXAM_STEPS.map((d) => ({ d, done: theory.filter((o) => stepState(data.tasks.filter((t) => t.offering_id === o.id), d.key) === 'done').length }));
  const items = data.items.filter((i) => i.status === 'held');
  const published = items.filter((i) => ['published', 'locked'].includes(i.marks_status)).length;
  const load = faculty.filter((f) => f.status === 'active').map((f) => ({
    f, teach: new Set(data.teachers.filter((t) => t.faculty_id === f.id).map((t) => data.sections.find((s) => s.id === t.section_id)?.offering_id)).size,
    exam: data.exam.reduce((n, a) => n + [a.qp_a, a.qp_b, a.mod_1, a.mod_2, a.scrutinizer].filter((x) => x === f.id).length, 0),
  })).filter((x) => x.teach || x.exam).sort((a, b) => b.exam + b.teach - (a.exam + a.teach));
  const maxLoad = Math.max(1, ...load.map((x) => x.exam + x.teach));
  const setup = [
    ...data.offerings.filter((o) => !data.teachers.some((t) => data.sections.some((s) => s.id === t.section_id && s.offering_id === o.id))).map((o) => `${courseOf(o)?.code}: no teachers`),
    ...data.offerings.filter((o) => courseOf(o)?.course_type === 'theory' && !data.exam.some((a) => a.offering_id === o.id)).map((o) => `${courseOf(o)?.code}: exam roles not assigned`),
    ...data.offerings.filter((o) => !data.components.some((c) => c.offering_id === o.id)).map((o) => `${courseOf(o)?.code}: no assessment plan`),
  ];

  return (
    <>
      <PageHeader eyebrow={data.term.name} title="Department overview" description="Where every course stands, what is stuck and who is carrying the load." />
      <div className="mb-5"><WeekTracker term={data.term} /></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Stat label="Courses" value={data.offerings.length} sub={`${theory.length} with term-final chains`} />
        <Stat label="Blocked or at risk" value={health.filter((h) => h.health === 'blocked' || h.health === 'at_risk').length} tone="bad" />
        <Stat label="Need attention" value={health.filter((h) => h.health === 'attention').length} tone="warn" />
        <Stat label="Held items with marks published" value={`${published}/${items.length}`} />
      </div>
      <div className="grid gap-5 xl:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader title="Term-final progress" subtitle="Theory courses that have completed each step." />
          <ul className="p-4 space-y-2">{funnel.map(({ d, done }) => (
            <li key={d.key} className="grid grid-cols-[160px_1fr_48px] items-center gap-3 text-sm">
              <span className="truncate" title={d.label}>{d.label.replace('Question preparation · Section', 'Question prep').replace('Script examination · Section', 'Script exam').replace('Gradesheet preparation', 'Gradesheet prep')}</span>
              <span className="h-2 rounded-full bg-sunken overflow-hidden" aria-hidden><span className="block h-full bg-brand" style={{ width: `${theory.length ? (done / theory.length) * 100 : 0}%` }} /></span>
              <span className="text-right tabular text-muted">{done}/{theory.length}</span>
            </li>))}</ul>
        </Card>
        <Card>
          <CardHeader title="Courses needing attention" />
          {health.filter((h) => h.health !== 'on_track').length ? <ul className="divide-y divide-line">{health.filter((h) => h.health !== 'on_track')
            .sort((a, b) => ['blocked', 'at_risk', 'attention'].indexOf(a.health) - ['blocked', 'at_risk', 'attention'].indexOf(b.health)).map((h) => (
              <li key={h.o.id} className="px-4 py-2.5 flex items-start gap-3">
                <Link to={`/courses/${h.o.id}`} className="link font-mono text-sm w-16 shrink-0">{h.c.code}</Link>
                <ul className="flex-1 text-2xs text-muted list-disc pl-4">{h.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                <StatePill state={h.health === 'attention' ? 'returned' : 'late'}>{{ attention: 'Attention', at_risk: 'At risk', blocked: 'Blocked', on_track: '' }[h.health]}</StatePill>
              </li>))}</ul> : <p className="px-4 py-6 text-sm text-muted">Every course is on track.</p>}
        </Card>
        <Card>
          <CardHeader title="Workload" subtitle="Courses taught and exam roles held this term." />
          <ul className="p-4 space-y-2">{load.map(({ f, teach, exam }) => (
            <li key={f.id} className="grid grid-cols-[1fr_120px_auto] items-center gap-3 text-sm">
              <span className="truncate">{nameOf(f.id)}</span>
              <span className="flex h-2 rounded-full bg-sunken overflow-hidden" aria-hidden>
                <span className="bg-brand" style={{ width: `${(teach / maxLoad) * 100}%` }} /><span className="bg-info" style={{ width: `${(exam / maxLoad) * 100}%` }} /></span>
              <span className="text-2xs text-muted tabular whitespace-nowrap">{teach} course{teach === 1 ? '' : 's'} · {exam} exam role{exam === 1 ? '' : 's'}</span>
            </li>))}</ul>
        </Card>
        <Card>
          <CardHeader title="Setup gaps" subtitle="Things the department still needs to fill in." />
          {setup.length ? <ul className="divide-y divide-line max-h-80 overflow-y-auto">{setup.map((s) => <li key={s} className="px-4 py-2 text-sm">{s}</li>)}</ul>
            : <p className="px-4 py-6 text-sm text-muted">Nothing missing.</p>}
        </Card>
      </div>
    </>
  );
}
