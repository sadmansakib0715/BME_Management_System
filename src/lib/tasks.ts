// The "My tasks" feed: every module's open work for one person, in one list.
import type { TermData } from './api';
import { addDays, daysUntil } from './format';
import type { Course, ExamStep, MilestoneKind, Offering } from './types';
import { EXAM_STEPS, blockers, stepDef, stepOwner, stepState } from './workflow';

export type Bucket = 'overdue' | 'soon' | 'later' | 'waiting';
export interface Task {
  id: string; offeringId: string; code: string; title: string; detail: string; due: string | null; bucket: Bucket;
  kind: 'exam' | 'ct' | 'marks' | 'gradesheet' | 'record'; href: string; waitingOn?: string;
}

const MARK_TURNAROUND = 14;

/** Which department deadline governs each exam step. */
export function stepMilestone(d: TermData, step: ExamStep, offeringId: string): string | null {
  if (['qp_a', 'qp_b', 'mod_1', 'mod_2'].includes(step)) return milestone(d, 'question_submission', offeringId);
  if (step === 'printing') return milestone(d, 'exam_start', offeringId) ?? milestone(d, 'question_submission', offeringId);
  return milestone(d, 'theory_gradesheet', offeringId);
}

export function milestone(d: TermData, kind: MilestoneKind, offeringId?: string): string | null {
  return (d.milestones.find((m) => m.kind === kind && m.offering_id === offeringId) ?? d.milestones.find((m) => m.kind === kind && !m.offering_id))?.due_on ?? null;
}

const bucket = (due: string | null): Bucket => {
  const n = daysUntil(due);
  return n === null ? 'later' : n < 0 ? 'overdue' : n <= 7 ? 'soon' : 'later';
};

export function buildTasks(d: TermData, me: string, courseOf: (o: Offering) => Course | undefined, nameOf: (id: string | null) => string, isAdmin = false): Task[] {
  const out: Task[] = [];
  const mine = (o: Offering) => d.teachers.some((t) => t.faculty_id === me && d.sections.some((s) => s.id === t.section_id && s.offering_id === o.id));

  for (const o of d.offerings) {
    const c = courseOf(o); if (!c) continue;
    const code = c.code;
    const a = d.exam.find((x) => x.offering_id === o.id);
    const tasks = d.tasks.filter((t) => t.offering_id === o.id);

    // Theory exam chain
    if (a) for (const def of EXAM_STEPS) {
      const owner = stepOwner(a, def.key);
      const isMine = owner === me || (isAdmin && def.key === 'printing');
      if (!isMine) continue;
      const st = stepState(tasks, def.key);
      if (st === 'done') continue;
      const due = tasks.find((t) => t.step === def.key)?.due_on ?? stepMilestone(d, def.key, o.id);
      const cur = tasks.find((t) => t.step === def.key)?.status ?? 'not_started';
      if (st === 'locked') {
        const b = blockers(tasks, def.key as ExamStep);
        const others = [...new Set(b.map((k) => stepOwner(a, k)).filter((id): id is string => !!id && id !== me))];
        const selfBlocked = b.some((k) => stepOwner(a, k) === me);
        const who = others.map((id) => nameOf(id)).join(', ') || (selfBlocked ? 'your own earlier step' : 'the department office');
        out.push({ id: `${o.id}:${def.key}`, offeringId: o.id, code, title: def.label, detail: `Waiting on ${b.map((k) => stepDef(k).short).join(', ')}`,
          due, bucket: 'waiting', kind: 'exam', href: `/courses/${o.id}/exam`, waitingOn: who });
      } else {
        out.push({ id: `${o.id}:${def.key}`, offeringId: o.id, code, title: def.label,
          detail: cur === 'under_correction' ? 'Returned by a moderator for correction' : cur === 'not_started' ? 'Ready to start' : 'In progress',
          due, bucket: cur === 'under_correction' ? 'overdue' : bucket(due), kind: 'exam', href: `/courses/${o.id}/exam` });
      }
    }

    if (!mine(o)) continue;
    // Assessments: upcoming events, and marks owed after they are held
    for (const it of d.items.filter((i) => i.offering_id === o.id && i.status !== 'cancelled')) {
      if (it.responsible && it.responsible !== me) continue;
      const isCt = d.components.find((x) => x.id === it.component_id)?.kind === 'class_test';
      if ((it.status === 'scheduled' || it.status === 'planned') && it.held_on && (daysUntil(it.held_on) ?? -1) >= 0 && (daysUntil(it.held_on) ?? 99) <= 14)
        out.push({ id: `${it.id}:event`, offeringId: o.id, code, title: it.title, detail: isCt ? 'Class test' : 'Assessment', due: it.held_on,
          bucket: bucket(it.held_on), kind: 'ct', href: `/courses/${o.id}/assessments` });
      if (it.status === 'scheduled' && it.held_on && (daysUntil(it.held_on) ?? 0) < 0)
        out.push({ id: `${it.id}:held`, offeringId: o.id, code, title: `${it.title}: confirm it was held`, detail: 'Date has passed but status is still Scheduled',
          due: it.held_on, bucket: 'overdue', kind: 'ct', href: `/courses/${o.id}/assessments` });
      if (it.status === 'held' && !['published', 'locked'].includes(it.marks_status)) {
        const due = it.held_on ? addDays(it.held_on, MARK_TURNAROUND) : null;
        out.push({ id: `${it.id}:marks`, offeringId: o.id, code, title: `Publish marks: ${it.title}`, detail: it.marks_status === 'none' ? 'No marks entered yet' : `Marks ${it.marks_status}`,
          due, bucket: bucket(due), kind: 'marks', href: `/courses/${o.id}/marks?item=${it.id}` });
      }
    }
    // Course records
    const r = d.records.find((x) => x.offering_id === o.id);
    if (r && r.outline_status !== 'shared') { const due = milestone(d, 'outline_sharing', o.id);
      out.push({ id: `${o.id}:outline`, offeringId: o.id, code, title: 'Share the course outline', detail: 'Outline not yet shared with students', due, bucket: bucket(due), kind: 'record', href: `/courses/${o.id}` }); }
    if (r && r.car_status !== 'final' && (daysUntil(milestone(d, 'car_deadline', o.id)) ?? 99) <= 21) { const due = milestone(d, 'car_deadline', o.id);
      out.push({ id: `${o.id}:car`, offeringId: o.id, code, title: 'Course File and CAR', detail: 'Due at the end of term', due, bucket: bucket(due), kind: 'record', href: `/courses/${o.id}/attainment` }); }
  }
  // Sessional gradesheets
  for (const g of d.gradesheets) {
    const o = d.offerings.find((x) => x.id === g.offering_id); const c = o && courseOf(o); if (!o || !c) continue;
    const due = milestone(d, 'sessional_gradesheet', o.id);
    if (g.preparer === me && g.prep_status !== 'forwarded')
      out.push({ id: `${o.id}:sg-prep`, offeringId: o.id, code: c.code, title: 'Sessional gradesheet preparation', detail: g.prep_status === 'not_started' ? 'Ready when all marks are published' : 'In progress', due, bucket: bucket(due), kind: 'gradesheet', href: `/courses/${o.id}/exam` });
    if (g.scrutinizer === me && g.scrutiny_status !== 'forwarded_hod')
      out.push({ id: `${o.id}:sg-scr`, offeringId: o.id, code: c.code, title: 'Sessional gradesheet scrutiny', detail: g.prep_status === 'forwarded' ? 'Ready for scrutiny' : 'Waiting on the preparer',
        due, bucket: g.prep_status === 'forwarded' ? bucket(due) : 'waiting', kind: 'gradesheet', href: `/courses/${o.id}/exam`, waitingOn: g.prep_status === 'forwarded' ? undefined : nameOf(g.preparer) });
  }
  const order: Record<Bucket, number> = { overdue: 0, soon: 1, later: 2, waiting: 3 };
  return out.sort((x, y) => order[x.bucket] - order[y.bucket] || (x.due ?? '9999').localeCompare(y.due ?? '9999'));
}

export type Health = 'blocked' | 'at_risk' | 'attention' | 'on_track';
/** One word per course for the HOD view, from overdue work and stalled steps. */
export function courseHealth(d: TermData, o: Offering): { health: Health; reasons: string[] } {
  const reasons: string[] = [];
  const tasks = d.tasks.filter((t) => t.offering_id === o.id);
  if (tasks.some((t) => t.status === 'under_correction')) reasons.push('Question paper under correction');
  const qDue = milestone(d, 'question_submission', o.id);
  if (d.exam.some((x) => x.offering_id === o.id) && (daysUntil(qDue) ?? 1) < 0 && !['qp_a', 'qp_b'].every((k) => tasks.find((t) => t.step === k)?.status === 'submitted'))
    reasons.push('Question submission deadline passed');
  const late = d.items.filter((i) => i.offering_id === o.id && i.status === 'held' && !['published', 'locked'].includes(i.marks_status) && (daysUntil(i.held_on) ?? 0) < -MARK_TURNAROUND);
  if (late.length) reasons.push(`${late.length} assessment${late.length > 1 ? 's' : ''} unmarked over ${MARK_TURNAROUND} days`);
  const stale = d.items.filter((i) => i.offering_id === o.id && i.status === 'scheduled' && (daysUntil(i.held_on) ?? 0) < 0);
  if (stale.length) reasons.push(`${stale.length} past assessment${stale.length > 1 ? 's' : ''} still marked Scheduled`);
  const undated = d.items.filter((i) => i.offering_id === o.id && i.status !== 'planned' && i.status !== 'cancelled' && !i.held_on);
  if (undated.length) reasons.push(`${undated.length} assessment${undated.length > 1 ? 's' : ''} without a date`);
  const health: Health = reasons.some((r) => r.includes('deadline passed')) ? 'blocked' : reasons.length >= 2 ? 'at_risk' : reasons.length ? 'attention' : 'on_track';
  return { health, reasons };
}
