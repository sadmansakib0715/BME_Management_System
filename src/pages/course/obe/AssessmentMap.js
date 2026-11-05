import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { Copy, Plus, Printer, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import ConnectBoard from '@/components/ConnectBoard';
import { Button, Callout, Card, CardHeader, Empty, Input, SegTabs, useToast } from '@/components/ui';
import { must, rpc, useWrite } from '@/lib/api';
import { ASSESSMENTS, byAssessment, coCoverage, criteriaWarnings } from '@/lib/obe';
import { supabase } from '@/lib/supabase';
import { Chips, PctBar } from './shared';
const newKey = () => crypto.randomUUID();
/** Assessment map: every exam question part or marking criterion with its marks and the COs it assesses — the item-to-CO sheet of the
    CO-PO-Assessment workbook, without student marks. Rubric bands for presentations, demos and reports are written under Rubrics. */
export default function AssessmentMap({ offering, course, obe, canEdit }) {
    const toast = useToast();
    const initial = useMemo(() => obe.criteria.map((c) => ({ key: c.id, id: c.id, assessment: c.assessment, label: c.label, max: String(Number(c.max_marks)),
        cos: obe.criterionCos.filter((l) => l.criterion_id === c.id).map((l) => l.co_id) })), [obe.criteria, obe.criterionCos]);
    const [rows, setRows] = useState(initial);
    const [view, setView] = useState('table');
    const [newGroup, setNewGroup] = useState('');
    useEffect(() => setRows(initial), [initial]);
    const dirty = JSON.stringify(rows) !== JSON.stringify(initial);
    const set = (key, patch) => setRows((x) => x.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    const bad = rows.filter((r) => !r.label.trim() || !(Number(r.max) > 0) || !r.assessment.trim());
    const save = useWrite(async (list) => {
        const keep = list.filter((r) => r.id).map((r) => r.id);
        const drop = initial.filter((r) => !keep.includes(r.id)).map((r) => r.id);
        if (drop.length)
            await must(supabase.from('obe_criteria').delete().in('id', drop));
        const ids = [];
        for (const [i, r] of list.entries()) {
            const row = { offering_id: offering.id, assessment: r.assessment.trim(), label: r.label.trim(), max_marks: Number(r.max), sort: i };
            const saved = (r.id ? await must(supabase.from('obe_criteria').update(row).eq('id', r.id).select().single())
                : await must(supabase.from('obe_criteria').insert(row).select().single()));
            ids.push(saved.id);
        }
        if (ids.length)
            await must(supabase.from('obe_criterion_cos').delete().in('criterion_id', ids));
        const links = list.flatMap((r, i) => r.cos.filter((co) => obe.cos.some((c) => c.id === co)).map((co) => ({ criterion_id: ids[i], co_id: co })));
        if (links.length)
            await must(supabase.from('obe_criterion_cos').insert(links));
    });
    const fill = useWrite(() => rpc.copyForward(offering.id));
    // Grouped order is the saved order, so the Connect view numbers rows the same way as the table.
    const groups = byAssessment(rows.map((r, i) => ({ ...r, sort: i })));
    const ordered = groups.flatMap((g) => g.items);
    const asLinks = rows.flatMap((r) => r.cos.map((co) => ({ criterion_id: r.key, co_id: co })));
    const cover = coCoverage(obe.cos, rows.map((r) => ({ id: r.key, max_marks: Number(r.max) || 0 })), asLinks);
    const warnings = criteriaWarnings(obe.cos, rows.map((r) => ({ id: r.key, assessment: r.assessment, label: r.label, max_marks: Number(r.max) || 0 })), asLinks);
    const coOpts = obe.cos.map((_, i) => `CO${i + 1}`);
    const idOf = (code) => obe.cos[Number(code.slice(2)) - 1]?.id;
    const codesOf = (ids) => obe.cos.map((c, i) => (ids.includes(c.id) ? `CO${i + 1}` : null)).filter(Boolean);
    const addRow = (assessment) => setRows((x) => {
        const last = x.map((r) => r.assessment).lastIndexOf(assessment);
        const row = { key: newKey(), assessment, label: '', max: '', cos: [] };
        return last < 0 ? [...x, row] : [...x.slice(0, last + 1), row, ...x.slice(last + 1)];
    });
    const renameGroup = (from, to) => setRows((x) => x.map((r) => (r.assessment === from ? { ...r, assessment: to } : r)));
    const docs = obe.docs;
    const saveButton = canEdit && _jsx(Button, { size: "sm", variant: "primary", disabled: !dirty || bad.length > 0, loading: save.isPending, onClick: () => save.mutate(rows, { onSuccess: () => toast('ok', 'Assessment map saved'), onError: (e) => toast('bad', e.message) }), children: "Save" });
    if (!obe.cos.length)
        return _jsx(Card, { children: _jsx(Empty, { title: "Add the COs first", children: "The assessment map tags each question or criterion to the course's COs (COs & mapping)." }) });
    return (_jsxs("div", { className: "space-y-5", children: [_jsxs(Card, { className: "car-print", children: [_jsx(CardHeader, { title: `Assessment map · ${course.code}`, subtitle: _jsxs(_Fragment, { children: ["One row per exam question part or marking criterion: its marks and the COs it assesses. Write mark bands for presentations, demos and reports under ", _jsx(Link, { className: "link", to: "?s=rubrics", children: "Rubrics" }), "."] }), actions: _jsxs(_Fragment, { children: [_jsx(SegTabs, { label: "Assessment map view", value: view, onChange: setView, options: [{ value: 'table', label: 'Table' }, { value: 'connect', label: 'Connect' }] }), canEdit && !rows.length && obe.prev && _jsxs(Button, { size: "sm", icon: _jsx(Copy, { className: "size-4", "aria-hidden": true }), loading: fill.isPending, onClick: () => fill.mutate(undefined, { onSuccess: (r) => toast('ok', r.criteria ? `${r.criteria} rows copied from ${obe.prev.termName}` : `${obe.prev.termName} has no assessment map to copy`), onError: (e) => toast('bad', e.message) }), children: ["Fill from ", obe.prev.termName] }), _jsx(Button, { size: "sm", icon: _jsx(Printer, { className: "size-4", "aria-hidden": true }), onClick: () => window.print(), children: "Print" }), saveButton] }) }), !groups.length && _jsx(Empty, { title: "No questions or criteria yet", children: "Add an assessment below (for example Term Final or Presentation 01), then its question parts or criteria." }), view === 'connect' && groups.length > 0 && _jsx(ConnectBoard, { nouns: { left: 'question', right: 'CO' }, disabled: !canEdit, onChange: (i, links) => set(ordered[i].key, { cos: links }), left: ordered.map((r, i) => ({ key: r.key, code: `#${i + 1}`, label: `${r.assessment} · ${r.label || 'untitled'}`, badge: `${Number(r.max) || 0} marks`, links: r.cos })), right: obe.cos.map((c, i) => ({ key: c.id, code: `CO${i + 1}`, label: c.statement, meta: cover[i].items ? `${Math.round(cover[i].marks * 100) / 100} marks` : undefined })) }), view === 'table' && groups.map((g) => {
                        const subtotal = g.items.reduce((n, r) => n + (Number(r.max) || 0), 0);
                        return (_jsxs("section", { className: "border-b border-line last:border-b-0", children: [_jsxs("div", { className: "px-4 py-2.5 flex flex-wrap items-center gap-2 bg-sunken/60", children: [canEdit ? _jsxs(_Fragment, { children: [_jsx("label", { htmlFor: `g-${g.assessment}`, className: "sr-only", children: "Assessment name" }), _jsx(Input, { id: `g-${g.assessment}`, className: "h-8 w-64 font-semibold", list: "obe-assessments", defaultValue: g.assessment, onBlur: (e) => e.target.value.trim() && e.target.value.trim() !== g.assessment && renameGroup(g.assessment, e.target.value.trim()) })] })
                                            : _jsx("h3", { className: "text-sm font-semibold", children: g.assessment }), _jsxs("span", { className: "text-2xs text-muted tabular", children: [g.items.length, " ", g.items.length === 1 ? 'item' : 'items', " \u00B7 ", Math.round(subtotal * 100) / 100, " marks"] }), canEdit && _jsx(Button, { size: "sm", variant: "ghost", className: "ml-auto", icon: _jsx(Plus, { className: "size-4", "aria-hidden": true }), onClick: () => addRow(g.assessment), children: "Add question or criterion" })] }), _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { className: "min-w-56", children: "Question part or criterion" }), _jsx("th", { className: "w-24 text-right", children: "Marks" }), _jsx("th", { className: "min-w-48", children: "COs assessed" }), canEdit && _jsx("th", { className: "w-10" })] }) }), _jsx("tbody", { children: g.items.map((r) => (_jsxs("tr", { children: [_jsx("td", { children: canEdit ? _jsxs(_Fragment, { children: [_jsx("label", { htmlFor: `l-${r.key}`, className: "sr-only", children: "Question part or criterion" }), _jsx(Input, { id: `l-${r.key}`, className: "h-8", value: r.label, placeholder: "e.g. Q01 (a) or Clinical need identification", onChange: (e) => set(r.key, { label: e.target.value }) })] })
                                                                : _jsx("span", { className: "text-sm", children: r.label }) }), _jsx("td", { className: "text-right", children: canEdit ? _jsxs(_Fragment, { children: [_jsx("label", { htmlFor: `m-${r.key}`, className: "sr-only", children: "Marks" }), _jsx(Input, { id: `m-${r.key}`, className: "h-8 w-20 text-right tabular ml-auto", inputMode: "decimal", value: r.max, onChange: (e) => set(r.key, { max: e.target.value }) })] })
                                                                : _jsx("span", { className: "tabular text-sm", children: r.max }) }), _jsx("td", { children: _jsx(Chips, { label: `COs assessed by ${r.label}`, disabled: !canEdit, options: coOpts, value: codesOf(r.cos), onChange: (v) => set(r.key, { cos: v.map(idOf).filter(Boolean) }) }) }), canEdit && _jsx("td", { className: "p-1", children: _jsx(Button, { variant: "ghost", size: "sm", "aria-label": `Remove ${r.label || 'row'}`, onClick: () => setRows((x) => x.filter((y) => y.key !== r.key)), children: _jsx(Trash2, { className: "size-4", "aria-hidden": true }) }) })] }, r.key))) })] }) })] }, g.assessment));
                    }), canEdit && view === 'table' && _jsxs("div", { className: "px-4 py-3 flex flex-wrap items-end gap-2 border-t border-line print:hidden", children: [_jsx("label", { htmlFor: "new-group", className: "sr-only", children: "New assessment" }), _jsx(Input, { id: "new-group", className: "h-8 w-64", list: "obe-assessments", placeholder: "New assessment, e.g. Term Final", value: newGroup, onChange: (e) => setNewGroup(e.target.value) }), _jsx(Button, { size: "sm", icon: _jsx(Plus, { className: "size-4", "aria-hidden": true }), disabled: !newGroup.trim(), onClick: () => { addRow(newGroup.trim()); setNewGroup(''); }, children: "Add assessment" }), _jsx("datalist", { id: "obe-assessments", children: ASSESSMENTS.map((a) => _jsx("option", { value: a }, a)) })] })] }), _jsxs("div", { className: "grid gap-5 xl:grid-cols-[1.4fr_1fr]", children: [_jsxs(Card, { children: [_jsx(CardHeader, { title: "How much each CO is assessed", subtitle: "Marks from every question or criterion tagged to the CO, and their share of all the marks in this map." }), _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "CO" }), _jsx("th", { className: "min-w-48", children: "Statement" }), _jsx("th", { className: "text-right", children: "Items" }), _jsx("th", { className: "text-right", children: "Marks" }), _jsx("th", { className: "min-w-32", children: "Share" })] }) }), _jsx("tbody", { children: obe.cos.map((c, i) => {
                                                const x = cover[i];
                                                return (_jsxs("tr", { children: [_jsxs("td", { className: "font-mono font-semibold", children: ["CO", i + 1] }), _jsx("td", { className: "text-2xs text-muted", children: _jsx("span", { className: "line-clamp-2", children: c.statement }) }), _jsx("td", { className: "text-right tabular text-sm", children: x.items }), _jsx("td", { className: "text-right tabular text-sm", children: Math.round(x.marks * 100) / 100 }), _jsx("td", { children: x.items ? _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(PctBar, { value: x.share, threshold: 0, label: `CO${i + 1} share` }), _jsxs("span", { className: "text-2xs tabular w-12 text-right", children: [x.share.toFixed(1), "%"] })] })
                                                                : _jsx("span", { className: "text-2xs text-warn font-medium", children: "Not assessed" }) })] }, c.id));
                                            }) })] }) })] }), docs && (docs.components.length > 0 || docs.marks_distribution.length > 0) && _jsxs(Card, { children: [_jsx(CardHeader, { title: "Marks distribution", subtitle: "From the course outline and the CO-PO-assessment workbook." }), docs.marks_distribution.length > 0 && _jsxs("table", { className: "table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Outline component" }), _jsx("th", { className: "text-right", children: "Share" })] }) }), _jsx("tbody", { children: docs.marks_distribution.map((m) => _jsxs("tr", { children: [_jsx("td", { className: "text-sm", children: m.component }), _jsxs("td", { className: "text-right tabular text-sm", children: [m.percent, "%"] })] }, m.component)) })] }), docs.components.length > 0 && _jsxs("table", { className: "table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Workbook component" }), _jsx("th", { className: "text-right", children: "Weight" }), _jsx("th", { className: "text-right", children: "Marks" })] }) }), _jsx("tbody", { children: docs.components.filter((c) => c.component !== 'Total').map((c) => _jsxs("tr", { children: [_jsx("td", { className: "text-sm", children: c.component }), _jsxs("td", { className: "text-right tabular text-sm", children: [Math.round(c.weight * 1000) / 10, "%"] }), _jsx("td", { className: "text-right tabular text-sm", children: c.marks })] }, c.component)) })] })] })] }), bad.length > 0 && _jsxs(Callout, { tone: "bad", children: ["Every row needs a name and marks above zero (", bad.length, " to fix)."] }), warnings.length > 0 && _jsxs(Callout, { tone: "warn", title: "Check the assessment map", children: [_jsx("ul", { className: "list-disc pl-5", children: warnings.slice(0, 12).map((w) => _jsx("li", { children: w }, w)) }), warnings.length > 12 && _jsxs("p", { className: "text-2xs mt-1", children: ["\u2026and ", warnings.length - 12, " more."] })] })] }));
}
