// Display-side mirror of the exam chain defined in supabase/migrations/0002 + 0004.
// The database enforces these rules; this module only explains them to people.
import type { ExamAssignment, ExamStep, ExamTask } from './types';

export interface StatusOption { value: string; label: string }
export interface StepDef { key: ExamStep; label: string; short: string; owner: keyof Omit<ExamAssignment, 'offering_id'> | 'admin' | 'hod'; statuses: StatusOption[]; done: string; deps: ExamStep[] }

const s = (value: string, label: string): StatusOption => ({ value, label });
const NS = s('not_started', 'Not started');

export const EXAM_STEPS: StepDef[] = [
  { key: 'qp_a', label: 'Question preparation · Section A', short: 'QP A', owner: 'qp_a', done: 'submitted', deps: [],
    statuses: [NS, s('under_preparation', 'Under preparation'), s('under_correction', 'Under correction'), s('submitted', 'Submitted')] },
  { key: 'qp_b', label: 'Question preparation · Section B', short: 'QP B', owner: 'qp_b', done: 'submitted', deps: [],
    statuses: [NS, s('under_preparation', 'Under preparation'), s('under_correction', 'Under correction'), s('submitted', 'Submitted')] },
  { key: 'mod_1', label: 'Moderation 1', short: 'Mod 1', owner: 'mod_1', done: 'finalized', deps: ['qp_a', 'qp_b'],
    statuses: [NS, s('under_moderation', 'Under moderation'), s('needs_correction', 'Needs correction'), s('finalized', 'Finalized')] },
  { key: 'mod_2', label: 'Moderation 2', short: 'Mod 2', owner: 'mod_2', done: 'finalized', deps: ['qp_a', 'qp_b'],
    statuses: [NS, s('under_moderation', 'Under moderation'), s('needs_correction', 'Needs correction'), s('finalized', 'Finalized')] },
  { key: 'printing', label: 'Printing', short: 'Print', owner: 'admin', done: 'printed', deps: ['mod_1', 'mod_2'],
    statuses: [NS, s('sent_to_print', 'Sent to print'), s('printed', 'Printed')] },
  { key: 'exam_a', label: 'Script examination · Section A', short: 'Exam A', owner: 'qp_a', done: 'examined', deps: ['printing'],
    statuses: [NS, s('under_examination', 'Under examination'), s('examined', 'Examined')] },
  { key: 'exam_b', label: 'Script examination · Section B', short: 'Exam B', owner: 'qp_b', done: 'examined', deps: ['printing'],
    statuses: [NS, s('under_examination', 'Under examination'), s('examined', 'Examined')] },
  { key: 'scrutiny', label: 'Script scrutiny', short: 'Scrutiny', owner: 'scrutinizer', done: 'scrutinized', deps: ['exam_a', 'exam_b'],
    statuses: [NS, s('under_scrutiny', 'Under scrutiny'), s('scrutinized', 'Scrutinized')] },
  { key: 'gs_prep', label: 'Gradesheet preparation', short: 'GS prep', owner: 'qp_a', done: 'uploaded_biis', deps: ['scrutiny'],
    statuses: [NS, s('under_preparation', 'Under preparation'), s('prepared', 'Prepared'), s('uploaded_biis', 'Uploaded in BIIS')] },
  { key: 'gs_scrutiny', label: 'Gradesheet scrutiny', short: 'GS scrutiny', owner: 'scrutinizer', done: 'scrutinized', deps: ['gs_prep'],
    statuses: [NS, s('under_scrutiny', 'Under scrutiny'), s('scrutinized', 'Scrutinized')] },
  { key: 'hod', label: 'Submission to HOD', short: 'To HOD', owner: 'qp_a', done: 'received', deps: ['gs_scrutiny'],
    statuses: [NS, s('forwarded', 'Forwarded to HOD'), s('received', 'Received by HOD')] },
];

export const stepDef = (k: ExamStep) => EXAM_STEPS.find((d) => d.key === k)!;
export const statusLabel = (k: ExamStep, v: string) => stepDef(k).statuses.find((x) => x.value === v)?.label ?? v;

export function stepOwner(a: ExamAssignment | undefined, k: ExamStep): string | null {
  const o = stepDef(k).owner;
  if (!a || o === 'admin' || o === 'hod') return null;
  return a[o] ?? null;
}

export type StepState = 'done' | 'active' | 'ready' | 'locked';

export function stepState(tasks: ExamTask[], k: ExamStep): StepState {
  const t = tasks.find((x) => x.step === k);
  const d = stepDef(k);
  if (t && t.status === d.done) return 'done';
  const blocked = d.deps.some((dep) => tasks.find((x) => x.step === dep)?.status !== stepDef(dep).done);
  if (blocked) return 'locked';
  return t && t.status !== 'not_started' ? 'active' : 'ready';
}

export const blockers = (tasks: ExamTask[], k: ExamStep): ExamStep[] =>
  stepDef(k).deps.filter((dep) => tasks.find((x) => x.step === dep)?.status !== stepDef(dep).done);

export function examProgress(tasks: ExamTask[]): { done: number; total: number; current: StepDef | null } {
  const done = EXAM_STEPS.filter((d) => stepState(tasks, d.key) === 'done').length;
  const current = EXAM_STEPS.find((d) => stepState(tasks, d.key) !== 'done') ?? null;
  return { done, total: EXAM_STEPS.length, current };
}

export interface RuleIssue { level: 'error' | 'warning'; message: string }

/** Same hard rules as the CHECK constraints on exam_assignments, plus the spreadsheet's soft warning. */
export function validateAssignment(a: Partial<ExamAssignment>, nameOf: (id: string) => string = (x) => x): RuleIssue[] {
  const out: RuleIssue[] = [];
  const eq = (x?: string | null, y?: string | null) => !!x && !!y && x === y;
  if (eq(a.qp_a, a.qp_b)) out.push({ level: 'error', message: 'Question preparers A and B must be different people.' });
  if (eq(a.mod_1, a.mod_2)) out.push({ level: 'error', message: 'Moderators 1 and 2 must be different people.' });
  for (const m of [a.mod_1, a.mod_2]) if (eq(m, a.qp_a) || eq(m, a.qp_b)) out.push({ level: 'error', message: `${nameOf(m!)} cannot moderate a paper they prepared.` });
  if (eq(a.scrutinizer, a.qp_a) || eq(a.scrutinizer, a.qp_b)) out.push({ level: 'error', message: 'The script scrutinizer cannot be one of the question preparers.' });
  if (eq(a.scrutinizer, a.mod_1) || eq(a.scrutinizer, a.mod_2)) out.push({ level: 'warning', message: 'The scrutinizer is also a moderator. Allowed, but check workload.' });
  return out;
}

// ------------------------------------------------------------- other status vocabularies
export const ITEM_STATUS: StatusOption[] = [s('planned', 'Planned'), s('scheduled', 'Scheduled'), s('held', 'Held'), s('postponed', 'Postponed'), s('cancelled', 'Cancelled')];
export const MARKS_STATUS: StatusOption[] = [s('none', 'No marks'), s('entering', 'Entering'), s('verified', 'Verified'), s('published', 'Published'), s('locked', 'Locked')];
export const OUTLINE_STATUS: StatusOption[] = [NS, s('under_preparation', 'Under preparation'), s('prepared', 'Prepared'), s('shared', 'Shared with students')];
export const FEEDBACK_STATUS: StatusOption[] = [NS, s('students_reminded', 'Students reminded'), s('collected', 'Feedback collected')];
export const CAR_STATUS: StatusOption[] = [NS, s('under_preparation', 'Under preparation'), s('prepared', 'Prepared'), s('final', 'Final')];
export const SG_PREP_STATUS: StatusOption[] = [NS, s('under_preparation', 'Under preparation'), s('prepared', 'Prepared'), s('uploaded_biis', 'Uploaded in BIIS'), s('forwarded', 'Forwarded to scrutinizer')];
export const SG_SCRUTINY_STATUS: StatusOption[] = [NS, s('under_scrutiny', 'Under scrutiny'), s('scrutinized', 'Scrutinized'), s('forwarded_hod', 'Forwarded to HOD')];
export const labelOf = (opts: StatusOption[], v: string) => opts.find((o) => o.value === v)?.label ?? v;

export const COMPONENT_KINDS: StatusOption[] = [
  s('class_test', 'Class test'), s('term_final', 'Term final'), s('attendance', 'Attendance'), s('lab_report', 'Lab report'),
  s('lab_test', 'Lab test'), s('quiz', 'Quiz'), s('viva', 'Viva'), s('presentation', 'Presentation'),
  s('demonstration', 'Demonstration'), s('project', 'Project'), s('assignment', 'Assignment'), s('other', 'Other'),
];
