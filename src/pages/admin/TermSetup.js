import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { clsx } from 'clsx';
import { FileSpreadsheet, Minus, Pause, Play, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { Link, NavLink, useParams } from 'react-router-dom';
import { Button, Card, CardHeader, Dialog, ErrorNote, Field, Input, PageHeader, Spinner, useToast } from '@/components/ui';
import { WeekTracker } from '@/components/WeekTracker';
import { must, useWrite } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useTerm } from '@/lib/TermContext';
/** Term setup: two equal routes. Import the workbook to fill everything at once, or build the term by hand tab by tab. */
const SetupCourses = lazy(() => import('./SetupCourses'));
const Assignments = lazy(() => import('./Assignments'));
const SetupRoutine = lazy(() => import('./SetupRoutine'));
const ImportPanel = lazy(() => import('./Import'));
const TABS = [
    { key: '', label: 'Term & dates' },
    { key: 'courses', label: 'Courses' },
    { key: 'people', label: 'Teachers & roles' },
    { key: 'routine', label: 'Class-test routine' },
    { key: 'import', label: 'Import workbook' },
];
const KINDS = [['exam_start', 'Term finals begin'], ['outline_sharing', 'Course outlines shared'], ['question_submission', 'Question papers submitted'],
    ['theory_gradesheet', 'Theory gradesheets to HOD'], ['sessional_gradesheet', 'Sessional gradesheets'], ['feedback_deadline', 'Student feedback collected'], ['car_deadline', 'Course File and CAR']];
export default function TermSetup() {
    const { tab = '' } = useParams();
    const { data, loading, error, setTermId } = useTerm();
    const toast = useToast();
    const [newTerm, setNewTerm] = useState(false);
    const [form, setForm] = useState({ code: '', name: '', starts_on: '', ends_on: '', total_weeks: 14 });
    const createTerm = useWrite(async () => {
        const t = await must(supabase.from('terms').insert({ ...form, starts_on: form.starts_on || null, ends_on: form.ends_on || null }).select().single());
        return t.id;
    });
    if (loading)
        return _jsx(Spinner, {});
    if (error)
        return _jsx(ErrorNote, { error: error });
    const t = data?.term;
    return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { eyebrow: t?.name ?? 'Department', title: "Term setup", actions: _jsx(Button, { icon: _jsx(Plus, { className: "size-4", "aria-hidden": true }), onClick: () => setNewTerm(true), children: "New term" }) }), _jsxs("div", { className: "grid gap-3 sm:grid-cols-2 mb-5", children: [_jsxs(Link, { to: "/admin/term/import", className: clsx('card p-4 flex gap-3 hover:border-brand/40 transition-colors duration-150', tab === 'import' && 'border-brand/60'), children: [_jsx("span", { className: "size-10 shrink-0 rounded-full bg-brand-soft text-brand-ink grid place-items-center", "aria-hidden": true, children: _jsx(FileSpreadsheet, { className: "size-5" }) }), _jsxs("span", { children: [_jsx("span", { className: "block text-sm font-semibold", children: "Option 1 \u00B7 Import the workbook" }), _jsx("span", { className: "block text-sm text-muted mt-0.5", children: "Upload the Activity Tracker .xlsx and everything is filled in at once. You can still adjust it by hand afterwards." })] })] }), _jsxs(Link, { to: "/admin/term/courses", className: clsx('card p-4 flex gap-3 hover:border-brand/40 transition-colors duration-150', tab !== 'import' && 'border-brand/60'), children: [_jsx("span", { className: "size-10 shrink-0 rounded-full bg-brand-soft text-brand-ink grid place-items-center", "aria-hidden": true, children: _jsx(SlidersHorizontal, { className: "size-5" }) }), _jsxs("span", { children: [_jsx("span", { className: "block text-sm font-semibold", children: "Option 2 \u00B7 Set up by hand" }), _jsx("span", { className: "block text-sm text-muted mt-0.5", children: "Term & dates \u2192 Courses \u2192 Teachers & roles \u2192 Class-test routine. Each tab saves as you go." })] })] })] }), _jsx("nav", { "aria-label": "Term setup", className: "-mx-4 sm:mx-0 px-4 sm:px-0 mb-5 overflow-x-auto", children: _jsx("ul", { className: "flex gap-1 border-b border-line min-w-max", children: TABS.map((x) => (_jsx("li", { children: _jsx(NavLink, { to: `/admin/term${x.key ? `/${x.key}` : ''}`, end: true, className: ({ isActive }) => clsx('inline-flex items-center h-10 px-3 -mb-px border-b-2 text-sm font-medium transition-colors duration-150', isActive ? 'border-brand text-brand-ink' : 'border-transparent text-muted hover:text-ink'), children: x.label }) }, x.key))) }) }), _jsx(Suspense, { fallback: _jsx(Spinner, {}), children: tab === 'import' ? _jsx(ImportPanel, {})
                    : !t ? _jsx(Card, { className: "p-6 text-sm text-muted", children: "No term yet. Create one with \u201CNew term\u201D, or import the workbook." })
                        : tab === 'courses' ? _jsx(SetupCourses, {})
                            : tab === 'people' ? _jsx(Assignments, {})
                                : tab === 'routine' ? _jsx(SetupRoutine, {})
                                    : _jsx(TermDates, { term: t }, t.id) }), _jsx(Dialog, { open: newTerm, onClose: () => setNewTerm(false), title: "New term", footer: _jsxs(_Fragment, { children: [_jsx(Button, { onClick: () => setNewTerm(false), children: "Cancel" }), _jsx(Button, { variant: "primary", disabled: !form.code.trim() || !form.name.trim(), loading: createTerm.isPending, onClick: () => createTerm.mutate(undefined, { onSuccess: (id) => { toast('ok', 'Term created. Add its courses next.'); setNewTerm(false); setTermId(id); }, onError: (e) => toast('bad', e.message) }), children: "Create term" })] }), children: _jsx(TermFields, { form: form, setForm: setForm, prefix: "n" }) })] }));
}
function TermFields({ form, setForm, prefix }) {
    return (_jsxs("div", { className: "grid grid-cols-2 gap-3", children: [_jsx(Field, { label: "Code", htmlFor: `${prefix}-code`, hint: "e.g. 2026-07", children: _jsx(Input, { id: `${prefix}-code`, value: form.code, onChange: (e) => setForm({ ...form, code: e.target.value }) }) }), _jsx(Field, { label: "Name", htmlFor: `${prefix}-name`, hint: "e.g. July 2026", children: _jsx(Input, { id: `${prefix}-name`, value: form.name, onChange: (e) => setForm({ ...form, name: e.target.value }) }) }), _jsx(Field, { label: "Starts", htmlFor: `${prefix}-s`, children: _jsx(Input, { id: `${prefix}-s`, type: "date", value: form.starts_on, onChange: (e) => setForm({ ...form, starts_on: e.target.value }) }) }), _jsx(Field, { label: "Ends", htmlFor: `${prefix}-e`, children: _jsx(Input, { id: `${prefix}-e`, type: "date", value: form.ends_on, onChange: (e) => setForm({ ...form, ends_on: e.target.value }) }) }), _jsx(Field, { label: "Teaching weeks", htmlFor: `${prefix}-w`, children: _jsx(Input, { id: `${prefix}-w`, type: "number", min: 1, max: 30, value: form.total_weeks, onChange: (e) => setForm({ ...form, total_weeks: Number(e.target.value) }) }) })] }));
}
function TermDates({ term: t }) {
    const { data } = useTerm();
    const toast = useToast();
    const [pause, setPause] = useState('');
    const initial = { code: t.code, name: t.name, starts_on: t.starts_on ?? '', ends_on: t.ends_on ?? '', total_weeks: t.total_weeks };
    const [form, setForm] = useState(initial);
    const dirty = JSON.stringify(form) !== JSON.stringify(initial);
    const err = (e) => toast('bad', e.message);
    const updTerm = useWrite((patch) => must(supabase.from('terms').update(patch).eq('id', t.id)));
    const makeCurrent = useWrite(async () => {
        await must(supabase.from('terms').update({ is_current: false }).eq('is_current', true));
        await must(supabase.from('terms').update({ is_current: true }).eq('id', t.id));
    });
    const setMilestone = useWrite((a) => a.due_on
        ? must(supabase.from('term_milestones').upsert({ term_id: t.id, offering_id: null, kind: a.kind, due_on: a.due_on }, { onConflict: 'term_id,offering_id,kind' }))
        : must(supabase.from('term_milestones').delete().eq('term_id', t.id).eq('kind', a.kind).is('offering_id', null)));
    // Everything belonging to the term (courses, sections, roles, workflow, plans, dates, outcomes) cascades in the database.
    const deleteTerm = useWrite(() => must(supabase.from('terms').delete().eq('id', t.id)));
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [typed, setTyped] = useState('');
    return (_jsxs("div", { className: "grid gap-5 xl:grid-cols-2", children: [_jsx("div", { className: "xl:col-span-2", children: _jsx(WeekTracker, { term: t }) }), _jsxs(Card, { children: [_jsx(CardHeader, { title: "Term details", subtitle: t.is_current ? 'This is the current term.' : 'Not the current term.', actions: !t.is_current && _jsx(Button, { size: "sm", onClick: () => makeCurrent.mutate(undefined, { onSuccess: () => toast('ok', 'Now the current term'), onError: err }), children: "Make current" }) }), _jsxs("div", { className: "p-4 space-y-4", children: [_jsx(TermFields, { form: form, setForm: setForm, prefix: "t" }), _jsxs("div", { className: "flex justify-end gap-2", children: [dirty && _jsx(Button, { onClick: () => setForm(initial), children: "Undo" }), _jsx(Button, { variant: "primary", disabled: !dirty || !form.code.trim() || !form.name.trim() || form.total_weeks < t.latest_completed_week, loading: updTerm.isPending, onClick: () => updTerm.mutate({ ...form, starts_on: form.starts_on || null, ends_on: form.ends_on || null }, { onSuccess: () => toast('ok', 'Term details saved'), onError: err }), children: "Save details" })] })] })] }), _jsxs(Card, { children: [_jsx(CardHeader, { title: "Teaching weeks", subtitle: "Move the counter on as each week finishes." }), _jsxs("div", { className: "p-4 space-y-4", children: [_jsxs("div", { className: "flex flex-wrap items-center gap-3", children: [_jsx("span", { className: "text-sm", children: "Weeks completed" }), _jsx(Button, { size: "sm", "aria-label": "One week fewer", disabled: t.latest_completed_week <= 0, onClick: () => updTerm.mutate({ latest_completed_week: t.latest_completed_week - 1 }, { onError: err }), children: _jsx(Minus, { className: "size-4", "aria-hidden": true }) }), _jsxs("span", { className: "text-lg font-semibold tabular w-16 text-center", children: [t.latest_completed_week, " / ", t.total_weeks] }), _jsx(Button, { size: "sm", "aria-label": "One more week completed", disabled: t.latest_completed_week >= t.total_weeks, onClick: () => updTerm.mutate({ latest_completed_week: t.latest_completed_week + 1 }, { onError: err }), children: _jsx(Plus, { className: "size-4", "aria-hidden": true }) })] }), t.calendar_status === 'active' ? (_jsxs("div", { className: "flex flex-wrap items-end gap-2", children: [_jsx(Field, { label: "Pause classes", htmlFor: "pause", hint: "For closures; everyone sees the reason.", className: "flex-1 min-w-48", children: _jsx(Input, { id: "pause", value: pause, onChange: (e) => setPause(e.target.value), placeholder: "Reason" }) }), _jsx(Button, { icon: _jsx(Pause, { className: "size-4", "aria-hidden": true }), disabled: !pause.trim(), onClick: () => updTerm.mutate({ calendar_status: 'paused', pause_reason: pause }, { onSuccess: () => setPause(''), onError: err }), children: "Pause" })] })) : _jsx(Button, { icon: _jsx(Play, { className: "size-4", "aria-hidden": true }), onClick: () => updTerm.mutate({ calendar_status: 'active', pause_reason: null }, { onError: err }), children: "Resume classes" })] })] }), _jsxs(Card, { className: "xl:col-span-2", children: [_jsx(CardHeader, { title: "Department dates", subtitle: "The term-finals date appears on everyone's calendar. The others are kept for the department office." }), _jsx("ul", { className: "divide-y divide-line sm:grid sm:grid-cols-2 sm:divide-y-0", children: KINDS.map(([k, l]) => (_jsxs("li", { className: "flex flex-wrap items-center justify-between gap-2 px-4 py-2 sm:border-b sm:border-line", children: [_jsx("label", { htmlFor: `m-${k}`, className: "text-sm", children: l }), _jsx(Input, { id: `m-${k}`, type: "date", className: "w-44 h-8", defaultValue: data.milestones.find((m) => m.kind === k && !m.offering_id)?.due_on ?? '', onBlur: (e) => {
                                        const prev = data.milestones.find((m) => m.kind === k && !m.offering_id)?.due_on ?? '';
                                        if (e.target.value !== prev)
                                            setMilestone.mutate({ kind: k, due_on: e.target.value }, { onSuccess: () => toast('ok', `${l}: saved`), onError: err });
                                    } })] }, k))) })] }), _jsx(Card, { className: "xl:col-span-2 border-bad/30", children: _jsxs("div", { className: "p-4 flex flex-wrap items-center justify-between gap-3", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-sm font-semibold", children: "Delete this term" }), _jsxs("p", { className: "text-sm text-muted mt-0.5", children: ["Removes ", t.name, " and everything in it: ", data.offerings.length, " course", data.offerings.length === 1 ? '' : 's', ", their sections, roles, exam workflow, plans, class-test dates and course outcomes. This cannot be undone."] })] }), _jsx(Button, { variant: "danger", icon: _jsx(Trash2, { className: "size-4", "aria-hidden": true }), onClick: () => { setTyped(''); setConfirmDelete(true); }, children: "Delete term" })] }) }), _jsxs(Dialog, { open: confirmDelete, onClose: () => setConfirmDelete(false), title: `Delete ${t.name}?`, footer: _jsxs(_Fragment, { children: [_jsx(Button, { onClick: () => setConfirmDelete(false), children: "Keep the term" }), _jsx(Button, { variant: "danger", disabled: typed.trim() !== t.code, loading: deleteTerm.isPending, onClick: () => deleteTerm.mutate(undefined, { onSuccess: () => { toast('ok', `${t.name} deleted`); setConfirmDelete(false); }, onError: err }), children: "Delete permanently" })] }), children: [_jsxs("p", { className: "text-sm text-muted", children: ["All ", data.offerings.length, " course", data.offerings.length === 1 ? '' : 's', " of this term and their workflow, plans, dates and outcomes will be deleted. The course catalog and faculty list are not affected.", t.is_current ? ' This is the current term; make another term current afterwards.' : ''] }), _jsx(Field, { label: _jsxs(_Fragment, { children: ["Type ", _jsx("span", { className: "font-mono font-semibold", children: t.code }), " to confirm"] }), htmlFor: "del-code", children: _jsx(Input, { id: "del-code", autoComplete: "off", value: typed, onChange: (e) => setTyped(e.target.value) }) })] })] }));
}
