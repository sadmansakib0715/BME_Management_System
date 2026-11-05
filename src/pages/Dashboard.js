import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Link } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { Card, CardHeader, ErrorNote, Meter, PageHeader, Spinner, Stat } from '@/components/ui';
import { WeekTracker } from '@/components/WeekTracker';
import { useTerm } from '@/lib/TermContext';
import { EXAM_STEPS, examProgress, marksPublished, stepState } from '@/lib/workflow';
/** Department overview, open to all faculty: progress only. Workload and setup gaps are for the HOD and admins. */
export default function Dashboard() {
    const { isAdmin } = useAuth();
    const { data, loading, error, courseOf, faculty, nameOf } = useTerm();
    if (loading)
        return _jsx(Spinner, {});
    if (error)
        return _jsx(ErrorNote, { error: error });
    if (!data)
        return null;
    const theory = data.offerings.filter((o) => data.exam.some((a) => a.offering_id === o.id));
    const funnel = EXAM_STEPS.map((d) => ({ d, done: theory.filter((o) => stepState(data.tasks.filter((t) => t.offering_id === o.id), d.key) === 'done').length }));
    const finished = theory.filter((o) => !examProgress(data.tasks.filter((t) => t.offering_id === o.id)).current).length;
    const items = data.items.filter((i) => i.status !== 'cancelled');
    const held = items.filter((i) => i.status === 'held').length;
    const published = items.filter((i) => marksPublished(i.marks_status)).length;
    const byCourse = data.offerings.map((o) => {
        const its = items.filter((i) => i.offering_id === o.id);
        return { o, c: courseOf(o), n: its.length, pub: its.filter((i) => i.status === 'held').length };
    }).filter((x) => x.c && x.n).sort((a, b) => a.c.code.localeCompare(b.c.code));
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
    return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { eyebrow: data.term.name, title: "Department overview", description: "How the term is going across every course." }), _jsx("div", { className: "mb-5", children: _jsx(WeekTracker, { term: data.term }) }), _jsxs("div", { className: "grid grid-cols-2 md:grid-cols-4 gap-3 mb-5", children: [_jsx(Stat, { label: "Courses", value: data.offerings.length, sub: `${theory.length} with a term final` }), _jsx(Stat, { label: "Assessments held", value: `${held}/${items.length}` }), _jsx(Stat, { label: "Term finals complete", value: `${finished}/${theory.length}` }), _jsx(Stat, { label: "Marks published", value: `${published}/${items.length}` })] }), _jsxs("div", { className: "grid gap-5 xl:grid-cols-2 [&>*]:min-w-0", children: [_jsxs(Card, { children: [_jsx(CardHeader, { title: "Term-final progress", subtitle: "Theory courses that have completed each step." }), _jsx("ul", { className: "p-4 space-y-2", children: funnel.map(({ d, done }) => (_jsxs("li", { className: "grid grid-cols-[160px_1fr_48px] items-center gap-3 text-sm", children: [_jsx("span", { className: "truncate", title: d.label, children: d.label.replace('Question preparation · Section', 'Question prep').replace('Script examination · Section', 'Script exam').replace('Gradesheet preparation', 'Gradesheet prep') }), _jsx("span", { className: "h-2 rounded-full bg-sunken overflow-hidden", "aria-hidden": true, children: _jsx("span", { className: "block h-full bg-wash", style: { width: `${theory.length ? (done / theory.length) * 100 : 0}%` } }) }), _jsxs("span", { className: "text-right tabular text-muted", children: [done, "/", theory.length] })] }, d.key))) })] }), _jsxs(Card, { children: [_jsx(CardHeader, { title: "Assessments held by course" }), byCourse.length ? _jsx("ul", { className: "divide-y divide-line max-h-96 overflow-y-auto", children: byCourse.map(({ o, c, n, pub }) => (_jsxs("li", { className: "px-4 py-2.5 grid grid-cols-[72px_1fr_48px] items-center gap-3", children: [_jsx(Link, { to: `/courses/${o.id}`, className: "link font-mono text-sm", children: c.code }), _jsx(Meter, { value: pub, max: n, label: `${c.code} assessments held` }), _jsxs("span", { className: "text-right text-2xs tabular text-muted", children: [pub, "/", n] })] }, o.id))) }) : _jsx("p", { className: "px-4 py-6 text-sm text-muted", children: "No assessment plans yet." })] }), isAdmin && _jsxs(_Fragment, { children: [_jsxs(Card, { children: [_jsx(CardHeader, { title: "Workload", subtitle: "Courses taught and exam roles held this term. Visible to HOD and admins." }), _jsx("ul", { className: "p-4 space-y-2", children: load.map(({ f, teach, exam }) => (_jsxs("li", { className: "grid grid-cols-[1fr_120px_auto] items-center gap-3 text-sm", children: [_jsx("span", { className: "truncate", children: nameOf(f.id) }), _jsxs("span", { className: "flex h-2 rounded-full bg-sunken overflow-hidden", "aria-hidden": true, children: [_jsx("span", { className: "bg-brand", style: { width: `${(teach / maxLoad) * 100}%` } }), _jsx("span", { className: "bg-wash", style: { width: `${(exam / maxLoad) * 100}%` } })] }), _jsxs("span", { className: "text-2xs text-muted tabular whitespace-nowrap", children: [teach, " course", teach === 1 ? '' : 's', " \u00B7 ", exam, " exam role", exam === 1 ? '' : 's'] })] }, f.id))) })] }), _jsxs(Card, { children: [_jsx(CardHeader, { title: "Setup gaps", subtitle: "Things the department still needs to fill in." }), setup.length ? _jsx("ul", { className: "divide-y divide-line max-h-80 overflow-y-auto", children: setup.map((s) => _jsx("li", { className: "px-4 py-2 text-sm", children: s }, s)) })
                                        : _jsx("p", { className: "px-4 py-6 text-sm text-muted", children: "Nothing missing." })] })] })] })] }));
}
