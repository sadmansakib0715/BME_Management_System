import { Copy, FileDown, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button, Callout, Card, CardHeader, Empty, Field, Input, Textarea, useToast } from '@/components/ui';
import { must, rpc, useWrite } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { coRows, save as saveFile } from './docData';
import type { ObeProps } from './shared';
import { useCourseInfo } from './useDocInputs';

const FILE_LABEL: Record<string, string> = { co_po_mapping: 'CO-PO mapping', outline: 'Course outline', assessment_workbook: 'CO-PO-assessment workbook' };
type Mark = { component: string; percent: string };
type Lec = { lectures: string; topic: string; cos: string };
type Contact = { name: string; room: string; email: string; phone: string };

/** Default "Assessment Strategy" wording of the department's outlines, by course type. */
function defaultStrategy(type: string): string {
  if (type === 'theory') return 'Class Participation: Class participation and attendance will be recorded in every class.\n'
    + 'Continuous Assessment: Continuous assessment through class tests, quizzes and assignments. The scheme will be declared on the first day of classes.\n'
    + 'Final Examination: A comprehensive term final examination will be held at the end of the term following the guideline of the Academic Council.';
  return 'Students are assessed continuously through the components listed under Distribution of Marks. Every component and rubric criterion is mapped to the course outcomes, and the rubrics are shared with the students in advance.';
}
function defaultMarks(type: string): Mark[] {
  return type === 'theory' ? [{ component: 'Class participation', percent: '10' }, { component: 'Continuous assessment', percent: '20' }, { component: 'Final examination', percent: '70' }] : [];
}

/** The course outline of this offering in the department's format: contents, objectives, assessment strategy, marks, textbooks and lecture plan.
    COs and their mapping come from “COs & mapping”. Download it as a PDF in the department's outline layout. */
export default function Outline({ offering, course, data, obe, canEdit, isAdmin }: ObeProps) {
  const toast = useToast();
  const info = useCourseInfo({ offering, course, data, obe });
  const teachersKey = JSON.stringify(info.teachers);
  const d = obe.docs;
  const from = useMemo(() => ({
    contents: d?.contents ?? '', objectives: d?.objectives ?? '', strategy: d?.assessment_strategy ?? '', textbooks: d?.textbooks ?? '',
    marks: (d?.marks_distribution ?? []).map((m) => ({ component: m.component, percent: String(m.percent) })) as Mark[],
    plan: (d?.lecture_plan ?? []) as Lec[],
    session: d?.academic_session ?? '', routine: d?.class_routine ?? '',
    contacts: (JSON.parse(teachersKey) as typeof info.teachers).map((t) => ({ name: t.name, room: t.room ?? '', email: t.email ?? '', phone: t.phone ?? '' })) as Contact[],
  }), [d, teachersKey]);
  const [v, setV] = useState(from);
  useEffect(() => setV(from), [from]);
  const dirty = JSON.stringify(v) !== JSON.stringify(from);
  const markTotal = v.marks.reduce((n, m) => n + (Number(m.percent) || 0), 0);
  const badMarks = v.marks.some((m) => !m.component.trim() || !(Number(m.percent) > 0));

  const save = useWrite(() => must(supabase.from('obe_offering_docs').upsert({
    offering_id: offering.id, contents: v.contents.trim() || null, objectives: v.objectives.trim() || null,
    assessment_strategy: v.strategy.trim() || null, textbooks: v.textbooks.trim() || null,
    marks_distribution: v.marks.map((m) => ({ component: m.component.trim(), percent: Number(m.percent) })),
    lecture_plan: v.plan.filter((r) => r.topic.trim() || r.lectures.trim()).map((r) => ({ lectures: r.lectures.trim(), topic: r.topic.trim(), cos: r.cos.trim() })),
    instructors: v.contacts.map((c) => ({ name: c.name, room: c.room.trim() || undefined, email: c.email.trim() || undefined, phone: c.phone.trim() || undefined })),
    academic_session: v.session.trim() || null, class_routine: v.routine.trim() || null,
    updated_at: new Date().toISOString() })).catch((e: Error) => {
      if (/academic_session|class_routine/.test(e.message)) throw new Error('The database needs the new outline fields: run supabase/update_obe_schema.sql in the Supabase SQL Editor once, then save again.');
      throw e;
    }));
  const fill = useWrite(() => rpc.copyForward(offering.id));
  const files = Object.entries(d?.source?.files ?? {});

  // The PDFs use what is on screen, including unsaved edits.
  const shown = { ...info, session: v.session, routine: v.routine, teachers: v.contacts.map((c) => ({ name: c.name, room: c.room, email: c.email, phone: c.phone })) };
  const marks = v.marks.filter((m) => m.component.trim()).map((m) => ({ component: m.component, percent: Number(m.percent) || 0 }));
  const unit = course.course_type === 'theory' ? 'Week' : 'Lecture';
  const download = async (kind: 'outline' | 'basic' | 'teachers') => {
    const pdf = await import('@/lib/pdf/obeDocs');
    if (kind === 'basic') return saveFile(pdf.basicInfoPdf({ course: shown, marks }), `${course.code} Basic information ${data.term.name}.pdf`);
    if (kind === 'teachers') return saveFile(pdf.instructorsPdf({ course: shown }), `${course.code} Instructors and schedule ${data.term.name}.pdf`);
    saveFile(pdf.outlinePdf({ course: shown, contents: v.contents, objectives: v.objectives, cos: coRows(obe), marks,
      textbooks: v.textbooks, lecturePlan: v.plan.filter((r) => r.topic.trim() || r.lectures.trim()), scheduleUnit: unit,
      preparedBy: shown.teachers.map((t) => t.name) }),
    `${course.code} Course Outline ${data.term.name}.pdf`);
  };
  const setContact = (i: number, p: Partial<Contact>) => setV((x) => ({ ...x, contacts: x.contacts.map((c, j) => (j === i ? { ...c, ...p } : c)) }));
  const setMark = (i: number, p: Partial<Mark>) => setV((x) => ({ ...x, marks: x.marks.map((m, j) => (j === i ? { ...m, ...p } : m)) }));
  const setLec = (i: number, p: Partial<Lec>) => setV((x) => ({ ...x, plan: x.plan.map((m, j) => (j === i ? { ...m, ...p } : m)) }));
  const missing = [!v.contents.trim() && 'course contents', !obe.cos.length && 'COs (under COs & mapping)', !v.marks.length && 'distribution of marks'].filter(Boolean) as string[];

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Course outline" subtitle="Everything the department's outline document holds. COs and their mapping are added from “COs & mapping”. Carried into the next offering of the course."
          actions={<>
            {canEdit && !d && obe.prev && <Button size="sm" icon={<Copy className="size-4" aria-hidden />} loading={fill.isPending}
              onClick={() => fill.mutate(undefined, { onSuccess: () => toast('ok', `Filled from ${obe.prev!.termName}`), onError: (e) => toast('bad', e.message) })}>Fill from {obe.prev.termName}</Button>}
            <Button size="sm" icon={<FileDown className="size-4" aria-hidden />} onClick={() => download('outline').catch((e) => toast('bad', e.message))}>Outline PDF</Button>
            <Button size="sm" variant="ghost" icon={<FileDown className="size-4" aria-hidden />} onClick={() => download('basic').catch((e) => toast('bad', e.message))}>Basic information</Button>
            <Button size="sm" variant="ghost" icon={<FileDown className="size-4" aria-hidden />} onClick={() => download('teachers').catch((e) => toast('bad', e.message))}>Instructors & schedule</Button>
            {canEdit && <Button size="sm" variant="primary" disabled={!dirty || badMarks} loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: () => toast('ok', 'Outline saved'), onError: (e) => toast('bad', e.message) })}>Save</Button>}</>} />
        <div className="p-4 grid gap-4 lg:grid-cols-2">
          <Field label="Course contents" htmlFor="o-contents" hint="As approved by the Academic Council."><Textarea id="o-contents" className="min-h-40" disabled={!canEdit} value={v.contents} onChange={(e) => setV({ ...v, contents: e.target.value })} /></Field>
          <Field label="Course objectives" htmlFor="o-objectives" hint="One per line."><Textarea id="o-objectives" className="min-h-40" disabled={!canEdit} value={v.objectives} onChange={(e) => setV({ ...v, objectives: e.target.value })} /></Field>
          <Field label="Assessment strategy" htmlFor="o-strategy" hint={<>For the course file; the department's outline template does not print it.{canEdit && !v.strategy.trim() && <> <button type="button" className="link" onClick={() => setV({ ...v, strategy: defaultStrategy(course.course_type) })}>Use the department wording</button></>}</>}>
            <Textarea id="o-strategy" className="min-h-32" disabled={!canEdit} value={v.strategy} onChange={(e) => setV({ ...v, strategy: e.target.value })} /></Field>
          <Field label="Textbooks and references" htmlFor="o-books" hint="One per line."><Textarea id="o-books" className="min-h-32" disabled={!canEdit} value={v.textbooks} onChange={(e) => setV({ ...v, textbooks: e.target.value })} /></Field>
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1fr_1.4fr]">
        <Card>
          <CardHeader title="Distribution of marks" subtitle={`Total ${Math.round(markTotal * 100) / 100}%`}
            actions={canEdit && <>
              {!v.marks.length && defaultMarks(course.course_type).length > 0 && <Button size="sm" variant="ghost" onClick={() => setV({ ...v, marks: defaultMarks(course.course_type) })}>Use 10 / 20 / 70</Button>}
              <Button size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => setV({ ...v, marks: [...v.marks, { component: '', percent: '' }] })}>Add</Button></>} />
          {!v.marks.length ? <p className="px-4 py-4 text-sm text-muted">No components yet.</p> : <table className="table">
            <thead><tr><th>Component</th><th className="w-28 text-right">Share (%)</th>{canEdit && <th className="w-10" />}</tr></thead>
            <tbody>{v.marks.map((m, i) => <tr key={i}>
              <td><label className="sr-only" htmlFor={`mk-c-${i}`}>Component</label><Input id={`mk-c-${i}`} className="h-8" disabled={!canEdit} value={m.component} onChange={(e) => setMark(i, { component: e.target.value })} /></td>
              <td><label className="sr-only" htmlFor={`mk-p-${i}`}>Share</label><Input id={`mk-p-${i}`} className="h-8 text-right tabular" inputMode="decimal" disabled={!canEdit} value={m.percent} onChange={(e) => setMark(i, { percent: e.target.value })} /></td>
              {canEdit && <td className="p-1"><Button variant="ghost" size="sm" aria-label={`Remove ${m.component || 'row'}`} onClick={() => setV({ ...v, marks: v.marks.filter((_, j) => j !== i) })}><Trash2 className="size-4" aria-hidden /></Button></td>}
            </tr>)}</tbody></table>}
          {v.marks.length > 0 && Math.abs(markTotal - 100) > 0.01 && <p className="px-4 pb-3 text-2xs text-warn">The shares add up to {Math.round(markTotal * 100) / 100}%, not 100%.</p>}
        </Card>
        <Card>
          <CardHeader title="Weekly schedule" subtitle={`${unit} numbers and topics. Leave the number empty for a row such as “Mid-term break”; COs, if given, print under the topic.`}
            actions={canEdit && <Button size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => setV({ ...v, plan: [...v.plan, { lectures: '', topic: '', cos: '' }] })}>Add row</Button>} />
          {!v.plan.length ? <p className="px-4 py-4 text-sm text-muted">No lecture plan yet.</p> : <div className="overflow-x-auto"><table className="table">
            <thead><tr><th className="w-24">{unit}</th><th>Topics</th><th className="w-28">CO(s)</th>{canEdit && <th className="w-10" />}</tr></thead>
            <tbody>{v.plan.map((r, i) => <tr key={i}>
              <td><label className="sr-only" htmlFor={`lp-l-${i}`}>Lectures</label><Input id={`lp-l-${i}`} className="h-8" placeholder="1" disabled={!canEdit} value={r.lectures} onChange={(e) => setLec(i, { lectures: e.target.value })} /></td>
              <td><label className="sr-only" htmlFor={`lp-t-${i}`}>Topics</label><Textarea id={`lp-t-${i}`} className="min-h-9" disabled={!canEdit} value={r.topic} onChange={(e) => setLec(i, { topic: e.target.value })} /></td>
              <td><label className="sr-only" htmlFor={`lp-c-${i}`}>COs</label><Input id={`lp-c-${i}`} className="h-8" placeholder="CO1, CO2" disabled={!canEdit} value={r.cos} onChange={(e) => setLec(i, { cos: e.target.value })} /></td>
              {canEdit && <td className="p-1"><Button variant="ghost" size="sm" aria-label={`Remove lecture row ${i + 1}`} onClick={() => setV({ ...v, plan: v.plan.filter((_, j) => j !== i) })}><Trash2 className="size-4" aria-hidden /></Button></td>}
            </tr>)}</tbody></table></div>}
        </Card>
      </div>

      {missing.length > 0 && <Callout tone="info">Before downloading the outline, add the {missing.join(', ')}.</Callout>}
      {dirty && <Callout tone="info">The PDF uses what is on screen; save to keep it.</Callout>}

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Course teachers, session and routine" subtitle="Printed in the outline header and the “Course Teacher(s)” table. Teachers are those assigned this term (Term setup); add their room, email and phone here." />
          <div className="p-4 grid gap-3 sm:grid-cols-2">
            <Field label="Academic session" htmlFor="o-session" hint="e.g. 2023-2024"><Input id="o-session" disabled={!canEdit} value={v.session} onChange={(e) => setV({ ...v, session: e.target.value })} /></Field>
            <Field label="Class routine" htmlFor="o-routine" hint="One slot per line, e.g. Sunday: 09:00 AM-09:50 AM"><Textarea id="o-routine" className="min-h-20" disabled={!canEdit} value={v.routine} onChange={(e) => setV({ ...v, routine: e.target.value })} /></Field>
          </div>
          {!v.contacts.length ? <p className="px-4 pb-4 text-sm text-muted">No teachers assigned yet.</p> : <div className="overflow-x-auto"><table className="table">
            <thead><tr><th>Name</th><th className="w-32">Office/Room</th><th>Email</th><th className="w-40">Telephone</th></tr></thead>
            <tbody>{v.contacts.map((c, i) => <tr key={c.name + i}>
              <td className="text-sm">{c.name}</td>
              <td><label className="sr-only" htmlFor={`tc-r-${i}`}>Room of {c.name}</label><Input id={`tc-r-${i}`} className="h-8" placeholder="ECE-1121" disabled={!canEdit} value={c.room} onChange={(e) => setContact(i, { room: e.target.value })} /></td>
              <td><label className="sr-only" htmlFor={`tc-e-${i}`}>Email of {c.name}</label><Input id={`tc-e-${i}`} className="h-8" type="email" disabled={!canEdit} value={c.email} onChange={(e) => setContact(i, { email: e.target.value })} /></td>
              <td><label className="sr-only" htmlFor={`tc-p-${i}`}>Telephone of {c.name}</label><Input id={`tc-p-${i}`} className="h-8" placeholder="+880 1…" disabled={!canEdit} value={c.phone} onChange={(e) => setContact(i, { phone: e.target.value })} /></td>
            </tr>)}</tbody></table></div>}
        </Card>
        <Card>
          <CardHeader title="In the department OBE folder" subtitle="BME BUET OBE Documents (SharePoint)." />
          {!d?.source?.folder && !files.length ? <p className="px-4 py-4 text-sm text-muted">Nothing recorded for this offering.</p> : (
            <dl className="divide-y divide-line">
              {d?.source?.folder && <div className="px-4 py-2 text-sm grid grid-cols-[140px_1fr] gap-2"><dt className="text-muted">Folder</dt><dd className="font-mono text-2xs break-all">{d.source.folder}</dd></div>}
              {files.map(([k, f]) => <div key={k} className="px-4 py-2 text-sm grid grid-cols-[140px_1fr] gap-2"><dt className="text-muted">{FILE_LABEL[k] ?? k}</dt><dd className="font-mono text-2xs break-all">{f}</dd></div>)}
            </dl>)}
        </Card>
      </div>

      {d && d.issues.length > 0 && isAdmin && <Callout tone="warn" title="Gaps found in the department folder"><ul className="list-disc pl-5">{d.issues.map((i) => <li key={i}>{i}</li>)}</ul></Callout>}

      {d?.outline_text ? <Card>
        <details><summary className="px-4 py-3 text-sm font-semibold cursor-pointer">Full text of the outline document from the folder</summary>
          <pre className="px-4 pb-4 text-2xs whitespace-pre-wrap font-sans text-muted">{d.outline_text}</pre></details>
      </Card> : !d && <Card><Empty title="No outline yet">{obe.prev ? `Fill it from ${obe.prev.termName}, or type it above.` : 'Type the contents and objectives above.'}</Empty></Card>}
    </div>
  );
}
