// The activity log (0017): turns audit_log rows into sentences people read, e.g.
// "Sadman Sakib Himel scheduled CT 01 for Fri, 20 Nov 2026 at 10:00".
// Rows written by one save share a timestamp and are shown as one entry.
import { fmtDateLong } from './format';
import type { AuditEntry, ExamStep } from './types';
import { CAR_STATUS, COMPONENT_KINDS, EXAM_STEPS, FEEDBACK_STATUS, ITEM_STATUS, labelOf, MARKS_LEGACY, MARKS_STATE, OUTLINE_STATUS,
  SG_PREP_STATUS, SG_SCRUTINY_STATUS, statusLabel, type StatusOption } from './workflow';

type Row = Record<string, unknown>;
export interface LogGroup {
  key: string; at: string; table: string; action: AuditEntry['action'];
  actor: string | null; actorName: string | null; offeringId: string | null; courseCode: string | null;
  entries: AuditEntry[];
  /** Reason typed when an assessment was rescheduled (item_date_history, same save). */
  reason?: string | null;
}
export interface LogContext { nameOf: (facultyId: string) => string; coCode?: (coId: string) => string | undefined }
export interface Described { text: string; details: string[] }

// ---------------------------------------------------------------- grouping
/** Consecutive rows from one save (same time, person, course, table and action) become one entry. A reschedule's reason
    (item_date_history) is attached to the assessment it belongs to. Input newest first, as the log is read. */
export function groupEntries(entries: AuditEntry[]): LogGroup[] {
  const reasons = new Map<string, string | null>();
  for (const e of entries) if (e.table_name === 'item_date_history' && e.new_row) reasons.set(`${e.at}|${String(e.new_row.item_id)}`, (e.new_row.reason as string | null) ?? null);
  const out: LogGroup[] = [];
  for (const e of entries) {
    if (e.table_name === 'item_date_history' && entries.some((x) => x.table_name === 'assessment_items' && x.at === e.at && x.row_pk === String(e.new_row?.item_id ?? ''))) continue;
    const key = [e.at, e.actor ?? e.actor_name ?? '', e.offering_id ?? '', e.table_name, e.action].join('|');
    const last = out[out.length - 1];
    if (last && last.key === key) { last.entries.push(e); continue; }
    out.push({ key, at: e.at, table: e.table_name, action: e.action, actor: e.actor, actorName: e.actor_name, offeringId: e.offering_id, courseCode: e.course_code,
      entries: [e], reason: e.table_name === 'assessment_items' ? reasons.get(`${e.at}|${e.row_pk}`) : undefined });
  }
  return out;
}

// ---------------------------------------------------------------- values
const FACULTY_FIELDS = new Set(['responsible', 'qp_a', 'qp_b', 'mod_1', 'mod_2', 'scrutinizer', 'preparer', 'updated_by', 'faculty_id', 'changed_by']);
const HIDDEN = new Set(['id', 'updated_at', 'created_at', 'computed_at', 'changed_at', 'sort', 'source', 'outline_text', 'issues', 'copied_from', 'map_hash', 'samples', 'warnings', 'thresholds']);
const FIELD: Record<string, string> = {
  held_on: 'Date', held_time: 'Time', title: 'Title', total_marks: 'Marks', status: 'Status', marks_status: 'Marks', responsible: 'Responsible', syllabus: 'Syllabus',
  seq: 'Number', name: 'Name', kind: 'Kind', item_count: 'Number of items', marks_each: 'Marks each', weight: 'Weight (%)', best_n: 'Best of', per_section: 'Per section',
  qp_a: 'Question setter (Section A)', qp_b: 'Question setter (Section B)', mod_1: 'Moderator 1', mod_2: 'Moderator 2', scrutinizer: 'Scrutinizer', preparer: 'Preparer',
  prep_status: 'Preparation', scrutiny_status: 'Scrutiny', outline_status: 'Course outline', feedback_status: 'Student feedback', car_status: 'Course file / CAR', notes: 'Notes',
  statement: 'Statement', domain_levels: 'Taxonomy levels', delivery: 'Delivery', tools: 'Assessment tools', kpa: 'K/P/A', domain: 'Domain', level: 'Level',
  contents: 'Contents', objectives: 'Objectives', instructors: 'Course teachers', marks_distribution: 'Assessment', components: 'Components', academic_session: 'Academic session', class_routine: 'Class routine',
  part_c: 'Part C', part_d: 'Part D', part_e: 'Part E', review_note: 'Review note', assessment: 'Assessment', label: 'Question / criterion', max_marks: 'Max marks', levels: 'Levels', criteria: 'Criteria', note: 'Note',
  due_on: 'Due', value: 'Value', done: 'Done', link: 'Link', finding: 'Finding', action: 'Action', owner: 'Owner', effective_term: 'Effective term',
  co_threshold: 'Student CO threshold', cohort_threshold: 'Cohort threshold', po_threshold: 'PO threshold', student_batch: 'Batch', batch: 'Cohort',
  latest_completed_week: 'Weeks completed', calendar_status: 'Calendar', pause_reason: 'Pause reason', is_current: 'Current term', read_only: 'Read only', starts_on: 'Starts', ends_on: 'Ends',
  display_name: 'Name', full_name: 'Full name', designation: 'Designation', email: 'Email', phone: 'Phone', room: 'Room', app_role: 'Role', active: 'Active',
};
const STATUS_OPTS: Record<string, StatusOption[]> = {
  outline_status: OUTLINE_STATUS, feedback_status: FEEDBACK_STATUS, car_status: CAR_STATUS, prep_status: SG_PREP_STATUS, scrutiny_status: SG_SCRUTINY_STATUS,
  marks_status: [...MARKS_STATE, ...MARKS_LEGACY], kind: COMPONENT_KINDS,
};
const MILESTONE: Record<string, string> = { exam_start: 'term finals start', outline_sharing: 'course outline sharing', question_submission: 'question paper submission',
  theory_gradesheet: 'theory gradesheet', sessional_gradesheet: 'sessional gradesheet', feedback_deadline: 'student feedback', car_deadline: 'CAR' };
const SLOT: Record<string, string> = { outline: 'course outline', lecture_materials: 'lecture materials', scripts: 'sample scripts', attainment_workbook: 'attainment workbook', bsfs_feedback: 'BSFS feedback' };

const fieldLabel = (k: string) => FIELD[k] ?? k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const short = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function value(k: string, v: unknown, ctx: LogContext): string {
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return '—';
  if (FACULTY_FIELDS.has(k) && typeof v === 'string') return ctx.nameOf(v);
  if (STATUS_OPTS[k] && typeof v === 'string') return labelOf(STATUS_OPTS[k], v);
  if (k === 'status' && typeof v === 'string') return labelOf(ITEM_STATUS, v);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (isDate(v)) return fmtDateLong(v);
  if (Array.isArray(v)) return v.every((x) => typeof x !== 'object') ? v.join(', ') : `${v.length} ${v.length === 1 ? 'entry' : 'entries'}`;
  if (typeof v === 'object') return 'updated';
  return short(String(v).replace(/\s+/g, ' '));
}

/** "Date: Fri, 20 Nov 2026 → Mon, 23 Nov 2026" for every field an update changed (ids and timestamps left out). */
export function changedFields(o: Row | null, n: Row | null, ctx: LogContext, skip: string[] = []): string[] {
  if (!o || !n) return [];
  return Object.keys(n).filter((k) => !HIDDEN.has(k) && !skip.includes(k) && !(k.endsWith('_id') && !FACULTY_FIELDS.has(k)) && !same(o[k], n[k]))
    .map((k) => {
      const long = typeof n[k] === 'string' && (n[k] as string).length > 60 || typeof o[k] === 'string' && (o[k] as string).length > 60;
      const structured = (typeof n[k] === 'object' && n[k] !== null && !Array.isArray(n[k])) || (Array.isArray(n[k]) && (n[k] as unknown[]).some((x) => typeof x === 'object'));
      if (long || structured) return `${fieldLabel(k)} edited`;
      return `${fieldLabel(k)}: ${value(k, o[k], ctx)} → ${value(k, n[k], ctx)}`;
    });
}

// ---------------------------------------------------------------- sentences
const VERB = { INSERT: 'added', UPDATE: 'edited', DELETE: 'removed' } as const;
const NOUN: Record<string, [string, string]> = {
  assessment_items: ['assessment', 'assessments'], assessment_components: ['assessment component', 'assessment components'], exam_tasks: ['exam step', 'exam steps'],
  exam_assignments: ['exam roles', 'exam roles'], section_teachers: ['course teacher', 'course teachers'], course_outcomes: ['course outcome', 'course outcomes'],
  co_po_map: ['CO-PO link', 'CO-PO links'], obe_criteria: ['assessment map entry', 'assessment map entries'], obe_criterion_cos: ['CO tag on the assessment map', 'CO tags on the assessment map'],
  obe_offering_docs: ['course outline', 'course outlines'], rubrics: ['rubric', 'rubrics'], car_reports: ['CAR', 'CARs'], obe_attainment: ['attainment value', 'attainment values'],
  obe_attainment_runs: ['attainment calculation', 'attainment calculations'], course_records: ['course records', 'course records'], sessional_gradesheets: ['sessional gradesheet', 'sessional gradesheets'],
  term_milestones: ['term deadline', 'term deadlines'], allowed_users: ['person on the access list', 'people on the access list'], offerings: ['course offering', 'course offerings'],
  sections: ['section', 'sections'], courses: ['course', 'courses'], terms: ['term', 'terms'], faculty: ['faculty member', 'faculty members'], cqi_items: ['CQI item', 'CQI items'],
  course_file_items: ['course file item', 'course file items'], bugs_resolutions: ['BUGS resolution', 'BUGS resolutions'], item_date_history: ['date change', 'date changes'], marks: ['mark', 'marks'],
};
const noun = (t: string, n: number) => (NOUN[t] ?? [t.replace(/_/g, ' '), t.replace(/_/g, ' ')])[n === 1 ? 0 : 1];
const step = (k: unknown) => EXAM_STEPS.find((d) => d.key === k)?.label ?? String(k);

/** A short name for one row, e.g. "CT 01", "CO2", "Term Final · Q01 (a)". */
function rowLabel(t: string, r: Row, ctx: LogContext): string {
  const s = (k: string) => (r[k] === null || r[k] === undefined ? '' : String(r[k]));
  switch (t) {
    case 'assessment_items': return s('title') || 'an assessment';
    case 'assessment_components': return s('name') || labelOf(COMPONENT_KINDS, s('kind'));
    case 'course_outcomes': return s('code');
    case 'obe_criteria': return `${s('assessment')} · ${s('label')}`;
    case 'rubrics': return s('title') ? `“${s('title')}”` : 'an untitled rubric';
    case 'term_milestones': return MILESTONE[s('kind')] ?? s('kind');
    case 'courses': return s('code');
    case 'terms': return s('name');
    case 'faculty': return s('display_name');
    case 'allowed_users': return s('email');
    case 'sections': return `section ${s('name')}`;
    case 'section_teachers': return ctx.nameOf(s('faculty_id'));
    case 'co_po_map': return `${ctx.coCode?.(s('co_id')) ?? 'a CO'} → ${s('po_code')}`;
    case 'obe_criterion_cos': return ctx.coCode?.(s('co_id')) ?? 'a CO';
    case 'exam_tasks': return step(r.step);
    case 'cqi_items': return short(s('finding'), 60);
    case 'bugs_resolutions': return `meeting ${s('meeting_no')}`;
    case 'course_file_items': return SLOT[s('slot')] ?? s('slot');
    case 'obe_attainment': return s('code');
    default: return '';
  }
}

const STATUS_PHRASE: Record<string, string> = { outline_status: 'the course outline', feedback_status: 'student feedback', car_status: 'the course file / CAR',
  prep_status: 'gradesheet preparation', scrutiny_status: 'gradesheet scrutiny' };
const when = (r: Row) => `${fmtDateLong(r.held_on as string)}${r.held_time ? ` at ${String(r.held_time)}` : ''}`;

function one(g: LogGroup, e: AuditEntry, ctx: LogContext): Described {
  const o = e.old_row, n = e.new_row, r = (n ?? o)!;
  const label = rowLabel(g.table, r, ctx);
  const changes = (skip: string[] = []) => changedFields(o, n, ctx, skip);
  switch (g.table) {
    case 'assessment_items': {
      if (e.action === 'INSERT') return { text: r.held_on ? `scheduled ${label} for ${when(r)}` : `added ${label} (date to be set)`, details: [] };
      if (e.action === 'DELETE') return { text: `removed ${label}${o?.held_on ? ` (was ${when(o)})` : ''}`, details: [] };
      const reason = g.reason ? [`Reason: ${g.reason}`] : [];
      if (!same(o!.held_on, n!.held_on) || !same(o!.held_time, n!.held_time)) {
        const text = !o!.held_on ? `scheduled ${label} for ${when(n!)}` : !n!.held_on ? `set the date of ${label} to be decided later (was ${when(o!)})`
          : `rescheduled ${label} from ${when(o!)} to ${when(n!)}`;
        return { text, details: [...reason, ...changes(['held_on', 'held_time'])] };
      }
      if (!same(o!.status, n!.status)) return { text: `marked ${label} as ${labelOf(ITEM_STATUS, String(n!.status)).toLowerCase()}`, details: [...reason, ...changes(['status'])] };
      if (!same(o!.marks_status, n!.marks_status)) return { text: `set the marks of ${label} to “${value('marks_status', n!.marks_status, ctx)}”`, details: changes(['marks_status']) };
      return { text: `edited ${label}`, details: [...reason, ...changes()] };
    }
    case 'exam_tasks':
      if (e.action === 'UPDATE' && !same(o!.status, n!.status))
        return { text: `set ${label} to “${statusLabel(n!.step as ExamStep, String(n!.status))}”`, details: n!.note && !same(o!.note, n!.note) ? [`Note: ${short(String(n!.note), 200)}`] : [] };
      break;
    case 'exam_assignments':
      if (e.action !== 'DELETE') return { text: e.action === 'INSERT' ? 'assigned the exam roles' : 'changed the exam roles',
        details: e.action === 'INSERT' ? ['qp_a', 'qp_b', 'mod_1', 'mod_2', 'scrutinizer'].filter((k) => n![k]).map((k) => `${fieldLabel(k)}: ${ctx.nameOf(String(n![k]))}`) : changes() };
      break;
    case 'section_teachers':
      return { text: e.action === 'DELETE' ? `removed ${label} as course teacher` : `assigned ${label} as course teacher`, details: [] };
    case 'course_records': case 'sessional_gradesheets': {
      const keys = Object.keys(STATUS_PHRASE).filter((k) => o && n && k in n && !same(o[k], n[k]));
      if (e.action === 'UPDATE' && keys.length === 1) return { text: `set ${STATUS_PHRASE[keys[0]]} to “${value(keys[0], n![keys[0]], ctx)}”`, details: changes(keys) };
      return { text: e.action === 'INSERT' ? `started the ${noun(g.table, 1)}` : `updated the ${noun(g.table, 1)}`, details: e.action === 'UPDATE' ? changes() : [] };
    }
    case 'car_reports':
      if (e.action === 'UPDATE' && !same(o!.status, n!.status)) return { text: `set the CAR to ${String(n!.status)}`, details: changes(['status']) };
      return { text: e.action === 'DELETE' ? 'removed the CAR' : 'edited the CAR', details: e.action === 'UPDATE' ? changes() : [] };
    case 'obe_offering_docs':
      return { text: e.action === 'DELETE' ? 'removed the course outline' : 'edited the course outline', details: e.action === 'UPDATE' ? changes() : [] };
    case 'course_outcomes':
      if (e.action === 'INSERT') return { text: `added ${label}`, details: r.statement ? [short(String(r.statement), 200)] : [] };
      break;
    case 'co_po_map':
      return { text: e.action === 'DELETE' ? `unmapped ${label}` : e.action === 'INSERT' ? `mapped ${label}` : `edited ${label}`, details: [] };
    case 'obe_criteria':
      if (e.action === 'INSERT') return { text: `added ${label} (${String(r.max_marks)} marks) to the assessment map`, details: [] };
      if (e.action === 'DELETE') return { text: `removed ${label} from the assessment map`, details: [] };
      break;
    case 'obe_attainment_runs':
      return { text: `calculated attainment from ${r.file_name ? `“${String(r.file_name)}”` : 'a marksheet'} (${String(r.students ?? 0)} students)`, details: [] };
    case 'term_milestones':
      if (e.action !== 'DELETE') return { text: `set the ${label} deadline to ${fmtDateLong(String(r.due_on))}`, details: [] };
      break;
    case 'course_file_items':
      if (e.action !== 'DELETE' && !same(o?.done, n!.done)) return { text: `marked the ${label} as ${n!.done ? 'done' : 'not done'}`, details: changes(['done']) };
      break;
  }
  return { text: `${VERB[e.action]} ${noun(g.table, 1)}${label ? ` ${label}` : ''}`, details: e.action === 'UPDATE' ? changes() : [] };
}

/** One readable line (and optional detail lines) for a group of rows saved together. The person's name goes in front. */
export function describe(g: LogGroup, ctx: LogContext): Described {
  if (g.entries.length === 1) return one(g, g.entries[0], ctx);
  const n = g.entries.length;
  if (g.table === 'obe_attainment') return { text: `saved ${n} attainment values`, details: [] };
  if (g.table === 'co_po_map') return { text: g.action === 'DELETE' ? `unmapped ${n} CO-PO links` : `mapped ${n} CO-PO links`,
    details: g.entries.map((e) => rowLabel(g.table, (e.new_row ?? e.old_row)!, ctx)) };
  if (g.table === 'section_teachers') return { text: g.action === 'DELETE' ? `removed ${n} course teachers` : `assigned ${n} course teachers`,
    details: g.entries.map((e) => rowLabel(g.table, (e.new_row ?? e.old_row)!, ctx)) };
  if (g.table === 'assessment_items' && g.action === 'INSERT') {
    const dated = g.entries.filter((e) => e.new_row?.held_on).length;
    return { text: dated ? `scheduled ${n} assessments` : `added ${n} assessments`,
      details: g.entries.slice(0, 12).map((e) => one(g, e, ctx).text.replace(/^\w/, (c) => c.toUpperCase())) };
  }
  const labels = g.entries.map((e) => rowLabel(g.table, (e.new_row ?? e.old_row)!, ctx)).filter(Boolean);
  const details = g.action === 'UPDATE' ? g.entries.slice(0, 12).map((e) => one(g, e, ctx).text.replace(/^\w/, (c) => c.toUpperCase())) : labels.slice(0, 12);
  if (n > 12) details.push(`…and ${n - 12} more`);
  return { text: `${VERB[g.action]} ${n} ${noun(g.table, n)}`, details };
}
