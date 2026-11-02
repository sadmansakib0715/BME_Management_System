import { ArrowRight, BellRing, BookOpen, CalendarDays, ClipboardCheck, FileSpreadsheet, History, LineChart, Lock, ShieldCheck, UserCog, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { IllCalendar, IllDepartment, IllExamChain, IllImport, IllOutcomes, IllPlan, IllSetup, IllTasks, InkMountains } from '@/components/illustrations';

/** "How it works": a short illustrated tour of the whole system. Shown in the app and, signed out, from the sign-in page. */

const FLOW: { icon: ReactNode; title: string; text: string; who: string }[] = [
  { icon: <FileSpreadsheet />, title: 'Set up the term', text: 'Import the Activity Tracker workbook, or add courses, sections and dates by hand in Term setup.', who: 'Admin' },
  { icon: <UserCog />, title: 'Assign roles', text: 'Teachers per section, question setters, moderators, scrutinizers and gradesheet roles. Conflicts are blocked.', who: 'Admin' },
  { icon: <BookOpen />, title: 'Plan each course', text: 'Write the course outcomes and the assessment plan.', who: 'Faculty' },
  { icon: <CalendarDays />, title: 'Fix the routine', text: 'Set class-test dates. One cohort never gets two class tests on the same day.', who: 'Admin or faculty' },
  { icon: <ClipboardCheck />, title: 'Run the exam workflow', text: 'Question papers to the HOD, step by step. Each step opens when the one before it is done.', who: 'Everyone' },
  { icon: <BellRing />, title: 'Get notified', text: 'Your start page and a short email show when it is your turn.', who: 'Automatic' },
];

const FEATURES: { art: ReactNode; title: string; text: string; to: string; admin?: boolean }[] = [
  { art: <IllTasks />, title: 'My courses', text: 'Your start page: each course you teach or examine, how it is going, and your calendar of class tests and exams.', to: '/' },
  { art: <IllExamChain />, title: 'Theory exam chain', text: 'Question papers → moderation → printing → scripts → scrutiny → gradesheet → HOD, with correction rounds.', to: '/courses' },
  { art: <IllCalendar />, title: 'Class tests & calendar', text: 'Every class test and exam in one calendar, and a guard against two class tests for one cohort on the same day.', to: '/calendar' },
  { art: <IllPlan />, title: 'Assessment plans', text: 'Components and how many of each, per course or sessional sub-section; items are generated for you.', to: '/courses' },
  { art: <IllOutcomes />, title: 'Course outcomes', text: 'COs mapped to the program outcomes by strength, and a department-wide coverage matrix.', to: '/outcomes' },
  { art: <IllDepartment />, title: 'Department overview', text: 'Term-final progress and assessments held across every course. The HOD also sees workload and setup gaps.', to: '/dashboard' },
  { art: <IllSetup />, title: 'Term setup by hand', text: 'Term dates, courses and sections, teachers and exam roles, and the class-test routine, tab by tab.', to: '/admin/term', admin: true },
  { art: <IllImport />, title: 'Workbook import', text: 'Or fill the whole term from the existing spreadsheet: read in the browser, every correction shown first.', to: '/admin/term/import', admin: true },
];

const ROLES: { icon: ReactNode; title: string; points: string[] }[] = [
  { icon: <Users />, title: 'Faculty', points: ['See your courses and calendar at a glance', 'Write course outcomes and assessment plans', 'Set class-test dates for your courses'] },
  { icon: <ClipboardCheck />, title: 'Exam roles', points: ['Prepare, moderate or scrutinize papers', 'Return a paper for correction', 'Steps open only when the previous one is done'] },
  { icon: <LineChart />, title: 'HOD & admins', points: ['Set up the term by import or by hand', 'Assign roles and manage access', 'See workload across the department'] },
];

const SAFEGUARDS: { icon: ReactNode; title: string; text: string }[] = [
  { icon: <ShieldCheck />, title: 'Rules live in the database', text: 'Order of steps, who owns them and clash checks hold even outside the app.' },
  { icon: <Lock />, title: 'Clear ownership', text: 'Each exam step belongs to one person. Only they, or an admin, can move it on.' },
  { icon: <History />, title: 'Everything is audited', text: 'Changes to assignments, exam steps, dates and access are logged with before and after values.' },
  { icon: <BellRing />, title: 'Email when it is your turn', text: 'A short note when your exam step opens or a paper comes back for correction.' },
];

const Icon = ({ children }: { children: ReactNode }) => (
  <span className="size-10 shrink-0 rounded-full bg-brand-soft text-brand-ink grid place-items-center [&>svg]:size-5" aria-hidden>{children}</span>
);

export default function Guide({ signedOut = false, isAdmin = false }: { signedOut?: boolean; isAdmin?: boolean }) {
  return (
    <div className="space-y-10 pb-6">
      <section className="relative overflow-hidden rounded-lg bg-hero text-hero-fg px-6 pt-8 pb-28 sm:px-10 sm:pt-12 sm:pb-36 shadow-pop">
        <InkMountains className="absolute inset-x-0 bottom-0 w-full h-48 sm:h-60 pointer-events-none" />
        <div className="relative max-w-2xl">
          <div className="text-2xs font-semibold uppercase tracking-wider opacity-80">How it works</div>
          <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight">One place for every course, exam step and outcome.</h1>
          <p className="mt-3 text-sm sm:text-base opacity-90">
            BME Workflow replaces the term’s Activity Tracker spreadsheet. It keeps everyone informed: who does what in each course,
            where every exam paper is, and when class tests and exams happen.
          </p>
          {signedOut && (
            <Link to="/" className="mt-5 inline-flex items-center gap-1.5 h-10 px-4 rounded bg-hero-fg text-hero text-sm font-semibold hover:opacity-90 transition-opacity duration-150">
              Sign in<ArrowRight className="size-4" aria-hidden />
            </Link>
          )}
        </div>
      </section>

      <section aria-labelledby="g-flow">
        <h2 id="g-flow" className="text-lg font-semibold tracking-tight">A term, start to finish</h2>
        <p className="text-sm text-muted mt-1">Six stages. Each one unlocks the next.</p>
        <ol className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {FLOW.map((f, i) => (
            <li key={f.title} className="card p-4 flex gap-3">
              <Icon>{f.icon}</Icon>
              <div className="min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-mono text-2xs text-subtle">{String(i + 1).padStart(2, '0')}</span>
                  <h3 className="text-sm font-semibold">{f.title}</h3>
                  <span className="text-2xs font-medium text-brand-ink bg-brand-soft rounded px-1.5 py-0.5">{f.who}</span>
                </div>
                <p className="text-sm text-muted mt-1">{f.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="g-features">
        <h2 id="g-features" className="text-lg font-semibold tracking-tight">What’s inside</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {FEATURES.map((f) => {
            const canOpen = !signedOut && (!f.admin || isAdmin);
            const body = (
              <>
                <div className="bg-sunken/70 border-b border-line">{f.art}</div>
                <div className="p-4">
                  <h3 className="text-sm font-semibold flex items-center gap-1.5">
                    {f.title}
                    {f.admin && <span className="text-2xs font-medium text-subtle">· HOD & admins</span>}
                  </h3>
                  <p className="text-sm text-muted mt-1">{f.text}</p>
                  {canOpen && <span className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand-ink">Open<ArrowRight className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden /></span>}
                </div>
              </>
            );
            return canOpen
              ? <Link key={f.title} to={f.to} className="group card overflow-hidden hover:border-brand/40 hover:shadow-pop transition-shadow duration-200">{body}</Link>
              : <div key={f.title} className="card overflow-hidden">{body}</div>;
          })}
        </div>
      </section>

      <section aria-labelledby="g-roles">
        <h2 id="g-roles" className="text-lg font-semibold tracking-tight">Who does what</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {ROLES.map((r) => (
            <div key={r.title} className="card p-4">
              <div className="flex items-center gap-3"><Icon>{r.icon}</Icon><h3 className="text-sm font-semibold">{r.title}</h3></div>
              <ul className="mt-3 space-y-1.5 text-sm text-muted">
                {r.points.map((p) => <li key={p} className="flex gap-2"><span className="mt-2 size-1.5 rounded-full bg-wash shrink-0" aria-hidden />{p}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="g-safe">
        <h2 id="g-safe" className="text-lg font-semibold tracking-tight">Built-in safeguards</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {SAFEGUARDS.map((s) => (
            <div key={s.title} className="flex gap-3 p-4 rounded-lg border border-line bg-surface/70">
              <Icon>{s.icon}</Icon>
              <div><h3 className="text-sm font-semibold">{s.title}</h3><p className="text-sm text-muted mt-0.5">{s.text}</p></div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
