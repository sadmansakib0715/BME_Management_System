// The department's Course Outline as a Word file (BME 310 layout), filled from an outline draft.
// Same layout as src/assets/course-folder/course_outline_template.docx; empty parts keep a grey placeholder.
import {
  AlignmentType, BorderStyle, Document, ImageRun, LevelFormat, Packer, Paragraph, ShadingType, Table, TableCell, TableRow,
  TabStopType, TextRun, VerticalAlign, VerticalMergeType, WidthType,
} from 'docx';
import type { OutlineDraft } from './outlineDraft';
import { BUET_LOGO } from './pdf/logo';

const PAGE_W = 9360;   // US Letter, 1-inch margins
const logoBytes = () => Uint8Array.from(atob(BUET_LOGO.split(',')[1]), (c) => c.charCodeAt(0));
const ph = (text: string) => new TextRun({ text, color: '7F7F7F' });
const t = (text: string, o: { bold?: boolean; size?: number; italics?: boolean; color?: string } = {}) => new TextRun({ text, ...o });
/** The value, or the grey placeholder when it is empty. */
const val = (v: string, placeholder: string) => (v.trim() ? t(v.trim()) : ph(placeholder));
const p = (children: (TextRun | ImageRun)[] | TextRun | string, o: Record<string, unknown> = {}) =>
  new Paragraph({ children: typeof children === 'string' ? [t(children)] : Array.isArray(children) ? children : [children], spacing: { after: 0, line: 276 }, ...o });
const cp = (children: (TextRun | ImageRun)[] | TextRun | string, o: Record<string, unknown> = {}) => p(children, { alignment: AlignmentType.CENTER, ...o });
const heading = (text: string) => p(t(text, { bold: true }), { spacing: { before: 240, after: 80 }, keepNext: true });
const field = (label: string, value: TextRun, second?: [string, TextRun]) => p([t(label, { bold: true }), t('\t'), value, ...(second ? [t('\t'), t(second[0], { bold: true }), t('\t'), second[1]] : [])],
  { tabStops: [{ type: TabStopType.LEFT, position: 3100 }, { type: TabStopType.LEFT, position: 6200 }, { type: TabStopType.LEFT, position: 8000 }], spacing: { after: 20 } });

const line = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
const borders = { top: line, bottom: line, left: line, right: line };
const cell = (children: Paragraph[], width: number, o: Record<string, unknown> = {}) => new TableCell({ children, width: { size: width, type: WidthType.DXA }, borders,
  verticalAlign: VerticalAlign.CENTER, margins: { top: 60, bottom: 60, left: 100, right: 100 }, ...o });
const head = (labels: string[], widths: number[]) => new TableRow({ tableHeader: true, children: labels.map((h, k) => cell([cp(t(h, { bold: true }))], widths[k])) });
const nonEmpty = <T,>(xs: T[], blank: (x: T) => boolean) => xs.filter((x) => !blank(x));

export async function outlineDocx(d: OutlineDraft): Promise<Uint8Array> {
  const teachers = nonEmpty(d.teachers, (x) => !x.name.trim() && !x.email.trim());
  const rows = teachers.length ? teachers : [{ name: '', room: '', email: '', phone: '' }];
  const routineLines = d.routine.split('\n').map((x) => x.trim()).filter(Boolean);
  const TW = [2000, 1500, 3060, 2800];
  const teacherTable = new Table({ width: { size: PAGE_W, type: WidthType.DXA }, columnWidths: TW, rows: [
    head(['Name', 'Office/Room', 'Email & Telephone', 'Class routine'], TW),
    ...rows.map((x, i) => new TableRow({ children: [
      cell([cp(val(x.name, '[Teacher name]'))], TW[0]), cell([cp(val(x.room, 'ECE-XXXX'))], TW[1]),
      cell([cp(val(x.email, '[email]@bme.buet.ac.bd')), ...(x.phone.trim() ? [cp(x.phone.trim())] : [])], TW[2]),
      i === 0 ? cell(routineLines.length ? routineLines.map((l) => cp(l)) : [cp(ph('[Day] (A1)')), cp(ph('[hh:mm AM] - [hh:mm PM]'))], TW[3], rows.length > 1 ? { verticalMerge: VerticalMergeType.RESTART } : {})
        : cell([cp('')], TW[3], { verticalMerge: VerticalMergeType.CONTINUE }),
    ] }))] });

  const weeks = nonEmpty(d.schedule, (x) => !x.week.trim() && !x.topic.trim() && !x.basis.trim());
  const SW = [900, 5660, 2800];
  const scheduleTable = new Table({ width: { size: PAGE_W, type: WidthType.DXA }, columnWidths: SW, rows: [
    head(['Week', 'Topics', 'Evaluation Basis'], SW),
    ...(weeks.length ? weeks : [{ week: '1', topic: '', basis: '' }]).map((x) => (x.week.trim()
      ? new TableRow({ children: [cell([cp(x.week.trim())], SW[0]), cell([p(val(x.topic, '[Topic]'))], SW[1]), cell([cp(x.basis.trim())], SW[2])] })
      // A row without a week number (a break, an exam week) spans the table, shaded, as in the department's outlines.
      : new TableRow({ children: [cell([cp(x.topic.trim())], PAGE_W, { columnSpan: 3, shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'D9D9D9' } })] }))),
  ] });

  const PW = [2200, 7160];
  const preparedBy = new Table({ width: { size: PAGE_W, type: WidthType.DXA }, columnWidths: PW, rows: [
    new TableRow({ children: [cell([p(t('Prepared by:', { bold: true }))], PW[0]), cell([p('')], PW[1])] }),
    ...rows.map((x) => new TableRow({ children: [cell([p('Name:'), p('Signature:'), p('Date:')], PW[0]), cell([p(val(x.name, '[Teacher name]')), p(''), p(ph('[dd/mm/yyyy]'))], PW[1])] }))] });

  const list = (ref: string, items: string[], placeholder: string) => {
    const xs = items.map((x) => x.trim()).filter(Boolean);
    return (xs.length ? xs : ['']).map((x) => p(x ? t(x) : ph(placeholder), { numbering: { reference: ref, level: 0 }, alignment: AlignmentType.JUSTIFIED }));
  };
  const assessment = nonEmpty(d.assessment, (x) => !x.name.trim());
  const assessLine = (x: { name: string; pct: string; count: number }) => p([t(`${x.name.trim()}${x.count > 1 ? ` (x${x.count})` : ''}:`), t('\t'), t(x.pct.trim() ? `${x.pct.trim().replace(/%$/, '')}%` : '')],
    { indent: { left: 720 }, tabStops: [{ type: TabStopType.LEFT, position: 5040 }] });
  const marker = (reference: string, format: (typeof LevelFormat)[keyof typeof LevelFormat], text: string) =>
    ({ reference, levels: [{ level: 0, format, text, alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] });

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Arial', size: 22 } } } },
    numbering: { config: [marker('bullets', LevelFormat.BULLET, '●'), marker('cos', LevelFormat.DECIMAL, '%1.'), marker('books', LevelFormat.DECIMAL, '%1.')] },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
      children: [
        cp(new ImageRun({ type: 'png', data: logoBytes(), transformation: { width: 72, height: 72 } }), { spacing: { after: 60 } }),
        cp(t('Bangladesh University of Engineering and Technology', { size: 22 })),
        cp(t('DEPARTMENT OF BIOMEDICAL ENGINEERING', { size: 32 })),
        cp(t('Course Outline', { size: 26 }), { spacing: { before: 200, after: 300 } }),
        field('Course No:', val(d.courseNo, 'BME XXX')),
        field('Course Title:', val(d.title, '[Course title]')),
        field('Credit hours:', val(d.credit, '[e.g. 1.5]'), ['Contact hours:', val(d.contact, '[e.g. 3]')]),
        field('Level/Term:', val(d.levelTerm, '[e.g. 3/1]')),
        field('Academic Session:', val(d.session, '[e.g. 2023-2024]')),
        heading('Course Teacher(s):'), teacherTable,
        heading('Course Contents:'), p(val(d.contents, '[Course contents as approved by the Academic Council]'), { alignment: AlignmentType.JUSTIFIED }),
        heading('Course Objectives:'), ...list('bullets', d.objectives, '[The course will …]'),
        heading('Course Outcomes:'), ...list('cos', d.outcomes, '[CO statement, starting with an action verb]'),
        heading('Assessment:'), ...(assessment.length ? assessment.map(assessLine) : [p(ph('[Assessment: weight %]'), { indent: { left: 720 } })]),
        heading('Textbooks and References:'), ...list('books', d.textbooks, '[Author, Title, edition, publisher (year)]'),
        heading('Weekly Schedule:'), scheduleTable,
        p('', { spacing: { after: 240 } }), preparedBy,
      ],
    }],
  });
  return new Uint8Array(await (await Packer.toBlob(doc)).arrayBuffer());
}
