import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { CalendarDays, History, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { Badge, Button, Callout, Card, CardHeader, Dialog, Empty, Field, Input, Select, SegTabs, StatusSelect, Textarea, useToast } from '@/components/ui';
import { must, rpc, useItemHistory, useWrite } from '@/lib/api';
import { fmtDate, fmtDateLong } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { useTerm } from '@/lib/TermContext';
import { COMPONENT_KINDS, ITEM_STATUS, labelOf, MARKS_LEGACY, MARKS_STATE } from '@/lib/workflow';
/** A blank component, as the Add component button starts it. */
export const newComponentDraft = (course) => ({ kind: 'other', name: '', item_count: 1, marks_each: 10, weight: 0, best_n: null, per_section: course.course_type !== 'theory' });
/** Saves a component and regenerates its items. Shared by this tab and the progress tree. Theory components are always whole-course. */
export function useSaveComponent(offeringId, componentCount, isTheory) {
    return useWrite(async (d) => {
        const row = { offering_id: offeringId, kind: d.kind, name: d.name.trim(), item_count: d.item_count, marks_each: d.marks_each, weight: d.weight,
            best_n: d.best_n || null, per_section: d.per_section && !isTheory, sort: d.id ? undefined : componentCount + 1 };
        const saved = d.id ? await must(supabase.from('assessment_components').update(row).eq('id', d.id).select().single())
            : await must(supabase.from('assessment_components').insert(row).select().single());
        await rpc.generateItems(saved.id);
    });
}
const THEORY_DEFAULTS = [
    { kind: 'attendance', name: 'Attendance', item_count: 1, marks_each: 30, weight: 10, best_n: null, per_section: false },
    { kind: 'class_test', name: 'Class Test', item_count: 4, marks_each: 20, weight: 20, best_n: 3, per_section: false },
    { kind: 'term_final', name: 'Term Final', item_count: 1, marks_each: 210, weight: 70, best_n: null, per_section: false },
];
export default function AssessmentsTab({ offering, course, data }) {
    const { me, isAdmin } = useAuth();
    const { teachersOf, nameOf } = useTerm();
    const toast = useToast();
    const canEdit = isAdmin || teachersOf(offering.id).includes(me?.facultyId ?? '');
    const comps = data.components.filter((c) => c.offering_id === offering.id).sort((a, b) => a.sort - b.sort);
    // Theory sub-sections (A1, A2) share one class, so only sessional courses split by sub-section.
    const sections = course.course_type === 'theory' ? [] : data.sections.filter((s) => s.offering_id === offering.id).sort((a, b) => a.name.localeCompare(b.name));
    const [section, setSection] = useState('all');
    const [edit, setEdit] = useState(null);
    const [moving, setMoving] = useState(null);
    const weight = comps.reduce((s, c) => s + Number(c.weight), 0);
    const saveComp = useSaveComponent(offering.id, comps.length, course.course_type === 'theory');
    const delComp = useWrite((id) => must(supabase.from('assessment_components').delete().eq('id', id)));
    const updItem = useWrite((a) => must(supabase.from('assessment_items').update(a.patch).eq('id', a.id)));
    const seed = useWrite(async () => { for (const d of THEORY_DEFAULTS)
        await saveComp.mutateAsync(d); });
    const items = useMemo(() => data.items.filter((i) => i.offering_id === offering.id && (section === 'all' || !i.section_id || i.section_id === section)), [data.items, offering.id, section]);
    const secName = (id) => sections.find((s) => s.id === id)?.name;
    return (_jsxs("div", { className: "space-y-5 min-w-0", children: [_jsxs(Card, { children: [_jsx(CardHeader, { title: "Assessment plan", subtitle: "Components, how many of each, and their weight in the final grade.", actions: canEdit && _jsx(Button, { size: "sm", icon: _jsx(Plus, { className: "size-4", "aria-hidden": true }), onClick: () => setEdit(newComponentDraft(course)), children: "Add component" }) }), comps.length === 0 ? (_jsx(Empty, { title: "No assessment plan yet", action: canEdit && course.course_type === 'theory' ? _jsx(Button, { variant: "primary", loading: seed.isPending, onClick: () => seed.mutate(undefined, { onError: (e) => toast('bad', e.message), onSuccess: () => toast('ok', 'Standard theory plan created') }), children: "Use standard theory plan" }) : undefined, children: course.course_type === 'theory' ? 'Start from the standard plan (attendance 10, class tests 20 with best 3 of 4, term final 70) and adjust it.' : 'Add components such as lab reports, lab tests, quiz and viva. Choose “per sub-section” to track A1 and A2 separately.' })) : (_jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Component" }), _jsx("th", { children: "Type" }), _jsx("th", { className: "text-right", children: "Items" }), _jsx("th", { className: "text-right", children: "Marks each" }), _jsx("th", { className: "text-right", children: "Counted" }), _jsx("th", { className: "text-right", children: "Weight" }), _jsx("th", { children: "Scope" }), canEdit && _jsx("th", { className: "w-24", children: _jsx("span", { className: "sr-only", children: "Actions" }) })] }) }), _jsx("tbody", { children: comps.map((c) => (_jsxs("tr", { children: [_jsx("td", { className: "font-medium", children: c.name }), _jsx("td", { className: "text-muted", children: labelOf(COMPONENT_KINDS, c.kind) }), _jsx("td", { className: "text-right tabular", children: c.item_count }), _jsx("td", { className: "text-right tabular", children: Number(c.marks_each) }), _jsx("td", { className: "text-right tabular", children: c.best_n ? `Best ${c.best_n}` : 'All' }), _jsxs("td", { className: "text-right tabular", children: [Number(c.weight), "%"] }), _jsx("td", { className: "text-muted text-2xs", children: c.per_section && sections.length > 1 ? 'Per sub-section' : 'Whole course' }), canEdit && _jsx("td", { children: _jsxs("div", { className: "flex gap-1 justify-end", children: [_jsx(Button, { size: "sm", variant: "ghost", "aria-label": `Edit ${c.name}`, onClick: () => setEdit({ ...c }), children: _jsx(Pencil, { className: "size-4", "aria-hidden": true }) }), _jsx(Button, { size: "sm", variant: "ghost", "aria-label": `Delete ${c.name}`, onClick: () => {
                                                                if (confirm(`Delete "${c.name}" and its items?`))
                                                                    delComp.mutate(c.id, { onSuccess: () => toast('ok', 'Component deleted'), onError: (e) => toast('bad', e.message) });
                                                            }, children: _jsx(Trash2, { className: "size-4", "aria-hidden": true }) })] }) })] }, c.id))) }), _jsx("tfoot", { children: _jsxs("tr", { children: [_jsx("td", { colSpan: 5, className: "px-3 py-2 text-right text-2xs text-subtle", children: "Total weight" }), _jsxs("td", { className: `px-3 py-2 text-right tabular font-semibold ${weight === 100 ? 'text-ok' : 'text-warn'}`, children: [weight, "%"] }), _jsx("td", { colSpan: 2, className: "px-3 py-2 text-2xs text-subtle", children: weight === 100 ? 'Complete' : 'Must total 100%' })] }) })] }) }))] }), comps.length > 0 && _jsxs(Card, { children: [_jsx(CardHeader, { title: course.course_type === 'theory' ? 'Class tests and assessments' : 'Assessments by sub-section', subtitle: "Dates feed the department calendar. Class tests for the same cohort cannot share a day.", actions: sections.length > 1 && _jsx(SegTabs, { label: "Sub-section", value: section, onChange: setSection, options: [{ value: 'all', label: 'All' }, ...sections.map((s) => ({ value: s.id, label: s.name }))] }) }), _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Item" }), sections.length > 1 && _jsx("th", { children: "Section" }), _jsx("th", { children: "Date" }), _jsx("th", { children: "Status" }), _jsx("th", { children: "Marks" }), _jsx("th", { children: "Responsible" })] }) }), _jsx("tbody", { children: items.sort((a, b) => (a.held_on ?? '9').localeCompare(b.held_on ?? '9') || a.seq - b.seq).map((i) => (_jsxs("tr", { children: [_jsxs("td", { children: [_jsx("div", { className: "font-medium", children: i.title }), _jsxs("div", { className: "text-2xs text-subtle tabular", children: [Number(i.total_marks), " marks"] })] }), sections.length > 1 && _jsx("td", { children: secName(i.section_id) ?? 'All' }), _jsx("td", { children: _jsxs("button", { disabled: !canEdit, onClick: () => setMoving(i), className: "inline-flex items-center gap-1.5 text-sm rounded px-1.5 py-1 -mx-1.5 hover:bg-sunken disabled:hover:bg-transparent cursor-pointer disabled:cursor-default", "aria-label": `Change date of ${i.title}`, children: [_jsx(CalendarDays, { className: "size-3.5 text-subtle", "aria-hidden": true }), i.held_on ? fmtDate(i.held_on, { weekday: 'short', day: 'numeric', month: 'short' }) : i.date_later ? _jsx("span", { className: "date-later px-1.5 py-0.5", children: "To be set later" }) : _jsx("span", { className: "text-warn", children: "Set date" })] }) }), _jsxs("td", { children: [_jsxs("label", { className: "sr-only", htmlFor: `is-${i.id}`, children: ["Status of ", i.title] }), _jsx(StatusSelect, { id: `is-${i.id}`, className: "h-8 w-36", disabled: !canEdit, opts: ITEM_STATUS, done: "held", value: i.status, onChange: (e) => updItem.mutate({ id: i.id, patch: { status: e.target.value } }, { onError: (er) => toast('bad', er.message) }) })] }), _jsxs("td", { children: [_jsxs("label", { className: "sr-only", htmlFor: `im-${i.id}`, children: ["Marks for ", i.title] }), _jsx(StatusSelect, { id: `im-${i.id}`, className: "h-8 w-44", disabled: !canEdit, value: i.marks_status, opts: [...MARKS_STATE, ...MARKS_LEGACY.filter((m) => m.value === i.marks_status)], done: "published", onChange: (e) => updItem.mutate({ id: i.id, patch: { marks_status: e.target.value } }, { onError: (er) => toast('bad', er.message) }) })] }), _jsxs("td", { children: [_jsxs("label", { className: "sr-only", htmlFor: `ir-${i.id}`, children: ["Responsible teacher for ", i.title] }), _jsxs(Select, { id: `ir-${i.id}`, className: "h-8 w-56", disabled: !canEdit, value: i.responsible ?? '', onChange: (e) => updItem.mutate({ id: i.id, patch: { responsible: e.target.value || null } }, { onError: (er) => toast('bad', er.message) }), children: [_jsx("option", { value: "", children: "All course teachers" }), teachersOf(offering.id).map((f) => _jsx("option", { value: f, children: nameOf(f) }, f))] })] })] }, i.id))) })] }) })] }), _jsx(ComponentDialog, { draft: edit, onClose: () => setEdit(null), busy: saveComp.isPending, hasSections: sections.length > 1, onSave: (d) => saveComp.mutate(d, { onSuccess: () => { toast('ok', 'Plan saved and items generated'); setEdit(null); }, onError: (e) => toast('bad', e.message) }) }, edit ? edit.id ?? 'new' : 'closed'), _jsx(RescheduleDialog, { item: moving, onClose: () => setMoving(null), admin: isAdmin })] }));
}
export function ComponentDialog({ draft, onClose, onSave, busy, hasSections }) {
    const [d, setD] = useState(draft);
    const set = (k, v) => setD((x) => (x ? { ...x, [k]: v } : x));
    const err = d && (!d.name.trim() ? 'Give the component a name.' : d.best_n && d.best_n > d.item_count ? 'Counted items cannot exceed the number of items.' : null);
    return (_jsx(Dialog, { open: !!draft, onClose: onClose, title: draft?.id ? 'Edit component' : 'Add component', footer: _jsxs(_Fragment, { children: [_jsx(Button, { onClick: onClose, children: "Cancel" }), _jsx(Button, { variant: "primary", loading: busy, disabled: !!err, onClick: () => d && onSave(d), children: "Save and generate items" })] }), children: d && _jsxs("div", { className: "grid grid-cols-2 gap-3", children: [_jsx(Field, { className: "col-span-2", label: "Name", htmlFor: "c-name", children: _jsx(Input, { id: "c-name", value: d.name, onChange: (e) => set('name', e.target.value), placeholder: "e.g. Lab Report" }) }), _jsx(Field, { label: "Type", htmlFor: "c-kind", children: _jsx(Select, { id: "c-kind", value: d.kind, onChange: (e) => set('kind', e.target.value), children: COMPONENT_KINDS.map((k) => _jsx("option", { value: k.value, children: k.label }, k.value)) }) }), _jsx(Field, { label: "Weight (%)", htmlFor: "c-w", children: _jsx(Input, { id: "c-w", type: "number", min: 0, max: 100, value: d.weight, onChange: (e) => set('weight', Number(e.target.value)) }) }), _jsx(Field, { label: "Number of items", htmlFor: "c-n", children: _jsx(Input, { id: "c-n", type: "number", min: 1, max: 40, value: d.item_count, onChange: (e) => set('item_count', Math.max(1, Number(e.target.value))) }) }), _jsx(Field, { label: "Marks per item", htmlFor: "c-m", children: _jsx(Input, { id: "c-m", type: "number", min: 1, value: d.marks_each, onChange: (e) => set('marks_each', Number(e.target.value)) }) }), _jsx(Field, { label: "Count best", htmlFor: "c-b", hint: "Leave empty to count every item.", children: _jsx(Input, { id: "c-b", type: "number", min: 1, value: d.best_n ?? '', onChange: (e) => set('best_n', e.target.value ? Number(e.target.value) : null) }) }), hasSections && _jsx(Field, { label: "Scope", htmlFor: "c-s", children: _jsxs(Select, { id: "c-s", value: d.per_section ? '1' : '0', onChange: (e) => set('per_section', e.target.value === '1'), children: [_jsx("option", { value: "1", children: "Separate items per sub-section" }), _jsx("option", { value: "0", children: "One item for the whole course" })] }) }), err && _jsx("p", { role: "alert", className: "col-span-2 text-2xs text-bad", children: err }), _jsx("p", { className: "col-span-2 text-2xs text-subtle", children: "Items are created or removed to match the count." })] }) }));
}
export function RescheduleDialog({ item, onClose, admin }) {
    const toast = useToast();
    const { nameOf } = useTerm();
    const [date, setDate] = useState('');
    const [reason, setReason] = useState('');
    const [time, setTime] = useState('');
    const [conflicts, setConflicts] = useState([]);
    const [seen, setSeen] = useState(null);
    const history = useItemHistory(item?.id);
    if (item && seen !== item.id) {
        setSeen(item.id);
        setDate(item.held_on ?? '');
        setTime(item.held_time ?? '');
        setReason('');
        setConflicts([]);
    }
    const move = useWrite(async (force) => {
        const r = await rpc.reschedule({ item: item.id, date: date || null, reason, force });
        if (r.ok && time !== (item.held_time ?? ''))
            await must(supabase.from('assessment_items').update({ held_time: time || null }).eq('id', item.id));
        return r;
    });
    // "To be set later": clear any date (kept in the history, with the reason) and flag the item so it glows until dated.
    const later = useWrite(async () => {
        if (item.held_on)
            await rpc.reschedule({ item: item.id, date: null, reason, force: false });
        await must(supabase.from('assessment_items').update({ date_later: true }).eq('id', item.id));
    });
    const go = (force) => move.mutate(force, {
        onSuccess: (r) => { if (!r.ok) {
            setConflicts(r.conflicts);
            return;
        } toast('ok', 'Date saved'); onClose(); },
        onError: (e) => toast('bad', e.message),
    });
    const changed = item && date !== (item.held_on ?? '');
    return (_jsxs(Dialog, { open: !!item, onClose: onClose, title: item ? `Date for ${item.title}` : '', footer: _jsxs(_Fragment, { children: [_jsx(Button, { className: "mr-auto", loading: later.isPending, disabled: (!!item?.date_later && !item.held_on) || (!!item?.held_on && !reason.trim()), title: item?.held_on ? 'Give a reason first; the current date is cleared.' : undefined, onClick: () => later.mutate(undefined, { onSuccess: () => { toast('ok', 'Marked to be set later'); onClose(); }, onError: (e) => toast('bad', e.message) }), children: "To be set later" }), _jsx(Button, { onClick: onClose, children: "Cancel" }), conflicts.length > 0 && admin && _jsx(Button, { variant: "danger", loading: move.isPending, disabled: !reason.trim(), onClick: () => go(true), children: "Override clash" }), _jsx(Button, { variant: "primary", loading: move.isPending, disabled: !!item?.held_on && !!changed && !reason.trim(), onClick: () => go(false), children: "Save" })] }), children: [_jsxs("div", { className: "grid grid-cols-2 gap-3", children: [_jsx(Field, { label: "Date", htmlFor: "r-date", children: _jsx(Input, { id: "r-date", type: "date", value: date, onChange: (e) => { setDate(e.target.value); setConflicts([]); } }) }), _jsx(Field, { label: "Time or slot", htmlFor: "r-time", hint: "Optional", children: _jsx(Input, { id: "r-time", value: time, onChange: (e) => setTime(e.target.value), placeholder: "e.g. 2:30 pm" }) })] }), item?.date_later && !item.held_on && _jsxs("p", { className: "text-sm", children: [_jsx("span", { className: "date-later px-1.5 py-0.5", children: "To be set later" }), " ", _jsx("span", { className: "text-muted", children: "Pick a date when it is known." })] }), item?.held_on && _jsx(Field, { label: "Reason for the change", htmlFor: "r-reason", hint: "Kept in the history and sent to co-teachers.", children: _jsx(Textarea, { id: "r-reason", value: reason, onChange: (e) => setReason(e.target.value) }) }), conflicts.length > 0 && _jsxs(Callout, { tone: "bad", title: "Same cohort already has a class test that day", children: [_jsx("ul", { className: "list-disc pl-5", children: conflicts.map((c, i) => _jsxs("li", { children: [c.course, " \u00B7 ", c.title] }, i)) }), _jsx("p", { className: "mt-1", children: admin ? 'Pick another date, or override with a reason.' : 'Pick another date, or ask a department admin to override.' })] }), !!history.data?.length && _jsxs("div", { children: [_jsxs("h3", { className: "text-sm font-semibold flex items-center gap-1.5 mb-1", children: [_jsx(History, { className: "size-4", "aria-hidden": true }), "Date history"] }), _jsx("ul", { className: "text-2xs text-muted space-y-1", children: history.data.map((h) => (_jsxs("li", { children: [_jsxs(Badge, { children: [fmtDate(h.old_date), " \u2192 ", fmtDate(h.new_date)] }), " ", nameOf(h.changed_by), " \u00B7 ", fmtDateLong(h.changed_at.slice(0, 10)), h.reason ? ` · ${h.reason}` : ''] }, h.id))) })] })] }));
}
