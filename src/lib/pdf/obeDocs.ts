// The department's OBE documents as PDF, each laid out like its Word template in Templates/:
//   Course Outline (BME 211_Course outline.pdf / BME 210_Course outline.docx), CO-PO Mapping (CO-PO Mapping.docx),
//   Course Assessment Report (CAR.pdf / CAR.docx), Basic information, Instructors and schedule, the Question Moderation Form,
//   and the teacher-made rubrics.
// Inputs are plain data so the same functions run in the browser and in tests.
import type { jsPDF } from 'jspdf';
import type { CellHookData, RowInput } from 'jspdf-autotable';
import { KPA } from '../obe';
import { byNum, clean, Doc, linesOf, pct, TICK } from './base';

export interface Teacher { name: string; room?: string | null; email?: string | null; phone?: string | null }
export interface CourseInfo { code: string; title: string; creditHours?: string | number | null; contactHours?: string | number | null;
  /** "2/2" (level/term), as the templates write it. */
  levelTerm?: string | null; session?: string | null; term: string; teachers: Teacher[];
  /** Class routine, one slot per line ("Sunday: 09:00 AM-09:50 AM"). */
  routine?: string | null }
export interface CoRow { code: string; statement: string; pos: string[]; domains: string[]; delivery: string[]; tools: string[]; kpa: string[] }
export interface PoRef { code: string; title: string }
export interface LecturePlanRow { lectures: string; topic: string; cos: string }

const KPA_CODES = KPA.flatMap((g) => g.items.map(([k]) => k));
const join = (xs: string[]) => xs.filter(Boolean).join(', ');
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const dash = (code: string) => code.replace(/^(CO|PO)(\d)/, '$1-$2'); // PO5 → PO-5, as in the mapping template

// ---------------------------------------------------------------- shared blocks
/** "Course Teacher(s)" table: Name | Office/Room | Email (& Telephone) | Class routine, the routine in one cell spanning all rows. */
function teacherTable(d: Doc, c: CourseInfo) {
  const ts = c.teachers.length ? c.teachers : [{ name: '' }];
  const phone = ts.some((t) => t.phone);
  const routine = linesOf(c.routine).join('\n');
  const w = d.inner;
  d.table([['Name', 'Office/Room', phone ? 'Email & Telephone' : 'Email', 'Class routine']],
    ts.map((t, i) => [t.name, t.room ?? '', [t.email, t.phone].filter(Boolean).join('\n'),
      ...(i === 0 ? [{ content: routine, rowSpan: ts.length, styles: { halign: 'center' as const } }] : [])]),
    { headStyles: { halign: 'left', fontSize: 11, font: 'helvetica' }, styles: { font: 'times', fontSize: 10.5, cellPadding: 1.6 },
      columnStyles: { 0: { cellWidth: w * 0.29 }, 1: { cellWidth: w * 0.18 }, 2: { cellWidth: w * 0.32, halign: 'center' }, 3: { cellWidth: w * 0.21 } } });
}

/** The CO table of CO-PO Mapping.docx. */
function coTable(d: Doc, cos: CoRow[]) {
  d.table([['CO No.', 'CO Statement', 'Corresponding PO(s)*', 'Domains and Taxonomy level(s)**', 'Delivery Method(s) and Activity(-ies)', 'Assessment Tool(s)']],
    cos.map((c) => [c.code.replace('CO', ''), c.statement, join([...c.pos].sort(byNum).map(dash)), join(c.domains), join(c.delivery), join(c.tools)]),
    { headStyles: { fontSize: 9.5 }, styles: { fontSize: 9.5 },
      columnStyles: { 0: { halign: 'center', cellWidth: 12 }, 1: { cellWidth: 44 }, 2: { halign: 'center', cellWidth: 28 }, 3: { halign: 'center', cellWidth: 25 }, 4: { cellWidth: 30 } } });
}

function kpaTable(d: Doc, cos: CoRow[]) {
  d.para('Mapping of Knowledge Profile, Complex Engineering Problem Solving and Complex Engineering Activities:', { style: 'bold', justify: false });
  const first = 14, rest = (d.inner - first) / KPA_CODES.length;
  d.table([
    [{ content: '', rowSpan: 2 }, ...KPA.map((g) => ({ content: g.group === 'Knowledge profile' ? 'Knowledge Profile' : g.group === 'Complex problem' ? 'Complex Engineering Problem' : 'Complex Engineering Activities', colSpan: g.items.length }))],
    KPA_CODES,
  ], cos.map((c) => [dash(c.code), ...KPA_CODES.map((k) => (c.kpa.includes(k) ? TICK : ''))]),
  { styles: { fontSize: 8.5, halign: 'center', cellPadding: 1 }, headStyles: { fontSize: 8.5 },
    columnStyles: Object.fromEntries([[0, { cellWidth: first }], ...KPA_CODES.map((_, i) => [i + 1, { cellWidth: rest }])]) });
}

function footnotes(d: Doc, pos: PoRef[]) {
  d.para(`* ${pos.map((p) => `${p.code}: ${p.title}`).join('; ')}.`, { size: 8.5, justify: false, spacing: 1.3 });
  d.para('** C = Cognitive (C1 Remember, C2 Understand, C3 Apply, C4 Analyze, C5 Evaluate, C6 Create); PS = Psychomotor (PS1-PS7); AF = Affective (AF1-AF5). '
    + 'K1-K8: knowledge profile; P1-P7: range of complex engineering problem solving; A1-A5: range of complex engineering activities (BAETE).', { size: 8.5, justify: false, spacing: 1.3 });
}

/** A Teachers' comment / Major issues block: the text as typed, or split into the template's numbered items when it uses their labels. */
function labelled(text: string, labels: string[]): string[] | null {
  const re = (l: string) => new RegExp(l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "['’]?").replace(/[\s-]+/g, '[\\s-]+') + '\\s*:', 'i');
  const hits = labels.map((l) => { const m = re(l).exec(text); return m ? { at: m.index, end: m.index + m[0].length } : null; });
  if (hits.every((h) => !h)) return null;
  const starts = hits.map((h) => h?.at ?? Infinity);
  return labels.map((l, i) => {
    const h = hits[i];
    if (!h) return `${l}: N/A`;
    const next = Math.min(...starts.filter((s) => s > h.at), text.length);
    return `${l}: ${text.slice(h.end, next).trim() || 'N/A'}`;
  });
}

// ---------------------------------------------------------------- course outline
export interface OutlineData {
  course: CourseInfo; contents: string; objectives: string; cos: CoRow[];
  marks: { component: string; percent: number }[]; textbooks: string; lecturePlan: LecturePlanRow[];
  /** First column of the weekly schedule: "Week" (theory outlines) or "Lecture" (sessional outlines). */
  scheduleUnit?: string; preparedBy: string[];
}
export function outlinePdf(a: OutlineData): jsPDF {
  const d = new Doc(), c = a.course;
  d.letterhead('Course Outline');
  d.fields([['Course No:', c.code], ['Course Title:', c.title], ['Credit hours:', str(c.creditHours), 'Contact hours:', str(c.contactHours)],
    ['Level/Term:', c.levelTerm ?? ''], ['Academic Session:', c.session ?? '']]);
  d.heading('Course Teacher(s):');
  teacherTable(d, c);
  if (a.contents.trim()) { d.heading('Course Contents:'); d.para(a.contents); d.gap(3); }
  if (a.objectives.trim()) { d.heading('Course Objectives:'); d.list(linesOf(a.objectives), { justify: true }); d.gap(2); }
  if (a.cos.length) { d.heading('Course Outcomes:'); d.list(a.cos.map((x) => x.statement), { numbered: true, spacing: 1.6 }); d.gap(2); }
  if (a.marks.length) {
    d.heading('Assessment:');
    d.tabbed(a.marks.map((m) => [m.component.trim().replace(/:?$/, ':'), `${m.percent}%`]));
  }
  if (a.textbooks.trim()) { d.heading('Textbooks and References:'); d.list(linesOf(a.textbooks), { numbered: true }); d.gap(3); }
  if (a.lecturePlan.length) {
    d.heading('Weekly Schedule:');
    d.table([[a.scheduleUnit ?? 'Week', 'Topics']], a.lecturePlan.map((r): RowInput => (!r.lectures.trim()
      ? [{ content: r.topic, colSpan: 2, styles: { halign: 'center', fillColor: [217, 217, 217] } }]  // "Mid-term break"
      : [r.lectures, r.cos.trim() ? `${r.topic}\n(${r.cos.trim()})` : r.topic])),
    { headStyles: { fontSize: 11 }, styles: { fontSize: 10.5 }, columnStyles: { 0: { cellWidth: 16, halign: 'center' } } });
  }
  d.gap(4);
  const names = a.preparedBy.length ? a.preparedBy : [''];
  d.table([], [[{ content: 'Prepared by:', styles: { fontStyle: 'bold' } }, ''], ...names.map((n) => ['Name:\n\nSignature:\n\nDate:', n])],
    { styles: { fontSize: 11, valign: 'top', cellPadding: 1.6 }, columnStyles: { 0: { cellWidth: d.inner * 0.27 } } });
  return d.finish();
}

// ---------------------------------------------------------------- course-file pieces: basic information, instructors and schedule
/** Basic information.docx: the course's identity and its assessment shares. */
export function basicInfoPdf(a: { course: CourseInfo; marks: { component: string; percent: number }[] }): jsPDF {
  const d = new Doc(), c = a.course;
  d.fields([['Course No:', c.code], ['Course Title:', c.title], ['Credit hours:', str(c.creditHours)], ['Contact hours:', str(c.contactHours)], ['Level/Term:', c.levelTerm ?? '']]);
  if (a.marks.length) { d.heading('Assessment:'); d.tabbed(a.marks.map((m) => [m.component.trim().replace(/:?$/, ':'), `${m.percent}%`]), { indent: 0 }); }
  return d.finish({ pageNumbers: false });
}

/** Instructors and schedule.docx: the teachers' table with the class routine. */
export function instructorsPdf(a: { course: CourseInfo }): jsPDF {
  const d = new Doc();
  d.heading('Course Teacher(s):');
  teacherTable(d, a.course);
  return d.finish({ pageNumbers: false });
}

// ---------------------------------------------------------------- CO-PO mapping
export function mappingPdf(a: { course: CourseInfo; cos: CoRow[]; pos: PoRef[]; approval?: string | null }): jsPDF {
  const d = new Doc(), c = a.course;
  d.letterhead('CO-PO Mapping');
  d.fields([['Course No:', c.code], ['Course Title:', c.title], ['Level/Term:', c.levelTerm ?? ''], ['Academic Term:', c.term]]);
  d.heading('Course Outcomes:');
  coTable(d, a.cos);
  kpaTable(d, a.cos);
  if (a.approval) d.para(`Approved: ${a.approval}`, { size: 10, justify: false });
  footnotes(d, a.pos);
  return d.finish();
}

// ---------------------------------------------------------------- rubric
export interface RubricPdf { title: string; assessment?: string | null; levels: string[];
  criteria: { name: string; max: number; cos: string[]; levels: { label: string; min: number | null; max: number | null; text: string }[] }[]; note?: string }
export function rubricPdf(a: { course: CourseInfo; rubric: RubricPdf }): jsPDF {
  const d = new Doc({ orientation: 'landscape', margin: 20 }), r = a.rubric;
  const total = r.criteria.reduce((n, c) => n + (Number(c.max) || 0), 0);
  d.title([`Rubric: ${r.title || 'Untitled'}`], 14);
  d.y -= 2;
  d.para(`${a.course.code}: ${a.course.title}  ·  ${a.course.term}${r.assessment ? `  ·  ${r.assessment}` : ''}  ·  Total ${total} marks`, { size: 10.5, justify: false });
  d.para('Department of Biomedical Engineering, BUET', { size: 10.5, justify: false });
  const band = (l: { min: number | null; max: number | null; text: string }) => (l.min !== null && l.max !== null ? `[${l.min === l.max ? l.max : `${l.min} - ${l.max}`}] ${l.text}` : l.text);
  d.table([['Criterion & CO Mapping', 'Max Score', ...r.levels]],
    r.criteria.map((c, i) => [`${i + 1}. ${c.name}${c.cos.length ? ` (${[...c.cos].sort(byNum).join(', ')})` : ''}`, String(c.max), ...r.levels.map((_, k) => band(c.levels[k] ?? { min: null, max: null, text: '' }))]),
    { styles: { fontSize: 9, valign: 'top' }, headStyles: { fontSize: 9.5 }, columnStyles: { 0: { cellWidth: 48, fontStyle: 'bold' }, 1: { cellWidth: 17, halign: 'center' } } });
  if (r.note?.trim()) d.para(`Note: ${r.note}`, { size: 10, justify: false });
  return d.finish();
}

// ---------------------------------------------------------------- course assessment report
export interface CarBlock { term: string; co: Record<string, { value: number | null; yn: 'Y' | 'N' | 'NA' }>; po: Record<string, { value: number | null; yn: 'Y' | 'N' | 'NA' }> }
export interface CarData { course: CourseInfo; section?: string | null; textbooks: string; lastTerm: string | null;
  current: CarBlock; previous: CarBlock | null; partC: string; partD: string; partE: string }
export const CAR_C = ["Teachers' comment on attainment", 'Interpretation of student feedback', "Teachers' comment on teaching learning"];
export const CAR_E = ['Major issues', 'Plan for future actions for further improvement'];

/** Part B table of CAR.pdf: shaded CO1–CO12 header, values, Y/N; then the same for PO1–PO12. */
function attainmentTable(d: Doc, b: CarBlock) {
  const codes = (p: string) => Array.from({ length: 12 }, (_, i) => `${p}${i + 1}`);
  const rows = (['CO', 'PO'] as const).flatMap((k) => {
    const map = k === 'CO' ? b.co : b.po, cs = codes(k);
    return [cs, cs.map((c) => (map[c] && map[c].yn !== 'NA' ? pct(map[c].value) : 'NA')), cs.map((c) => map[c]?.yn ?? 'NA')];
  });
  d.table([], rows, { theme: 'plain', styles: { fontSize: 9.5, halign: 'center', cellPadding: 1.1, lineWidth: 0 },
    didParseCell: (h: CellHookData) => { if (h.row.index % 3 === 0) { h.cell.styles.fontStyle = 'bold'; h.cell.styles.fillColor = [217, 226, 243]; } } });
}

/** Numbered items of Part C / Part E, a blank line apart as in the template. */
function partItems(d: Doc, text: string, labels: string[]) {
  const items = labelled(text, labels);
  if (items) d.list(items, { numbered: true, size: 11, indent: 6, spacing: 1.4, itemGap: 4 });
  else d.para(text.trim() || 'N/A', { justify: false });
}

export function carPdf(a: CarData): jsPDF {
  const d = new Doc({ header: { height: 6, draw: (x) => { x.y = 14; x.title(['Course Assessment Report', 'Department of BME, BUET'], 13); } } });
  const c = a.course;
  d.heading('Part A. Course Information', 10.5);
  const books = linesOf(a.textbooks).map((b, i) => `${i + 1}. ${b.replace(/^\d+[.)]\s*/, '')}`).join('\n');
  d.table([], [
    ['1.   Course Number:', c.code], ['2.   Course Title:', c.title], ['3.   Level, Term and Section', [c.levelTerm, a.section].filter(Boolean).join(', ')],
    ['4.   Academic Term', c.term], ['5.   Textbooks used:', books], ['6.   Last term when the course was offered', a.lastTerm ?? 'N/A'],
  ], { styles: { fontSize: 10.5, cellPadding: { top: 0.6, bottom: 0.6, left: 1.6, right: 1.6 }, valign: 'top' },
    columnStyles: { 0: { cellWidth: d.inner / 2, cellPadding: { top: 0.6, bottom: 0.6, left: 8, right: 1.6 } } } });
  d.gap(3);
  d.heading('Part B. Attainment for current and previous terms', 10.5);
  d.para(a.current.term, { style: 'italic', size: 10.5, justify: false });
  attainmentTable(d, a.current);
  d.gap(2);
  d.para(a.previous ? `Previous term: ${a.previous.term}` : 'Previous term:', { style: 'italic', size: 10.5, justify: false });
  if (a.previous) attainmentTable(d, a.previous); else d.para('Not available', { size: 10.5 });
  d.gap(4);
  d.heading('Part C. Analysis', 10.5);
  partItems(d, a.partC, CAR_C);
  d.gap(3);
  d.heading('Part D. Comments on CQI implemented based on last assessment', 10.5);
  d.para(a.partD.trim() || 'N/A', { justify: false });
  d.gap(3);
  d.heading('Part E. Recommendation', 10.5);
  partItems(d, a.partE, CAR_E);
  d.para('Signature(s):', { justify: false });
  const ts = c.teachers.length ? c.teachers.map((t) => t.name) : [''];
  const per = Math.min(3, ts.length);
  for (let i = 0; i < ts.length; i += per) {
    const chunk = ts.slice(i, i + per);
    while (chunk.length < per) chunk.push('');
    d.table([], [chunk.map((n) => `Name: ${clean(n)}`), chunk.map(() => 'Signature:')], { styles: { fontSize: 10.5, cellPadding: { top: 0.6, bottom: 0.6, left: 1.6, right: 1.6 } } });
    d.y -= 5;
  }
  return d.finish({ pageNumbers: false });
}

// ---------------------------------------------------------------- question moderation form
export interface ModerationRow { question: string; cos: string[]; domains: string[]; levels: string[] }
export interface ModerationSection { section: string; teacher: string; rows: ModerationRow[] }
/** BME OBE Info for question moderation.docx: one landscape page per section of the term final. */
export function moderationPdf(a: { course: CourseInfo; sections: ModerationSection[] }): jsPDF {
  const d = new Doc({ orientation: 'landscape' }), c = a.course;
  const [level, term] = (c.levelTerm ?? '').split('/');
  a.sections.forEach((s, i) => {
    if (i > 0) { d.doc.addPage(); d.y = d.top; }
    d.title(['Question Moderation Form for Term Final Examination', 'Department of Biomedical Engineering', 'Faculty of Electrical and Electronic Engineering',
      'Bangladesh University of Engineering and Technology (BUET), Dhaka.'], 12);
    d.fields([['Level:', level ?? '', 'Course No.', c.code], ['Term:', term ?? '', 'Course Title:', c.title], ['Section:', s.section, 'Course Teacher:', s.teacher]],
      { tab: 18, tab2: 60, tab3: 92 });
    d.table([
      [{ content: 'Section 1: To be completed by Course Teacher', colSpan: 4 }, { content: 'Section 2: To be completed by Moderator(s)', colSpan: 2 }],
      ['Question No.', 'Course Outcomes (CO) addressed by the question', "Domain of Bloom's taxonomy", "Level of Bloom's Taxonomy", 'Question(s) Addresses the CO satisfactorily (Yes/No)', 'Comments'],
    ], (s.rows.length ? s.rows : [{ question: '', cos: [], domains: [], levels: [] }]).map((r) => [r.question, join(r.cos.map(dash)), join(r.domains), join(r.levels), '', '']),
    { styles: { fontSize: 10.5, halign: 'center', minCellHeight: 9 }, headStyles: { fontSize: 10.5 },
      columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 46 }, 2: { cellWidth: 36 }, 3: { cellWidth: 32 }, 4: { cellWidth: 44 } } });
    d.gap(6);
    d.font(11, 'bold');
    d.doc.text('Checked by: ..........................................................', d.m, d.y);
    d.doc.text('Date: ...............................', d.width - d.m, d.y, { align: 'right' });
  });
  return d.finish({ pageNumbers: false });
}
