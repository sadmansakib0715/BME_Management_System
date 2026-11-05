import { fmtDate } from './format';
import { courseFile } from './obe';
import { blockers, ITEM_STATUS, MARKS_STATE, OUTLINE_STATUS, SG_PREP_STATUS, SG_SCRUTINY_STATUS, marksPublished, marksUnderEvaluation, stepDef, stepState, } from './workflow';
// ---------------------------------------------------------------- roll-up and next actions
export function rollUp(n) {
    if (!n.children?.length) {
        const state = n.state ?? 'locked';
        return { ...n, children: undefined, state, done: state === 'done' ? 1 : 0, total: state === 'na' ? 0 : 1 };
    }
    const kids = n.children.map(rollUp);
    const live = kids.filter((k) => k.state !== 'na');
    const done = kids.reduce((s, k) => s + k.done, 0);
    const total = kids.reduce((s, k) => s + k.total, 0);
    const has = (s) => live.some((k) => k.state === s);
    const state = live.length === 0 ? 'na'
        : live.every((k) => k.state === 'done') ? 'done'
            : has('returned') ? 'returned'
                : has('active') || has('done') ? 'active'
                    : has('ready') ? 'ready'
                        : 'locked';
    return { ...n, children: kids, state, done, total };
}
const URGENCY = { returned: 0, active: 1, ready: 2 };
/** Leaves someone can act on now, most urgent first, in lifecycle order within each group. */
export function nextActions(root, limit = 3) {
    const out = [];
    let order = 0;
    const walk = (n, path) => {
        if (!n.children) {
            if (n.state in URGENCY)
                out.push({ node: n, path, order: order++ });
            return;
        }
        n.children.forEach((c) => walk(c, n.tone === 'group' ? path : [...path, n.label])); // level groups would only lengthen the path
    };
    walk(root, []);
    return out.sort((a, b) => URGENCY[a.node.state] - URGENCY[b.node.state] || a.order - b.order)
        .slice(0, limit).map(({ node, path }) => ({ node, path: path.slice(1) }));
}
// ---------------------------------------------------------------- mapping status vocabularies to node states
const RETURNED = new Set(['needs_correction', 'under_correction', 'postponed']);
/** A status from one of the app's option lists. `done` defaults to the last option. */
function fromOpts(opts, value, done = opts[opts.length - 1].value) {
    const v = value ?? opts[0].value;
    if (RETURNED.has(v))
        return 'returned';
    const i = opts.findIndex((o) => o.value === v), end = opts.findIndex((o) => o.value === done);
    if (i >= end && end >= 0)
        return 'done';
    return i <= 0 ? 'ready' : 'active';
}
const label = (opts, v) => opts.find((o) => o.value === v)?.label ?? opts[0].label;
/** An unfinished step whose prerequisite isn't done waits, and says what it waits for. */
function gated(n, open, waitingOn) {
    return !open && (n.state === 'ready' || n.state === 'active') ? { ...n, state: 'locked', waitingOn } : n;
}
/** Node ids are unique only within a course; prefix them so several courses can share one tree. */
const scoped = (n, p) => ({ ...n, id: `${p}:${n.id}`, children: n.children?.map((c) => scoped(c, p)) });
// ---------------------------------------------------------------- one course
export function courseNode(offering, course, data, obe) {
    const id = offering.id;
    const base = `/courses/${id}`;
    const page = { overview: { to: base, toLabel: 'Overview' }, assess: { to: `${base}/assessments`, toLabel: course.course_type === 'theory' ? 'Class tests & plan' : 'Assessments' },
        exam: { to: `${base}/exam`, toLabel: course.course_type === 'theory' ? 'Exam workflow' : 'Gradesheet' }, obe: { to: `${base}/outcomes`, toLabel: 'OBE' } };
    const isTheory = course.course_type === 'theory';
    const rec = data.records.find((r) => r.offering_id === id);
    const sectionIds = data.sections.filter((s) => s.offering_id === id).map((s) => s.id);
    const hasTeachers = data.teachers.some((t) => sectionIds.includes(t.section_id));
    // Setup
    const cos = obe?.cos ?? [];
    const mapped = cos.length > 0 && cos.every((c) => obe.coPo.some((m) => m.co_id === c.id));
    const setup = { id: 'setup', label: 'Setup', tone: 'setup', children: [
            { id: 'teachers', label: 'Teachers', state: hasTeachers ? 'done' : 'ready', hint: hasTeachers ? 'Assigned' : 'Not assigned', ...page.overview },
            { id: 'outline', label: 'Course outline', state: fromOpts(OUTLINE_STATUS, rec?.outline_status, 'prepared'), hint: label(OUTLINE_STATUS, rec?.outline_status), ...page.overview,
                edits: rec ? [{ label: 'Status', target: { offering: id, kind: 'record', field: 'outline_status' }, value: rec.outline_status ?? OUTLINE_STATUS[0].value, options: OUTLINE_STATUS }] : [] },
            { id: 'cos', label: 'COs', state: cos.length ? 'done' : 'ready', hint: cos.length ? `${cos.length} written` : 'None yet', ...page.obe },
            gated({ id: 'copo', label: 'CO–PO mapping', state: mapped ? 'done' : 'ready', hint: mapped ? 'Every CO mapped' : 'Some COs unmapped', ...page.obe }, cos.length > 0, 'COs'),
            gated({ id: 'bugs', label: 'BUGS approval', state: offering.co_resolution_id ? 'done' : 'ready', hint: offering.co_resolution_id ? 'Resolution linked' : 'No resolution linked', ...page.obe }, mapped, 'CO–PO mapping'),
        ] };
    // Assessments: one branch per component; theory term final is handled by the exam chain instead.
    const comps = data.components.filter((c) => c.offering_id === id && !(isTheory && c.kind === 'term_final')).sort((a, b) => a.sort - b.sort);
    const items = data.items.filter((i) => i.offering_id === id);
    const secName = (sid) => data.sections.find((s) => s.id === sid)?.name;
    const itemState = (i) => i.status === 'cancelled' ? 'na' : i.status === 'postponed' ? 'returned'
        : marksPublished(i.marks_status) ? 'done'
            : i.status === 'held' || marksUnderEvaluation(i.marks_status) ? 'active' : 'ready';
    const itemHint = (i) => marksPublished(i.marks_status) ? 'Marks published' : i.status === 'held' ? 'Held, marks pending'
        : i.held_on ? `On ${fmtDate(i.held_on, { weekday: 'short', day: 'numeric', month: 'short' })}` : i.date_later && i.status !== 'cancelled' ? 'Date to be set later' : i.status === 'cancelled' ? 'Cancelled' : 'Not scheduled';
    // Items sit under their sub-section's branch, so the "(A1)" that generate_items adds to titles is dropped.
    const plain = (i, name) => { const s = secName(i.section_id); return s && name.endsWith(` (${s})`) ? name.slice(0, -s.length - 3) : name; };
    const leaf = (i, name = i.title) => ({ id: i.id, label: plain(i, name), state: itemState(i), hint: itemHint(i), ...page.assess,
        dated: { itemId: i.id, date: i.held_on, later: !!i.date_later && !i.held_on && i.status !== 'cancelled' },
        edits: [
            // Postponing needs a new date, so it is done from the assessments page.
            { label: 'Held', target: { offering: id, kind: 'item', itemId: i.id, field: 'status' }, value: i.status, options: ITEM_STATUS, elsewhere: ['postponed'] },
            { label: 'Marks', target: { offering: id, kind: 'item', itemId: i.id, field: 'marks_status' }, value: marksPublished(i.marks_status) ? 'published' : marksUnderEvaluation(i.marks_status) ? 'entering' : 'none', options: MARKS_STATE },
        ] });
    const compNode = (c, its, key = '') => {
        its = [...its].sort((a, b) => a.seq - b.seq);
        return its.length === 1 ? { ...leaf(its[0], c.name), id: c.id + key }
            : { id: c.id + key, label: c.name, children: its.length ? its.map((i) => leaf(i)) : [{ id: c.id + key + '-none', label: 'No items yet', state: 'ready', ...page.assess }] };
    };
    // Theory: A1 and A2 sit the same class tests, so the course is one class. Sessional: each sub-section is its own lab group, with its own branch.
    const subs = isTheory ? [] : data.sections.filter((s) => s.offering_id === id).sort((a, b) => a.name.localeCompare(b.name));
    const split = subs.length > 1 && comps.some((c) => c.per_section);
    const assessments = { id: 'assess', label: 'Assessments', tone: 'assess', ...page.assess,
        children: !split ? comps.map((c) => compNode(c, items.filter((i) => i.component_id === c.id)))
            : [...comps.filter((c) => !c.per_section).map((c) => compNode(c, items.filter((i) => i.component_id === c.id))),
                ...subs.map((s) => ({ id: 'sub-' + s.id, label: `Sub-section ${s.name}`,
                    children: comps.filter((c) => c.per_section).map((c) => compNode(c, items.filter((i) => i.component_id === c.id && i.section_id === s.id), ':' + s.id)) }))] };
    if (!assessments.children.length)
        assessments.children = [{ id: 'assess-none', label: 'Plan assessments', state: 'ready', hint: 'Add an assessment to start', ...page.assess }];
    // Exam chain (theory) or sessional gradesheet
    const tasks = data.tasks.filter((t) => t.offering_id === id);
    const openRounds = data.rounds.filter((r) => r.offering_id === id && !r.resolved_at);
    const step = (k, text) => {
        const d = stepDef(k);
        const t = tasks.find((x) => x.step === k);
        const st = stepState(tasks, k);
        const returned = RETURNED.has(t?.status ?? '') || (k.startsWith('mod') && openRounds.some((r) => r.moderator_step === k));
        const state = returned ? 'returned' : st === 'locked' ? 'locked' : st;
        return { id: k, label: text ?? d.short, state, hint: d.statuses.find((s) => s.value === (t?.status ?? 'not_started'))?.label, ...page.exam,
            waitingOn: st === 'locked' ? blockers(tasks, k).map((b) => stepDef(b).short).join(', ') : undefined,
            // Returning a paper for correction needs a note and a half, so that is done from the exam page.
            edits: data.exam.some((a) => a.offering_id === id) ? [{ label: 'Status', target: { offering: id, kind: 'exam', step: k }, value: t?.status ?? 'not_started', options: d.statuses, elsewhere: ['needs_correction'] }] : [] };
    };
    let examBranch;
    let marksDone;
    if (isTheory) {
        examBranch = [
            { id: 'final', label: 'Term final', tone: 'exam', children: [
                    { id: 'qp', label: 'Questions', children: [step('qp_a', 'Section A'), step('qp_b', 'Section B')] },
                    { id: 'mod', label: 'Moderation', children: [step('mod_1', 'Moderator 1'), step('mod_2', 'Moderator 2')] },
                    step('printing', 'Printing'),
                    { id: 'scripts', label: 'Script evaluation', children: [step('exam_a', 'Section A'), step('exam_b', 'Section B')] },
                    step('scrutiny', 'Scrutiny'),
                ] },
            { id: 'results', label: 'Gradesheet', tone: 'results', children: [step('gs_prep', 'Preparation'), step('gs_scrutiny', 'Scrutiny'), step('hod', 'To HOD')] },
        ];
        marksDone = stepState(tasks, 'scrutiny') === 'done';
    }
    else {
        const gs = data.gradesheets.find((g) => g.offering_id === id);
        const allPublished = items.length > 0 && items.every((i) => i.status === 'cancelled' || marksPublished(i.marks_status));
        const prep = gated({ id: 'sg_prep', label: 'Preparation', state: fromOpts(SG_PREP_STATUS, gs?.prep_status, 'uploaded_biis'), hint: label(SG_PREP_STATUS, gs?.prep_status), ...page.exam,
            edits: [{ label: 'Status', target: { offering: id, kind: 'gradesheet', part: 'prep' }, value: gs?.prep_status ?? 'not_started', options: SG_PREP_STATUS }] }, allPublished, 'All marks published');
        examBranch = [{ id: 'results', label: 'Gradesheet', tone: 'results', children: [prep,
                    gated({ id: 'sg_scr', label: 'Scrutiny', state: fromOpts(SG_SCRUTINY_STATUS, gs?.scrutiny_status, 'scrutinized'), hint: label(SG_SCRUTINY_STATUS, gs?.scrutiny_status), ...page.exam,
                        edits: [{ label: 'Status', target: { offering: id, kind: 'gradesheet', part: 'scrutiny' }, value: gs?.scrutiny_status ?? 'not_started', options: SG_SCRUTINY_STATUS }] }, prep.state === 'done', 'Gradesheet preparation'),
                ] }];
        marksDone = allPublished;
    }
    // OBE: CO attainment needs final marks; PO needs CO; program PO only for culminating courses.
    const att = obe?.attainment ?? [];
    const coVals = cos.filter((c) => att.some((a) => a.outcome_type === 'CO' && a.code === c.code && a.value != null)).length;
    const poCodes = [...new Set((obe?.coPo ?? []).map((m) => m.po_code))];
    const poVals = poCodes.filter((p) => att.some((a) => a.outcome_type === 'PO' && a.code === p && a.value != null)).length;
    const coState = cos.length && coVals === cos.length ? 'done' : coVals ? 'active' : 'ready';
    const poState = poCodes.length && poVals === poCodes.length ? 'done' : poVals ? 'active' : 'ready';
    const obeBranch = { id: 'obe', label: 'OBE', tone: 'obe', children: [
            gated({ id: 'co_att', label: 'CO attainment', state: coState, hint: `${coVals}/${cos.length} COs`, ...page.obe }, marksDone && cos.length > 0, isTheory ? 'Term-final scrutiny' : 'All marks published'),
            gated({ id: 'po_att', label: 'PO attainment', state: poState, hint: `${poVals}/${poCodes.length} POs`, ...page.obe }, coState === 'done', 'CO attainment'),
            ...(course.is_culminating ? [gated({ id: 'prog_po', label: 'Program PO', state: poState === 'done' ? 'done' : 'ready', hint: 'Feeds the batch PO', to: '/outcomes?tab=program', toLabel: 'Program PO' }, poState === 'done', 'PO attainment')] : []),
        ] };
    // Close-out. The CAR checks its own text before it can be final, so its status is set on the CAR page.
    const car = obe?.car;
    const carState = car?.status === 'final' ? 'done' : car ? 'active' : 'ready';
    const file = courseFile({ cos, coPo: obe?.coPo ?? [], attainment: att, car: car ?? null, files: obe?.files ?? [], hasTeachers, hasResolution: !!offering.co_resolution_id });
    const fileDone = file.filter((f) => f.done).length;
    const close = { id: 'close', label: 'Close-out', tone: 'close', children: [
            gated({ id: 'car', label: 'CAR', state: carState, hint: car ? car.status[0].toUpperCase() + car.status.slice(1) : 'Not started', ...page.obe }, coState === 'done', 'CO attainment'),
            { id: 'file', label: 'Course file', state: fileDone === file.length ? 'done' : fileDone ? 'active' : 'ready', hint: `${fileDone}/${file.length} parts`, ...page.obe },
        ] };
    return scoped({ id: 'course', label: course.code, tone: 'course', hint: course.title, to: base, toLabel: course.code, children: [setup, assessments, ...examBranch, obeBranch, close] }, id);
}
export const buildCourseTree = (offering, course, data, obe) => rollUp(courseNode(offering, course, data, obe));
/** One course's slice of the term-wide OBE bundle. */
export function obeSlice(obe, offeringId) {
    const cos = obe.cos.filter((c) => c.offering_id === offeringId);
    return { cos, coPo: obe.coPo.filter((m) => cos.some((c) => c.id === m.co_id)), attainment: obe.attainment.filter((a) => a.offering_id === offeringId),
        car: obe.cars.find((c) => c.offering_id === offeringId) ?? null, files: obe.files.filter((f) => f.offering_id === offeringId) };
}
/** Several courses under one root, optionally grouped (e.g. by level-term). Groups keep the order given. */
export function buildForest(rootLabel, rootHint, courses) {
    const groups = [...new Set(courses.map((c) => c.group))];
    const children = groups.length === 1 && groups[0] === undefined ? courses.map((c) => c.node)
        : groups.map((g) => ({ id: `group:${g ?? 'other'}`, label: g ?? 'Other', tone: 'group', children: courses.filter((c) => c.group === g).map((c) => c.node) }));
    return rollUp({ id: 'forest', label: rootLabel, hint: rootHint, children: children.length ? children : [{ id: 'none', label: 'No courses', state: 'na' }] });
}
