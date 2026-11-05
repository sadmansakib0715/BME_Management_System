import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useAuth } from '@/auth/AuthProvider';
import { Card, CardHeader, StatusSelect, useToast } from '@/components/ui';
import { must, useWrite } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useTerm } from '@/lib/TermContext';
import { CAR_STATUS, OUTLINE_STATUS } from '@/lib/workflow';
export default function Overview({ offering, course, data }) {
    const { me, isAdmin } = useAuth();
    const { teachersOf, nameOf } = useTerm();
    const toast = useToast();
    const canEdit = isAdmin || teachersOf(offering.id).includes(me?.facultyId ?? '');
    const rec = data.records.find((r) => r.offering_id === offering.id);
    const save = useWrite((patch) => must(supabase.from('course_records').update({ ...patch, updated_at: new Date().toISOString() }).eq('offering_id', offering.id)));
    const sections = data.sections.filter((s) => s.offering_id === offering.id).sort((a, b) => a.name.localeCompare(b.name));
    const StatusRow = ({ label, field, opts }) => (_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-2 px-4 py-2.5", children: [_jsx("label", { htmlFor: field, className: "text-sm", children: label }), _jsx(StatusSelect, { id: field, className: "w-56 h-8", disabled: !canEdit || !rec || save.isPending, opts: opts, value: rec?.[field] ?? 'not_started', onChange: (e) => save.mutate({ [field]: e.target.value }, { onSuccess: () => toast('ok', `${label} updated`), onError: (er) => toast('bad', er.message) }) })] }));
    return (_jsxs("div", { className: "grid gap-5 lg:grid-cols-2", children: [_jsxs(Card, { children: [_jsx(CardHeader, { title: "Course" }), _jsxs("dl", { className: "grid grid-cols-[140px_1fr] gap-y-2 px-4 py-3 text-sm", children: [_jsx("dt", { className: "text-muted", children: "Credits" }), _jsx("dd", { className: "tabular", children: course.credits ?? '—' }), _jsx("dt", { className: "text-muted", children: "Contact hours" }), _jsxs("dd", { className: "tabular", children: [course.contact_hours ?? '—', " per week"] }), _jsx("dt", { className: "text-muted", children: "Level-term" }), _jsxs("dd", { children: [course.level ? `Level ${course.level}${course.term_no ? `, Term ${course.term_no}` : ''}` : '—', course.elective_group && ` · Elective group ${course.elective_group}`] }), course.course_type === 'theory' || sections.length < 2
                                ? [_jsx("dt", { className: "text-muted", children: "Teachers" }, "tl"), _jsx("dd", { children: teachersOf(offering.id).map(nameOf).join(', ') || 'No teachers' }, "t")]
                                : sections.map((s) => [_jsxs("dt", { className: "text-muted", children: ["Sub-section ", s.name] }, s.id + 'l'), _jsx("dd", { children: teachersOf(offering.id, s.id).map(nameOf).join(', ') || 'No teachers' }, s.id)])] })] }), _jsxs(Card, { children: [_jsx(CardHeader, { title: "Course records", subtitle: canEdit ? 'Course teachers update these.' : 'Read only' }), _jsxs("div", { className: "divide-y divide-line", children: [_jsx(StatusRow, { label: "Course outline", field: "outline_status", opts: OUTLINE_STATUS }), _jsx(StatusRow, { label: "Course File / CAR", field: "car_status", opts: CAR_STATUS })] })] })] }));
}
