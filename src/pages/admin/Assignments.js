import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, CardHeader, Empty, ErrorNote, SegTabs, Select, Spinner, useToast } from '@/components/ui';
import { must, useWrite } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useTerm } from '@/lib/TermContext';
import { validateAssignment } from '@/lib/workflow';
export default function Assignments() {
    const { data, loading, error } = useTerm();
    const [tab, setTab] = useState('teachers');
    if (loading)
        return _jsx(Spinner, {});
    if (error)
        return _jsx(ErrorNote, { error: error });
    if (!data)
        return null;
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-3 mb-4", children: [_jsx("p", { className: "text-sm text-muted max-w-2xl", children: "Who teaches each section and who holds each exam role. Rule conflicts are flagged here and refused by the database." }), _jsx(SegTabs, { label: "Assignment type", value: tab, onChange: setTab, options: [{ value: 'teachers', label: 'Teachers' }, { value: 'exam', label: 'Exam roles' }, { value: 'gradesheets', label: 'Sessional gradesheets' }] })] }), tab === 'exam' && _jsx(ExamRoles, {}), tab === 'teachers' && _jsx(Teachers, {}), tab === 'gradesheets' && _jsx(Gradesheets, {})] }));
}
function PersonSelect({ id, value, onChange, label }) {
    const { faculty } = useTerm();
    return _jsxs(_Fragment, { children: [_jsx("label", { htmlFor: id, className: "sr-only", children: label }), _jsxs(Select, { id: id, className: "h-8 w-36 pl-2 text-[13px]", value: value ?? '', onChange: (e) => onChange(e.target.value || null), children: [_jsx("option", { value: "", children: "Unassigned" }), faculty.filter((f) => f.status !== 'former').map((f) => _jsx("option", { value: f.id, children: f.display_name }, f.id))] })] });
}
const ROLE_COLS = [['qp_a', 'QP A'], ['qp_b', 'QP B'], ['mod_1', 'Moderator 1'], ['mod_2', 'Moderator 2'], ['scrutinizer', 'Scrutinizer']];
function ExamRoles() {
    const { data, courseOf, nameOf, faculty } = useTerm();
    const toast = useToast();
    const [drafts, setDrafts] = useState({});
    const save = useWrite((a) => must(supabase.from('exam_assignments').upsert({ ...a, updated_at: new Date().toISOString() })));
    const theory = data.offerings.filter((o) => courseOf(o)?.course_type === 'theory').sort((a, b) => courseOf(a).code.localeCompare(courseOf(b).code));
    const current = (o) => drafts[o.id] ?? data.exam.find((x) => x.offering_id === o.id) ?? { offering_id: o.id, qp_a: null, qp_b: null, mod_1: null, mod_2: null, scrutinizer: null };
    const count = (id) => theory.reduce((n, o) => n + ROLE_COLS.filter(([k]) => current(o)[k] === id).length, 0);
    const busiest = faculty.map((f) => ({ f, n: count(f.id) })).filter((x) => x.n).sort((a, b) => b.n - a.n).slice(0, 6);
    if (!theory.length)
        return _jsx(Card, { children: _jsx(Empty, { title: "No theory courses this term" }) });
    return (_jsxs("div", { className: "space-y-4", children: [_jsx(Card, { className: "overflow-hidden", children: _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Course" }), ROLE_COLS.map(([, l]) => _jsx("th", { children: l }, l)), _jsx("th", { children: "Rules" }), _jsx("th", { children: _jsx("span", { className: "sr-only", children: "Save" }) })] }) }), _jsx("tbody", { children: theory.map((o) => {
                                    const a = current(o);
                                    const issues = validateAssignment(a, nameOf);
                                    const dirty = !!drafts[o.id];
                                    return (_jsxs("tr", { children: [_jsx("td", { className: "font-mono text-sm whitespace-nowrap", children: courseOf(o)?.code }), ROLE_COLS.map(([k, l]) => _jsx("td", { className: "p-1", children: _jsx(PersonSelect, { id: `${o.id}-${k}`, label: `${l} for ${courseOf(o)?.code}`, value: a[k], onChange: (v) => setDrafts((d) => ({ ...d, [o.id]: { ...a, [k]: v } })) }) }, k)), _jsx("td", { className: "max-w-48", children: issues.length ? _jsx("ul", { className: "space-y-0.5", children: issues.map((i) => _jsx("li", { className: `text-2xs ${i.level === 'error' ? 'text-bad' : 'text-warn'}`, children: i.message }, i.message)) }) : _jsx(Badge, { tone: "ok", children: "OK" }) }), _jsx("td", { children: _jsx(Button, { size: "sm", variant: "primary", disabled: !dirty || issues.some((i) => i.level === 'error'), loading: save.isPending && save.variables?.offering_id === o.id, onClick: () => save.mutate(a, { onSuccess: () => { toast('ok', `${courseOf(o)?.code} roles saved`); setDrafts((d) => { const n = { ...d }; delete n[o.id]; return n; }); }, onError: (e) => toast('bad', e.message) }), children: "Save" }) })] }, o.id));
                                }) })] }) }) }), busiest.length > 0 && _jsxs(Card, { children: [_jsx(CardHeader, { title: "Exam roles per person", subtitle: "Including unsaved changes." }), _jsx("div", { className: "flex flex-wrap gap-2 p-4", children: busiest.map(({ f, n }) => _jsxs(Badge, { tone: n >= 5 ? 'warn' : 'neutral', children: [f.display_name, ": ", n] }, f.id)) })] })] }));
}
function Teachers() {
    const { data, courseOf, nameOf } = useTerm();
    const toast = useToast();
    const [adding, setAdding] = useState({});
    const add = useWrite((a) => must(supabase.from('section_teachers').insert({ section_id: a.section, faculty_id: a.faculty, position: a.position })));
    const remove = useWrite((a) => must(supabase.from('section_teachers').delete().eq('section_id', a.section).eq('faculty_id', a.faculty)));
    const sections = data.sections.map((s) => ({ s, c: courseOf(s.offering_id) })).filter((x) => x.c).sort((a, b) => a.c.code.localeCompare(b.c.code) || a.s.name.localeCompare(b.s.name));
    return (_jsx(Card, { className: "overflow-hidden", children: _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Course" }), _jsx("th", { children: "Section" }), _jsx("th", { children: "Teachers (in order)" }), _jsx("th", { className: "min-w-72", children: "Add" })] }) }), _jsx("tbody", { children: sections.map(({ s, c }) => {
                            const list = data.teachers.filter((t) => t.section_id === s.id).sort((a, b) => a.position - b.position);
                            return (_jsxs("tr", { children: [_jsx("td", { className: "font-mono text-sm", children: c.code }), _jsx("td", { children: s.name }), _jsx("td", { children: _jsxs("div", { className: "flex flex-wrap gap-1.5", children: [list.map((t) => (_jsxs("span", { className: "inline-flex items-center gap-1 rounded border border-line bg-sunken pl-2 pr-0.5 py-0.5 text-2xs", children: [nameOf(t.faculty_id), _jsx("button", { className: "size-6 grid place-items-center rounded hover:bg-surface cursor-pointer", "aria-label": `Remove ${nameOf(t.faculty_id)} from ${c.code} ${s.name}`, onClick: () => remove.mutate({ section: s.id, faculty: t.faculty_id }, { onError: (e) => toast('bad', e.message) }), children: _jsx(X, { className: "size-3", "aria-hidden": true }) })] }, t.faculty_id))), !list.length && _jsx("span", { className: "text-2xs text-warn", children: "No teachers" })] }) }), _jsx("td", { children: _jsxs("div", { className: "flex gap-2", children: [_jsx(PersonSelect, { id: `add-${s.id}`, label: `Add teacher to ${c.code} ${s.name}`, value: adding[s.id] ?? null, onChange: (v) => setAdding((x) => ({ ...x, [s.id]: v ?? '' })) }), _jsx(Button, { size: "sm", icon: _jsx(Plus, { className: "size-4", "aria-hidden": true }), disabled: !adding[s.id] || list.some((t) => t.faculty_id === adding[s.id]), onClick: () => add.mutate({ section: s.id, faculty: adding[s.id], position: list.length + 1 }, { onSuccess: () => setAdding((x) => ({ ...x, [s.id]: '' })), onError: (e) => toast('bad', e.message) }), children: "Add" })] }) })] }, s.id));
                        }) })] }) }) }));
}
function Gradesheets() {
    const { data, courseOf } = useTerm();
    const toast = useToast();
    const [drafts, setDrafts] = useState({});
    const save = useWrite((a) => must(supabase.from('sessional_gradesheets').upsert(a)));
    const list = data.offerings.filter((o) => courseOf(o) && courseOf(o).course_type !== 'theory').sort((a, b) => courseOf(a).code.localeCompare(courseOf(b).code));
    if (!list.length)
        return _jsx(Card, { children: _jsx(Empty, { title: "No sessional courses this term" }) });
    return (_jsx(Card, { className: "overflow-hidden", children: _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Course" }), _jsx("th", { children: "Gradesheet preparer" }), _jsx("th", { children: "Gradesheet scrutinizer" }), _jsx("th", { children: _jsx("span", { className: "sr-only", children: "Save" }) })] }) }), _jsx("tbody", { children: list.map((o) => {
                            const g = drafts[o.id] ?? data.gradesheets.find((x) => x.offering_id === o.id) ?? { preparer: null, scrutinizer: null };
                            const same = !!g.preparer && g.preparer === g.scrutinizer;
                            return (_jsxs("tr", { children: [_jsx("td", { className: "font-mono text-sm", children: courseOf(o)?.code }), _jsx("td", { className: "p-1.5", children: _jsx(PersonSelect, { id: `p-${o.id}`, label: "Preparer", value: g.preparer, onChange: (v) => setDrafts((d) => ({ ...d, [o.id]: { ...g, preparer: v } })) }) }), _jsxs("td", { className: "p-1.5", children: [_jsx(PersonSelect, { id: `s-${o.id}`, label: "Scrutinizer", value: g.scrutinizer, onChange: (v) => setDrafts((d) => ({ ...d, [o.id]: { ...g, scrutinizer: v } })) }), same && _jsx("p", { className: "text-2xs text-bad mt-1", children: "Must differ from the preparer." })] }), _jsx("td", { children: _jsx(Button, { size: "sm", variant: "primary", disabled: !drafts[o.id] || same, loading: save.isPending, onClick: () => save.mutate({ offering_id: o.id, preparer: g.preparer, scrutinizer: g.scrutinizer }, { onSuccess: () => { toast('ok', 'Saved'); setDrafts((d) => { const n = { ...d }; delete n[o.id]; return n; }); }, onError: (e) => toast('bad', e.message) }), children: "Save" }) })] }, o.id));
                        }) })] }) }) }));
}
