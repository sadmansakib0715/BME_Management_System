// The Word documents of the course folder. CAR, CO-PO Mapping and Instructors & Schedule fill copies of the
// department's own BME 211 files (src/assets/course-folder/*.docx); the attainment report is generated.
import JSZip from 'jszip';
import type { Element } from '@xmldom/xmldom';
import {
  clean, COHORT_THRESHOLD, draftAttainmentComment, fmtNum, fmtPct, isSessional, levelTerm, MAX_CO, MAX_PO, PLACEHOLDER, STUDENT_THRESHOLD,
  type Attainment, type CourseInfo, type Marks, type Outline, type Rec, type Sample,
} from './model';
import { clone, desc, DocxPackage, esc, getW, insertAfter, kid, kids, paraText, remove, setCellLines, setParaAfterLabel, setParaText, setW, W, wEl } from './xml';

const tcs = (tr: Element) => kids(tr, 'tc');
const rows = (tbl: Element) => kids(tbl, 'tr');

/** Import a table from another document (the outline's K/P/A matrix) into this one. */
function importNode(pkg: DocxPackage, el: unknown): Element {
  return pkg.doc.importNode(el as Element, true) as Element;
}

// ------------------------------------------------------------------ CO-PO Mapping
export async function coPoMappingDocx(template: ArrayBuffer | Uint8Array, o: Outline): Promise<Uint8Array> {
  const pkg = await DocxPackage.open(template);
  const t = pkg.tables()[0];
  const [, proto, ...rest] = rows(t);
  for (const r of [proto, ...rest]) remove(r);
  for (const c of o.cos) {
    const r = clone(proto);
    const vals = [String(c.no), c.statement, c.pos.map((p) => `PO-${p}`).join(', ') || '-', c.domain, c.delivery, c.tools];
    tcs(r).forEach((tc, k) => setCellLines(tc, k === 4 ? vals[k].split(' / ').map((x) => x.trim()) : [vals[k] ?? '']));
    t.appendChild(r);
  }
  if (o.kpaTable) {
    const sect = kid(pkg.body, 'sectPr');
    const title = clone(pkg.paragraphs()[0]);
    setParaText(title, 'Mapping of Knowledge Profile, Complex Engineering Problem Solving and Complex Engineering Activities');
    for (const el of [wEl(pkg.doc, 'p'), title, importNode(pkg, o.kpaTable)]) pkg.body.insertBefore(el, sect);
  }
  return pkg.save();
}

// ------------------------------------------------------------------ Instructors and Schedule
function routineFor(info: CourseInfo, fac: Rec): Rec[] {
  const secs = (fac.section ?? '').split(/[,/;]/).map((s) => s.trim()).filter(Boolean);
  return info.routine.filter((x) => !secs.length || secs.includes(clean(x.section)));
}
function routineLines(entries: Rec[], showSection: boolean): string[] {
  const out = entries.flatMap((e) => [`${clean(e.day)}${showSection && clean(e.section) ? ` (${clean(e.section)})` : ''}:`, `${clean(e.start_time)}-${clean(e.end_time)}`]);
  return out.length ? out : ['-'];
}

export async function instructorsDocx(template: ArrayBuffer | Uint8Array, info: CourseInfo): Promise<Uint8Array> {
  const pkg = await DocxPackage.open(template);
  const t = pkg.tables()[0];
  const [, proto, ...rest] = rows(t);
  for (const r of [proto, ...rest]) remove(r);
  const showSec = new Set(info.routine.map((x) => clean(x.section)).filter(Boolean)).size > 1;
  const routines = info.faculties.map((fac) => routineLines(routineFor(info, fac), showSec));
  const shared = routines.length > 1 && routines.every((r) => JSON.stringify(r) === JSON.stringify(routines[0]));
  info.faculties.forEach((fac, i) => {
    const r = clone(proto);
    const [nameTc, roomTc, mailTc, rouTc] = tcs(r);
    setCellLines(nameTc, [clean(fac.name)]);
    setCellLines(roomTc, [clean(fac.office_room)]);
    const ps = kids(mailTc, 'p');
    const email = clean(fac.email), phone = clean(fac.telephone);
    const hl = ps[0] ? kid(ps[0], 'hyperlink') : null;
    if (hl && email) {
      DocxPackage.setRid(hl, pkg.addHyperlink(`mailto:${email}`));
      const ts = desc(hl, 't');
      ts.forEach((x, k) => { while (x.firstChild) x.removeChild(x.firstChild); x.appendChild(pkg.doc.createTextNode(k === 0 ? email : '')); });
      for (const run of kids(ps[0], 'r')) remove(run);
    } else if (ps[0]) setParaText(ps[0], email);
    if (ps[1]) { setParaText(ps[1], phone); ps.slice(2).forEach(remove); }
    const tcPr = kid(rouTc, 'tcPr')!;
    let vm = kid(tcPr, 'vMerge');
    if (shared) {
      if (!vm) { vm = wEl(pkg.doc, 'vMerge'); tcPr.appendChild(vm); }
      if (i === 0) { setW(vm, 'val', 'restart'); setCellLines(rouTc, routines[0]); }
      else { vm.removeAttributeNS(W, 'val'); setCellLines(rouTc, ['']); }
    } else {
      if (vm) remove(vm);
      setCellLines(rouTc, routines[i]);
    }
    t.appendChild(r);
  });
  return pkg.save();
}

// ------------------------------------------------------------------ CAR
export type CarRows = { co: [string, string][]; po: [string, string][] };
export interface Previous extends CarRows { semester: string }

export function carRows(att: Attainment): CarRows {
  const cell = (x: { pct: number | null; ok: boolean | null } | undefined): [string, string] => (x && x.pct !== null ? [fmtPct(x.pct), x.ok ? 'Y' : 'N'] : ['NA', 'NA']);
  return {
    co: Array.from({ length: MAX_CO }, (_, i) => cell(att.co.get(i + 1))),
    po: Array.from({ length: MAX_PO }, (_, i) => cell(att.po.get(i + 1))),
  };
}

function fillAttainmentTable(tbl: Element, r: CarRows) {
  const rs = rows(tbl);
  const data: ([string, string][] | null)[] = [null, r.co, r.co, null, r.po, r.po];
  data.forEach((vals, ri) => { if (vals && rs[ri]) tcs(rs[ri]).forEach((tc, k) => vals[k] && setCellLines(tc, [vals[k][ri === 1 || ri === 4 ? 0 : 1]])); });
}

export async function carDocx(template: ArrayBuffer | Uint8Array, info: CourseInfo, o: Outline, att: Attainment, previous: Previous | null): Promise<Uint8Array> {
  const pkg = await DocxPackage.open(template);
  const [partA, partB, sign] = [pkg.tables()[0], pkg.tables()[1], pkg.tables()[pkg.tables().length - 1]];
  const secNames = info.sections.map((s) => clean(s.section)).filter(Boolean);
  const lt = levelTerm(info) + (isSessional(info) && secNames.length ? ` (${secNames.join(', ')})` : '');
  const a: (string | string[])[] = [info.courseNo, o.title || '-', lt, info.semester, o.textbooks.length ? o.textbooks : ['-'], clean(info.extra.last_offered) || 'Not available'];
  rows(partA).forEach((tr, i) => { if (i < a.length) setCellLines(tcs(tr)[1], Array.isArray(a[i]) ? (a[i] as string[]) : [a[i] as string]); });
  fillAttainmentTable(partB, carRows(att));
  const paras = pkg.paragraphs();
  const sem = paras.find((p) => /^\s*(january|july|jan|jul)\w*\s+\d{4}\s*$/i.test(paraText(p)));
  if (sem) setParaText(sem, info.semester);
  const prevIdx = paras.findIndex((p) => paraText(p).trim().toLowerCase().startsWith('previous term'));
  if (prevIdx >= 0 && previous) {
    const na = paras[prevIdx + 1];
    setParaText(na, previous.semester);
    const tbl = clone(partB);
    fillAttainmentTable(tbl, previous);
    insertAfter(na, tbl);
    insertAfter(tbl, wEl(pkg.doc, 'p'));
  }
  for (const p of paras) {
    const tx = paraText(p).replace(/’/g, "'");
    if (tx.startsWith("Teachers' comment on attainment")) setParaAfterLabel(p, /:/, `[Draft] ${draftAttainmentComment(att)}`, true);
    else if (/^(Interpretation of student feedback|Teachers' comment on teaching|Major issues|Plan for future actions)/.test(tx)) setParaAfterLabel(p, /:/, PLACEHOLDER, true);
  }
  const dIdx = paras.findIndex((p) => paraText(p).startsWith('Part D'));
  if (dIdx >= 0 && paras[dIdx + 1]) setParaText(paras[dIdx + 1], PLACEHOLDER, true);
  // Signatures: one column per teacher
  const names = info.faculties.map((x) => clean(x.name));
  if (!names.length) names.push('');
  const grid = kid(sign, 'tblGrid')!;
  const width = kids(grid, 'gridCol').reduce((s, g) => s + Number(getW(g, 'w') || 0), 0) || 9350;
  const each = String(Math.floor(width / names.length));
  kids(grid, 'gridCol').forEach(remove);
  for (let k = 0; k < names.length; k++) grid.appendChild(wEl(pkg.doc, 'gridCol', { w: each }));
  rows(sign).forEach((tr, ri) => {
    const proto = clone(tcs(tr)[0]);
    tcs(tr).forEach(remove);
    for (const nm of names) {
      const tc = clone(proto);
      const tcw = kid(kid(tc, 'tcPr')!, 'tcW');
      if (tcw) setW(tcw, 'w', each);
      setCellLines(tc, [ri === 0 ? `Name: ${nm}` : 'Signature:']);
      tr.appendChild(tc);
    }
  });
  return pkg.save();
}

// ------------------------------------------------------------------ attainment report (generated)
const P = (text: string, o: { bold?: boolean; italic?: boolean; size?: number; center?: boolean } = {}) =>
  `<w:p>${o.center ? '<w:pPr><w:jc w:val="center"/></w:pPr>' : ''}<w:r><w:rPr>${o.bold ? '<w:b/>' : ''}${o.italic ? '<w:i/>' : ''}${o.size ? `<w:sz w:val="${o.size * 2}"/>` : ''}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
function T(headers: string[], body: (string | number)[][]) {
  const c = (v: string | number, head = false) => `<w:tc><w:tcPr>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="D9E1F2"/>' : ''}</w:tcPr><w:p><w:r>${head ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${esc(String(v))}</w:t></w:r></w:p></w:tc>`;
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/></w:tblPr><w:tblGrid>${headers.map(() => '<w:gridCol/>').join('')}</w:tblGrid>`
    + `<w:tr>${headers.map((h) => c(h, true)).join('')}</w:tr>${body.map((r) => `<w:tr>${r.map((v) => c(v)).join('')}</w:tr>`).join('')}</w:tbl>`;
}

export async function reportDocx(info: CourseInfo, o: Outline, att: Attainment, m: Marks, samples: { name: string; max: number; s: Sample }[]): Promise<Uint8Array> {
  const yn = (ok: boolean | null) => (ok === null ? 'NA' : ok ? 'Y' : 'N');
  const parts = [
    P('CO and PO Attainment Report', { bold: true, size: 14, center: true }),
    P(`${info.courseNo}: ${o.title}`, { bold: true, size: 13, center: true }),
    P(`Department of BME, BUET  |  ${info.semester}  |  Level-Term ${levelTerm(info)}  |  Session ${info.session}`, { center: true }),
    P(`Students on roll: ${m.ids.length}.  Student threshold: ${STUDENT_THRESHOLD * 100}% of CO marks.  Cohort threshold: ${COHORT_THRESHOLD * 100}% of students attaining.`),
    P('1. Course Outcome attainment', { bold: true }),
    T(['CO', 'Assessed through', 'Students assessed', 'Students attained', 'Cohort %', 'Attained'], o.cos.map((c) => {
      const items = m.items.filter((it) => it.cos.includes(c.no)).map((it) => `${it.name} (${fmtNum(it.max)})`).join(', ') || 'none';
      const a = att.co.get(c.no);
      return a && a.pct !== null ? [`CO${c.no}`, items, a.assessed, a.attained, fmtPct(a.pct), yn(a.ok)] : [`CO${c.no}`, items, '-', '-', 'NA', 'NA'];
    })),
    P(''), P('2. Programme Outcome attainment (course level)', { bold: true }),
    T(['PO', 'Mapped COs', 'Students assessed', 'Students attained', 'Cohort %', 'Attained'], att.poUsed.map((p) => {
      const a = att.po.get(p)!;
      return [`PO${p}`, att.poCos.get(p)!.map((c) => `CO${c}`).join(', '), a.assessed, a.attained, fmtPct(a.pct), yn(a.ok)];
    })),
    P(''), P('3. Sample scripts to upload (Highest / Average / Lowest)', { bold: true }),
    T(['Assessment', 'Highest', 'Average*', 'Lowest', 'Class mean'], samples.map(({ name, max, s }) => [name,
      ...[s.highest, s.average, s.lowest].map((x) => (x ? `${x[0]} (${fmtNum(x[1])})` : '-')), s.mean === null ? '-' : `${s.mean.toFixed(2)} / ${fmtNum(max)}`])),
    P('* Average = the student whose mark is closest to the class mean.', { italic: true }),
    P('4. Students excluded as absent', { bold: true }),
    att.absentees.size ? T(['Student ID', 'Excluded from'], [...att.absentees].sort((a, b) => a[0] - b[0]).map(([s, cs]) => [s, cs.map((c) => `CO${c}`).join(', ')])) : P('None.'),
    P(''), P(`Generated automatically from the course outline, course information and marks sheet on ${new Date().toISOString().slice(0, 10)}.`, { italic: true }),
  ];
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>`);
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${parts.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
