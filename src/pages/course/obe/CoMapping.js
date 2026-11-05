import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Copy, FileDown, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button, Callout, Card, CardHeader, Empty, Field, SegTabs, Select, Textarea, useToast } from '@/components/ui';
import { must, useBugs, usePOs, useWrite } from '@/lib/api';
import { coWarnings, CULMINATING_POS, DELIVERY, DOMAIN_LEVELS, KPA, TOOLS } from '@/lib/obe';
import { supabase } from '@/lib/supabase';
import CoPoBoard from './CoPoBoard';
import { coRows, poRefs, save as saveFile } from './docData';
import { Chips } from './shared';
import { useCourseInfo } from './useDocInputs';
const DOMAIN_OF = { C: 'cognitive', PS: 'psychomotor', AF: 'affective' };
/** COs and their mapping, laid out like CO-PO Mapping.docx: statements, then a CO × PO table, then CO × K/P/A. */
export default function CoMapping({ offering, course, data, obe, canEdit, isAdmin }) {
    const toast = useToast();
    const info = useCourseInfo({ offering, course, data, obe });
    const pos = usePOs();
    const bugs = useBugs();
    const initial = useMemo(() => obe.cos.map((c) => ({ id: c.id, statement: c.statement, domain_levels: c.domain_levels ?? [], delivery: c.delivery ?? [], tools: c.tools ?? [], kpa: c.kpa ?? [],
        pos: obe.coPo.filter((m) => m.co_id === c.id).map((m) => m.po_code) })), [obe.cos, obe.coPo]);
    const [cos, setCos] = useState(initial);
    const [view, setView] = useState('connect');
    useEffect(() => setCos(initial), [initial]);
    const dirty = JSON.stringify(cos) !== JSON.stringify(initial);
    const set = (i, patch) => setCos((x) => x.map((c, j) => (j === i ? { ...c, ...patch } : c)));
    const toggle = (i, key, v) => set(i, { [key]: cos[i][key].includes(v) ? cos[i][key].filter((x) => x !== v) : [...cos[i][key], v] });
    const save = useWrite(async (list) => {
        const keep = list.filter((c) => c.id).map((c) => c.id);
        const drop = initial.filter((c) => !keep.includes(c.id)).map((c) => c.id);
        if (drop.length)
            await must(supabase.from('course_outcomes').delete().in('id', drop));
        for (const [i, c] of list.entries()) {
            const first = c.domain_levels[0]?.match(/^(C|PS|AF)(\d)$/);
            const row = { offering_id: offering.id, code: `CO${i + 1}`, statement: c.statement.trim(), domain_levels: c.domain_levels, delivery: c.delivery, tools: c.tools, kpa: c.kpa,
                domain: first ? DOMAIN_OF[first[1]] : 'cognitive', level: first ? Math.min(6, Number(first[2])) : 3, sort: i + 1 };
            // Codes are renumbered in order via temporary CO9xx codes, so the (offering, code) key never collides mid-save.
            const saved = c.id ? await must(supabase.from('course_outcomes').update({ ...row, code: `CO${900 + i}` }).eq('id', c.id).select().single())
                : await must(supabase.from('course_outcomes').insert({ ...row, code: `CO${900 + i}` }).select().single());
            const id = saved.id;
            await must(supabase.from('co_po_map').delete().eq('co_id', id));
            if (c.pos.length)
                await must(supabase.from('co_po_map').insert(c.pos.map((po) => ({ co_id: id, po_code: po, strength: 1 }))));
        }
        const fresh = await must(supabase.from('course_outcomes').select('id, sort').eq('offering_id', offering.id));
        for (const r of fresh)
            await must(supabase.from('course_outcomes').update({ code: `CO${r.sort}` }).eq('id', r.id));
    });
    const setResolution = useWrite((id) => must(supabase.from('offerings').update({ co_resolution_id: id }).eq('id', offering.id)));
    if (!pos.data)
        return null;
    const poList = pos.data.pos;
    const fromPrev = () => obe.prev && setCos(obe.prev.cos.map((c) => ({ tmp: crypto.randomUUID(), statement: c.statement, domain_levels: c.domain_levels ?? [], delivery: c.delivery ?? [], tools: c.tools ?? [],
        kpa: c.kpa ?? [], pos: obe.prev.coPo.filter((m) => m.co_id === c.id).map((m) => m.po_code) })));
    const warnings = coWarnings(course, cos.map((c, i) => ({ id: c.id ?? c.tmp ?? String(i), statement: c.statement, kpa: c.kpa, domain_levels: c.domain_levels })), cos.flatMap((c, i) => c.pos.map((po) => ({ co_id: c.id ?? c.tmp ?? String(i), po_code: po, strength: 1 }))), poList);
    const add = () => setCos((x) => [...x, { tmp: crypto.randomUUID(), statement: '', domain_levels: [], delivery: [], tools: [], kpa: [], pos: [] }]);
    const res = bugs.data?.find((b) => b.id === offering.co_resolution_id);
    const downloadPdf = async () => {
        const { mappingPdf } = await import('@/lib/pdf/obeDocs');
        saveFile(mappingPdf({ course: info, cos: coRows(obe), pos: poRefs(poList), approval: res ? `BUGS meeting ${res.meeting_no}${res.held_on ? `, ${res.held_on}` : ''}` : null }), `${course.code} CO-PO Mapping ${data.term.name}.pdf`);
    };
    const pdfButton = _jsx(Button, { size: "sm", icon: _jsx(FileDown, { className: "size-4", "aria-hidden": true }), disabled: dirty || !obe.cos.length, title: dirty ? 'Save first: the PDF uses the saved COs and mapping' : undefined, onClick: () => downloadPdf().catch((e) => toast('bad', e.message)), children: "CO-PO mapping PDF" });
    const saveButton = _jsx(Button, { size: "sm", variant: "primary", disabled: !dirty || cos.some((c) => !c.statement.trim()), loading: save.isPending, onClick: () => save.mutate(cos, { onSuccess: () => toast('ok', 'COs and mapping saved'), onError: (e) => toast('bad', e.message) }), children: "Save" });
    return (_jsxs("div", { className: "space-y-5", children: [_jsxs(Card, { children: [_jsx(CardHeader, { title: "Course outcomes (COs)", subtitle: "At most 12. Start each statement with an action verb. Pick one or more domain and taxonomy levels.", actions: _jsxs(_Fragment, { children: [pdfButton, canEdit && _jsxs(_Fragment, { children: [obe.prev && obe.prev.cos.length > 0 && cos.length === 0 && _jsxs(Button, { size: "sm", icon: _jsx(Copy, { className: "size-4", "aria-hidden": true }), onClick: fromPrev, children: ["Copy from ", obe.prev.termName] }), _jsx(Button, { size: "sm", icon: _jsx(Plus, { className: "size-4", "aria-hidden": true }), disabled: cos.length >= 12, onClick: add, children: "Add CO" }), saveButton] })] }) }), cos.length === 0 ? _jsx(Empty, { title: "No COs yet", children: obe.prev?.cos.length ? `Copy last term's ${obe.prev.cos.length} COs from ${obe.prev.termName}, then revise them.` : 'Add the COs approved for this course.' }) : (_jsx("ol", { className: "divide-y divide-line", children: cos.map((c, i) => (_jsxs("li", { className: "px-4 py-3 grid gap-3 md:grid-cols-[48px_1fr_auto]", children: [_jsxs("span", { className: "font-mono text-sm font-semibold pt-2", children: ["CO", i + 1] }), _jsxs("div", { className: "space-y-2.5 min-w-0", children: [_jsx(Field, { label: _jsxs("span", { className: "sr-only", children: ["Statement for CO", i + 1] }), htmlFor: `co-s-${i}`, children: _jsx(Textarea, { id: `co-s-${i}`, className: "min-h-14", disabled: !canEdit, value: c.statement, onChange: (e) => set(i, { statement: e.target.value }), placeholder: "e.g. Analyze biomedical signals using\u2026" }) }), _jsxs("div", { className: "grid gap-2.5 lg:grid-cols-2", children: [_jsxs("div", { children: [_jsx("div", { className: "text-2xs font-semibold text-subtle mb-1", children: "Domain and taxonomy level" }), _jsx(Chips, { label: `Taxonomy levels for CO${i + 1}`, disabled: !canEdit, options: DOMAIN_LEVELS.flatMap((d) => d.codes), value: c.domain_levels, onChange: (v) => set(i, { domain_levels: v }) })] }), _jsxs("div", { children: [_jsx("div", { className: "text-2xs font-semibold text-subtle mb-1", children: "Delivery methods and activities" }), _jsx(Chips, { label: `Delivery for CO${i + 1}`, disabled: !canEdit, options: DELIVERY, value: c.delivery, onChange: (v) => set(i, { delivery: v }) })] }), _jsxs("div", { className: "lg:col-span-2", children: [_jsx("div", { className: "text-2xs font-semibold text-subtle mb-1", children: "Assessment tools" }), _jsx(Chips, { label: `Assessment tools for CO${i + 1}`, disabled: !canEdit, options: TOOLS, value: c.tools, onChange: (v) => set(i, { tools: v }) })] })] })] }), canEdit && _jsx(Button, { variant: "ghost", "aria-label": `Remove CO${i + 1}`, onClick: () => setCos((x) => x.filter((_, j) => j !== i)), children: _jsx(Trash2, { className: "size-4", "aria-hidden": true }) })] }, c.id ?? c.tmp))) }))] }), cos.length > 0 && _jsxs(Card, { children: [_jsx(CardHeader, { title: "CO\u2013PO mapping", subtitle: "Connect each CO to the POs it addresses. A PO no CO maps to is NA for this course.", actions: _jsxs(_Fragment, { children: [_jsx(SegTabs, { label: "Mapping view", value: view, onChange: setView, options: [{ value: 'connect', label: 'Connect' }, { value: 'table', label: 'Table' }] }), canEdit && dirty && saveButton] }) }), view === 'connect'
                        ? _jsx(CoPoBoard, { cos: cos.map((c, i) => ({ key: c.id ?? c.tmp ?? String(i), code: `CO${i + 1}`, statement: c.statement, pos: c.pos })), pos: poList, expected: CULMINATING_POS[course.code], disabled: !canEdit, onChange: (i, next) => set(i, { pos: next }) })
                        : _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "CO" }), poList.map((p) => _jsx("th", { className: "text-center", title: `${p.title} (${p.k_profiles ?? '—'})`, children: p.code }, p.code))] }) }), _jsx("tbody", { children: cos.map((c, i) => (_jsxs("tr", { children: [_jsxs("td", { className: "font-mono font-semibold", children: ["CO", i + 1] }), poList.map((p) => (_jsx("td", { className: "text-center p-1", children: _jsx("input", { type: "checkbox", className: "size-4 accent-[rgb(var(--brand))] cursor-pointer disabled:cursor-default", disabled: !canEdit, checked: c.pos.includes(p.code), onChange: () => toggle(i, 'pos', p.code), "aria-label": `CO${i + 1} maps to ${p.code}` }) }, p.code)))] }, c.id ?? c.tmp))) })] }) })] }), cos.length > 0 && _jsxs(Card, { children: [_jsx(CardHeader, { title: "Knowledge profile, complex problem and complex activity", subtitle: "The \u201CMapping of Knowledge Profile, CEP and CEA\u201D table." }), _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "table", children: [_jsxs("thead", { children: [_jsxs("tr", { children: [_jsx("th", {}), KPA.map((g) => _jsx("th", { colSpan: g.items.length, className: "text-center border-l border-line", children: g.group }, g.group))] }), _jsxs("tr", { children: [_jsx("th", { children: "CO" }), KPA.flatMap((g) => g.items.map(([k, label], j) => _jsx("th", { className: `text-center ${j === 0 ? 'border-l border-line' : ''}`, title: label, children: k }, k)))] })] }), _jsx("tbody", { children: cos.map((c, i) => (_jsxs("tr", { children: [_jsxs("td", { className: "font-mono font-semibold", children: ["CO", i + 1] }), KPA.flatMap((g) => g.items.map(([k, label], j) => (_jsx("td", { className: `text-center p-1 ${j === 0 ? 'border-l border-line' : ''}`, children: _jsx("input", { type: "checkbox", className: "size-4 accent-[rgb(var(--brand))] cursor-pointer disabled:cursor-default", disabled: !canEdit, checked: c.kpa.includes(k), onChange: () => toggle(i, 'kpa', k), "aria-label": `CO${i + 1}: ${k} ${label}` }) }, k))))] }, c.id ?? c.tmp))) })] }) })] }), _jsxs(Card, { children: [_jsx(CardHeader, { title: "Approval", subtitle: "The BUGS resolution that approved these COs and this mapping." }), _jsxs("div", { className: "p-4 flex flex-wrap items-end gap-3", children: [isAdmin ? _jsx(Field, { label: "BUGS resolution", htmlFor: "co-res", className: "min-w-72", children: _jsxs(Select, { id: "co-res", value: offering.co_resolution_id ?? '', onChange: (e) => setResolution.mutate(e.target.value || null, { onSuccess: () => toast('ok', 'Approval saved'), onError: (er) => toast('bad', er.message) }), children: [_jsx("option", { value: "", children: "Not linked yet" }), (bugs.data ?? []).map((b) => _jsxs("option", { value: b.id, children: ["Meeting ", b.meeting_no, b.held_on ? ` · ${b.held_on}` : '', b.title ? ` · ${b.title}` : ''] }, b.id))] }) })
                                : _jsx("p", { className: "text-sm", children: res ? _jsxs(_Fragment, { children: ["Meeting ", res.meeting_no, res.held_on ? `, ${res.held_on}` : '', res.link && _jsxs(_Fragment, { children: [" \u00B7 ", _jsx("a", { className: "link", href: res.link, target: "_blank", rel: "noreferrer", children: "resolution" })] })] }) : _jsx("span", { className: "text-muted", children: "Not linked yet. The OBE Cell links it." }) }), isAdmin && !bugs.data?.length && _jsx("p", { className: "text-2xs text-subtle", children: "Add resolutions on the OBE page under \u201CBUGS & CQI\u201D." })] })] }), warnings.length > 0 && _jsx(Callout, { tone: "warn", title: "Check the COs and mapping", children: _jsx("ul", { className: "list-disc pl-5", children: warnings.map((w) => _jsx("li", { children: w }, w)) }) })] }));
}
