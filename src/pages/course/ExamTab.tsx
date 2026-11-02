import { clsx } from 'clsx';
import { Check, Lock } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { Badge, Button, Callout, Card, CardHeader, Dialog, Empty, Field, Select, StatePill, Textarea, useToast } from '@/components/ui';
import { rpc, useWrite } from '@/lib/api';
import { fmtDateLong } from '@/lib/format';
import { useTerm } from '@/lib/TermContext';
import type { ExamStep } from '@/lib/types';
import { blockers, EXAM_STEPS, labelOf, SG_PREP_STATUS, SG_SCRUTINY_STATUS, statusLabel, stepDef, stepOwner, stepState } from '@/lib/workflow';
import type { TabProps } from './shared';

export default function ExamTab(props: TabProps) {
  return props.course.course_type === 'theory' ? <TheoryExam {...props} /> : <SessionalGradesheet {...props} />;
}

function TheoryExam({ offering, data }: TabProps) {
  const { me, isAdmin, isHod } = useAuth();
  const { nameOf } = useTerm();
  const toast = useToast();
  const a = data.exam.find((x) => x.offering_id === offering.id);
  const tasks = data.tasks.filter((t) => t.offering_id === offering.id);
  const rounds = data.rounds.filter((r) => r.offering_id === offering.id).sort((x, y) => y.returned_at.localeCompare(x.returned_at));
  const [draft, setDraft] = useState<Partial<Record<ExamStep, string>>>({});
  const [dlg, setDlg] = useState<{ step: ExamStep; status: string; override: boolean } | null>(null);
  const [half, setHalf] = useState<'A' | 'B'>('A');
  const [note, setNote] = useState('');
  const write = useWrite(rpc.setExamTask);

  if (!a) return <Card><Empty title="Exam roles are not assigned yet" action={isAdmin ? <Link className="link" to="/admin/assignments">Assign exam roles</Link> : undefined}>
    An admin assigns the question preparers, moderators and scrutinizer; the rest of the chain is derived from them.</Empty></Card>;

  const submit = (step: ExamStep, status: string, extra?: { note?: string; half?: 'A' | 'B' }) =>
    write.mutate({ offering: offering.id, step, status, ...extra }, {
      onSuccess: () => { toast('ok', `${stepDef(step).label}: ${statusLabel(step, status)}`); setDraft((d) => ({ ...d, [step]: undefined })); setDlg(null); setNote(''); },
      onError: (e) => toast('bad', e.message),
    });

  const canAct = (step: ExamStep) => {
    const owner = stepOwner(a, step);
    if (step === 'printing') return isAdmin;
    if (step === 'hod') return owner === me?.facultyId || isHod || isAdmin;
    return owner === me?.facultyId || isAdmin;
  };
  const allowedStatuses = (step: ExamStep) => stepDef(step).statuses.filter((s) => !(step === 'hod' && s.value === 'received' && !isHod && !isAdmin));

  const roles: [string, string | null, string][] = [
    ['Question preparer A', a.qp_a, 'Also examines Section A scripts and prepares the gradesheet'], ['Question preparer B', a.qp_b, 'Also examines Section B scripts'],
    ['Moderator 1', a.mod_1, ''], ['Moderator 2', a.mod_2, ''], ['Script scrutinizer', a.scrutinizer, 'Also scrutinizes the gradesheet'],
  ];

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_340px] [&>*]:min-w-0">
      <Card>
        <CardHeader title="Term-final chain" subtitle="Each step opens when the one before it is complete." />
        <ol className="divide-y divide-line">
          {EXAM_STEPS.map((def, idx) => {
            const t = tasks.find((x) => x.step === def.key);
            const st = stepState(tasks, def.key);
            const cur = t?.status ?? 'not_started';
            const owner = stepOwner(a, def.key);
            const mine = canAct(def.key);
            const value = draft[def.key] ?? cur;
            const returned = cur === 'under_correction' || cur === 'needs_correction';
            return (
              <li key={def.key} className={clsx('px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2', st === 'locked' && 'bg-sunken/40')}>
                <span className={clsx('size-7 rounded-full grid place-items-center text-2xs font-semibold shrink-0 border',
                  st === 'done' ? 'bg-ok text-ok-fg border-ok' : st === 'locked' ? 'border-line text-subtle' : 'border-brand text-brand-ink')} aria-hidden>
                  {st === 'done' ? <Check className="size-4" /> : st === 'locked' ? <Lock className="size-3.5" /> : idx + 1}
                </span>
                <div className="min-w-0 flex-1 basis-48">
                  <div className="text-sm font-medium">{def.label}</div>
                  <div className="text-2xs text-subtle">{def.key === 'printing' ? 'Department office' : def.key === 'hod' && cur === 'forwarded' ? 'Awaiting HOD' : nameOf(owner)}
                    {st === 'locked' && ` · waiting on ${blockers(tasks, def.key).map((k) => stepDef(k).short).join(', ')}`}</div>
                </div>
                <StatePill state={returned ? 'returned' : st}>{statusLabel(def.key, cur)}</StatePill>
                {mine && st !== 'locked' && (
                  <div className="flex items-center gap-2 ml-auto">
                    <label htmlFor={`st-${def.key}`} className="sr-only">New status for {def.label}</label>
                    <Select id={`st-${def.key}`} className="h-8 w-44" value={value} onChange={(e) => setDraft((d) => ({ ...d, [def.key]: e.target.value }))}>
                      {allowedStatuses(def.key).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </Select>
                    <Button size="sm" variant="primary" disabled={value === cur} loading={write.isPending && write.variables?.step === def.key}
                      onClick={() => (value === 'needs_correction' ? setDlg({ step: def.key, status: value, override: false }) : submit(def.key, value))}>Update</Button>
                  </div>
                )}
                {mine && st === 'locked' && isAdmin && (
                  <Button size="sm" variant="ghost" className="ml-auto" onClick={() => { setNote(''); setDlg({ step: def.key, status: stepDef(def.key).statuses[1].value, override: true }); }}>Override…</Button>
                )}
              </li>
            );
          })}
        </ol>
      </Card>
      <div className="space-y-5 min-w-0">
        <Card>
          <CardHeader title="Exam roles" subtitle={isAdmin ? <Link className="link" to="/admin/assignments">Change assignments</Link> : 'Assigned by the department'} />
          <dl className="divide-y divide-line">{roles.map(([r, id, help]) => (
            <div key={r} className="px-4 py-2.5"><dt className="text-2xs text-subtle">{r}</dt><dd className="text-sm font-medium">{nameOf(id)}</dd>{help && <dd className="text-2xs text-subtle">{help}</dd>}</div>))}
          </dl>
        </Card>
        <Card>
          <CardHeader title="Moderation rounds" subtitle="Each return for correction is kept." />
          {rounds.length ? <ul className="divide-y divide-line">{rounds.map((r) => (
            <li key={r.id} className="px-4 py-2.5 text-sm">
              <div className="flex items-center justify-between gap-2"><span>Section {r.half} returned by {nameOf(r.returned_by)}</span>
                <Badge tone={r.resolved_at ? 'ok' : 'warn'}>{r.resolved_at ? 'Resolved' : 'Open'}</Badge></div>
              <div className="text-2xs text-subtle">{fmtDateLong(r.returned_at.slice(0, 10))}</div>
              {r.comment && <p className="text-2xs text-muted mt-1">“{r.comment}”</p>}
            </li>))}</ul> : <p className="px-4 py-4 text-sm text-muted">No returns so far.</p>}
        </Card>
      </div>

      <Dialog open={!!dlg} onClose={() => setDlg(null)} title={dlg && !dlg.override ? 'Return for correction' : 'Override a locked step'}
        footer={<><Button onClick={() => setDlg(null)}>Cancel</Button>
          <Button variant="primary" loading={write.isPending} disabled={!note.trim()}
            onClick={() => dlg && submit(dlg.step, dlg.status, { note, half: !dlg.override ? half : undefined })}>
            {dlg && !dlg.override ? 'Return paper' : 'Override and update'}</Button></>}>
        {dlg && !dlg.override ? <>
          <Field label="Which half needs correction?" htmlFor="half"><Select id="half" value={half} onChange={(e) => setHalf(e.target.value as 'A' | 'B')}>
            <option value="A">Section A · {nameOf(a.qp_a)}</option><option value="B">Section B · {nameOf(a.qp_b)}</option></Select></Field>
          <Field label="What needs to change?" htmlFor="note" hint="The preparer receives this by email."><Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </> : <>
          <Callout tone="warn">Earlier steps are not finished. Admin overrides are recorded with your note in the audit log.</Callout>
          {dlg && <Field label={`New status for ${stepDef(dlg.step).label}`} htmlFor="ov-status">
            <Select id="ov-status" value={dlg.status} onChange={(e) => setDlg({ ...dlg, status: e.target.value })}>
              {allowedStatuses(dlg.step).filter((x) => x.value !== 'not_started').map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</Select></Field>}
          <Field label="Reason for override" htmlFor="note"><Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </>}
      </Dialog>
    </div>
  );
}

function SessionalGradesheet({ offering, data }: TabProps) {
  const { isAdmin } = useAuth();
  const g = data.gradesheets.find((x) => x.offering_id === offering.id);
  const items = data.items.filter((i) => i.offering_id === offering.id && i.status !== 'cancelled');
  const pending = items.filter((i) => !['published', 'locked'].includes(i.marks_status)).length;
  if (!g) return <Card><Empty title="Gradesheet roles are not assigned yet" action={isAdmin ? <Link className="link" to="/admin/assignments">Assign roles</Link> : undefined} /></Card>;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader title="Sessional gradesheet" subtitle="Preparation, then scrutiny, then to the HOD." />
        {pending > 0 && <div className="px-4 pt-3"><Callout tone="info">{pending} assessment item{pending > 1 ? 's' : ''} across all sub-sections still need published marks before preparation can start.</Callout></div>}
        <div className="divide-y divide-line">
          <GradesheetPart offering={offering.id} part="prep" title="Preparation" who={g.preparer} status={g.prep_status} opts={SG_PREP_STATUS} enabled={pending === 0} />
          <GradesheetPart offering={offering.id} part="scrutiny" title="Scrutiny" who={g.scrutinizer} status={g.scrutiny_status} opts={SG_SCRUTINY_STATUS} enabled={g.prep_status === 'forwarded'} />
        </div>
      </Card>
    </div>
  );
}

function GradesheetPart({ offering, part, title, who, status, opts, enabled }: { offering: string; part: 'prep' | 'scrutiny'; title: string; who: string | null; status: string; opts: typeof SG_PREP_STATUS; enabled: boolean }) {
  const { me, isAdmin } = useAuth();
  const { nameOf } = useTerm();
  const toast = useToast();
  const write = useWrite(rpc.setGradesheet);
  const [v, setV] = useState(status);
  const mine = isAdmin || who === me?.facultyId;
  return (
    <div className="px-4 py-3 flex flex-wrap items-center gap-3">
      <div className="flex-1 min-w-48"><div className="text-sm font-medium">{title}</div><div className="text-2xs text-subtle">{nameOf(who)}</div></div>
      <StatePill state={status === opts[opts.length - 1].value ? 'done' : !enabled ? 'locked' : status === 'not_started' ? 'ready' : 'active'}>{labelOf(opts, status)}</StatePill>
      {mine && (enabled || isAdmin) && <div className="flex gap-2">
        <label className="sr-only" htmlFor={`sg-${part}`}>New status</label>
        <Select id={`sg-${part}`} className="h-8 w-52" value={v} onChange={(e) => setV(e.target.value)}>{opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
        <Button size="sm" variant="primary" disabled={v === status} loading={write.isPending}
          onClick={() => write.mutate({ offering, part, status: v }, { onSuccess: () => toast('ok', `${title} updated`), onError: (e) => toast('bad', e.message) })}>Update</Button>
      </div>}
    </div>
  );
}
