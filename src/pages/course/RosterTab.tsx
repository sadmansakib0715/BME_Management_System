import { Copy, Lock, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { Button, Callout, Card, CardHeader, Dialog, Empty, ErrorNote, Field, Select, Spinner, Textarea, useToast } from '@/components/ui';
import { must, rosterRpc, useCourseObe, useWrite } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useTerm } from '@/lib/TermContext';
import type { TabProps } from './shared';

/** Accepts "id,name,section" or tab-separated rows pasted from Excel; a header row is skipped. */
export function parseRoster(text: string) {
  return text.split(/\r?\n/).map((l) => l.split(/\t|,/).map((x) => x.trim())).filter((c) => c.length >= 2 && /^\d{7}$/.test(c[0]))
    .map(([student_no, name, section]) => ({ student_no, name, section: section || undefined }));
}

export default function RosterTab({ offering, data }: TabProps) {
  const { me, isAdmin } = useAuth();
  const { teachersOf, courseOf } = useTerm();
  const toast = useToast();
  const canEdit = isAdmin || teachersOf(offering.id).includes(me?.facultyId ?? '');
  const obe = useCourseObe(offering.id, []);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [from, setFrom] = useState('');
  const sections = data.sections.filter((s) => s.offering_id === offering.id);
  const rows = parseRoster(text);
  const enrol = useWrite(rosterRpc.enrol);
  const copy = useWrite(rosterRpc.copy);
  const remove = useWrite((sid: string) => must(supabase.from('enrolments').delete().eq('offering_id', offering.id).eq('student_id', sid)));
  const move = useWrite((a: { sid: string; sec: string }) => must(supabase.from('enrolments').update({ section_id: a.sec }).eq('offering_id', offering.id).eq('student_id', a.sid)));
  const siblings = data.offerings.filter((o) => o.id !== offering.id && o.batch && o.batch === offering.batch);

  if (obe.isLoading) return <Spinner />;
  if (obe.error) return <ErrorNote error={obe.error} />;
  const students = obe.data!.students;
  if (!students.length && !canEdit) return <Card><Empty icon={<Lock className="size-6" />} title="Student list is private to this course" /></Card>;
  const secOf = (sid: string) => obe.data!.enrolments.find((e) => e.student_id === sid)?.section_id ?? '';

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title={`Students · ${students.length}`} subtitle="No BIIS export is available, so lists are pasted from Excel once and copied between courses of the same cohort."
          actions={canEdit && <Button size="sm" variant="primary" icon={<Upload className="size-4" aria-hidden />} onClick={() => setOpen(true)}>Add students</Button>} />
        {canEdit && siblings.length > 0 && <div className="px-4 py-3 border-b border-line flex flex-wrap items-end gap-2">
          <Field label="Copy the list from another course of this cohort" htmlFor="copy-from" className="w-72">
            <Select id="copy-from" value={from} onChange={(e) => setFrom(e.target.value)}><option value="">Choose a course</option>{siblings.map((o) => <option key={o.id} value={o.id}>{courseOf(o)?.code}</option>)}</Select></Field>
          <Button icon={<Copy className="size-4" aria-hidden />} disabled={!from} loading={copy.isPending}
            onClick={() => copy.mutate({ from, to: offering.id }, { onSuccess: (n) => toast('ok', `${n} students added`), onError: (e) => toast('bad', e.message) })}>Copy list</Button>
        </div>}
        {students.length === 0 ? <Empty title="No students yet">Paste the class list, or copy it from another course of the same cohort.</Empty> : (
          <div className="overflow-x-auto max-h-[60vh]"><table className="table">
            <thead className="sticky top-0"><tr><th>Student ID</th><th>Name</th>{sections.length > 1 && <th>Sub-section</th>}{canEdit && <th className="w-12"><span className="sr-only">Remove</span></th>}</tr></thead>
            <tbody>{students.map((s) => (
              <tr key={s.id}><td className="font-mono">{s.student_no}</td><td>{s.name}</td>
                {sections.length > 1 && <td>
                  <label className="sr-only" htmlFor={`sec-${s.id}`}>Sub-section for {s.student_no}</label>
                  <Select id={`sec-${s.id}`} className="h-8 w-24" disabled={!canEdit} value={secOf(s.id)} onChange={(e) => move.mutate({ sid: s.id, sec: e.target.value }, { onError: (er) => toast('bad', er.message) })}>
                    {sections.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></td>}
                {canEdit && <td><Button size="sm" variant="ghost" aria-label={`Remove ${s.student_no}`}
                  onClick={() => confirm(`Remove ${s.student_no} from this course? Their marks stay in the system.`) && remove.mutate(s.id, { onError: (e) => toast('bad', e.message) })}><Trash2 className="size-4" aria-hidden /></Button></td>}
              </tr>))}</tbody>
          </table></div>
        )}
      </Card>
      <Dialog open={open} onClose={() => setOpen(false)} title="Add students" wide
        footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={!rows.length} loading={enrol.isPending}
          onClick={() => enrol.mutate({ offering: offering.id, rows }, { onSuccess: (r) => { toast(r.rejected.length ? 'bad' : 'ok', `${r.enrolled} enrolled, ${r.added} new${r.rejected.length ? `, ${r.rejected.length} rejected` : ''}`); setOpen(false); setText(''); }, onError: (e) => toast('bad', e.message) })}>
          Add {rows.length || ''} students</Button></>}>
        <Field label="Paste rows: student ID, name, sub-section" htmlFor="roster" hint={`Columns from Excel or comma-separated. Sub-section is optional (${sections.map((s) => s.name).join(', ')}).`}>
          <Textarea id="roster" className="min-h-48 font-mono text-2xs" value={text} onChange={(e) => setText(e.target.value)} placeholder={'2118001\tArif Hossain\tA1\n2118002\tBushra Karim\tA1'} />
        </Field>
        {text && <Callout tone={rows.length ? 'info' : 'warn'}>{rows.length ? `${rows.length} valid rows found.` : 'No valid rows yet. Each row needs a 7-digit student ID and a name.'}</Callout>}
      </Dialog>
    </div>
  );
}
