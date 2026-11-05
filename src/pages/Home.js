import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { clsx } from 'clsx';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { TypeBadge } from '@/components/bits';
import TermTree from '@/components/TermTree';
import { Button, Card, CardHeader, Empty, ErrorNote, Meter, PageHeader, SegTabs, Spinner } from '@/components/ui';
import { fmtDate, todayISO } from '@/lib/format';
import { useTerm } from '@/lib/TermContext';
import { blockers, EXAM_STEPS, examProgress, marksPublished, marksUnderEvaluation, stepDef, stepOwner, stepState } from '@/lib/workflow';
const KIND = {
    ct: { label: 'Class test', dot: 'bg-brand' },
    exam: { label: 'Exam', dot: 'bg-info' },
    assess: { label: 'Assessment', dot: 'bg-wash' },
};
const ROLE = { qp_a: 'Question setter A', qp_b: 'Question setter B', mod_1: 'Moderator 1', mod_2: 'Moderator 2', scrutinizer: 'Scrutinizer' };
export default function Home() {
    const { me } = useAuth();
    const { data, loading, error, courseOf, nameOf, teachersOf } = useTerm();
    const fid = me?.facultyId ?? null;
    const [params, setParams] = useSearchParams();
    const view = params.get('view') === 'tree' ? 'tree' : 'cards';
    const mine = useMemo(() => {
        if (!data || !fid)
            return [];
        return data.offerings.map((o) => {
            const c = courseOf(o);
            const a = data.exam.find((x) => x.offering_id === o.id);
            const teaches = teachersOf(o.id).includes(fid);
            const examRoles = a ? Object.keys(ROLE).filter((k) => a[k] === fid) : [];
            const g = data.gradesheets.find((x) => x.offering_id === o.id);
            const gsRole = g?.preparer === fid ? 'Gradesheet preparer' : g?.scrutinizer === fid ? 'Gradesheet scrutinizer' : null;
            return { o, c, a, teaches, examRoles, gsRole };
        }).filter((x) => !!x.c && (x.teaches || x.examRoles.length > 0 || !!x.gsRole))
            .sort((x, y) => Number(y.teaches) - Number(x.teaches) || x.c.code.localeCompare(y.c.code));
    }, [data, fid, courseOf, teachersOf]);
    const events = useMemo(() => {
        if (!data)
            return [];
        const out = [];
        for (const { o, c, teaches } of mine) {
            if (!teaches)
                continue;
            for (const i of data.items) {
                if (i.offering_id !== o.id || !i.held_on || i.status === 'cancelled')
                    continue;
                const k = data.components.find((x) => x.id === i.component_id)?.kind;
                out.push({ date: i.held_on, time: i.held_time, code: c.code, title: i.title, kind: k === 'class_test' ? 'ct' : k === 'term_final' ? 'exam' : 'assess', href: `/courses/${o.id}/assessments` });
            }
            const start = examStart(data, o);
            if (start && c.course_type === 'theory')
                out.push({ date: start, time: null, code: c.code, title: 'Term final exams begin', kind: 'exam', href: `/courses/${o.id}/exam` });
        }
        return out.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''));
    }, [data, mine]);
    if (loading)
        return _jsx(Spinner, {});
    if (error)
        return _jsx(ErrorNote, { error: error });
    if (!data)
        return _jsx(Empty, { title: "No term set up yet", children: "Create a term in Term setup, or import the department workbook." });
    const t = data.term;
    const week = t.calendar_status === 'paused' ? 'Classes paused' : t.latest_completed_week >= t.total_weeks ? 'Teaching weeks complete' : `Week ${t.latest_completed_week + 1} of ${t.total_weeks}`;
    if (!fid)
        return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { eyebrow: `${t.name} · ${week}`, title: "My courses" }), _jsx(Card, { children: _jsx(Empty, { title: "Choose your name to see your courses", children: "Pick yourself under \u201CViewing as\u201D at the bottom of the sidebar." }) })] }));
    const first = nameOf(fid).replace(/^(Dr|Mr|Ms|Mrs|Prof)\.?\s+/, '').split(' ')[0];
    return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { eyebrow: `${t.name} · ${week}`, title: `Hello, ${first}`, actions: _jsxs(Link, { to: "/dashboard", className: "inline-flex items-center gap-1.5 text-sm font-medium text-brand-ink hover:underline underline-offset-2", children: ["Department overview", _jsx(ArrowRight, { className: "size-4", "aria-hidden": true })] }) }), _jsxs("div", { className: clsx('grid gap-6 [&>*]:min-w-0', view === 'cards' && 'xl:grid-cols-[1fr_380px]'), children: [_jsxs("section", { "aria-labelledby": "my-courses", children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-2 mb-3", children: [_jsx("h2", { id: "my-courses", className: "text-base font-semibold", children: "My courses" }), mine.length > 0 && _jsx(SegTabs, { label: "Show my courses as", value: view, onChange: (v) => setParams(v === 'tree' ? { view: 'tree' } : {}), options: [{ value: 'cards', label: 'Cards' }, { value: 'tree', label: 'Tree view' }] })] }), mine.length && view === 'tree' ? (_jsx(TermTree, { data: data, offerings: mine.map((m) => m.o), label: "My courses", hint: nameOf(fid) })) : mine.length ? (_jsx("ul", { className: "grid gap-3 md:grid-cols-2", children: mine.map((m) => _jsx("li", { children: _jsx(CourseCard, { data: data, me: fid, ...m }) }, m.o.id)) })) : _jsx(Card, { children: _jsx(Empty, { title: "No courses this term", children: "Courses you teach or examine will appear here." }) })] }), view === 'cards' && _jsxs("section", { "aria-labelledby": "my-cal", children: [_jsx("h2", { id: "my-cal", className: "text-base font-semibold mb-3", children: "My calendar" }), _jsx(MyCalendar, { events: events })] })] })] }));
}
function examStart(d, o) {
    return (d.milestones.find((m) => m.kind === 'exam_start' && m.offering_id === o.id) ?? d.milestones.find((m) => m.kind === 'exam_start' && !m.offering_id))?.due_on ?? null;
}
function CourseCard({ data, me, o, c, a, teaches, examRoles, gsRole }) {
    const tasks = data.tasks.filter((t) => t.offering_id === o.id);
    const p = a ? examProgress(tasks) : null;
    const items = data.items.filter((i) => i.offering_id === o.id && i.status !== 'cancelled');
    const held = items.filter((i) => i.status === 'held').length;
    const pub = items.filter((i) => marksPublished(i.marks_status)).length;
    const evaluating = items.filter((i) => marksUnderEvaluation(i.marks_status)).length;
    const today = todayISO();
    const next = items.filter((i) => i.held_on && i.held_on >= today && i.status !== 'held').sort((x, y) => x.held_on.localeCompare(y.held_on))[0];
    const roles = [teaches && 'Teacher', ...examRoles.map((k) => ROLE[k]), gsRole].filter(Boolean);
    // My exam step, described plainly: what it is and whether it is open yet.
    const myStep = a && EXAM_STEPS.find((d) => stepOwner(a, d.key) === me && stepState(tasks, d.key) !== 'done');
    const part = !a || !examRoles.length ? null : !myStep ? 'Your exam steps are complete'
        : stepState(tasks, myStep.key) === 'locked' ? `${myStep.label} · opens after ${blockers(tasks, myStep.key).map((k) => stepDef(k).short).join(', ')}`
            : `${myStep.label} · ${stepState(tasks, myStep.key) === 'active' ? 'in progress' : 'ready for you'}`;
    return (_jsxs(Link, { to: `/courses/${o.id}${!teaches && a ? '/exam' : ''}`, className: "group card p-4 flex flex-col gap-3 h-full hover:border-brand/40 hover:shadow-pop transition-shadow duration-200", children: [_jsxs("div", { className: "flex items-start justify-between gap-2", children: [_jsxs("div", { className: "min-w-0", children: [_jsxs("div", { className: "font-mono text-2xs text-subtle", children: [c.code, o.batch ? ` · ${o.batch}` : ''] }), _jsx("div", { className: "text-sm font-semibold leading-snug line-clamp-2", children: c.title })] }), _jsx(TypeBadge, { type: c.course_type })] }), _jsx("div", { className: "flex flex-wrap gap-1", children: roles.map((r) => _jsx("span", { className: "text-2xs font-medium rounded px-1.5 py-0.5 bg-sunken text-muted", children: r }, r)) }), _jsxs("div", { className: "space-y-2.5", children: [teaches && items.length > 0 && (_jsxs("div", { children: [_jsxs("div", { className: "flex justify-between text-2xs text-muted mb-1", children: [_jsx("span", { children: "Class tests & assessments held" }), _jsxs("span", { className: "tabular", children: [held, "/", items.length] })] }), _jsx(Meter, { value: held, max: items.length, label: `${c.code} assessments held` }), _jsxs("p", { className: "text-2xs text-muted mt-1.5", children: [_jsx("span", { className: "text-subtle", children: "Marks: " }), pub, " published", evaluating ? `, ${evaluating} under evaluation` : ''] })] })), teaches && !items.length && _jsx("p", { className: "text-2xs text-subtle", children: "No assessment plan yet" }), p && (_jsxs("div", { children: [_jsxs("div", { className: "flex justify-between text-2xs text-muted mb-1", children: [_jsxs("span", { children: ["Term final", p.current ? ` · now at ${p.current.short}` : ' · complete'] }), _jsxs("span", { className: "tabular", children: [p.done, "/", p.total] })] }), _jsx(Meter, { value: p.done, max: p.total, label: `${c.code} term-final progress` })] })), part && _jsxs("p", { className: "text-2xs text-ink", children: [_jsx("span", { className: "text-subtle", children: "Your part: " }), part] }), teaches && next && _jsxs("p", { className: "text-2xs text-ink", children: [_jsx("span", { className: "text-subtle", children: "Next: " }), next.title, " \u00B7 ", fmtDate(next.held_on, { weekday: 'short', day: 'numeric', month: 'short' })] })] })] }));
}
function MyCalendar({ events }) {
    const today = todayISO();
    const [month, setMonth] = useState(() => today.slice(0, 7));
    const [y, m] = month.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1));
    const lead = (first.getUTCDay() + 1) % 7; // weeks start on Saturday, as at BUET
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const cells = Array.from({ length: Math.ceil((lead + days) / 7) * 7 }, (_, i) => {
        const d = i - lead + 1;
        return d >= 1 && d <= days ? `${month}-${String(d).padStart(2, '0')}` : null;
    });
    const shift = (n) => setMonth(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7));
    const upcoming = events.filter((e) => e.date >= today).slice(0, 6);
    return (_jsxs(Card, { children: [_jsxs("div", { className: "flex items-center justify-between px-3 pt-3", children: [_jsx(Button, { size: "sm", variant: "ghost", "aria-label": "Previous month", onClick: () => shift(-1), children: _jsx(ChevronLeft, { className: "size-4", "aria-hidden": true }) }), _jsx("button", { type: "button", onClick: () => setMonth(today.slice(0, 7)), className: "text-sm font-semibold rounded px-2 h-8 hover:bg-sunken cursor-pointer", "aria-live": "polite", title: "Back to this month", children: first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }) }), _jsx(Button, { size: "sm", variant: "ghost", "aria-label": "Next month", onClick: () => shift(1), children: _jsx(ChevronRight, { className: "size-4", "aria-hidden": true }) })] }), _jsx("div", { className: "grid grid-cols-7 px-3 pt-2 text-center text-2xs font-semibold text-subtle", "aria-hidden": true, children: ['Sa', 'Su', 'Mo', 'Tu', 'We', 'Th', 'Fr'].map((d) => _jsx("div", { className: "py-1", children: d }, d)) }), _jsx("div", { className: "grid grid-cols-7 gap-0.5 px-3 pb-3", children: cells.map((d, i) => {
                    const list = d ? events.filter((e) => e.date === d) : [];
                    const label = d ? `${fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' })}${list.length ? `: ${list.map((e) => `${e.code} ${e.title}`).join(', ')}` : ''}` : undefined;
                    return (_jsxs("div", { title: label, className: clsx('h-11 rounded flex flex-col items-center justify-center gap-0.5 text-2xs tabular', !d && 'invisible', d === today ? 'bg-brand text-brand-fg font-semibold' : list.length ? 'bg-sunken text-ink font-medium' : 'text-muted'), children: [d && Number(d.slice(8)), list.length > 0 && _jsx("span", { className: "sr-only", children: label }), list.length > 0 && _jsx("span", { className: "flex gap-0.5", "aria-hidden": true, children: [...new Set(list.map((e) => e.kind))].map((k) => _jsx("span", { className: clsx('size-1.5 rounded-full', d === today ? 'bg-brand-fg' : KIND[k].dot) }, k)) })] }, i));
                }) }), _jsx("div", { className: "flex flex-wrap gap-3 px-4 pb-3 text-2xs text-muted", children: Object.keys(KIND).map((k) => _jsxs("span", { className: "flex items-center gap-1", children: [_jsx("span", { className: clsx('size-2 rounded-full', KIND[k].dot), "aria-hidden": true }), KIND[k].label] }, k)) }), _jsx(CardHeader, { title: "Coming up" }), upcoming.length ? (_jsx("ul", { className: "divide-y divide-line", children: upcoming.map((e, i) => (_jsx("li", { children: _jsxs(Link, { to: e.href, className: "flex items-center gap-3 px-4 py-2.5 hover:bg-sunken/60 transition-colors duration-150", children: [_jsxs("span", { className: "w-11 shrink-0 text-center leading-tight", children: [_jsx("span", { className: "block text-2xs uppercase text-subtle", children: fmtDate(e.date, { month: 'short' }) }), _jsx("span", { className: "block text-base font-semibold tabular", children: Number(e.date.slice(8)) })] }), _jsx("span", { className: clsx('size-2 rounded-full shrink-0', KIND[e.kind].dot), "aria-hidden": true }), _jsxs("span", { className: "min-w-0 flex-1", children: [_jsxs("span", { className: "block text-sm font-medium truncate", children: [e.code, " \u00B7 ", e.title] }), _jsxs("span", { className: "block text-2xs text-subtle", children: [KIND[e.kind].label, e.time ? ` · ${e.time}` : ''] })] })] }) }, i))) })) : _jsx("p", { className: "px-4 py-5 text-sm text-muted", children: "No class tests or exams scheduled yet." })] }));
}
