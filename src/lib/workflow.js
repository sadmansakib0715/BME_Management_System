const s = (value, label) => ({ value, label });
const NS = s('not_started', 'Not started');
export const EXAM_STEPS = [
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
export const stepDef = (k) => EXAM_STEPS.find((d) => d.key === k);
export const statusLabel = (k, v) => stepDef(k).statuses.find((x) => x.value === v)?.label ?? v;
export function stepOwner(a, k) {
    const o = stepDef(k).owner;
    if (!a || o === 'admin' || o === 'hod')
        return null;
    return a[o] ?? null;
}
export function stepState(tasks, k) {
    const t = tasks.find((x) => x.step === k);
    const d = stepDef(k);
    if (t && t.status === d.done)
        return 'done';
    const blocked = d.deps.some((dep) => tasks.find((x) => x.step === dep)?.status !== stepDef(dep).done);
    if (blocked)
        return 'locked';
    return t && t.status !== 'not_started' ? 'active' : 'ready';
}
export const blockers = (tasks, k) => stepDef(k).deps.filter((dep) => tasks.find((x) => x.step === dep)?.status !== stepDef(dep).done);
export function examProgress(tasks) {
    const done = EXAM_STEPS.filter((d) => stepState(tasks, d.key) === 'done').length;
    const current = EXAM_STEPS.find((d) => stepState(tasks, d.key) !== 'done') ?? null;
    return { done, total: EXAM_STEPS.length, current };
}
/** Same hard rules as the CHECK constraints on exam_assignments, plus the spreadsheet's soft warning. */
export function validateAssignment(a, nameOf = (x) => x) {
    const out = [];
    const eq = (x, y) => !!x && !!y && x === y;
    if (eq(a.qp_a, a.qp_b))
        out.push({ level: 'error', message: 'Question preparers A and B must be different people.' });
    if (eq(a.mod_1, a.mod_2))
        out.push({ level: 'error', message: 'Moderators 1 and 2 must be different people.' });
    for (const m of [a.mod_1, a.mod_2])
        if (eq(m, a.qp_a) || eq(m, a.qp_b))
            out.push({ level: 'error', message: `${nameOf(m)} cannot moderate a paper they prepared.` });
    if (eq(a.scrutinizer, a.qp_a) || eq(a.scrutinizer, a.qp_b))
        out.push({ level: 'error', message: 'The script scrutinizer cannot be one of the question preparers.' });
    if (eq(a.scrutinizer, a.mod_1) || eq(a.scrutinizer, a.mod_2))
        out.push({ level: 'warning', message: 'The scrutinizer is also a moderator. Allowed, but check workload.' });
    return out;
}
// ------------------------------------------------------------- other status vocabularies
export const ITEM_STATUS = [s('planned', 'Planned'), s('scheduled', 'Scheduled'), s('held', 'Held'), s('postponed', 'Postponed'), s('cancelled', 'Cancelled')];
export const OUTLINE_STATUS = [NS, s('under_preparation', 'Under preparation'), s('prepared', 'Prepared'), s('shared', 'Shared with students')];
export const FEEDBACK_STATUS = [NS, s('students_reminded', 'Students reminded'), s('collected', 'Feedback collected')];
export const CAR_STATUS = [NS, s('under_preparation', 'Under preparation'), s('prepared', 'Prepared'), s('final', 'Final')];
export const SG_PREP_STATUS = [NS, s('under_preparation', 'Under preparation'), s('prepared', 'Prepared'), s('uploaded_biis', 'Uploaded in BIIS'), s('forwarded', 'Forwarded to scrutinizer')];
export const SG_SCRUTINY_STATUS = [NS, s('under_scrutiny', 'Under scrutiny'), s('scrutinized', 'Scrutinized'), s('forwarded_hod', 'Forwarded to HOD')];
/** Marks are not kept here; teachers only record whether an item's marks are out. 'verified'/'locked' come from older data or the workbook. */
export const MARKS_STATE = [s('none', 'Not evaluated'), s('entering', 'Under evaluation'), s('published', 'Published')];
export const MARKS_LEGACY = [s('verified', 'Under evaluation (verified)'), s('locked', 'Published (locked)')];
export const marksPublished = (s) => s === 'published' || s === 'locked';
export const marksUnderEvaluation = (s) => s === 'entering' || s === 'verified';
export const labelOf = (opts, v) => opts.find((o) => o.value === v)?.label ?? v;
const OFF_PATH = { cancelled: 'n', postponed: 1, needs_correction: 0, under_correction: 0, verified: 2, locked: 3 };
/** Colour step for a status: first step 0 (mild red), done 3 (green), in between 1–2 by how far along it is. */
export function progressTone(opts, value, done = opts[opts.length - 1].value) {
    if (value in OFF_PATH)
        return OFF_PATH[value];
    const path = opts.filter((o) => !(o.value in OFF_PATH)).map((o) => o.value);
    const i = path.indexOf(value), end = path.indexOf(done);
    if (i <= 0 || end <= 0)
        return 0;
    if (i >= end)
        return 3;
    return i / end <= 0.5 ? 1 : 2;
}
export const COMPONENT_KINDS = [
    s('class_test', 'Class test'), s('term_final', 'Term final'), s('attendance', 'Attendance'), s('lab_report', 'Lab report'),
    s('lab_test', 'Lab test'), s('quiz', 'Quiz'), s('viva', 'Viva'), s('presentation', 'Presentation'),
    s('demonstration', 'Demonstration'), s('project', 'Project'), s('assignment', 'Assignment'), s('other', 'Other'),
];
