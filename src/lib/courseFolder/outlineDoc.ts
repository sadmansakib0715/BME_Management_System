// The course folder's "<course>_Course outline.docx" in the department's layout (as the BME 310 outline): BUET crest, header block,
// Course Teacher(s) table with the class routine, Contents, Objectives, Outcomes, Assessment, Textbooks, Weekly Schedule, Prepared by.
// The teaching content comes from the uploaded outline (20.26 "Description of the Course" format); the course details, teachers and
// routine from the website / course information, so nothing is typed twice.
import {
  AlignmentType, BorderStyle, Document, ImageRun, LevelFormat, Packer, Paragraph, ShadingType, Table, TableCell, TableRow,
  TabStopType, TextRun, VerticalAlign, VerticalMergeType, WidthType,
} from 'docx';
import { BUET_LOGO } from '../pdf/logo';
import { clean, fmtNum, type CourseInfo, type Outline } from './model';

const PAGE_W = 9360;   // US Letter, 1-inch margins
const logoBytes = () => Uint8Array.from(atob(BUET_LOGO.split(',')[1]), (c) => c.charCodeAt(0));
const t = (text: string, o: { bold?: boolean; size?: number; color?: string } = {}) => new TextRun({ text, ...o });
const ph = (text: string) => t(text, { color: '7F7F7F' });
const val = (v: string | number | undefined | null, placeholder: string) => (clean(v) ? t(clean(v)) : ph(placeholder));
type Kids = (TextRun | ImageRun)[] | TextRun | ImageRun | string;
const p = (children: Kids, o: Record<string, unknown> = {}) =>
  new Paragraph({ children: typeof children === 'string' ? [t(children)] : Array.isArray(children) ? children : [children], spacing: { after: 0, line: 276 }, ...o });
const cp = (children: Kids, o: Record<string, unknown> = {}) => p(children, { alignment: AlignmentType.CENTER, ...o });
const heading = (text: string) => p(t(text, { bold: true }), { spacing: { before: 240, after: 80 }, keepNext: true });
const field = (label: string, value: TextRun, second?: [string, TextRun]) => p([t(label, { bold: true }), t('\t'), value, ...(second ? [t('\t'), t(second[0], { bold: true }), t('\t'), second[1]] : [])],
  { tabStops: [{ type: TabStopType.LEFT, position: 3100 }, { type: TabStopType.LEFT, position: 6200 }, { type: TabStopType.LEFT, position: 8000 }], spacing: { after: 20 } });
const line = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
const borders = { top: line, bottom: line, left: line, right: line };
const cell = (children: Paragraph[], width: number, o: Record<string, unknown> = {}) => new TableCell({ children, width: { size: width, type: WidthType.DXA }, borders,
  verticalAlign: VerticalAlign.CENTER, margins: { top: 60, bottom: 60, left: 100, right: 100 }, ...o });
const head = (labels: string[], widths: number[]) => new TableRow({ tableHeader: true, children: labels.map((h, k) => cell([cp(t(h, { bold: true }))], widths[k])) });
/** Text from a table cell of the uploaded outline ("- Demonstrations … / - Site visit") as separate lines, without the dashes. */
const cellLines = (s: string) => s.split(' / ').map((x) => x.replace(/^\s*[-–•●]\s*/, '').trim()).filter(Boolean);

/** `counts`: how many of each assessment were taken (the page's "How many taken"), written as "Lab test (x2)". */
export async function departmentOutlineDocx(info: CourseInfo, o: Outline, counts: Record<string, number> = {}): Promise<Uint8Array> {
  const teachers = info.faculties.filter((f) => clean(f.name));
  const rows = teachers.length ? teachers : [{ name: '', office_room: '', email: '', telephone: '' } as Record<string, string>];
  const routine = info.routine.flatMap((r) => [`${clean(r.day)}${clean(r.section) ? ` (${clean(r.section)})` : ''}`, ...(clean(r.start_time) ? [`${clean(r.start_time)} - ${clean(r.end_time)}`] : [])]);
  const TW = [2000, 1500, 3060, 2800];
  const teacherTable = new Table({ width: { size: PAGE_W, type: WidthType.DXA }, columnWidths: TW, rows: [
    head(['Name', 'Office/Room', 'Email & Telephone', 'Class routine'], TW),
    ...rows.map((f, i) => new TableRow({ children: [
      cell([cp(val(f.name, '[Teacher name]'))], TW[0]), cell([cp(val(f.office_room, 'ECE-XXXX'))], TW[1]),
      cell([cp(val(f.email, '[email]@bme.buet.ac.bd')), ...(clean(f.telephone) ? [cp(clean(f.telephone))] : [])], TW[2]),
      i === 0 ? cell(routine.length ? routine.map((l) => cp(l)) : [cp(ph('[Day] (A1)')), cp(ph('[hh:mm AM] - [hh:mm PM]'))], TW[3], rows.length > 1 ? { verticalMerge: VerticalMergeType.RESTART } : {})
        : cell([cp('')], TW[3], { verticalMerge: VerticalMergeType.CONTINUE }),
    ] }))] });

  // Weekly Schedule from the outline's lecture plan: Week | Topics | its third column (Corresponding CO(s), Evaluation basis …).
  const hdr = o.planHeader;
  const weekCol = Math.max(0, hdr.findIndex((h) => /week|lecture\s*no|lab|class|no\.?$/i.test(h) && !/topic/i.test(h)));
  const topicCol = hdr.findIndex((h, i) => i !== weekCol && /topic|content|experiment/i.test(h));
  const tc = topicCol >= 0 ? topicCol : weekCol === 0 ? 1 : 0;
  const thirdCol = hdr.findIndex((_, i) => i !== weekCol && i !== tc);
  const third = thirdCol >= 0 ? clean(hdr[thirdCol]) || 'Evaluation Basis' : 'Evaluation Basis';
  const SW = [900, 5660, 2800];
  const plan = o.plan.filter((r) => r.some((c) => clean(c)));
  const scheduleTable = new Table({ width: { size: PAGE_W, type: WidthType.DXA }, columnWidths: SW, rows: [
    head(['Week', 'Topics', third], SW),
    ...(plan.length ? plan : [['1', '', '']]).map((r) => {
      const week = clean(r[weekCol]), topics = cellLines(r[tc] ?? ''), extra = thirdCol >= 0 ? clean(r[thirdCol]) : '';
      // A row without a week number (a break, an exam week) spans the table, shaded, as in the department's outlines.
      if (!week && r.filter((c) => clean(c)).length === 1) return new TableRow({ children: [cell([cp(r.map(clean).find(Boolean) ?? '')], PAGE_W, { columnSpan: 3, shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'D9D9D9' } })] });
      return new TableRow({ children: [cell([cp(week)], SW[0]), cell(topics.length ? topics.map((x) => p(x)) : [p(ph('[Topic]'))], SW[1]), cell([cp(extra)], SW[2])] });
    }),
  ] });

  const PW = [2200, 7160];
  const preparedBy = new Table({ width: { size: PAGE_W, type: WidthType.DXA }, columnWidths: PW, rows: [
    new TableRow({ children: [cell([p(t('Prepared by:', { bold: true }))], PW[0]), cell([p('')], PW[1])] }),
    ...rows.map((f) => new TableRow({ children: [cell([p('Name:'), p('Signature:'), p('Date:')], PW[0]), cell([p(val(f.name, '[Teacher name]')), p(''), p('')], PW[1])] }))] });

  const list = (ref: string, items: string[], placeholder: string) => {
    const xs = items.map(clean).filter(Boolean);
    return (xs.length ? xs : ['']).map((x) => p(x ? t(x) : ph(placeholder), { numbering: { reference: ref, level: 0 }, alignment: AlignmentType.JUSTIFIED }));
  };
  const assessment = o.distribution.map((d) => {
    const n = counts[d.name] ?? d.count ?? 1;
    return p([t(`${d.name}${n > 1 ? ` (x${n})` : ''}:`), t('\t'), t(`${fmtNum(d.pct)}%`)], { indent: { left: 720 }, tabStops: [{ type: TabStopType.LEFT, position: 5040 }] });
  });
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
        field('Course No:', val(info.courseNo, 'BME XXX')),
        field('Course Title:', val(o.title || info.extra.title, '[Course title]')),
        field('Credit hours:', val(fmtNum(info.credit), '[e.g. 1.5]'), ['Contact hours:', val(info.contactHours, '[e.g. 3]')]),
        field('Level/Term:', val(info.level ? `${info.level}/${info.term}` : '', '[e.g. 3/1]')),
        field('Academic Session:', val(info.session, '[e.g. 2023-2024]')),
        heading('Course Teacher(s):'), teacherTable,
        heading('Course Contents:'), p(val(o.contents.join(' '), '[Course contents as approved by the Academic Council]'), { alignment: AlignmentType.JUSTIFIED }),
        heading('Course Objectives:'), ...list('bullets', o.objectives, '[The course will …]'),
        heading('Course Outcomes:'), ...list('cos', o.cos.map((c) => c.statement), '[CO statement]'),
        heading('Assessment:'), ...(assessment.length ? assessment : [p(ph('[Assessment: weight %]'), { indent: { left: 720 } })]),
        heading('Textbooks and References:'), ...list('books', o.textbooks, '[Author, Title, edition, publisher (year)]'),
        heading('Weekly Schedule:'), scheduleTable,
        p('', { spacing: { after: 240 } }), preparedBy,
      ],
    }],
  });
  return new Uint8Array(await (await Packer.toBlob(doc)).arrayBuffer());
}
