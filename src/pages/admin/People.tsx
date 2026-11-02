import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { Badge, Button, Card, CardHeader, Dialog, ErrorNote, Field, Input, PageHeader, Select, Spinner, useToast } from '@/components/ui';
import { must, useAllowedUsers, useWrite } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useTerm } from '@/lib/TermContext';
import type { AppRole, Faculty } from '@/lib/types';
import { useQueryClient } from '@tanstack/react-query';

type Draft = Partial<Faculty> & { role: AppRole | 'none' };

export default function People() {
  const { isAdmin, me } = useAuth();
  const { faculty } = useTerm();
  const allowed = useAllowedUsers(isAdmin);
  const toast = useToast();
  const qc = useQueryClient();
  const [d, setD] = useState<Draft | null>(null);
  const save = useWrite(async (x: Draft) => {
    const email = x.email?.trim().toLowerCase() || null;
    const row = { full_name: x.full_name!.trim(), display_name: x.display_name!.trim(), designation: x.designation || null, email, status: x.status ?? 'active' };
    const f = (x.id ? await must(supabase.from('faculty').update(row).eq('id', x.id).select().single()) : await must(supabase.from('faculty').insert(row).select().single())) as Faculty;
    const prev = allowed.data?.find((a) => a.faculty_id === f.id);
    if (prev && prev.email !== email) await must(supabase.from('allowed_users').delete().eq('email', prev.email));
    if (email) await must(supabase.from('allowed_users').upsert({ email, faculty_id: f.id, app_role: x.role === 'none' ? 'faculty' : x.role, active: x.role !== 'none' && x.status !== 'former' }));
  });
  if (allowed.isLoading) return <Spinner />;
  if (allowed.error) return <ErrorNote error={allowed.error} />;
  const access = (id: string) => allowed.data?.find((a) => a.faculty_id === id);

  return (
    <>
      <PageHeader eyebrow="Department" title="People and access" description="Faculty records and who may sign in. Only listed emails can create an account."
        actions={<Button variant="primary" icon={<Plus className="size-4" aria-hidden />} onClick={() => setD({ full_name: '', display_name: '', email: '', designation: 'Lecturer', status: 'active', role: 'faculty' })}>Add faculty</Button>} />
      <Card className="overflow-hidden">
        <CardHeader title={`${faculty.length} faculty`} />
        <div className="overflow-x-auto"><table className="table">
          <thead><tr><th>Name</th><th>Designation</th><th>Email</th><th>Status</th><th>Access</th><th><span className="sr-only">Edit</span></th></tr></thead>
          <tbody>{faculty.map((f) => { const a = access(f.id); return (
            <tr key={f.id}><td className="font-medium">{f.display_name}</td><td className="text-muted">{f.designation ?? '—'}</td><td className="text-muted">{f.email ?? <span className="text-warn">No email</span>}</td>
              <td><Badge tone={f.status === 'active' ? 'ok' : 'neutral'}>{{ active: 'Active', on_leave: 'On leave', former: 'Former' }[f.status]}</Badge></td>
              <td>{a?.active ? <Badge tone={a.app_role === 'faculty' ? 'neutral' : 'brand'}>{{ faculty: 'Faculty', admin: 'Admin', hod: 'HOD' }[a.app_role]}</Badge> : <Badge>No access</Badge>}</td>
              <td><Button size="sm" variant="ghost" aria-label={`Edit ${f.display_name}`} onClick={() => setD({ ...f, role: a?.active ? a.app_role : 'none' })}><Pencil className="size-4" aria-hidden /></Button></td>
            </tr>); })}</tbody>
        </table></div>
      </Card>
      <Dialog open={!!d} onClose={() => setD(null)} title={d?.id ? 'Edit faculty' : 'Add faculty'}
        footer={<><Button onClick={() => setD(null)}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!d?.full_name?.trim() || !d?.display_name?.trim() || (d.role !== 'none' && !d.email?.trim())}
          onClick={() => d && save.mutate(d, { onSuccess: () => { toast('ok', 'Saved'); setD(null); qc.invalidateQueries({ queryKey: ['faculty'] }); qc.invalidateQueries({ queryKey: ['allowed'] }); }, onError: (e) => toast('bad', e.message) })}>Save</Button></>}>
        {d && <div className="grid grid-cols-2 gap-3">
          <Field label="Full name" htmlFor="p-full" className="col-span-2"><Input id="p-full" value={d.full_name ?? ''} onChange={(e) => setD({ ...d, full_name: e.target.value })} /></Field>
          <Field label="Display name" htmlFor="p-disp" hint="As it appears in lists, e.g. Dr. A. Rahman" className="col-span-2"><Input id="p-disp" value={d.display_name ?? ''} onChange={(e) => setD({ ...d, display_name: e.target.value })} /></Field>
          <Field label="Designation" htmlFor="p-des"><Select id="p-des" value={d.designation ?? ''} onChange={(e) => setD({ ...d, designation: e.target.value })}>
            {['Lecturer', 'Assistant Professor', 'Associate Professor', 'Professor'].map((x) => <option key={x}>{x}</option>)}</Select></Field>
          <Field label="Status" htmlFor="p-st"><Select id="p-st" value={d.status} onChange={(e) => setD({ ...d, status: e.target.value as Faculty['status'] })}>
            <option value="active">Active</option><option value="on_leave">On leave</option><option value="former">Former</option></Select></Field>
          <Field label="Institutional email" htmlFor="p-em" className="col-span-2"><Input id="p-em" type="email" value={d.email ?? ''} onChange={(e) => setD({ ...d, email: e.target.value })} /></Field>
          <Field label="Access" htmlFor="p-role" className="col-span-2" hint={d.id === me?.facultyId ? 'You cannot remove your own admin access here.' : 'Admins manage terms, assignments and imports. HOD also confirms gradesheet receipt.'}>
            <Select id="p-role" value={d.role} disabled={d.id === me?.facultyId} onChange={(e) => setD({ ...d, role: e.target.value as Draft['role'] })}>
              <option value="none">No access</option><option value="faculty">Faculty</option><option value="admin">Admin</option><option value="hod">HOD</option></Select></Field>
        </div>}
      </Dialog>
    </>
  );
}
