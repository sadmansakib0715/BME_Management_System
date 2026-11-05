import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { clsx } from 'clsx';
import { Link, useSearchParams } from 'react-router-dom';
import { Card, CardHeader, ErrorNote, PageHeader, Spinner } from '@/components/ui';
import { useObeTerm, usePOs } from '@/lib/api';
import { CULMINATING_POS, DOMAIN_LEVELS, KPA, mappedPos } from '@/lib/obe';
import { useTerm } from '@/lib/TermContext';
import BugsCqi from './obe/BugsCqi';
import ObeCourses from './obe/ObeCourses';
import ProgramPo from './obe/ProgramPo';
/** OBE (spec sections 2, 8, 11, 14): course dashboard, program PO per batch, CO–PO coverage, BUGS & CQI, and the framework itself. */
const TABS = [
    { key: 'courses', label: 'Courses' },
    { key: 'program', label: 'Program PO' },
    { key: 'coverage', label: 'Coverage' },
    { key: 'cqi', label: 'BUGS & CQI' },
    { key: 'framework', label: 'Framework' },
];
export default function Outcomes() {
    const { data, loading, error } = useTerm();
    const [params, setParams] = useSearchParams();
    const tab = params.get('tab') ?? 'courses';
    const obe = useObeTerm(data?.term.id, data?.offerings.map((o) => o.id) ?? []);
    if (loading || obe.isLoading)
        return _jsx(Spinner, {});
    if (error || obe.error)
        return _jsx(ErrorNote, { error: error ?? obe.error });
    if (!data || !obe.data)
        return null;
    return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { eyebrow: data.term.name, title: "Outcome-based education (OBE)", description: "Course outcomes and their mapping, attainment against the 40% thresholds, CARs, the program POs per batch, and the CQI loops." }), _jsx("nav", { "aria-label": "OBE", className: "-mx-4 sm:mx-0 px-4 sm:px-0 mb-5 overflow-x-auto", children: _jsx("ul", { className: "flex gap-1 border-b border-line min-w-max", children: TABS.map((t) => (_jsx("li", { children: _jsx("button", { type: "button", onClick: () => setParams(t.key === 'courses' ? {} : { tab: t.key }), "aria-current": tab === t.key ? 'page' : undefined, className: clsx('inline-flex items-center h-10 px-3 -mb-px border-b-2 text-sm font-medium transition-colors duration-150 cursor-pointer', tab === t.key ? 'border-brand text-brand-ink' : 'border-transparent text-muted hover:text-ink'), children: t.label }) }, t.key))) }) }), tab === 'courses' && _jsx(ObeCourses, { data: data, obe: obe.data }), tab === 'program' && _jsx(ProgramPo, {}), tab === 'coverage' && _jsx(Coverage, { data: data, obe: obe.data }), tab === 'cqi' && _jsx(BugsCqi, {}), tab === 'framework' && _jsx(Framework, {})] }));
}
function Coverage({ data, obe }) {
    const { courseOf } = useTerm();
    const pos = usePOs();
    if (!pos.data)
        return _jsx(Spinner, {});
    const poList = pos.data.pos;
    const rows = data.offerings.map((o) => ({ o, c: courseOf(o), m: mappedPos(obe.cos.filter((x) => x.offering_id === o.id), obe.coPo) })).filter((r) => r.c).sort((a, b) => a.c.code.localeCompare(b.c.code));
    return (_jsxs(Card, { children: [_jsx(CardHeader, { title: "CO\u2013PO coverage this term", subtitle: "\u25CF = at least one CO of the course maps to the PO. Empty rows: COs not mapped yet." }), _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Course" }), poList.map((p) => _jsx("th", { className: "text-center", title: p.title, children: p.code.replace('PO', '') }, p.code))] }) }), _jsx("tbody", { children: rows.map(({ o, c, m }) => (_jsxs("tr", { children: [_jsx("td", { children: _jsx(Link, { to: `/courses/${o.id}/outcomes`, className: "link font-mono text-sm", children: c.code }) }), poList.map((p) => _jsx("td", { className: "p-1 text-center", children: m.has(p.code) ? _jsx("span", { className: "text-brand text-base", "aria-label": `${c.code} maps to ${p.code}`, children: "\u25CF" }) : _jsx("span", { className: "text-line-strong", "aria-hidden": true, children: "\u00B7" }) }, p.code))] }, o.id))) }), _jsx("tfoot", { children: _jsxs("tr", { children: [_jsx("td", { className: "px-3 py-2 text-2xs text-subtle", children: "Courses covering" }), poList.map((p) => {
                                        const n = rows.filter((r) => r.m.has(p.code)).length;
                                        return _jsx("td", { className: `px-1 py-2 text-center text-2xs tabular font-semibold ${n ? 'text-muted' : 'text-bad'}`, children: n }, p.code);
                                    })] }) })] }) })] }));
}
function Framework() {
    const pos = usePOs();
    if (!pos.data)
        return _jsx(Spinner, {});
    return (_jsxs("div", { className: "grid gap-5 xl:grid-cols-2", children: [_jsxs(Card, { children: [_jsx(CardHeader, { title: "Program educational objectives (PEOs)", subtitle: "SAR \u00A77.2. PEO attainment target: 60%." }), _jsx("dl", { className: "divide-y divide-line", children: pos.data.peos.map((p) => _jsxs("div", { className: "px-4 py-2.5 text-sm", children: [_jsxs("dt", { className: "font-semibold inline", children: [p.code, ". "] }), _jsx("dd", { className: "inline text-muted", children: p.statement })] }, p.code)) })] }), _jsxs(Card, { children: [_jsx(CardHeader, { title: "Culminating courses", subtitle: "Only these feed program PO attainment, averaged per batch." }), _jsx("ul", { className: "divide-y divide-line", children: Object.entries(CULMINATING_POS).map(([c, list]) => (_jsxs("li", { className: "px-4 py-2.5 text-sm flex flex-wrap gap-x-3", children: [_jsx("span", { className: "font-mono font-semibold w-20", children: c }), _jsxs("span", { className: "text-muted", children: ["PO", list.join(', PO')] })] }, c))) })] }), _jsxs(Card, { className: "xl:col-span-2", children: [_jsx(CardHeader, { title: "Program outcomes (POs)", subtitle: "BAETE PO reference, with the knowledge profile each needs." }), _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "PO" }), _jsx("th", { children: "Attribute" }), _jsx("th", { children: "Knowledge profile" }), _jsx("th", { children: "Statement" })] }) }), _jsx("tbody", { children: pos.data.pos.map((p) => _jsxs("tr", { children: [_jsx("td", { className: "font-mono font-semibold", children: p.code }), _jsx("td", { className: "text-sm whitespace-nowrap", children: p.title }), _jsx("td", { className: "text-sm", children: p.k_profiles ?? '—' }), _jsx("td", { className: "text-2xs text-muted", children: p.statement })] }, p.code)) })] }) })] }), KPA.map((g) => (_jsxs(Card, { children: [_jsx(CardHeader, { title: g.group }), _jsx("dl", { className: "divide-y divide-line", children: g.items.map(([k, label]) => _jsxs("div", { className: "px-4 py-2 text-sm flex gap-3", children: [_jsx("dt", { className: "font-mono font-semibold w-8", children: k }), _jsx("dd", { className: "text-muted", children: label })] }, k)) })] }, g.group))), _jsxs(Card, { children: [_jsx(CardHeader, { title: "Domains and taxonomy levels" }), _jsx("dl", { className: "divide-y divide-line", children: DOMAIN_LEVELS.map((d) => _jsxs("div", { className: "px-4 py-2 text-sm flex gap-3", children: [_jsx("dt", { className: "font-semibold w-28", children: d.domain }), _jsx("dd", { className: "text-muted", children: d.codes.join(', ') })] }, d.domain)) })] })] }));
}
