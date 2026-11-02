import { clsx } from 'clsx';
import { Lock, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState, type ClipboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { Badge, Button, Callout, Card, CardHeader, Empty, ErrorNote, Field, Input, Select, Spinner, useToast } from '@/components/ui';
import { must, useCourseObe, useWrite } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import type { AssessmentItem, Mark, MarksStatus, Question } from '@/lib/types';
import { labelOf, MARKS_STATUS } from '@/lib/workflow';
import type { TabProps } from './shared';

type Cell = string; // raw text: number, "AB", "EX" or ""
const key = (q: string, s: string) => `${q}|${s}`;
const fromMark = (m?: Mark): Cell => (!m ? '' : m.flag ? m.flag : m.value === null ? '' : String(Number(m.value)));
function parse(c: Cell, max: number): { value: number | null; flag: 'AB' | 'EX' | null; error?: string } {
  const t = c.trim().toUpperCase();
  if (!t) return { value: null, flag: null };
  if (t === 'AB' || t === 'EX') return { value: null, flag: t };
  const n = Number(t);
  if (!Number.isFinite(n)) return { value: null, flag: null, error: 'Not a number' };
  if (n < 0) return { value: null, flag: null, error: 'Negative' };
  if (n > max) return { value: null, flag: null, error: `Over ${max}` };
  return { value: Math.round(n * 100) / 100, flag: null };
}

export default function MarksTab({ offering, data }: TabProps) {
  const [params, setParams] = useSearchParams();
  const items = data.items.filter((i) => i.offering_id === offering.id && i.status !== 'cancelled').sort((a, b) => a.component_id.localeCompare(b.component_id) || a.seq - b.seq);
  const itemId = params.get('item') ?? items.find((i) => i.status === 'held' && !['published', 'locked'].includes(i.marks_status))?.id ?? items[0]?.id;
  const obe = useCourseObe(offering.id, data.items.filter((i) => i.offering_id === offering.id).map((i) => i.id));
  const item = items.find((i) => i.id === itemId);
  const sec = (id: string | null) => data.sections.find((s) => s.id === id)?.name;

  if (!items.length) return <Card><Empty title="No assessment items yet">Create the assessment plan first; each item then gets a marks sheet here.</Empty></Card>;
  if (obe.isLoading) return <Spinner />;
  if (obe.error) return <ErrorNote error={obe.error} />;
  if (!obe.data?.canSeeMarks) return <Card><Empty icon={<Lock className="size-6" />} title="Marks are private to this course">
    Only the course teachers, its exam-role holders and department admins can see students and marks. If you teach this course, ask an admin to load the student list.</Empty></Card>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Assessment item" htmlFor="item-pick" className="w-full sm:w-80">
          <Select id="item-pick" value={itemId} onChange={(e) => setParams({ item: e.target.value })}>
            {items.map((i) => <option key={i.id} value={i.id}>{i.title}{i.section_id ? '' : ''} · {labelOf(MARKS_STATUS, i.marks_status)}</option>)}
          </Select>
        </Field>
        {item?.section_id && <Badge tone="brand">Section {sec(item.section_id)}</Badge>}
      </div>
      {item && <ItemSheet key={item.id} item={item} obe={obe.data} />}
    </div>
  );
}

function ItemSheet({ item, obe }: { item: AssessmentItem; obe: NonNullable<ReturnType<typeof useCourseObe>['data']> }) {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const locked = item.marks_status === 'locked' && !isAdmin;
  const questions = useMemo(() => obe.questions.filter((q) => q.item_id === item.id), [obe.questions, item.id]);
  const students = useMemo(() => {
    const ids = new Set(obe.enrolments.filter((e) => !item.section_id || e.section_id === item.section_id).map((e) => e.student_id));
    return obe.students.filter((s) => ids.has(s.id));
  }, [obe, item.section_id]);

  // ---------------- questions editor
  const [qs, setQs] = useState<(Partial<Question> & { tmp?: string })[]>(questions);
  useEffect(() => setQs(questions), [questions]);
  const qMax = qs.reduce((a, q) => a + Number(q.max_marks || 0), 0);
  const saveQs = useWrite(async () => {
    const keep = qs.filter((q) => q.id).map((q) => q.id!);
    const drop = questions.filter((q) => !keep.includes(q.id)).map((q) => q.id);
    if (drop.length) await must(supabase.from('assessment_questions').delete().in('id', drop));
    for (const [i, q] of qs.entries()) {
      const row = { item_id: item.id, label: q.label || `Q${i + 1}`, max_marks: Number(q.max_marks), co_id: q.co_id || null, sort: i + 1 };
      if (q.id) await must(supabase.from('assessment_questions').update(row).eq('id', q.id));
      else await must(supabase.from('assessment_questions').insert(row));
    }
  });
  const qErr = qs.some((q) => !(Number(q.max_marks) > 0)) ? 'Every question needs maximum marks above zero.'
    : qs.some((q) => !q.co_id) ? 'Tag every question with a course outcome so attainment can be computed.' : null;
  const qDirty = JSON.stringify(qs.map((q) => [q.id, q.label, Number(q.max_marks), q.co_id ?? null])) !== JSON.stringify(questions.map((q) => [q.id, q.label, Number(q.max_marks), q.co_id ?? null]));

  // ---------------- marks grid
  const initial = useMemo(() => {
    const m = new Map(obe.marks.map((x) => [key(x.question_id, x.student_id), x]));
    const g: Record<string, Cell> = {};
    for (const q of questions) for (const s of students) g[key(q.id, s.id)] = fromMark(m.get(key(q.id, s.id)));
    return g;
  }, [obe.marks, questions, students]);
  const [grid, setGrid] = useState(initial);
  useEffect(() => setGrid(initial), [initial]);
  const dirty = Object.keys(grid).filter((k) => grid[k] !== initial[k]);
  const errors = Object.entries(grid).filter(([k, v]) => parse(v, Number(questions.find((q) => q.id === k.split('|')[0])?.max_marks ?? 0)).error).length;

  const saveMarks = useWrite(async () => {
    const rows = dirty.map((k) => { const [qid, sid] = k.split('|'); const q = questions.find((x) => x.id === qid)!; const p = parse(grid[k], Number(q.max_marks));
      return { question_id: qid, student_id: sid, value: p.value, flag: p.flag }; });
    for (let i = 0; i < rows.length; i += 500) await must(supabase.from('marks').upsert(rows.slice(i, i + 500)));
    if (item.marks_status === 'none') await must(supabase.from('assessment_items').update({ marks_status: 'entering' }).eq('id', item.id));
  });
  const setStatus = useWrite((s: MarksStatus) => must(supabase.from('assessment_items').update({ marks_status: s }).eq('id', item.id)));

  const onPaste = (e: ClipboardEvent<HTMLInputElement>, row: number, col: number) => {
    const text = e.clipboardData.getData('text');
    if (!/[\t\n]/.test(text)) return;
    e.preventDefault();
    const lines = text.replace(/\r/g, '').split('\n').filter((l, i, a) => l !== '' || i < a.length - 1);
    setGrid((g) => {
      const n = { ...g };
      lines.forEach((line, r) => line.split('\t').forEach((v, c) => {
        const s = students[row + r], q = questions[col + c];
        if (s && q) n[key(q.id, s.id)] = v.trim();
      }));
      return n;
    });
    toast('ok', `Pasted ${lines.length} row${lines.length > 1 ? 's' : ''}. Review, then save.`);
  };
  const total = (sid: string) => Math.round(questions.reduce((a, q) => { const p = parse(grid[key(q.id, sid)] ?? '', Number(q.max_marks)); return a + (p.value ?? 0); }, 0) * 100) / 100;

  return (
    <>
      <Card>
        <CardHeader title="Questions and outcomes" subtitle={`Each question is tagged to one course outcome. Item total: ${Number(item.total_marks)} marks.`}
          actions={!locked && <Button size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => setQs((x) => [...x, { tmp: crypto.randomUUID(), label: `Q${x.length + 1}`, max_marks: 10, co_id: obe.cos[0]?.id }])}>Add question</Button>} />
        {obe.cos.length === 0 ? <div className="p-4"><Callout tone="warn">Define this course's outcomes first (Course outcomes tab), then tag questions to them.</Callout></div> : (
          <div className="p-4 space-y-2">
            {qs.length === 0 && <p className="text-sm text-muted">No questions yet. Add at least one, or one question for the whole item.</p>}
            {qs.map((q, i) => (
              <div key={q.id ?? q.tmp} className="flex flex-wrap items-end gap-2">
                <Field label={i === 0 ? 'Label' : <span className="sr-only">Label</span>} htmlFor={`ql-${i}`} className="w-24"><Input id={`ql-${i}`} disabled={locked} value={q.label ?? ''} onChange={(e) => setQs((x) => x.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} /></Field>
                <Field label={i === 0 ? 'Max marks' : <span className="sr-only">Max marks</span>} htmlFor={`qm-${i}`} className="w-28"><Input id={`qm-${i}`} type="number" min={0.5} step={0.5} disabled={locked} value={q.max_marks ?? ''} onChange={(e) => setQs((x) => x.map((y, j) => (j === i ? { ...y, max_marks: Number(e.target.value) } : y)))} /></Field>
                <Field label={i === 0 ? 'Course outcome' : <span className="sr-only">Course outcome</span>} htmlFor={`qc-${i}`} className="flex-1 min-w-56">
                  <Select id={`qc-${i}`} disabled={locked} value={q.co_id ?? ''} onChange={(e) => setQs((x) => x.map((y, j) => (j === i ? { ...y, co_id: e.target.value || null } : y)))}>
                    <option value="">Choose an outcome</option>{obe.cos.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.statement.slice(0, 70)}</option>)}</Select></Field>
                {!locked && <Button variant="ghost" aria-label={`Remove ${q.label}`} onClick={() => setQs((x) => x.filter((_, j) => j !== i))}><Trash2 className="size-4" aria-hidden /></Button>}
              </div>))}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <span className={clsx('text-2xs tabular', qMax === Number(item.total_marks) ? 'text-subtle' : 'text-warn font-semibold')}>Questions total {qMax} of {Number(item.total_marks)} marks</span>
              {qDirty && <div className="flex items-center gap-2">{qErr && <span className="text-2xs text-bad">{qErr}</span>}
                <Button size="sm" variant="primary" disabled={!!qErr} loading={saveQs.isPending} onClick={() => saveQs.mutate(undefined, { onSuccess: () => toast('ok', 'Questions saved'), onError: (e) => toast('bad', e.message) })}>Save questions</Button></div>}
            </div>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title={`Marks · ${students.length} students`} subtitle="Type a number, AB for absent or EX for exempt. Paste a block straight from Excel into any cell."
          actions={<div className="flex flex-wrap items-center gap-2">
            <label htmlFor="ms" className="text-2xs text-subtle">Status</label>
            <Select id="ms" className="h-8 w-36" value={item.marks_status} disabled={locked || dirty.length > 0 || setStatus.isPending}
              onChange={(e) => { const v = e.target.value as MarksStatus; if (v === 'locked' && !confirm('Lock these marks? Only an admin can reopen them.')) return;
                setStatus.mutate(v, { onSuccess: () => toast('ok', `Marks ${labelOf(MARKS_STATUS, v).toLowerCase()}`), onError: (er) => toast('bad', er.message) }); }}>
              {MARKS_STATUS.filter((s) => s.value !== 'none' || item.marks_status === 'none').map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select>
            <Button size="sm" variant="primary" icon={<Save className="size-4" aria-hidden />} disabled={!dirty.length || errors > 0 || locked} loading={saveMarks.isPending}
              onClick={() => saveMarks.mutate(undefined, { onSuccess: () => toast('ok', `${dirty.length} mark${dirty.length > 1 ? 's' : ''} saved`), onError: (e) => toast('bad', e.message) })}>
              Save{dirty.length ? ` ${dirty.length}` : ''}</Button>
          </div>} />
        {locked && <div className="px-4 pt-3"><Callout tone="info">These marks are locked. Ask an admin if a correction is needed.</Callout></div>}
        {errors > 0 && <div className="px-4 pt-3"><Callout tone="bad">{errors} cell{errors > 1 ? 's have' : ' has'} an invalid value. Fix the cells outlined in red before saving.</Callout></div>}
        {questions.length === 0 ? <Empty title="Add and save questions first" /> : students.length === 0 ? <Empty title="No students in this section">Load the student list on the Students tab.</Empty> : (
          <div className="overflow-x-auto max-h-[65vh]">
            <table className="table">
              <thead className="sticky top-0 z-10"><tr><th className="sticky left-0 bg-sunken z-20">Student</th>
                {questions.map((q) => <th key={q.id} className="text-right">{q.label}<span className="block normal-case font-normal">/{Number(q.max_marks)} · {obe.cos.find((c) => c.id === q.co_id)?.code ?? '—'}</span></th>)}
                <th className="text-right">Total</th></tr></thead>
              <tbody>{students.map((s, r) => (
                <tr key={s.id}>
                  <td className="sticky left-0 bg-surface"><div className="font-mono text-2xs">{s.student_no}</div><div className="text-2xs text-muted truncate max-w-40">{s.name}</div></td>
                  {questions.map((q, c) => {
                    const k = key(q.id, s.id); const v = grid[k] ?? ''; const p = parse(v, Number(q.max_marks));
                    return <td key={q.id} className="p-1">
                      <input aria-label={`${s.student_no} ${q.label}`} aria-invalid={!!p.error} title={p.error} disabled={locked} inputMode="decimal"
                        className={clsx('w-16 h-8 rounded border px-2 text-right text-sm tabular bg-surface focus:outline-none focus:ring-2 focus:ring-brand/30',
                          p.error ? 'border-bad bg-bad-soft' : v !== (initial[k] ?? '') ? 'border-info' : 'border-line', p.flag && 'text-subtle')}
                        value={v} onChange={(e) => setGrid((g) => ({ ...g, [k]: e.target.value }))} onPaste={(e) => onPaste(e, r, c)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { const next = document.querySelector<HTMLInputElement>(`input[aria-label="${students[r + 1]?.student_no} ${q.label}"]`); next?.focus(); } }} />
                    </td>;
                  })}
                  <td className="text-right tabular font-medium">{total(s.id)}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
