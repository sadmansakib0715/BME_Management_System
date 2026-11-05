import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { TypeBadge } from '@/components/bits';
import { Card, Empty, ErrorNote, Input, Meter, PageHeader, SegTabs, Spinner, StatusBadge } from '@/components/ui';
import { useTerm } from '@/lib/TermContext';
import { examProgress, marksPublished, marksUnderEvaluation, OUTLINE_STATUS } from '@/lib/workflow';
export default function Courses() {
    const { me } = useAuth();
    const { data, loading, error, courseOf, teachersOf, nameOf } = useTerm();
    const [filter, setFilter] = useState('all');
    const [q, setQ] = useState('');
    const rows = useMemo(() => {
        if (!data)
            return [];
        return data.offerings.map((o) => ({ o, c: courseOf(o) })).filter(({ c }) => !!c)
            .filter(({ o, c }) => filter === 'all' || (filter === 'mine' ? teachersOf(o.id).includes(me?.facultyId ?? '') : filter === 'theory' ? c.course_type === 'theory' : c.course_type !== 'theory'))
            .filter(({ o, c }) => !q || `${c.code} ${c.title} ${teachersOf(o.id).map(nameOf).join(' ')}`.toLowerCase().includes(q.toLowerCase()))
            .sort((a, b) => a.c.code.localeCompare(b.c.code));
    }, [data, filter, q, courseOf, teachersOf, nameOf, me]);
    if (loading)
        return _jsx(Spinner, {});
    if (error)
        return _jsx(ErrorNote, { error: error });
    if (!data)
        return null;
    return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { eyebrow: data.term.name, title: "All courses", description: `${data.offerings.length} courses this term.` }), _jsxs("div", { className: "flex flex-wrap items-center gap-3 mb-4", children: [_jsx(SegTabs, { label: "Filter courses", value: filter, onChange: setFilter, options: [{ value: 'all', label: 'All' }, { value: 'mine', label: 'Mine' }, { value: 'theory', label: 'Theory' }, { value: 'sessional', label: 'Sessional' }] }), _jsxs("div", { className: "relative w-full sm:w-72", children: [_jsx(Search, { className: "size-4 absolute left-2.5 top-2.5 text-subtle", "aria-hidden": true }), _jsx("label", { htmlFor: "course-search", className: "sr-only", children: "Search courses" }), _jsx(Input, { id: "course-search", className: "pl-8", placeholder: "Code, title or teacher", value: q, onChange: (e) => setQ(e.target.value) })] })] }), _jsx(Card, { className: "overflow-hidden", children: rows.length === 0 ? _jsx(Empty, { title: "No courses match", children: "Try another filter or search term." }) : (_jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Course" }), _jsx("th", { children: "Type" }), _jsx("th", { children: "Teachers" }), _jsx("th", { children: "Outline" }), _jsx("th", { className: "min-w-44", children: "Progress" })] }) }), _jsx("tbody", { children: rows.map(({ o, c }) => {
                                    const hasExam = data.exam.some((x) => x.offering_id === o.id);
                                    const p = examProgress(data.tasks.filter((t) => t.offering_id === o.id));
                                    const items = data.items.filter((i) => i.offering_id === o.id && i.status !== 'cancelled');
                                    const held = items.filter((i) => i.status === 'held').length;
                                    const rec = data.records.find((r) => r.offering_id === o.id);
                                    return (_jsxs("tr", { children: [_jsxs("td", { children: [_jsx(Link, { to: `/courses/${o.id}`, className: "link font-mono text-sm", children: c.code }), _jsx("div", { className: "text-2xs text-muted max-w-64 truncate", children: c.title })] }), _jsx("td", { children: _jsx(TypeBadge, { type: c.course_type }) }), _jsx("td", { className: "text-sm text-muted max-w-64", children: _jsx("span", { className: "line-clamp-2", children: teachersOf(o.id).map(nameOf).join(', ') || '—' }) }), _jsx("td", { children: rec ? _jsx(StatusBadge, { opts: OUTLINE_STATUS, value: rec.outline_status }) : _jsx("span", { className: "text-2xs text-subtle", children: "\u2014" }) }), _jsx("td", { children: hasExam ? _jsxs(_Fragment, { children: [_jsxs("div", { className: "text-2xs text-muted mb-1", children: ["Exam: ", p.current ? p.current.short : 'Complete', " \u00B7 ", p.done, "/", p.total] }), _jsx(Meter, { value: p.done, max: p.total, label: `${c.code} exam progress` })] })
                                                    : items.length ? _jsxs(_Fragment, { children: [_jsxs("div", { className: "text-2xs text-muted mb-1", children: ["Assessments held ", held, "/", items.length] }), _jsx(Meter, { value: held, max: items.length, label: `${c.code} assessments held` }), _jsxs("div", { className: "text-2xs text-subtle mt-1", children: ["Marks ", items.filter((i) => marksPublished(i.marks_status)).length, " published", items.some((i) => marksUnderEvaluation(i.marks_status)) ? `, ${items.filter((i) => marksUnderEvaluation(i.marks_status)).length} under evaluation` : ''] })] })
                                                        : _jsx("span", { className: "text-2xs text-subtle", children: "No assessments yet" }) })] }, o.id));
                                }) })] }) })) })] }));
}
