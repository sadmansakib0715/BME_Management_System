import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
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
const ProgressTab = lazy(() => import('./ProgressTab'));
export default function CourseDetail() {
    const { id = '', tab = 'overview' } = useParams();
    const { data, loading, error, courseOf, teachersOf, nameOf } = useTerm();
    if (loading)
        return _jsx(Spinner, {});
    if (error)
        return _jsx(ErrorNote, { error: error });
    const o = data?.offerings.find((x) => x.id === id);
    const c = o && courseOf(o);
    if (!data || !o || !c)
        return _jsx(Empty, { title: "Course not found", children: "It may belong to another term. Pick the term in the sidebar." });
    const isTheory = c.course_type === 'theory';
    const tabs = [
        ['overview', 'Overview'], ['assessments', isTheory ? 'Class tests & plan' : 'Assessments'], ['exam', isTheory ? 'Exam workflow' : 'Gradesheet'],
        ['outcomes', 'OBE'], ['progress', 'Progress tree'],
    ];
    const props = { offering: o, course: c, data };
    return (_jsxs(_Fragment, { children: [_jsxs(Link, { to: "/courses", className: "inline-flex items-center gap-1 text-sm text-muted hover:text-ink mb-3 cursor-pointer", children: [_jsx(ChevronLeft, { className: "size-4", "aria-hidden": true }), "Courses"] }), _jsx("div", { className: "flex flex-wrap items-start justify-between gap-3 mb-4", children: _jsxs("div", { children: [_jsxs("div", { className: "flex items-center gap-2 mb-1", children: [_jsx("span", { className: "font-mono text-sm text-muted", children: c.code }), _jsx(TypeBadge, { type: c.course_type }), o.batch && _jsxs("span", { className: "text-2xs text-subtle", children: ["Cohort ", o.batch] })] }), _jsx("h1", { className: "text-xl font-semibold tracking-tight", children: c.title }), _jsx("p", { className: "text-sm text-muted mt-1", children: teachersOf(o.id).map(nameOf).join(' · ') || 'No teachers assigned' })] }) }), _jsx("nav", { "aria-label": "Course sections", className: "border-b border-line mb-5 -mx-1 overflow-x-auto", children: _jsx("ul", { className: "flex gap-1 min-w-max px-1", children: tabs.map(([k, label]) => (_jsx("li", { children: _jsx(NavLink, { to: `/courses/${o.id}/${k === 'overview' ? '' : k}`, end: k === 'overview', className: ({ isActive }) => clsx('inline-block px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors duration-150 cursor-pointer', isActive || (k === tab) ? 'border-brand text-ink' : 'border-transparent text-muted hover:text-ink'), children: label }) }, k))) }) }), _jsxs(Suspense, { fallback: _jsx(Spinner, {}), children: [tab === 'overview' && _jsx(Overview, { ...props }), tab === 'assessments' && _jsx(AssessmentsTab, { ...props }), tab === 'exam' && _jsx(ExamTab, { ...props }), tab === 'outcomes' && _jsx(OutcomesTab, { ...props }), tab === 'progress' && _jsx(ProgressTab, { ...props })] })] }));
}
