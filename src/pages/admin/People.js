import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { Badge, Button, Card, CardHeader, Dialog, ErrorNote, Field, Input, PageHeader, Select, Spinner, useToast } from '@/components/ui';
import { must, useAllowedUsers, useWrite } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useTerm } from '@/lib/TermContext';
import { useQueryClient } from '@tanstack/react-query';
export default function People() {
    const { isAdmin, me } = useAuth();
    const { faculty } = useTerm();
    const allowed = useAllowedUsers(isAdmin);
    const toast = useToast();
    const qc = useQueryClient();
    const [d, setD] = useState(null);
    const save = useWrite(async (x) => {
        const email = x.email?.trim().toLowerCase() || null;
        const row = { full_name: x.full_name.trim(), display_name: x.display_name.trim(), designation: x.designation || null, email, status: x.status ?? 'active' };
        const f = (x.id ? await must(supabase.from('faculty').update(row).eq('id', x.id).select().single()) : await must(supabase.from('faculty').insert(row).select().single()));
        const prev = allowed.data?.find((a) => a.faculty_id === f.id);
        if (prev && prev.email !== email)
            await must(supabase.from('allowed_users').delete().eq('email', prev.email));
        if (email)
            await must(supabase.from('allowed_users').upsert({ email, faculty_id: f.id, app_role: x.role === 'none' ? 'faculty' : x.role, active: x.role !== 'none' && x.status !== 'former' }));
    });
    if (allowed.isLoading)
        return _jsx(Spinner, {});
    if (allowed.error)
        return _jsx(ErrorNote, { error: allowed.error });
    const access = (id) => allowed.data?.find((a) => a.faculty_id === id);
    return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { eyebrow: "Department", title: "People and access", description: "Faculty records and who may sign in. Only listed emails can create an account.", actions: _jsx(Button, { variant: "primary", icon: _jsx(Plus, { className: "size-4", "aria-hidden": true }), onClick: () => setD({ full_name: '', display_name: '', email: '', designation: 'Lecturer', status: 'active', role: 'faculty' }), children: "Add faculty" }) }), _jsxs(Card, { className: "overflow-hidden", children: [_jsx(CardHeader, { title: `${faculty.length} faculty` }), _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Name" }), _jsx("th", { children: "Designation" }), _jsx("th", { children: "Email" }), _jsx("th", { children: "Status" }), _jsx("th", { children: "Access" }), _jsx("th", { children: _jsx("span", { className: "sr-only", children: "Edit" }) })] }) }), _jsx("tbody", { children: faculty.map((f) => {
                                        const a = access(f.id);
                                        return (_jsxs("tr", { children: [_jsx("td", { className: "font-medium", children: f.display_name }), _jsx("td", { className: "text-muted", children: f.designation ?? '—' }), _jsx("td", { className: "text-muted", children: f.email ?? _jsx("span", { className: "text-warn", children: "No email" }) }), _jsx("td", { children: _jsx(Badge, { tone: f.status === 'active' ? 'ok' : 'neutral', children: { active: 'Active', on_leave: 'On leave', former: 'Former' }[f.status] }) }), _jsx("td", { children: a?.active ? _jsx(Badge, { tone: a.app_role === 'faculty' ? 'neutral' : 'brand', children: { faculty: 'Faculty', admin: 'Admin', hod: 'HOD' }[a.app_role] }) : _jsx(Badge, { children: "No access" }) }), _jsx("td", { children: _jsx(Button, { size: "sm", variant: "ghost", "aria-label": `Edit ${f.display_name}`, onClick: () => setD({ ...f, role: a?.active ? a.app_role : 'none' }), children: _jsx(Pencil, { className: "size-4", "aria-hidden": true }) }) })] }, f.id));
                                    }) })] }) })] }), _jsx(Dialog, { open: !!d, onClose: () => setD(null), title: d?.id ? 'Edit faculty' : 'Add faculty', footer: _jsxs(_Fragment, { children: [_jsx(Button, { onClick: () => setD(null), children: "Cancel" }), _jsx(Button, { variant: "primary", loading: save.isPending, disabled: !d?.full_name?.trim() || !d?.display_name?.trim() || (d.role !== 'none' && !d.email?.trim()), onClick: () => d && save.mutate(d, { onSuccess: () => { toast('ok', 'Saved'); setD(null); qc.invalidateQueries({ queryKey: ['faculty'] }); qc.invalidateQueries({ queryKey: ['allowed'] }); }, onError: (e) => toast('bad', e.message) }), children: "Save" })] }), children: d && _jsxs("div", { className: "grid grid-cols-2 gap-3", children: [_jsx(Field, { label: "Full name", htmlFor: "p-full", className: "col-span-2", children: _jsx(Input, { id: "p-full", value: d.full_name ?? '', onChange: (e) => setD({ ...d, full_name: e.target.value }) }) }), _jsx(Field, { label: "Display name", htmlFor: "p-disp", hint: "As it appears in lists, e.g. Dr. A. Rahman", className: "col-span-2", children: _jsx(Input, { id: "p-disp", value: d.display_name ?? '', onChange: (e) => setD({ ...d, display_name: e.target.value }) }) }), _jsx(Field, { label: "Designation", htmlFor: "p-des", children: _jsx(Select, { id: "p-des", value: d.designation ?? '', onChange: (e) => setD({ ...d, designation: e.target.value }), children: ['Lecturer', 'Assistant Professor', 'Associate Professor', 'Professor'].map((x) => _jsx("option", { children: x }, x)) }) }), _jsx(Field, { label: "Status", htmlFor: "p-st", children: _jsxs(Select, { id: "p-st", value: d.status, onChange: (e) => setD({ ...d, status: e.target.value }), children: [_jsx("option", { value: "active", children: "Active" }), _jsx("option", { value: "on_leave", children: "On leave" }), _jsx("option", { value: "former", children: "Former" })] }) }), _jsx(Field, { label: "Institutional email", htmlFor: "p-em", className: "col-span-2", children: _jsx(Input, { id: "p-em", type: "email", value: d.email ?? '', onChange: (e) => setD({ ...d, email: e.target.value }) }) }), _jsx(Field, { label: "Access", htmlFor: "p-role", className: "col-span-2", hint: d.id === me?.facultyId ? 'You cannot remove your own admin access here.' : 'Admins manage terms, assignments and imports. HOD also confirms gradesheet receipt.', children: _jsxs(Select, { id: "p-role", value: d.role, disabled: d.id === me?.facultyId, onChange: (e) => setD({ ...d, role: e.target.value }), children: [_jsx("option", { value: "none", children: "No access" }), _jsx("option", { value: "faculty", children: "Faculty" }), _jsx("option", { value: "admin", children: "Admin" }), _jsx("option", { value: "hod", children: "HOD" })] }) })] }) })] }));
}
