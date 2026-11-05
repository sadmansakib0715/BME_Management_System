import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { clsx } from 'clsx';
import { Check, Lock } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { Badge, Button, Callout, Card, CardHeader, Dialog, Empty, Field, Select, StatePill, StatusBadge, StatusSelect, Textarea, useToast } from '@/components/ui';
import { rpc, useWrite } from '@/lib/api';
import { fmtDateLong } from '@/lib/format';
import { useTerm } from '@/lib/TermContext';
import { blockers, EXAM_STEPS, labelOf, SG_PREP_STATUS, SG_SCRUTINY_STATUS, statusLabel, stepDef, stepOwner, stepState } from '@/lib/workflow';
export default function ExamTab(props) {
    return props.course.course_type === 'theory' ? _jsx(TheoryExam, { ...props }) : _jsx(SessionalGradesheet, { ...props });
}
function TheoryExam({ offering, data }) {
    const { me, isAdmin, isHod } = useAuth();
    const { nameOf } = useTerm();
    const toast = useToast();
    const a = data.exam.find((x) => x.offering_id === offering.id);
    const tasks = data.tasks.filter((t) => t.offering_id === offering.id);
    const rounds = data.rounds.filter((r) => r.offering_id === offering.id).sort((x, y) => y.returned_at.localeCompare(x.returned_at));
    const [draft, setDraft] = useState({});
    const [dlg, setDlg] = useState(null);
    const [half, setHalf] = useState('A');
    const [note, setNote] = useState('');
    const write = useWrite(rpc.setExamTask);
    if (!a)
        return _jsx(Card, { children: _jsx(Empty, { title: "Exam roles are not assigned yet", action: isAdmin ? _jsx(Link, { className: "link", to: "/admin/term/people", children: "Assign exam roles" }) : undefined, children: "An admin assigns the question preparers, moderators and scrutinizer; the rest of the chain is derived from them." }) });
    const submit = (step, status, extra) => write.mutate({ offering: offering.id, step, status, ...extra }, {
        onSuccess: () => { toast('ok', `${stepDef(step).label}: ${statusLabel(step, status)}`); setDraft((d) => ({ ...d, [step]: undefined })); setDlg(null); setNote(''); },
        onError: (e) => toast('bad', e.message),
    });
    const canAct = (step) => {
        const owner = stepOwner(a, step);
        if (step === 'printing')
            return isAdmin;
        if (step === 'hod')
            return owner === me?.facultyId || isHod || isAdmin;
        return owner === me?.facultyId || isAdmin;
    };
    const allowedStatuses = (step) => stepDef(step).statuses.filter((s) => !(step === 'hod' && s.value === 'received' && !isHod && !isAdmin));
    const roles = [
        ['Question preparer A', a.qp_a, 'Also examines Section A scripts and prepares the gradesheet'], ['Question preparer B', a.qp_b, 'Also examines Section B scripts'],
        ['Moderator 1', a.mod_1, ''], ['Moderator 2', a.mod_2, ''], ['Script scrutinizer', a.scrutinizer, 'Also scrutinizes the gradesheet'],
    ];
    return (_jsxs("div", { className: "grid gap-5 xl:grid-cols-[1fr_340px] [&>*]:min-w-0", children: [_jsxs(Card, { children: [_jsx(CardHeader, { title: "Term-final chain", subtitle: "Each step opens when the one before it is complete." }), _jsx("ol", { className: "divide-y divide-line", children: EXAM_STEPS.map((def, idx) => {
                            const t = tasks.find((x) => x.step === def.key);
                            const st = stepState(tasks, def.key);
                            const cur = t?.status ?? 'not_started';
                            const owner = stepOwner(a, def.key);
                            const mine = canAct(def.key);
                            const value = draft[def.key] ?? cur;
                            return (_jsxs("li", { className: clsx('px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2', st === 'locked' && 'bg-sunken/40'), children: [_jsx("span", { className: clsx('size-7 rounded-full grid place-items-center text-2xs font-semibold shrink-0 border', st === 'done' ? 'bg-ok text-ok-fg border-ok' : st === 'locked' ? 'border-line text-subtle' : 'border-brand text-brand-ink'), "aria-hidden": true, children: st === 'done' ? _jsx(Check, { className: "size-4" }) : st === 'locked' ? _jsx(Lock, { className: "size-3.5" }) : idx + 1 }), _jsxs("div", { className: "min-w-0 flex-1 basis-48", children: [_jsx("div", { className: "text-sm font-medium", children: def.label }), _jsxs("div", { className: "text-2xs text-subtle", children: [def.key === 'printing' ? 'Department office' : def.key === 'hod' && cur === 'forwarded' ? 'Awaiting HOD' : nameOf(owner), st === 'locked' && ` · waiting on ${blockers(tasks, def.key).map((k) => stepDef(k).short).join(', ')}`] })] }), st === 'locked' ? _jsx(StatePill, { state: "locked", children: statusLabel(def.key, cur) }) : _jsx(StatusBadge, { opts: def.statuses, done: def.done, value: cur }), mine && st !== 'locked' && (_jsxs("div", { className: "flex items-center gap-2 ml-auto", children: [_jsxs("label", { htmlFor: `st-${def.key}`, className: "sr-only", children: ["New status for ", def.label] }), _jsx(StatusSelect, { id: `st-${def.key}`, className: "h-8 w-44", opts: allowedStatuses(def.key), scale: def.statuses, done: def.done, value: value, onChange: (e) => setDraft((d) => ({ ...d, [def.key]: e.target.value })) }), _jsx(Button, { size: "sm", variant: "primary", disabled: value === cur, loading: write.isPending && write.variables?.step === def.key, onClick: () => (value === 'needs_correction' ? setDlg({ step: def.key, status: value, override: false }) : submit(def.key, value)), children: "Update" })] })), mine && st === 'locked' && isAdmin && (_jsx(Button, { size: "sm", variant: "ghost", className: "ml-auto", onClick: () => { setNote(''); setDlg({ step: def.key, status: stepDef(def.key).statuses[1].value, override: true }); }, children: "Override\u2026" }))] }, def.key));
                        }) })] }), _jsxs("div", { className: "space-y-5 min-w-0", children: [_jsxs(Card, { children: [_jsx(CardHeader, { title: "Exam roles", subtitle: isAdmin ? _jsx(Link, { className: "link", to: "/admin/term/people", children: "Change assignments" }) : 'Assigned by the department' }), _jsx("dl", { className: "divide-y divide-line", children: roles.map(([r, id, help]) => (_jsxs("div", { className: "px-4 py-2.5", children: [_jsx("dt", { className: "text-2xs text-subtle", children: r }), _jsx("dd", { className: "text-sm font-medium", children: nameOf(id) }), help && _jsx("dd", { className: "text-2xs text-subtle", children: help })] }, r))) })] }), _jsxs(Card, { children: [_jsx(CardHeader, { title: "Moderation rounds", subtitle: "Each return for correction is kept." }), rounds.length ? _jsx("ul", { className: "divide-y divide-line", children: rounds.map((r) => (_jsxs("li", { className: "px-4 py-2.5 text-sm", children: [_jsxs("div", { className: "flex items-center justify-between gap-2", children: [_jsxs("span", { children: ["Section ", r.half, " returned by ", nameOf(r.returned_by)] }), _jsx(Badge, { tone: r.resolved_at ? 'ok' : 'warn', children: r.resolved_at ? 'Resolved' : 'Open' })] }), _jsx("div", { className: "text-2xs text-subtle", children: fmtDateLong(r.returned_at.slice(0, 10)) }), r.comment && _jsxs("p", { className: "text-2xs text-muted mt-1", children: ["\u201C", r.comment, "\u201D"] })] }, r.id))) }) : _jsx("p", { className: "px-4 py-4 text-sm text-muted", children: "No returns so far." })] })] }), _jsx(Dialog, { open: !!dlg, onClose: () => setDlg(null), title: dlg && !dlg.override ? 'Return for correction' : 'Override a locked step', footer: _jsxs(_Fragment, { children: [_jsx(Button, { onClick: () => setDlg(null), children: "Cancel" }), _jsx(Button, { variant: "primary", loading: write.isPending, disabled: !note.trim(), onClick: () => dlg && submit(dlg.step, dlg.status, { note, half: !dlg.override ? half : undefined }), children: dlg && !dlg.override ? 'Return paper' : 'Override and update' })] }), children: dlg && !dlg.override ? _jsxs(_Fragment, { children: [_jsx(Field, { label: "Which half needs correction?", htmlFor: "half", children: _jsxs(Select, { id: "half", value: half, onChange: (e) => setHalf(e.target.value), children: [_jsxs("option", { value: "A", children: ["Section A \u00B7 ", nameOf(a.qp_a)] }), _jsxs("option", { value: "B", children: ["Section B \u00B7 ", nameOf(a.qp_b)] })] }) }), _jsx(Field, { label: "What needs to change?", htmlFor: "note", hint: "The preparer receives this by email.", children: _jsx(Textarea, { id: "note", value: note, onChange: (e) => setNote(e.target.value) }) })] }) : _jsxs(_Fragment, { children: [_jsx(Callout, { tone: "warn", children: "Earlier steps are not finished. Admin overrides are recorded with your note in the audit log." }), dlg && _jsx(Field, { label: `New status for ${stepDef(dlg.step).label}`, htmlFor: "ov-status", children: _jsx(Select, { id: "ov-status", value: dlg.status, onChange: (e) => setDlg({ ...dlg, status: e.target.value }), children: allowedStatuses(dlg.step).filter((x) => x.value !== 'not_started').map((x) => _jsx("option", { value: x.value, children: x.label }, x.value)) }) }), _jsx(Field, { label: "Reason for override", htmlFor: "note", children: _jsx(Textarea, { id: "note", value: note, onChange: (e) => setNote(e.target.value) }) })] }) })] }));
}
function SessionalGradesheet({ offering, data }) {
    const { isAdmin } = useAuth();
    const g = data.gradesheets.find((x) => x.offering_id === offering.id);
    if (!g)
        return _jsx(Card, { children: _jsx(Empty, { title: "Gradesheet roles are not assigned yet", action: isAdmin ? _jsx(Link, { className: "link", to: "/admin/term/people", children: "Assign roles" }) : undefined }) });
    return (_jsx("div", { className: "grid gap-5 lg:grid-cols-[1fr_320px]", children: _jsxs(Card, { children: [_jsx(CardHeader, { title: "Sessional gradesheet", subtitle: "Preparation, then scrutiny, then to the HOD." }), _jsxs("div", { className: "divide-y divide-line", children: [_jsx(GradesheetPart, { offering: offering.id, part: "prep", title: "Preparation", who: g.preparer, status: g.prep_status, opts: SG_PREP_STATUS, enabled: true }), _jsx(GradesheetPart, { offering: offering.id, part: "scrutiny", title: "Scrutiny", who: g.scrutinizer, status: g.scrutiny_status, opts: SG_SCRUTINY_STATUS, enabled: g.prep_status === 'forwarded' })] })] }) }));
}
function GradesheetPart({ offering, part, title, who, status, opts, enabled }) {
    const { me, isAdmin } = useAuth();
    const { nameOf } = useTerm();
    const toast = useToast();
    const write = useWrite(rpc.setGradesheet);
    const [v, setV] = useState(status);
    const mine = isAdmin || who === me?.facultyId;
    return (_jsxs("div", { className: "px-4 py-3 flex flex-wrap items-center gap-3", children: [_jsxs("div", { className: "flex-1 min-w-48", children: [_jsx("div", { className: "text-sm font-medium", children: title }), _jsx("div", { className: "text-2xs text-subtle", children: nameOf(who) })] }), !enabled && status === 'not_started' ? _jsx(StatePill, { state: "locked", children: labelOf(opts, status) }) : _jsx(StatusBadge, { opts: opts, value: status }), mine && (enabled || isAdmin) && _jsxs("div", { className: "flex gap-2", children: [_jsx("label", { className: "sr-only", htmlFor: `sg-${part}`, children: "New status" }), _jsx(StatusSelect, { id: `sg-${part}`, className: "h-8 w-52", opts: opts, value: v, onChange: (e) => setV(e.target.value) }), _jsx(Button, { size: "sm", variant: "primary", disabled: v === status, loading: write.isPending, onClick: () => write.mutate({ offering, part, status: v }, { onSuccess: () => toast('ok', `${title} updated`), onError: (e) => toast('bad', e.message) }), children: "Update" })] })] }));
}
