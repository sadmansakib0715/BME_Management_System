import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { CalendarDays, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, CardHeader, Empty, SegTabs, Select, useToast } from '@/components/ui';
import { must, rpc, useWrite } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { useTerm } from '@/lib/TermContext';
import { RescheduleDialog } from '../course/AssessmentsTab';
/** The term's class-test routine in one table: set or move any date. Same rules as the course page (no two class tests for a cohort on one day). */
export default function SetupRoutine() {
    const { data, courseOf } = useTerm();
    const toast = useToast();
    const [scope, setScope] = useState('ct');
    const [cohort, setCohort] = useState('');
    const [moving, setMoving] = useState(null);
    const kindOf = (i) => data.components.find((c) => c.id === i.component_id)?.kind;
    const planCts = useWrite(async (offering) => {
        const c = await must(supabase.from('assessment_components').insert({ offering_id: offering, kind: 'class_test', name: 'Class Test', item_count: 4, marks_each: 20, weight: 20, best_n: 3, per_section: false, sort: 2 }).select().single());
        await rpc.generateItems(c.id);
    });
    const offer = (id) => data.offerings.find((o) => o.id === id);
    const cohorts = [...new Set(data.offerings.map((o) => o.batch).filter(Boolean))].sort();
    const rows = data.items
        .filter((i) => i.status !== 'cancelled' && (scope === 'all' || kindOf(i) === 'class_test') && (!cohort || offer(i.offering_id)?.batch === cohort))
        .map((i) => ({ i, o: offer(i.offering_id), c: courseOf(i.offering_id) })).filter((r) => r.o && r.c)
        .sort((a, b) => (a.i.held_on ?? '9999').localeCompare(b.i.held_on ?? '9999') || a.c.code.localeCompare(b.c.code) || a.i.seq - b.i.seq);
    const clashWith = (r) => kindOf(r.i) !== 'class_test' || !r.i.held_on ? [] : data.items.filter((x) => x.id !== r.i.id && x.held_on === r.i.held_on
        && x.status !== 'cancelled' && kindOf(x) === 'class_test' && offer(x.offering_id)?.batch && offer(x.offering_id)?.batch === r.o.batch);
    const unplanned = data.offerings.filter((o) => courseOf(o)?.course_type === 'theory' && !data.components.some((c) => c.offering_id === o.id && c.kind === 'class_test'))
        .sort((a, b) => courseOf(a).code.localeCompare(courseOf(b).code));
    const undated = rows.filter((r) => !r.i.held_on).length;
    const sec = (id) => data.sections.find((s) => s.id === id)?.name;
    return (_jsxs("div", { className: "space-y-5", children: [unplanned.length > 0 && _jsxs(Card, { children: [_jsx(CardHeader, { title: "Theory courses without class tests", subtitle: "Adds the standard four class tests (best three counted). Adjust the count on the course page if needed." }), _jsx("ul", { className: "flex flex-wrap gap-2 p-4", children: unplanned.map((o) => (_jsx("li", { children: _jsx(Button, { size: "sm", icon: _jsx(Plus, { className: "size-4", "aria-hidden": true }), loading: planCts.isPending && planCts.variables === o.id, onClick: () => planCts.mutate(o.id, { onSuccess: () => toast('ok', `${courseOf(o)?.code}: four class tests added`), onError: (e) => toast('bad', e.message) }), children: courseOf(o)?.code }) }, o.id))) })] }), _jsxs(Card, { className: "overflow-hidden", children: [_jsx(CardHeader, { title: "Class-test routine", subtitle: undated ? `${undated} still without a date. Click a date to set or change it.` : 'Click a date to set or change it. Changes appear on everyone’s calendar.', actions: _jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsx("label", { htmlFor: "r-cohort", className: "sr-only", children: "Cohort" }), _jsxs(Select, { id: "r-cohort", className: "h-8 w-36", value: cohort, onChange: (e) => setCohort(e.target.value), children: [_jsx("option", { value: "", children: "All cohorts" }), cohorts.map((c) => _jsx("option", { value: c, children: c }, c))] }), _jsx(SegTabs, { label: "Which items", value: scope, onChange: setScope, options: [{ value: 'ct', label: 'Class tests' }, { value: 'all', label: 'All assessments' }] })] }) }), rows.length === 0 ? _jsx(Empty, { title: "Nothing to schedule yet", children: "Add class tests above, or build an assessment plan on a course page." }) : (_jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Date" }), _jsx("th", { children: "Course" }), _jsx("th", { children: "Cohort" }), _jsx("th", { children: "Item" }), _jsx("th", { children: "Time" }), _jsx("th", { children: "Note" })] }) }), _jsx("tbody", { children: rows.map((r) => {
                                        const clash = clashWith(r);
                                        return (_jsxs("tr", { children: [_jsx("td", { children: _jsxs("button", { type: "button", onClick: () => setMoving(r.i), className: "inline-flex items-center gap-1.5 text-sm rounded px-1.5 py-1 -mx-1.5 hover:bg-sunken cursor-pointer", "aria-label": `Set date for ${r.c.code} ${r.i.title}`, children: [_jsx(CalendarDays, { className: "size-3.5 text-subtle", "aria-hidden": true }), r.i.held_on ? fmtDate(r.i.held_on, { weekday: 'short', day: 'numeric', month: 'short' }) : r.i.date_later ? _jsx("span", { className: "date-later px-1.5 py-0.5", children: "To be set later" }) : _jsx("span", { className: "text-brand-ink font-medium", children: "Set date" })] }) }), _jsx("td", { children: _jsx(Link, { to: `/courses/${r.o.id}/assessments`, className: "link font-mono text-sm", children: r.c.code }) }), _jsx("td", { className: "text-muted text-sm", children: r.o.batch ?? '—' }), _jsxs("td", { className: "text-sm", children: [r.i.title, sec(r.i.section_id) ? _jsxs("span", { className: "text-subtle", children: [" \u00B7 ", sec(r.i.section_id)] }) : null] }), _jsx("td", { className: "text-sm text-muted", children: r.i.held_time ?? '' }), _jsx("td", { className: "text-2xs", children: clash.length > 0 && _jsxs("span", { className: "text-warn font-medium", children: ["Same day as ", clash.map((x) => `${courseOf(x.offering_id)?.code} ${x.title}`).join(', ')] }) })] }, r.i.id));
                                    }) })] }) }))] }), _jsx(RescheduleDialog, { item: moving, onClose: () => setMoving(null), admin: true })] }));
}
