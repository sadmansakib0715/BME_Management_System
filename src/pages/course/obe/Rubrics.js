import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { clsx } from 'clsx';
import { ClipboardPaste, Copy, FileDown, FileText, ListPlus, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button, Callout, Card, CardHeader, Dialog, Empty, Textarea, useToast } from '@/components/ui';
import { must, rpc, useWrite } from '@/lib/api';
import { blankRubric, rubricChecks, rubricFromSheet, SAMPLE_RUBRIC, total } from '@/lib/rubric';
import { supabase } from '@/lib/supabase';
import { RubricEditor } from './RubricEditor';
import { save as saveFile } from './docData';
import { useCourseInfo } from './useDocInputs';
const toDraft = (r) => ({ id: r.id, title: r.title, component_id: r.component_id, levels: r.levels, criteria: r.criteria, note: r.note });
/** The offering's rubrics. A teacher writes or pastes a rubric, then links each criterion to COs. */
export default function Rubrics({ offering, course, data, obe, canEdit }) {
    const toast = useToast();
    const info = useCourseInfo({ offering, course, data, obe });
    const rubrics = obe.rubrics;
    const [openId, setOpenId] = useState(rubrics[0]?.id ?? null);
    const saved = useMemo(() => (openId && openId !== 'new' ? rubrics.find((x) => x.id === openId) : undefined), [openId, rubrics]);
    const [draft, setDraft] = useState(saved ? toDraft(saved) : null);
    // Reset the draft when another rubric is opened or this one is saved, not on every refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { if (saved)
        setDraft(toDraft(saved)); }, [saved?.id, saved?.updated_at]);
    useEffect(() => { if (openId === null && rubrics[0])
        setOpenId(rubrics[0].id); }, [openId, rubrics]);
    const [paste, setPaste] = useState(null);
    const comps = data.components.filter((c) => c.offering_id === offering.id && c.kind !== 'term_final');
    const dirty = !!draft && (openId === 'new' || JSON.stringify(draft) !== JSON.stringify(saved && toDraft(saved)));
    const save = useWrite(async (d) => {
        const valid = new Set(obe.cos.map((c) => c.id));
        const row = { offering_id: offering.id, component_id: d.component_id, title: d.title.trim(), levels: d.levels, note: d.note.trim(), updated_at: new Date().toISOString(),
            criteria: d.criteria.map((c) => ({ ...c, name: c.name.trim(), cos: c.cos.filter((id) => valid.has(id)) })) };
        const res = d.id ? await must(supabase.from('rubrics').update(row).eq('id', d.id).select().single())
            : await must(supabase.from('rubrics').insert({ ...row, sort: rubrics.length + 1 }).select().single());
        return res;
    });
    const del = useWrite((id) => must(supabase.from('rubrics').delete().eq('id', id)));
    const fill = useWrite(() => rpc.copyForward(offering.id));
    const start = (d) => { setOpenId('new'); setDraft(d); };
    const coCode = (id) => { const i = obe.cos.findIndex((c) => c.id === id); return i < 0 ? null : `CO${i + 1}`; };
    const groupName = (r) => comps.find((c) => c.id === r.component_id)?.name ?? (r.title.trim() || 'Rubric');
    const downloadPdf = async (r) => {
        const { rubricPdf } = await import('@/lib/pdf/obeDocs');
        saveFile(rubricPdf({ course: info, rubric: { title: r.title, assessment: comps.find((c) => c.id === r.component_id)?.name ?? null, levels: r.levels, note: r.note,
                criteria: r.criteria.map((c) => ({ name: c.name, max: Number(c.max), levels: c.levels, cos: c.cos.map(coCode).filter((x) => !!x) })) } }), `${course.code} Rubric ${r.title || 'untitled'} ${data.term.name}.pdf`);
    };
    /** Puts the rubric's criteria into the assessment map (one group named after its assessment), replacing that group, so the
        marksheet template gets one column per criterion with its marks and COs. */
    const toMap = useWrite(async (r) => {
        const name = groupName(r);
        const valid = new Set(obe.cos.map((c) => c.id));
        const old = obe.criteria.filter((c) => c.assessment === name).map((c) => c.id);
        if (old.length)
            await must(supabase.from('obe_criteria').delete().in('id', old));
        const base = Math.max(-1, ...obe.criteria.filter((c) => c.assessment !== name).map((c) => c.sort)) + 1;
        const rows = r.criteria.filter((c) => c.name.trim() && Number(c.max) > 0)
            .map((c, i) => ({ offering_id: offering.id, assessment: name, label: c.name.trim(), max_marks: Number(c.max), sort: base + i }));
        if (!rows.length)
            return 0;
        const saved = await must(supabase.from('obe_criteria').insert(rows).select());
        const crit = r.criteria.filter((c) => c.name.trim() && Number(c.max) > 0);
        const links = saved.flatMap((row) => { const c = crit[row.sort - base]; return (c?.cos ?? []).filter((id) => valid.has(id)).map((co_id) => ({ criterion_id: row.id, co_id })); });
        if (links.length)
            await must(supabase.from('obe_criterion_cos').insert(links));
        return rows.length;
    });
    const parsed = paste === null ? null : rubricFromSheet(paste);
    return (_jsxs("div", { className: "space-y-5", children: [_jsxs(Card, { children: [_jsx(CardHeader, { title: "Rubrics", subtitle: "For presentations, demonstrations, projects and reports. Link every criterion to the COs it measures.", actions: canEdit && _jsxs(_Fragment, { children: [!rubrics.length && obe.prev && _jsxs(Button, { size: "sm", icon: _jsx(Copy, { className: "size-4", "aria-hidden": true }), loading: fill.isPending, onClick: () => fill.mutate(undefined, { onSuccess: (r) => toast('ok', r.rubrics ? `${r.rubrics} rubrics copied from ${obe.prev.termName}` : `${obe.prev.termName} has no rubrics to copy`), onError: (e) => toast('bad', e.message) }), children: ["Fill from ", obe.prev.termName] }), _jsx(Button, { size: "sm", icon: _jsx(ClipboardPaste, { className: "size-4", "aria-hidden": true }), onClick: () => setPaste(''), children: "Paste from sheet" }), _jsx(Button, { size: "sm", icon: _jsx(FileText, { className: "size-4", "aria-hidden": true }), onClick: () => start(SAMPLE_RUBRIC()), children: "Start from sample" }), _jsx(Button, { size: "sm", icon: _jsx(Plus, { className: "size-4", "aria-hidden": true }), onClick: () => start(blankRubric()), children: "New rubric" })] }) }), rubrics.length === 0 && openId !== 'new'
                        ? _jsx(Empty, { title: "No rubrics yet", children: "Paste a rubric from Excel or Google Sheets, start from the sample, or write a new one." })
                        : _jsxs("div", { className: "flex flex-wrap gap-2 px-4 py-3", role: "tablist", "aria-label": "Rubrics", children: [rubrics.map((x) => (_jsxs("button", { type: "button", role: "tab", "aria-selected": openId === x.id, onClick: () => setOpenId(x.id), className: clsx('rounded border px-3 py-1.5 text-sm transition-colors duration-150 cursor-pointer', openId === x.id ? 'border-brand bg-brand-soft text-brand-ink font-medium' : 'border-line hover:bg-sunken'), children: [x.title || 'Untitled', " ", _jsxs("span", { className: "text-2xs text-subtle tabular", children: ["\u00B7 ", total(x)] }), rubricChecks({ ...x, criteria: x.criteria.map((c) => ({ ...c, cos: c.cos.filter((id) => obe.cos.some((o) => o.id === id)) })) }).length > 0 && _jsx("span", { className: "ml-1 text-warn", title: "Needs attention", children: "\u2022" })] }, x.id))), openId === 'new' && _jsx("span", { role: "tab", "aria-selected": true, className: "rounded border border-brand bg-brand-soft text-brand-ink font-medium px-3 py-1.5 text-sm", children: draft?.title || 'New rubric' })] })] }), draft && openId && _jsxs(Card, { children: [_jsx(CardHeader, { title: draft.title || 'Untitled rubric', subtitle: draft.component_id ? `Marks ${comps.find((c) => c.id === draft.component_id)?.name ?? 'an assessment'}` : 'Not linked to an assessment yet', actions: !canEdit ? (saved && _jsx(Button, { size: "sm", icon: _jsx(FileDown, { className: "size-4", "aria-hidden": true }), onClick: () => downloadPdf(saved).catch((e) => toast('bad', e.message)), children: "Rubric PDF" })) : _jsxs(_Fragment, { children: [saved && !dirty && _jsx(Button, { size: "sm", icon: _jsx(FileDown, { className: "size-4", "aria-hidden": true }), onClick: () => downloadPdf(saved).catch((e) => toast('bad', e.message)), children: "Rubric PDF" }), saved && !dirty && _jsx(Button, { size: "sm", icon: _jsx(ListPlus, { className: "size-4", "aria-hidden": true }), loading: toMap.isPending, title: "Adds one assessment-map row per criterion, so the marksheet template has a column for each", onClick: () => {
                                        const name = groupName(saved);
                                        if (obe.criteria.some((c) => c.assessment === name) && !confirm(`The assessment map already has “${name}”. Replace its rows with this rubric's ${saved.criteria.length} criteria?`))
                                            return;
                                        toMap.mutate(saved, { onSuccess: (n) => toast('ok', `${n} criteria added to the assessment map as “${name}”`), onError: (e) => toast('bad', e.message) });
                                    }, children: "Add to assessment map" }), draft.id && _jsx(Button, { size: "sm", variant: "ghost", icon: _jsx(Trash2, { className: "size-4", "aria-hidden": true }), loading: del.isPending, onClick: () => confirm(`Delete “${draft.title || 'this rubric'}”?`) && del.mutate(draft.id, { onSuccess: () => { toast('ok', 'Rubric deleted'); setOpenId(rubrics.find((x) => x.id !== draft.id)?.id ?? null); setDraft(null); }, onError: (e) => toast('bad', e.message) }), children: "Delete" }), openId === 'new' && _jsx(Button, { size: "sm", onClick: () => { setOpenId(rubrics[0]?.id ?? null); setDraft(rubrics[0] ? toDraft(rubrics[0]) : null); }, children: "Discard" }), _jsx(Button, { size: "sm", variant: "primary", disabled: !dirty || !draft.title.trim(), loading: save.isPending, onClick: () => save.mutate(draft, { onSuccess: (x) => { toast('ok', 'Rubric saved'); setOpenId(x.id); }, onError: (e) => toast('bad', e.message) }), children: "Save" })] }) }), _jsx(RubricEditor, { value: draft, onChange: setDraft, cos: obe.cos, components: comps, disabled: !canEdit })] }), _jsx(Dialog, { open: paste !== null, onClose: () => setPaste(null), title: "Paste a rubric", wide: true, footer: _jsxs(_Fragment, { children: [_jsx(Button, { onClick: () => setPaste(null), children: "Cancel" }), _jsx(Button, { variant: "primary", disabled: !parsed, onClick: () => { start(parsed); setPaste(null); }, children: "Use this rubric" })] }), children: _jsxs("div", { className: "space-y-3", children: [_jsxs("p", { className: "text-sm text-muted", children: ["In Excel or Google Sheets, select the rubric from the title row down to the note, copy it, and paste it here. The header row needs ", _jsx("b", { children: "Criterion" }), " and ", _jsx("b", { children: "Max Marks" }), ", then one column per level. Bands written as \u201C7\u20138: \u2026\u201D keep their marks."] }), _jsx("label", { className: "sr-only", htmlFor: "rb-paste", children: "Rubric cells" }), _jsx(Textarea, { id: "rb-paste", className: "min-h-40 font-mono text-2xs", value: paste ?? '', onChange: (e) => setPaste(e.target.value) }), paste ? parsed
                            ? _jsxs(Callout, { tone: "ok", children: ["Found \u201C", parsed.title || 'Untitled', "\u201D: ", parsed.criteria.length, " criteria, ", parsed.levels.length, " levels (", parsed.levels.join(', '), "), ", total(parsed), " marks."] })
                            : _jsx(Callout, { tone: "warn", children: "No header row with Criterion and Max Marks was found." }) : null] }) })] }));
}
