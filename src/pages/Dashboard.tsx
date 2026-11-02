import { Link } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { Card, CardHeader, ErrorNote, Meter, PageHeader, Spinner, Stat } from '@/components/ui';
import { WeekTracker } from '@/components/WeekTracker';
import { useTerm } from '@/lib/TermContext';
import { EXAM_STEPS, examProgress, stepState } from '@/lib/workflow';

/** Department overview, open to all faculty: progress only. Workload and setup gaps are for the HOD and admins. */
export default function Dashboard() {
  const { isAdmin } = useAuth();
  const { data, loading, error, courseOf, faculty, nameOf } = useTerm();
  if (loading) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;
  const theory = data.offerings.filter((o) => data.exam.some((a) => a.offering_id === o.id));
  const funnel = EXAM_STEPS.map((d) => ({ d, done: theory.filter((o) => stepState(data.tasks.filter((t) => t.offering_id === o.id), d.key) === 'done').length }));
  const finished = theory.filter((o) => !examProgress(data.tasks.filter((t) => t.offering_id === o.id)).current).length;
  const items = data.items.filter((i) => i.status !== 'cancelled');
  const held = items.filter((i) => i.status === 'held').length;
  const dated = items.filter((i) => i.held_on).length;
  const byCourse = data.offerings.map((o) => {
    const its = items.filter((i) => i.offering_id === o.id);
    return { o, c: courseOf(o), n: its.length, pub: its.filter((i) => i.status === 'held').length };
  }).filter((x) => x.c && x.n).sort((a, b) => a.c!.code.localeCompare(b.c!.code));
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
      <PageHeader eyebrow={data.term.name} title="Department overview" description="How the term is going across every course." />
      <div className="mb-5"><WeekTracker term={data.term} /></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Stat label="Courses" value={data.offerings.length} sub={`${theory.length} with a term final`} />
        <Stat label="Term finals complete" value={`${finished}/${theory.length}`} />
        <Stat label="Assessments held" value={`${held}/${items.length}`} />
        <Stat label="Assessments dated" value={`${dated}/${items.length}`} />
      </div>
      <div className="grid gap-5 xl:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader title="Term-final progress" subtitle="Theory courses that have completed each step." />
          <ul className="p-4 space-y-2">{funnel.map(({ d, done }) => (
            <li key={d.key} className="grid grid-cols-[160px_1fr_48px] items-center gap-3 text-sm">
              <span className="truncate" title={d.label}>{d.label.replace('Question preparation · Section', 'Question prep').replace('Script examination · Section', 'Script exam').replace('Gradesheet preparation', 'Gradesheet prep')}</span>
              <span className="h-2 rounded-full bg-sunken overflow-hidden" aria-hidden><span className="block h-full bg-wash" style={{ width: `${theory.length ? (done / theory.length) * 100 : 0}%` }} /></span>
              <span className="text-right tabular text-muted">{done}/{theory.length}</span>
            </li>))}</ul>
        </Card>
        <Card>
          <CardHeader title="Assessments held by course" />
          {byCourse.length ? <ul className="divide-y divide-line max-h-96 overflow-y-auto">{byCourse.map(({ o, c, n, pub }) => (
            <li key={o.id} className="px-4 py-2.5 grid grid-cols-[72px_1fr_48px] items-center gap-3">
              <Link to={`/courses/${o.id}`} className="link font-mono text-sm">{c!.code}</Link>
              <Meter value={pub} max={n} label={`${c!.code} assessments held`} />
              <span className="text-right text-2xs tabular text-muted">{pub}/{n}</span>
            </li>))}</ul> : <p className="px-4 py-6 text-sm text-muted">No assessment plans yet.</p>}
        </Card>
        {isAdmin && <>
          <Card>
            <CardHeader title="Workload" subtitle="Courses taught and exam roles held this term. Visible to HOD and admins." />
            <ul className="p-4 space-y-2">{load.map(({ f, teach, exam }) => (
              <li key={f.id} className="grid grid-cols-[1fr_120px_auto] items-center gap-3 text-sm">
                <span className="truncate">{nameOf(f.id)}</span>
                <span className="flex h-2 rounded-full bg-sunken overflow-hidden" aria-hidden>
                  <span className="bg-brand" style={{ width: `${(teach / maxLoad) * 100}%` }} /><span className="bg-wash" style={{ width: `${(exam / maxLoad) * 100}%` }} /></span>
                <span className="text-2xs text-muted tabular whitespace-nowrap">{teach} course{teach === 1 ? '' : 's'} · {exam} exam role{exam === 1 ? '' : 's'}</span>
              </li>))}</ul>
          </Card>
          <Card>
            <CardHeader title="Setup gaps" subtitle="Things the department still needs to fill in." />
            {setup.length ? <ul className="divide-y divide-line max-h-80 overflow-y-auto">{setup.map((s) => <li key={s} className="px-4 py-2 text-sm">{s}</li>)}</ul>
              : <p className="px-4 py-6 text-sm text-muted">Nothing missing.</p>}
          </Card>
        </>}
      </div>
    </>
  );
}
