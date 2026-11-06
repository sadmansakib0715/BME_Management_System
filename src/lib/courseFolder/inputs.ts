// Reading the faculty's inputs: course_information.xlsx and course_outline.docx.
import ExcelJS from 'exceljs';
import { cellText, DocxPackage, kids, paraText } from './xml';
import { clean, parseNums, type CO, type CourseInfo, type Outline, type Rec } from './model';

/** An ExcelJS cell value as a plain number / string / null (formula results, rich text and hyperlinks unwrapped). */
export function plain(v: ExcelJS.CellValue): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return plain((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join('');
    if ('text' in v) return String((v as ExcelJS.CellHyperlinkValue).text);
    if ('error' in v) return null;
  }
  return null;
}

export async function loadWorkbook(data: ArrayBuffer | Uint8Array): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as ArrayBuffer);
  return wb;
}

export function sheetRecords(ws: ExcelJS.Worksheet | undefined): Rec[] {
  if (!ws) return [];
  const hdr: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, col) => { hdr[col] = clean(plain(c.value)).toLowerCase().replace(/ /g, '_'); });
  const out: Rec[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const rec: Rec = {};
    let any = false;
    hdr.forEach((h, col) => {
      if (!h) return;
      const v = clean(plain(row.getCell(col).value));
      rec[h] = v;
      if (v) any = true;
    });
    if (any) out.push(rec);
  }
  return out;
}

export async function readCourseInfo(data: ArrayBuffer | Uint8Array): Promise<CourseInfo> {
  const wb = await loadWorkbook(data);
  const sheet = (n: string) => wb.worksheets.find((w) => w.name.trim().toLowerCase() === n);
  const info = sheetRecords(sheet('info') ?? wb.worksheets[0])[0];
  if (!info) throw new Error("course information: the 'info' sheet is empty");
  const credit = Number(info.credit_hours);
  if (!Number.isFinite(credit) || credit <= 0) throw new Error(`course information: credit_hours '${info.credit_hours ?? ''}' is not a number`);
  const known = new Set(['course_no', 'credit_hours', 'contact_hours', 'level', 'term', 'semester', 'session']);
  const extra: Rec = {};
  for (const [k, v] of Object.entries(info)) if (!known.has(k) && v) extra[k] = v;
  return {
    courseNo: clean(info.course_no).toUpperCase().replace(/^([A-Z]+)\s*-?\s*(\d)/, '$1 $2'),
    credit, contactHours: info.contact_hours ?? '', level: info.level ?? '', term: info.term ?? '',
    semester: info.semester ?? '', session: info.session ?? '', extra,
    faculties: sheetRecords(sheet('faculties')), routine: sheetRecords(sheet('routine')), sections: sheetRecords(sheet('sections')),
  };
}

const SECTION_KEYS: [string, RegExp][] = [
  ['title', /^course\s+title/i], ['type', /^type\s+of\s+course/i], ['offered', /^offered\s+to/i], ['prereq', /^pre-?\s*requisite/i],
  ['content', /^course\s+content/i], ['objectives', /^course\s+objectives?/i], ['knowledge', /^knowledge\s+required/i],
  ['outcomes', /^course\s+outcomes?/i], ['mapping', /^mapping\s+of\s+knowledge/i], ['plan', /^(lecture|lab|class)\s+plan/i],
  ['strategy', /^assessment\s+strateg/i], ['distribution', /^(distribution\s+of\s+marks|marks\s+distribution|assessment\s*:?\s*$)/i],
  ['textbooks', /^(text\s*books?|references)/i],
];

export async function readOutline(data: ArrayBuffer | Uint8Array): Promise<Outline> {
  const pkg = await DocxPackage.open(data);
  const o: Outline = { courseNo: '', title: '', cos: [], coTable: null, kpaTable: null, planHeader: [], plan: [], distribution: [], textbooks: [] };
  let current = '';
  for (const el of pkg.blocks()) {
    if (el.localName === 'p') {
      const raw = paraText(el);
      const txt = clean(raw);
      if (!txt) continue;
      const m = txt.match(/description\s+of\s+the\s+course\s+(.+)$/i);
      if (m) { o.courseNo = clean(m[1]); continue; }
      const stripped = raw.replace(/^\s*\d+(\.\d+)*\s*/, '').trim();
      const hit = SECTION_KEYS.find(([, rx]) => rx.test(stripped))?.[0];
      if (hit) {
        current = hit;
        const parts = stripped.split(/\t+|\s{3,}/).map((x) => x.trim()).filter(Boolean);
        if (hit === 'title' && parts.length > 1) o.title = parts[parts.length - 1];
        continue;
      }
      if (current === 'distribution') {
        const d = raw.trim().match(/^(.*?)[\s\t:]+(\d+(?:\.\d+)?)\s*%/);
        if (d && !/^total\b/i.test(d[1].trim())) o.distribution.push({ name: clean(d[1]), pct: Number(d[2]) });
      } else if (current === 'textbooks') o.textbooks.push(txt);
    } else {
      const rows = kids(el, 'tr').map((tr) => kids(tr, 'tc').map((tc) => clean(cellText(tc).replace(/\n/g, ' / '))));
      if (!rows.length) continue;
      const hdr = rows[0].map((h) => h.toLowerCase());
      const joined = hdr.join(' ');
      if (joined.includes('co statement') || hdr[0]?.startsWith('co no')) {
        o.coTable = el;
        for (const c of rows.slice(1)) {
          const n = parseNums(c[0], 'CO');
          if (!clean(c[0]) || !n.length) continue;
          const v = [...c, '', '', '', '', '', ''];
          o.cos.push({ no: n[0], statement: v[1], pos: parseNums(v[2], 'PO'), domain: v[3], delivery: v[4], tools: v[5] } satisfies CO);
        }
      } else if (hdr.includes('k1') && (hdr.includes('p1') || hdr.includes('a1'))) {
        o.kpaTable = el;
      } else if (current === 'distribution') {
        for (const c of rows.slice(1)) {
          const pct = c.slice(1).find((x) => /\d/.test(x))?.match(/(\d+(?:\.\d+)?)/);
          if (pct && c[0] && !/^total/i.test(c[0])) o.distribution.push({ name: c[0], pct: Number(pct[1]) });
        }
      } else if ((current === 'plan' || /week|lecture|experiment|lab/.test(joined)) && !o.plan.length) {
        o.planHeader = rows[0];
        o.plan = rows.slice(1);
      }
    }
  }
  if (!o.cos.length) throw new Error('course outline: the Course Outcomes table (CO No. | CO Statement | …) was not found');
  return o;
}
