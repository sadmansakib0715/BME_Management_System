import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { FileDown, ListPlus, Printer, Wand2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Callout, Card, CardHeader, Field, StatusBadge, Textarea, useToast } from '@/components/ui';
import { must, useWrite } from '@/lib/api';
import { attained, coCodes, fmtPct, mappedPos, nearThreshold, PO_CODES, valueOf } from '@/lib/obe';
import { supabase } from '@/lib/supabase';
import { useTerm } from '@/lib/TermContext';
import { save as saveFile } from './docData';
import { useCourseInfo } from './useDocInputs';
const CAR_STATES = [{ value: 'draft', label: 'Draft' }, { value: 'submitted', label: 'Submitted' }, { value: 'reviewed', label: 'Reviewed' }, { value: 'final', label: 'Final' }];
/** Course Assessment Report (spec section 9): parts A and B come from the data; teachers write C–E. */
export default function Car({ offering, course, data, obe, canEdit, isAdmin }) {
    const toast = useToast();
    const { teachersOf, nameOf } = useTerm();
    const info = useCourseInfo({ offering, course, data, obe });
    const car = obe.car;
    // Past offerings have no term assignments; their CAR shows the teachers named in the outline.
    const assigned = teachersOf(offering.id).map(nameOf);
    const teachers = assigned.length ? assigned : [...new Set((obe.docs?.instructors ?? []).map((i) => i.name.trim()))];
    const status = car?.status ?? 'draft';
    const blank = { part_c: car?.part_c ?? '', part_d: car?.part_d ?? '', part_e: car?.part_e ?? '' };
    const [parts, setParts] = useState(blank);
    useEffect(() => setParts({ part_c: car?.part_c ?? '', part_d: car?.part_d ?? '', part_e: car?.part_e ?? '' }), [car]);
    const dirty = JSON.stringify(parts) !== JSON.stringify(blank);
    const locked = status === 'final' || (!isAdmin && status !== 'draft');
    const editable = canEdit && !locked;
    const coT = Number(offering.cohort_threshold ?? 0.4), poT = Number(offering.po_threshold ?? 0.4);
    const mapped = mappedPos(obe.cos, obe.coPo);
    const flags = [
        ...obe.cos.map((_, i) => `CO${i + 1}`).filter((c) => { const v = valueOf(obe.attainment, 'CO', c); return attained(v, coT) === false || nearThreshold(v, coT); }),
        ...[...mapped].filter((p) => { const v = valueOf(obe.attainment, 'PO', p); return attained(v, poT) === false || nearThreshold(v, poT); }),
    ];
    const missing = obe.cos.map((_, i) => `CO${i + 1}`).filter((c) => valueOf(obe.attainment, 'CO', c) === null);
    const needText = flags.length > 0 && (!parts.part_c.trim() || !parts.part_e.trim());
    const write = useWrite((patch) => must(supabase.from('car_reports').upsert({ offering_id: offering.id, ...parts, status, ...patch, updated_at: new Date().toISOString() })));
    const toCqi = useWrite(() => must(supabase.from('cqi_items').insert({ loop: 'CO', source: 'CAR', offering_id: offering.id, course_code: course.code,
        finding: flags.length ? `Below or near threshold: ${flags.join(', ')}` : 'CAR recommendation', action: parts.part_e.trim(), effective_term: 'Next offering' })));
    const block = (term, att, cs, cp) => {
        const m = mappedPos(cs, cp);
        const cell = (type, code, used, t) => {
            const v = used ? valueOf(att, type, code) : null;
            const a = attained(v, t);
            return { value: v, yn: (!used || a === null ? 'NA' : a ? 'Y' : 'N') };
        };
        return { term, co: Object.fromEntries(coCodes().map((c, i) => [c, cell('CO', c, i < cs.length, coT)])), po: Object.fromEntries(PO_CODES.map((p) => [p, cell('PO', p, m.has(p), poT)])) };
    };
    const downloadPdf = async () => {
        const { carPdf } = await import('@/lib/pdf/obeDocs');
        const blocks = [...(obe.prev ? [block(obe.prev.termName, obe.prev.attainment, obe.prev.cos, obe.prev.coPo)] : []), block(data.term.name, obe.attainment, obe.cos, obe.coPo)];
        saveFile(carPdf({ course: { ...info, teachers: info.teachers.length ? info.teachers : teachers.map((name) => ({ name })) }, section: null, textbooks: obe.docs?.textbooks ?? '',
            lastTerm: obe.prev?.termName ?? null, blocks, partC: parts.part_c, partD: parts.part_d, partE: parts.part_e, status: CAR_STATES.find((x) => x.value === status)?.label ?? status,
            thresholds: `A CO/PO is attained when at least ${coT * 100}% of the students reach ${Number(offering.co_threshold ?? 0.4) * 100}% on it (SAR §8.4). NA: not assessed or not mapped.${obe.run ? ` Calculated from ${obe.run.students} students' marks.` : ''}` }), `${course.code} CAR ${data.term.name}.pdf`);
    };
    /** First wording for Parts C and E from the attainment results; the teachers edit it. */
    const draftFromResults = () => {
        const cos = obe.cos.map((_, i) => `CO${i + 1}`).map((c) => ({ c, v: valueOf(obe.attainment, 'CO', c) })).filter((x) => x.v !== null);
        const pos = [...mapped].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2))).map((p) => ({ c: p, v: valueOf(obe.attainment, 'PO', p) })).filter((x) => x.v !== null);
        const low = cos.filter((x) => attained(x.v, coT) === false), near = cos.filter((x) => nearThreshold(x.v, coT));
        const min = cos.length ? cos.reduce((a, b) => (b.v < a.v ? b : a)) : null;
        const prevNote = obe.prev ? cos.map((x) => { const p = valueOf(obe.prev.attainment, 'CO', x.c); return p === null ? null : `${x.c} ${p.toFixed(2)}% → ${x.v.toFixed(2)}%`; }).filter(Boolean) : [];
        const c = [`Teachers' comment on attainment: ${low.length ? `${low.map((x) => x.c).join(', ')} ${low.length === 1 ? 'was' : 'were'} not attained` : `All ${cos.length} COs were attained`}`
                + ` (${cos.map((x) => `${x.c} ${x.v.toFixed(2)}%`).join(', ')}).`
                + (pos.length ? ` PO attainment: ${pos.map((x) => `${x.c} ${x.v.toFixed(2)}%`).join(', ')}.` : '')
                + (min ? ` The lowest is ${min.c} (${min.v.toFixed(2)}%).` : '')
                + (near.length ? ` ${near.map((x) => x.c).join(', ')} ${near.length === 1 ? 'is' : 'are'} within 10 points of the threshold.` : '')
                + (prevNote.length ? ` Compared with ${obe.prev.termName}: ${prevNote.join('; ')}.` : ''),
            '', 'Interpretation of student feedback: ', '', "Teachers' comment on teaching-learning: "].join('\n');
        const e = [`Major issues: ${low.length ? `${low.map((x) => x.c).join(', ')} below the threshold.` : near.length ? `${near.map((x) => x.c).join(', ')} close to the threshold.` : 'None.'}`,
            '', 'Plan for future actions for further improvement: '].join('\n');
        setParts({ ...parts, part_c: parts.part_c.trim() ? parts.part_c : c, part_e: parts.part_e.trim() ? parts.part_e : e });
    };
    const go = (patch, msg) => write.mutate(patch, { onSuccess: () => toast('ok', msg), onError: (e) => toast('bad', e.message) });
    return (_jsxs("div", { className: "space-y-5", children: [_jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsx("span", { className: "text-sm text-muted", children: "Status" }), _jsx(StatusBadge, { opts: CAR_STATES, value: status }), _jsxs("div", { className: "ml-auto flex flex-wrap gap-2", children: [editable && (!parts.part_c.trim() || !parts.part_e.trim()) && obe.attainment.length > 0 && _jsx(Button, { size: "sm", icon: _jsx(Wand2, { className: "size-4", "aria-hidden": true }), onClick: draftFromResults, children: "Draft from results" }), _jsx(Button, { size: "sm", icon: _jsx(FileDown, { className: "size-4", "aria-hidden": true }), onClick: () => downloadPdf().catch((e) => toast('bad', e.message)), children: "CAR PDF" }), _jsx(Button, { size: "sm", variant: "ghost", icon: _jsx(Printer, { className: "size-4", "aria-hidden": true }), onClick: () => window.print(), children: "Print" }), editable && _jsx(Button, { size: "sm", disabled: !dirty, loading: write.isPending, onClick: () => go({}, 'CAR saved'), children: "Save draft" }), canEdit && status === 'draft' && _jsx(Button, { size: "sm", variant: "primary", disabled: needText || missing.length > 0, loading: write.isPending, onClick: () => go({ status: 'submitted' }, 'CAR submitted for review'), children: "Submit" }), isAdmin && status === 'submitted' && _jsx(Button, { size: "sm", variant: "primary", onClick: () => go({ status: 'reviewed' }, 'Marked reviewed'), children: "Mark reviewed" }), isAdmin && status === 'reviewed' && _jsx(Button, { size: "sm", variant: "primary", disabled: missing.length > 0, onClick: () => go({ status: 'final' }, 'CAR is final'), children: "Finalise" }), isAdmin && status !== 'draft' && _jsx(Button, { size: "sm", variant: "ghost", onClick: () => go({ status: 'draft' }, 'Reopened as draft'), children: "Reopen" })] })] }), car?.review_note && _jsx(Callout, { tone: "info", children: car.review_note }), missing.length > 0 && _jsxs(Callout, { tone: "warn", title: "Info missing", children: [missing.join(', '), " ", missing.length === 1 ? 'has' : 'have', " no attainment result. Add it in Attainment before submitting."] }), flags.length > 0 && _jsxs(Callout, { tone: "info", title: "Comment and action needed", children: [flags.join(', '), " ", flags.length === 1 ? 'is' : 'are', " below or within 10 points of the threshold, so Part C needs a comment and Part E an action."] }), _jsxs(Card, { className: "car-print", children: [_jsx(CardHeader, { title: `Course Assessment Report · ${course.code}`, subtitle: data.term.name }), _jsxs("div", { className: "p-4 space-y-6", children: [_jsxs("section", { children: [_jsx("h3", { className: "text-sm font-semibold mb-2", children: "A. Course information" }), _jsxs("dl", { className: "grid grid-cols-[160px_1fr] gap-x-4 gap-y-1 text-sm", children: [_jsx("dt", { className: "text-muted", children: "Course" }), _jsxs("dd", { children: [course.code, " \u00B7 ", course.title] }), _jsx("dt", { className: "text-muted", children: "Level and term" }), _jsxs("dd", { children: [course.level ? `Level ${course.level}${course.term_no ? `, Term ${course.term_no}` : ''}` : '—', offering.batch ? ` · Cohort ${offering.batch}` : ''] }), _jsx("dt", { className: "text-muted", children: "Academic term" }), _jsx("dd", { children: data.term.name }), _jsx("dt", { className: "text-muted", children: "Teachers" }), _jsx("dd", { children: teachers.join(', ') || '—' }), _jsx("dt", { className: "text-muted", children: "Last term offered" }), _jsx("dd", { children: obe.prev?.termName ?? '—' })] })] }), _jsxs("section", { children: [_jsx("h3", { className: "text-sm font-semibold mb-2", children: "B. Attainment for the previous and current terms" }), obe.prev && _jsx(PartB, { title: `Previous · ${obe.prev.termName}`, att: obe.prev.attainment, cos: obe.prev.cos, coPo: obe.prev.coPo, coT: coT, poT: poT }), _jsx(PartB, { title: `Current · ${data.term.name}`, att: obe.attainment, cos: obe.cos, coPo: obe.coPo, coT: coT, poT: poT })] }), _jsxs("section", { className: "space-y-4", children: [_jsxs(Field, { label: "C. Comments: on attainment, on the BSFS student feedback, and on teaching and learning", htmlFor: "car-c", children: [_jsx(Textarea, { id: "car-c", className: "min-h-28 print:hidden", disabled: !editable, value: parts.part_c, onChange: (e) => setParts({ ...parts, part_c: e.target.value }) }), _jsx("p", { className: "hidden print:block whitespace-pre-wrap text-sm", children: parts.part_c })] }), _jsxs(Field, { label: "D. CQI implemented: changes made because of the last CAR or BUGS resolution", htmlFor: "car-d", hint: obe.prev?.car?.part_e ? _jsxs(_Fragment, { children: ["Last CAR's planned actions: \u201C", obe.prev.car.part_e.slice(0, 160), obe.prev.car.part_e.length > 160 ? '…' : '', "\u201D", editable && !parts.part_d.trim() && _jsxs(_Fragment, { children: [" \u00B7 ", _jsx("button", { type: "button", className: "link", onClick: () => setParts({ ...parts, part_d: `Planned last term: ${obe.prev.car.part_e}\n\nDone: ` }), children: "Start from them" })] })] }) : undefined, children: [_jsx(Textarea, { id: "car-d", className: "min-h-24 print:hidden", disabled: !editable, value: parts.part_d, onChange: (e) => setParts({ ...parts, part_d: e.target.value }) }), _jsx("p", { className: "hidden print:block whitespace-pre-wrap text-sm", children: parts.part_d })] }), _jsxs(Field, { label: "E. Recommendation: major issues and the plan for future actions", htmlFor: "car-e", children: [_jsx(Textarea, { id: "car-e", className: "min-h-24 print:hidden", disabled: !editable, value: parts.part_e, onChange: (e) => setParts({ ...parts, part_e: e.target.value }) }), _jsx("p", { className: "hidden print:block whitespace-pre-wrap text-sm", children: parts.part_e })] }), canEdit && parts.part_e.trim() && _jsx(Button, { size: "sm", variant: "ghost", icon: _jsx(ListPlus, { className: "size-4", "aria-hidden": true }), loading: toCqi.isPending, onClick: () => toCqi.mutate(undefined, { onSuccess: () => toast('ok', 'Added to the CQI log for the next offering'), onError: (e) => toast('bad', e.message) }), children: "Send Part E to the CQI log" })] }), _jsxs("section", { children: [_jsx("h3", { className: "text-sm font-semibold mb-2", children: "Signatures" }), _jsx("div", { className: "grid sm:grid-cols-2 gap-4", children: teachers.map((t) => (_jsxs("div", { className: "text-sm", children: [_jsx("div", { className: "h-10 border-b border-line-strong" }), _jsx("div", { className: "mt-1", children: t })] }, t))) })] })] })] })] }));
}
function PartB({ title, att, cos, coPo, coT, poT }) {
    const mapped = mappedPos(cos, coPo);
    const cell = (type, code, used, t) => {
        const v = used ? valueOf(att, type, code) : null;
        const a = attained(v, t);
        return { pct: used ? fmtPct(v) : 'NA', yn: !used || a === null ? 'NA' : a ? 'Y' : 'N', cls: !used || a === null ? 'text-subtle' : a ? 'text-ok' : 'text-bad' };
    };
    const block = (type, codes, used, t) => (_jsxs("table", { className: "table text-2xs mb-2", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: title }), codes.map((c) => _jsx("th", { className: "text-center", children: c }, c))] }) }), _jsxs("tbody", { children: [_jsxs("tr", { children: [_jsxs("td", { className: "font-semibold", children: [type, " %"] }), codes.map((c, i) => _jsx("td", { className: "text-center tabular", children: cell(type, c, used(c, i), t).pct }, c))] }), _jsxs("tr", { children: [_jsx("td", { className: "font-semibold", children: "Attained" }), codes.map((c, i) => { const x = cell(type, c, used(c, i), t); return _jsx("td", { className: `text-center font-semibold ${x.cls}`, children: x.yn }, c); })] })] })] }));
    return (_jsxs("div", { className: "overflow-x-auto", children: [block('CO', coCodes(), (_, i) => i < cos.length, coT), block('PO', PO_CODES, (c) => mapped.has(c), poT)] }));
}
