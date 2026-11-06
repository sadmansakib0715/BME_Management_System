// Reading the faculty's inputs: course_information.xlsx and course_outline.docx.
import ExcelJS from 'exceljs';
import { cellText, DocxPackage, kids, paraText } from './xml';
import { clean, fmtNum, norm, parseNums, type CO, type CourseInfo, type Outline, type Rec, type Warnings } from './model';

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
  ['teachers', /^course\s+teachers?(\(s\))?\s*:?\s*$/i],
  ['content', /^course\s+contents?/i], ['objectives', /^course\s+objectives?/i], ['knowledge', /^knowledge\s+required/i],
  ['outcomes', /^course\s+outcomes?/i], ['mapping', /^mapping\s+of\s+knowledge/i], ['plan', /^((lecture|lab|class)\s+plan|weekly\s+schedule)/i],
  ['strategy', /^assessment\s+strateg/i], ['distribution', /^(distribution\s+of\s+marks|marks\s+distribution|assessment\s*:?\s*$)/i],
  ['textbooks', /^(text\s*books?|references)/i], ['prepared', /^prepared\s+by/i],
];

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;
const PHONE = /\+?\d[\d\s-]{8,}\d/;
/** "Saturday (A1):02:00 PM-05:00 PM Tuesday (A2): …" → routine rows (section, day, start_time, end_time). */
export function parseRoutine(text: string): Rec[] {
  return [...text.matchAll(/([A-Z][a-z]+day)\s*(?:\(\s*([^)]+?)\s*\))?\s*:?\s*(\d{1,2}[:.]\d{2}\s*[AP]\.?M\.?)\s*[-–to]+\s*(\d{1,2}[:.]\d{2}\s*[AP]\.?M\.?)/gi)]
    .map((m) => ({ day: m[1], section: m[2] ?? '', start_time: m[3].toUpperCase().replace(/\s+/g, ' '), end_time: m[4].toUpperCase().replace(/\s+/g, ' ') }));
}

/** The header block of the department's outline ("Course No:\tBME 210", "Credit hours:\t0.75\tContact hours:\t1.5", …). */
function readHeaderLine(raw: string, h: Outline['header']) {
  const t = raw.replace(/\s+/g, ' ');
  const m = (rx: RegExp) => t.match(rx)?.[1]?.trim();
  h.courseNo ??= m(/course\s*no\.?\s*:\s*([A-Za-z]+\s*-?\s*\d{3}[A-Za-z]?)/i)?.toUpperCase().replace(/^([A-Z]+)\s*-?\s*/, '$1 ');
  h.title ??= m(/course\s*title\s*:\s*(.+)$/i);
  h.credit ??= m(/credit\s*hours?\s*:\s*(\d+(?:\.\d+)?)/i);
  h.contact ??= m(/contact\s*hours?\s*:\s*(\d+(?:\.\d+)?)/i);
  const lt = t.match(/level\s*\/\s*term\s*:\s*(\d)\s*\/\s*(\d)/i);
  if (lt && !h.level) { h.level = lt[1]; h.term = lt[2]; }
  h.session ??= m(/academic\s*session\s*:\s*(\d{4}\s*-\s*\d{2,4})/i)?.replace(/\s/g, '');
}

/** Reads a course outline. Two layouts are understood:
    - the department's outline (BME 210 / BME 211): header fields, Course Teacher(s) table, COs as a numbered list,
      "Assessment:" lines such as "Lab Quiz 30%", Weekly Schedule table;
    - the website's outline template: a CO table (CO No. | CO Statement | PO | Domain | Delivery | Assessment Tool(s)) and a
      Distribution of Marks section.
    The CO-PO mapping (POs, assessment tools) may instead come from the department's CO-PO Mapping.docx: see `mergeMapping`. */
export async function readOutline(data: ArrayBuffer | Uint8Array, opts: { requireCos?: boolean } = {}): Promise<Outline> {
  const pkg = await DocxPackage.open(data);
  const o: Outline = { courseNo: '', title: '', cos: [], coTable: null, kpaTable: null, planHeader: [], plan: [], distribution: [], textbooks: [], header: {}, teachers: [], routine: [] };
  const listCos: string[] = [];
  let current = '';
  for (const el of pkg.blocks()) {
    if (el.localName === 'p') {
      const raw = paraText(el);
      const txt = clean(raw);
      if (!txt) continue;
      const m = txt.match(/description\s+of\s+the\s+course\s+(.+)$/i);
      if (m) { o.courseNo = clean(m[1]); continue; }
      readHeaderLine(raw, o.header);
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
        if (d && clean(d[1]) && !/^total\b/i.test(d[1].trim())) o.distribution.push({ name: clean(d[1]).replace(/[:\-–]+$/, '').trim(), pct: Number(d[2]) });
      } else if (current === 'textbooks') o.textbooks.push(txt);
      else if (current === 'outcomes' && !/:\s*$/.test(txt)) listCos.push(txt.replace(/^(CO\s*-?\s*\d+|\d+)\s*[.):-]\s*/i, ''));
    } else {
      const rows = kids(el, 'tr').map((tr) => kids(tr, 'tc').map((tc) => clean(cellText(tc).replace(/\n/g, ' / '))));
      const rawRows = kids(el, 'tr').map((tr) => kids(tr, 'tc').map((tc) => cellText(tc)));
      if (!rows.length) continue;
      const hdr = rows[0].map((h) => h.toLowerCase());
      const joined = hdr.join(' ');
      if (joined.includes('co statement') || hdr[0]?.startsWith('co no')) {
        o.coTable = el;
        o.cos = coRows(rows);
      } else if (hdr.includes('k1') && (hdr.includes('p1') || hdr.includes('a1'))) {
        o.kpaTable = el;
      } else if (hdr[0] === 'name' && /office|room|email/.test(joined)) {
        const routineCol = hdr.findIndex((h) => /routine|schedule/.test(h));
        rawRows.slice(1).forEach((c) => {
          const contact = c.slice(2).join(' ');
          if (clean(c[0])) o.teachers.push({ name: clean(c[0]), room: clean(c[1]), email: contact.match(EMAIL)?.[0] ?? '', phone: clean(contact.replace(EMAIL, ' ').match(PHONE)?.[0]) });
        });
        if (routineCol >= 0) o.routine = parseRoutine(rawRows.slice(1).map((c) => c[routineCol] ?? '').find((x) => clean(x)) ?? '');
      } else if (current === 'distribution') {
        for (const c of rows.slice(1)) {
          const pct = c.slice(1).find((x) => /\d/.test(x))?.match(/(\d+(?:\.\d+)?)/);
          if (pct && c[0] && !/^total/i.test(c[0])) o.distribution.push({ name: c[0], pct: Number(pct[1]) });
        }
      } else if ((current === 'plan' || /week|lecture|experiment|lab/.test(joined)) && !o.plan.length && current !== 'prepared') {
        o.planHeader = rows[0];
        o.plan = rows.slice(1);
      }
    }
  }
  if (!o.cos.length) o.cos = listCos.map((statement, i) => ({ no: i + 1, statement, pos: [], domain: '', delivery: '', tools: '' }));
  o.courseNo ||= o.header.courseNo ?? '';
  o.title ||= o.header.title ?? '';
  if (opts.requireCos !== false && !o.cos.length) throw new Error('course outline: no Course Outcomes found (neither a numbered list under "Course Outcomes:" nor a CO table)');
  return o;
}

function coRows(rows: string[][]): CO[] {
  const out: CO[] = [];
  for (const c of rows.slice(1)) {
    const n = parseNums(c[0], 'CO');
    if (!clean(c[0]) || !n.length) continue;
    const v = [...c, '', '', '', '', '', ''];
    out.push({ no: n[0], statement: v[1], pos: parseNums(v[2], 'PO'), domain: v[3], delivery: v[4], tools: v[5] });
  }
  return out;
}

/** Puts the department's CO-PO Mapping.docx (CO table with POs and assessment tools, and the K/P/A matrix) into the outline's COs. */
export async function mergeMapping(o: Outline, data: ArrayBuffer | Uint8Array, w: Warnings): Promise<Outline> {
  const m = await readOutline(data, { requireCos: false });
  if (!m.coTable) { w.add('CO-PO mapping: no CO table (CO No. | CO Statement | Corresponding PO(s) | … | Assessment Tool(s)) found; it was ignored'); return o; }
  if (o.cos.length && m.cos.length !== o.cos.length) w.add(`the outline lists ${o.cos.length} COs but the CO-PO mapping has ${m.cos.length}`);
  const cos = m.cos.map((c) => ({ ...c, statement: o.cos.find((x) => x.no === c.no)?.statement || c.statement }));
  for (const c of o.cos) if (!cos.some((x) => x.no === c.no)) cos.push(c);
  return { ...o, cos: cos.sort((a, b) => a.no - b.no), coTable: m.coTable, kpaTable: m.kpaTable ?? o.kpaTable };
}

/** POs and assessment tools from the website's own COs (this course's OBE page), for COs that have none yet. */
export function mergeSiteCos(o: Outline, site: CO[]): Outline {
  if (!site.length || o.cos.some((c) => c.pos.length)) return o;
  const cos = (o.cos.length ? o.cos : site).map((c) => { const s = site.find((x) => x.no === c.no); return s ? { ...s, ...c, pos: s.pos, tools: c.tools || s.tools, domain: c.domain || s.domain, delivery: c.delivery || s.delivery } : c; });
  return { ...o, cos };
}

/** Course information when no course_information.xlsx is given: the outline's header and teachers, plus the roll range typed on the page. */
export function infoFromOutline(o: Outline, a: { semester: string; batch: string; count: number; missingIds: string[]; courseType?: string }): CourseInfo {
  const h = o.header;
  const credit = Number(h.credit);
  if (!o.courseNo) throw new Error('course outline: no "Course No:" found, so the course information workbook is needed');
  if (!Number.isFinite(credit) || credit <= 0) throw new Error('course outline: no "Credit hours:" found, so the course information workbook is needed');
  return {
    courseNo: o.courseNo, credit, contactHours: h.contact ?? '', level: h.level ?? '', term: h.term ?? '', semester: a.semester, session: h.session ?? '',
    extra: { batch: a.batch, ...(a.courseType ? { course_type: a.courseType } : {}) },
    faculties: o.teachers.map((t) => ({ name: t.name, section: '', office_room: t.room, email: t.email, telephone: t.phone, consultation: '' })),
    routine: o.routine,
    sections: [{ section: '', first_roll: '1', last_roll: String(a.count), extra_ids: '', exclude_ids: a.missingIds.join(', ') }],
  };
}

/** Course information checked against the outline: what differs is reported; what the workbook leaves out is taken from the outline. */
export function checkInfo(info: CourseInfo, o: Outline, w: Warnings): CourseInfo {
  const h = o.header;
  const out = { ...info, extra: { ...info.extra } };
  if (o.courseNo && norm(o.courseNo) !== norm(info.courseNo)) w.add(`the outline is for '${o.courseNo}' but the course information says '${info.courseNo}'`);
  if (h.credit && Math.abs(Number(h.credit) - info.credit) > 1e-9) {
    w.add(`credit hours: the outline says ${h.credit}, the course information ${info.credit}; using the outline's ${h.credit} (marks total ${fmtNum(Number(h.credit) * 100)})`);
    out.credit = Number(h.credit);
  }
  if (h.level && info.level && `${h.level}/${h.term}` !== `${info.level}/${info.term}`) w.add(`level/term: the outline says ${h.level}/${h.term}, the course information ${info.level}/${info.term}`);
  if (h.session && info.session && h.session.replace(/\s/g, '') !== info.session.replace(/\s/g, '')) w.add(`session: the outline says ${h.session}, the course information ${info.session}`);
  out.contactHours ||= h.contact ?? ''; out.level ||= h.level ?? ''; out.term ||= h.term ?? ''; out.session ||= h.session ?? '';
  if (!out.faculties.length && o.teachers.length) out.faculties = o.teachers.map((t) => ({ name: t.name, section: '', office_room: t.room, email: t.email, telephone: t.phone, consultation: '' }));
  if (!out.routine.length && o.routine.length) out.routine = o.routine;
  return out;
}
