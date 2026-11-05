import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { clsx } from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { Button, Card, ErrorNote, PageHeader, SegTabs, Select, Spinner } from '@/components/ui';
import { fmtDateLong, todayISO } from '@/lib/format';
import { useTerm } from '@/lib/TermContext';
export default function Calendar() {
    const { me } = useAuth();
    const { data, loading, error, courseOf, teachersOf } = useTerm();
    const [scope, setScope] = useState('all');
    const [cohort, setCohort] = useState('');
    const [month, setMonth] = useState(() => todayISO().slice(0, 7));
    const events = useMemo(() => {
        if (!data)
            return [];
        const out = [];
        for (const i of data.items) {
            if (!i.held_on || i.status === 'cancelled')
                continue;
            const o = data.offerings.find((x) => x.id === i.offering_id);
            if (scope === 'mine' && !teachersOf(o.id).includes(me?.facultyId ?? ''))
                continue;
            if (cohort && o.batch !== cohort)
                continue;
            const isCt = data.components.find((c) => c.id === i.component_id)?.kind === 'class_test';
            out.push({ date: i.held_on, label: `${courseOf(o)?.code} ${i.title}`, sub: [o.batch, i.held_time].filter(Boolean).join(' · '), href: `/courses/${o.id}/assessments`, kind: isCt ? 'ct' : 'assess' });
        }
        for (const m of data.milestones.filter((x) => !x.offering_id && x.kind === 'exam_start'))
            out.push({ date: m.due_on, label: 'Term final exams begin', sub: 'Department', href: '/calendar', kind: 'deadline' });
        return out.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
    }, [data, scope, cohort, me, courseOf, teachersOf]);
    if (loading)
        return _jsx(Spinner, {});
    if (error)
        return _jsx(ErrorNote, { error: error });
    if (!data)
        return null;
    const cohorts = [...new Set(data.offerings.map((o) => o.batch).filter(Boolean))].sort();
    const [y, m] = month.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1));
    const lead = (first.getUTCDay() + 1) % 7; // weeks start on Saturday, as at BUET
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const cells = Array.from({ length: Math.ceil((lead + days) / 7) * 7 }, (_, i) => {
        const d = i - lead + 1;
        return d >= 1 && d <= days ? `${month}-${String(d).padStart(2, '0')}` : null;
    });
    const shift = (n) => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); setMonth(d.toISOString().slice(0, 7)); };
    const today = todayISO();
    const inMonth = events.filter((e) => e.date.startsWith(month));
    const dot = { ct: 'bg-brand', assess: 'bg-wash', deadline: 'bg-info' };
    return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { eyebrow: data.term.name, title: "Calendar", description: "Class tests, sessional assessments and term finals across the department. Weeks start on Saturday." }), _jsxs("div", { className: "flex flex-wrap items-center gap-3 mb-4", children: [_jsxs("div", { className: "flex items-center gap-1", children: [_jsx(Button, { size: "sm", variant: "ghost", "aria-label": "Previous month", onClick: () => shift(-1), children: _jsx(ChevronLeft, { className: "size-4", "aria-hidden": true }) }), _jsx("h2", { className: "text-base font-semibold w-36 text-center", "aria-live": "polite", children: first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }) }), _jsx(Button, { size: "sm", variant: "ghost", "aria-label": "Next month", onClick: () => shift(1), children: _jsx(ChevronRight, { className: "size-4", "aria-hidden": true }) }), _jsx(Button, { size: "sm", onClick: () => setMonth(today.slice(0, 7)), children: "Today" })] }), _jsx(SegTabs, { label: "Whose events", value: scope, onChange: setScope, options: [{ value: 'all', label: 'Department' }, { value: 'mine', label: 'My courses' }] }), _jsx("label", { htmlFor: "cohort", className: "sr-only", children: "Cohort" }), _jsxs(Select, { id: "cohort", className: "w-40 h-8", value: cohort, onChange: (e) => setCohort(e.target.value), children: [_jsx("option", { value: "", children: "All cohorts" }), cohorts.map((c) => _jsx("option", { value: c, children: c }, c))] }), _jsxs("div", { className: "flex items-center gap-3 text-2xs text-muted ml-auto", children: [_jsxs("span", { className: "flex items-center gap-1", children: [_jsx("span", { className: `size-2 rounded-full ${dot.ct}` }), "Class test"] }), _jsxs("span", { className: "flex items-center gap-1", children: [_jsx("span", { className: `size-2 rounded-full ${dot.assess}` }), "Sessional"] }), _jsxs("span", { className: "flex items-center gap-1", children: [_jsx("span", { className: `size-2 rounded-full ${dot.deadline}` }), "Term finals"] })] })] }), _jsxs(Card, { className: "hidden md:block overflow-hidden", children: [_jsx("div", { className: "grid grid-cols-7 text-2xs font-semibold uppercase tracking-wide text-subtle bg-sunken/60 border-b border-line", children: ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d) => _jsx("div", { className: "px-2 py-2", children: d }, d)) }), _jsx("div", { className: "grid grid-cols-7", children: cells.map((d, i) => {
                            const list = d ? events.filter((e) => e.date === d) : [];
                            return (_jsxs("div", { className: clsx('min-h-28 border-b border-r border-line p-1.5', !d && 'bg-sunken/40', (i + 1) % 7 === 0 && 'border-r-0'), children: [d && _jsx("div", { className: clsx('text-2xs tabular mb-1 w-6 h-6 grid place-items-center rounded-full', d === today ? 'bg-brand text-brand-fg font-semibold' : 'text-muted'), children: Number(d.slice(8)) }), _jsxs("ul", { className: "space-y-0.5", children: [list.slice(0, 4).map((e, j) => (_jsx("li", { children: _jsxs(Link, { to: e.href, title: `${e.label} · ${e.sub}`, className: "flex items-center gap-1 rounded px-1 py-0.5 text-2xs hover:bg-sunken cursor-pointer", children: [_jsx("span", { className: `size-1.5 rounded-full shrink-0 ${dot[e.kind]}`, "aria-hidden": true }), _jsx("span", { className: "truncate", children: e.label })] }) }, j))), list.length > 4 && _jsxs("li", { className: "text-2xs text-subtle px-1", children: ["+", list.length - 4, " more"] })] })] }, i));
                        }) })] }), _jsx(Card, { className: "md:hidden", children: inMonth.length ? _jsx("ul", { className: "divide-y divide-line", children: inMonth.map((e, i) => (_jsx("li", { children: _jsxs(Link, { to: e.href, className: "flex items-center gap-3 px-4 py-2.5 cursor-pointer", children: [_jsx("span", { className: `size-2 rounded-full ${dot[e.kind]}`, "aria-hidden": true }), _jsxs("span", { className: "flex-1 min-w-0", children: [_jsx("span", { className: "block text-sm font-medium truncate", children: e.label }), _jsxs("span", { className: "block text-2xs text-subtle", children: [fmtDateLong(e.date), " \u00B7 ", e.sub] })] })] }) }, i))) }) : _jsx("p", { className: "px-4 py-6 text-sm text-muted", children: "Nothing scheduled this month." }) })] }));
}
