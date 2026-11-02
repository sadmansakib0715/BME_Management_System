import { clsx } from 'clsx';
import { ChevronLeft } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { Link, NavLink, useParams } from 'react-router-dom';
import { TypeBadge } from '@/components/bits';
import { Empty, ErrorNote, Spinner } from '@/components/ui';
import { useTerm } from '@/lib/TermContext';
import Overview from './Overview';

const ExamTab = lazy(() => import('./ExamTab'));
const AssessmentsTab = lazy(() => import('./AssessmentsTab'));
const OutcomesTab = lazy(() => import('./OutcomesTab'));

export default function CourseDetail() {
  const { id = '', tab = 'overview' } = useParams();
  const { data, loading, error, courseOf, teachersOf, nameOf } = useTerm();
  if (loading) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  const o = data?.offerings.find((x) => x.id === id);
  const c = o && courseOf(o);
  if (!data || !o || !c) return <Empty title="Course not found">It may belong to another term. Pick the term in the sidebar.</Empty>;

  const isTheory = c.course_type === 'theory';
  const tabs = [
    ['overview', 'Overview'], ['exam', isTheory ? 'Exam workflow' : 'Gradesheet'], ['assessments', isTheory ? 'Class tests & plan' : 'Assessments'],
    ['outcomes', 'OBE'],
  ] as const;
  const props = { offering: o, course: c, data };

  return (
    <>
      <Link to="/courses" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink mb-3 cursor-pointer"><ChevronLeft className="size-4" aria-hidden />Courses</Link>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1"><span className="font-mono text-sm text-muted">{c.code}</span><TypeBadge type={c.course_type} />
            {o.batch && <span className="text-2xs text-subtle">Cohort {o.batch}</span>}</div>
          <h1 className="text-xl font-semibold tracking-tight">{c.title}</h1>
          <p className="text-sm text-muted mt-1">{teachersOf(o.id).map(nameOf).join(' · ') || 'No teachers assigned'}</p>
        </div>
      </div>
      <nav aria-label="Course sections" className="border-b border-line mb-5 -mx-1 overflow-x-auto">
        <ul className="flex gap-1 min-w-max px-1">{tabs.map(([k, label]) => (
          <li key={k}><NavLink to={`/courses/${o.id}/${k === 'overview' ? '' : k}`} end={k === 'overview'}
            className={({ isActive }) => clsx('inline-block px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors duration-150 cursor-pointer',
              isActive || (k === tab) ? 'border-brand text-ink' : 'border-transparent text-muted hover:text-ink')}>{label}</NavLink></li>))}
        </ul>
      </nav>
      <Suspense fallback={<Spinner />}>
        {tab === 'overview' && <Overview {...props} />}
        {tab === 'exam' && <ExamTab {...props} />}
        {tab === 'assessments' && <AssessmentsTab {...props} />}
        {tab === 'outcomes' && <OutcomesTab {...props} />}
      </Suspense>
    </>
  );
}
