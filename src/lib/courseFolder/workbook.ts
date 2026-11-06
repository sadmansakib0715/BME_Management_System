// The marks workbooks: the blank template the faculty downloads (stage 1) and the course file's
// "<course>-CO-PO-Assessment-marks.xlsx" (stage 2), in the layout of the BME 211 workbook.
import ExcelJS from 'exceljs';
import { loadWorkbook, plain } from './inputs';
import {
  clean, COHORT_THRESHOLD, fmtNum, isAbsentToken, key, levelTerm, MAX_PO, parseNums, STUDENT_THRESHOLD, studentIds, toId, toMark,
  type Attainment, type CourseInfo, type Item, type Marks, type Outline, Warnings,
} from './model';
import { planColumns, planFromOutline, theoryWeights, type Plan } from './plan';

export const MAP = 'Assessment-CO Mapping';
export const COM = 'CO Marks';
export const IND = 'Individual Attainment CO & PO';
export const COH = 'Cohort Attainment';
const TF_SLOTS = [...'abcde'].map((c) => `Q01 (${c})`).concat([...'abcde'].map((c) => `Q05 (${c})`));

/** One row of the Assessment-CO Mapping: an assessment item and every CO it assesses (one 1 under each). */
export interface Slot { group: string; name: string; max: number | null; cos: number[]; src: [string, string] | null; row?: number }
export interface Spec {
  kind: 'theory' | 'sessional';
  slots: Slot[];
  items?: Item[];                     // sessional
  faculty?: string[]; attEach?: number; attTotal?: number;   // theory
  nCt?: number; best?: number; ctMax?: number; tfSection?: number; att?: number; ca?: number; tf?: number;
}
/** Filled values (all keyed `${sid}:${index}`); null = absent. */
export interface Data {
  att?: Map<string, number | null>; ct?: Map<string, number | null>; bonus?: Map<number, number | null>;
  tf?: Map<string, number | null>; slot?: Map<string, number | null>; item?: Map<string, number | null>;
}
/** One folder of "Sample scripts to upload": folder name, assessment name, max marks, mark per student. */
export interface FolderAssessment { folder: string; name: string; max: number; values: Map<number, number | null> }

// ------------------------------------------------------------------ cell helpers
export const colL = (n: number): string => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
export const colN = (s: string): number => [...s].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
const next = (c: string) => colL(colN(c) + 1);

const THIN = { style: 'thin' as const, color: { argb: 'FF999999' } };
const BOX: Partial<ExcelJS.Borders> = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const GREY = fill('FFBFBFBF'), YEL = fill('FFFFF2CC');
const CTR: Partial<ExcelJS.Alignment> = { horizontal: 'center', vertical: 'middle', wrapText: true };

type V = ExcelJS.CellValue | undefined;
const f = (formula: string, result?: number | string): ExcelJS.CellFormulaValue => ({ formula: formula.replace(/^=/, ''), ...(result !== undefined ? { result } : {}) });

function hdr(ws: ExcelJS.Worksheet, a: string, v?: V) {
  const c = ws.getCell(a);
  if (v !== undefined) c.value = v;
  c.font = { name: 'Calibri', size: 11, bold: true }; c.fill = GREY; c.alignment = CTR; c.border = BOX;
}
function cell(ws: ExcelJS.Worksheet, a: string, v?: V, o: { fmt?: string; inp?: boolean; bold?: boolean } = {}) {
  const c = ws.getCell(a);
  if (v !== undefined) c.value = v;
  c.font = { name: 'Calibri', size: 11, bold: !!o.bold }; c.alignment = CTR; c.border = BOX;
  if (o.fmt) c.numFmt = o.fmt;
  if (o.inp) c.fill = YEL;
}
function validateMarks(ws: ExcelJS.Worksheet, col: string, first: number, last: number, maxRef: string) {
  for (let r = first; r <= last; r++) {
    const a = `${col}${r}`;
    ws.getCell(a).dataValidation = { type: 'custom', allowBlank: true, showErrorMessage: true, errorTitle: 'Invalid mark',
      error: 'Enter a number between 0 and the maximum, or Abs for absent.',
      formulae: [`OR(UPPER(${a})="ABS",UPPER(${a})="ABSENT",AND(ISNUMBER(${a}),${a}>=0,${a}<=${maxRef}))`] };
  }
}
function statsRows(ws: ExcelJS.Worksheet, cols: string[], first: number, last: number): [number, number, number] {
  const hi = last + 2, lo = last + 3, av = last + 4;
  for (const [lab, r, fn] of [['Highest', hi, 'MAX'], ['Lowest', lo, 'MIN'], ['Average', av, 'AVERAGE']] as const) {
    hdr(ws, `A${r}`, lab);
    for (const c of cols) cell(ws, `${c}${r}`, f(`IFERROR(${fn}(${c}${first}:${c}${last}),"")`), { fmt: fn === 'AVERAGE' ? '0.00' : undefined });
  }
  return [hi, lo, av];
}
const markOut = (v: number | null | undefined, filled: boolean, absent = 'Absent'): V => (v === null || v === undefined ? (filled ? absent : null) : v);

// ------------------------------------------------------------------ theory plan
/** Weights (%) of attendance, class tests and term final, and the COs the class tests assess. */
export interface TheoryWeights { att: number; ca: number; tf: number; ctCos?: number[] }

export function theorySpec(info: CourseInfo, o: Outline, w: Warnings, weights?: TheoryWeights): Spec {
  let att: number | null = weights?.att ?? null, ca: number | null = weights?.ca ?? null, tf: number | null = weights?.tf ?? null;
  if (!weights) for (const { name, pct } of o.distribution) {
    const n = name.toLowerCase();
    if (/class\s*test|\bct\b|continuous/.test(n)) ca = (ca ?? 0) + pct;
    else if (/final/.test(n)) tf = (tf ?? 0) + pct;
    else if (/attend|participation/.test(n)) att = (att ?? 0) + pct;
  }
  if (att === null || ca === null || tf === null) { w.add('theory marks distribution not fully recognised in the outline; using 10% / 20% / 70%'); att ??= 10; ca ??= 20; tf ??= 70; }
  const total = info.credit * 100;
  const best = Number(info.extra.ct_best) || Math.round(info.credit);
  const nCt = Number(info.extra.ct_count) || best + 1;
  const ctMax = Math.round(((total * ca) / 100 / best) * 100) / 100;
  const faculty = info.faculties.map((x) => clean(x.name)).filter(Boolean);
  if (!faculty.length) faculty.push('Faculty 1');
  const attTotal = (total * att) / 100;
  return {
    kind: 'theory', att, ca, tf, faculty, attTotal, attEach: Math.round((attTotal / faculty.length) * 100) / 100, nCt, best, ctMax,
    tfSection: Math.round(((total * tf) / 100 / 2) * 100) / 100,
    slots: [
      ...TF_SLOTS.map((s): Slot => ({ group: 'Term Final', name: s, max: null, cos: [], src: null })),
      ...Array.from({ length: nCt }, (_, k): Slot => ({ group: 'Class Tests (optional)', name: `CT${String(k + 1).padStart(2, '0')}`, max: ctMax, cos: weights?.ctCos ?? [], src: ['CA Marks', colL(2 + k)] })),
    ],
  };
}

// ------------------------------------------------------------------ stage 1
/** The marks sheet the faculty downloads, built from the assessment tree (`plan`, read from the outline when not given).
    `theory` layout: the department's theory workbook, blank. `columns` layout: the single `ca` sheet, one column per assessment. */
export async function marksTemplate(info: CourseInfo, o: Outline, w: Warnings, plan: Plan = planFromOutline(info, o, w)): Promise<Uint8Array> {
  const ids = studentIds(info);
  if (plan.layout === 'theory') return courseWorkbook(info, o, ids, theorySpec(info, o, w, theoryWeights(plan)), null, true);
  const items = planColumns(plan);
  if (!items.length) throw new Error('the assessment list is empty: add the assessments first');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('ca');
  const tot = colL(items.length + 2);
  const last = colL(items.length + 1);
  ws.getCell('A1').value = 'Assessment'; ws.getCell('A2').value = 'CO'; ws.getCell('A3').value = 'Total'; ws.getCell('A4').value = 'Student ID';
  items.forEach((it, k) => { const c = colL(2 + k); ws.getCell(`${c}1`).value = it.name; ws.getCell(`${c}2`).value = it.cos.map((x) => `CO${x}`).join(', '); ws.getCell(`${c}3`).value = it.max; });
  ws.getCell(`${tot}1`).value = 'Total';
  ws.getCell(`${tot}3`).value = f(`SUM(B3:${last}3)`);
  ids.forEach((sid, i) => {
    const r = 5 + i;
    ws.getCell(`A${r}`).value = sid;
    ws.getCell(`${tot}${r}`).value = f(`IF(COUNT(B${r}:${last}${r})=0,IF(COUNTIF(B${r}:${last}${r},"Abs*")>0,"Abs",""),SUM(B${r}:${last}${r}))`);
  });
  const lastRow = 4 + ids.length;
  for (let r = 1; r <= lastRow; r++) for (let j = 1; j <= items.length + 2; j++) {
    const a = `${colL(j)}${r}`;
    if (r <= 4) hdr(ws, a); else cell(ws, a, undefined, { bold: j === 1, inp: j > 1 && j < items.length + 2 });
  }
  items.forEach((_, k) => validateMarks(ws, colL(2 + k), 5, lastRow, `${colL(2 + k)}$3`));
  ws.getColumn(1).width = 13;
  for (let j = 2; j <= items.length + 2; j++) ws.getColumn(j).width = 16;
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 4 }];
  const g = colL(items.length + 4);
  ws.getCell(`${g}1`).value = `${info.courseNo} | ${info.semester} | Level-Term ${levelTerm(info)}`; ws.getCell(`${g}1`).font = { bold: true };
  ws.getCell(`${g}2`).value = 'Enter marks in the yellow cells. Type Abs for an absent student.';
  ws.getCell(`${g}3`).value = 'Do not change rows 1-4 or the Student ID column.';
  ws.getColumn(items.length + 4).width = 60;
  meta(wb, { course_no: info.courseNo, semester: info.semester, kind: 'columns', layout: 'columns-ca-v1' });
  return save(wb);
}

function meta(wb: ExcelJS.Workbook, m: Record<string, string | number>) {
  const ws = wb.addWorksheet('_meta');
  Object.entries({ ...m, generated: new Date().toISOString().slice(0, 10) }).forEach(([k, v], i) => { ws.getCell(`A${i + 1}`).value = k; ws.getCell(`B${i + 1}`).value = v; });
  ws.state = 'hidden';
}

async function save(wb: ExcelJS.Workbook): Promise<Uint8Array> {
  wb.calcProperties.fullCalcOnLoad = true;
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

// ------------------------------------------------------------------ BME 211 layout
/** The CO-PO assessment workbook. `data` = filled values (null for a blank template); `att` adds cached results. */
export async function courseWorkbook(info: CourseInfo, o: Outline, ids: number[], spec: Spec, data: Data | null, template: boolean, att?: Attainment): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const d = data ?? {};
  const filled = !!data && !template;
  const n = ids.length;
  const cos = o.cos.map((c) => c.no);

  if (spec.kind === 'theory') {
    // Attendance Summary
    let ws = wb.addWorksheet('Attendance Summary');
    const fac = spec.faculty!, nf = fac.length, tot = colL(2 + nf);
    ws.mergeCells('A1:A2'); hdr(ws, 'A1', 'Student ID'); hdr(ws, 'A2');
    fac.forEach((x, k) => { hdr(ws, `${colL(2 + k)}1`, x); hdr(ws, `${colL(2 + k)}2`, `Marks (${fmtNum(spec.attEach!)})`); });
    ws.mergeCells(`${tot}1:${tot}2`); hdr(ws, `${tot}1`, `Total Marks (${fmtNum(spec.attTotal!)})`); hdr(ws, `${tot}2`);
    const step = Number.isInteger(info.credit) ? info.credit : 1;
    ids.forEach((sid, i) => {
      const r = 3 + i;
      cell(ws, `A${r}`, sid);
      for (let k = 0; k < nf; k++) cell(ws, `${colL(2 + k)}${r}`, markOut(d.att?.get(key(sid, k)), filled), { inp: true });
      cell(ws, `${tot}${r}`, f(`MIN(${fmtNum(spec.attTotal!)},ROUNDUP(SUM(B${r}:${colL(1 + nf)}${r})/${step},0)*${step})`));
    });
    for (let k = 0; k < nf; k++) validateMarks(ws, colL(2 + k), 3, 2 + n, fmtNum(spec.attEach!));
    ws.getColumn(1).width = 16; for (let k = 0; k <= nf; k++) ws.getColumn(2 + k).width = 18;
    ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 2 }];

    // CA Marks
    ws = wb.addWorksheet('CA Marks');
    const nct = spec.nCt!;
    const ctCols = Array.from({ length: nct }, (_, k) => colL(2 + k));
    const bc = colL(2 + nct), bonus = colL(3 + nct), totc = colL(4 + nct);
    hdr(ws, 'A1', 'Student ID');
    ctCols.forEach((c, k) => hdr(ws, `${c}1`, `CT${String(k + 1).padStart(2, '0')} (${fmtNum(spec.ctMax!)})`));
    hdr(ws, `${bc}1`, `Best ${spec.best} of ${nct}`); hdr(ws, `${bonus}1`, 'Bonus'); hdr(ws, `${totc}1`, 'Total');
    ids.forEach((sid, i) => {
      const r = 2 + i;
      cell(ws, `A${r}`, sid);
      ctCols.forEach((c, k) => cell(ws, `${c}${r}`, markOut(d.ct?.get(key(sid, k)), filled), { inp: true }));
      const rng = `${ctCols[0]}${r}:${colL(1 + nct)}${r}`;
      const larg = Array.from({ length: spec.best! }, (_, j) => `IFERROR(LARGE(${rng},${j + 1}),0)`).join('+');
      cell(ws, `${bc}${r}`, f(`IF(COUNT(${rng})=0,IF(COUNTIF(${rng},"Abs*")>0,"Absent",""),ROUNDUP(${larg},0))`));
      cell(ws, `${bonus}${r}`, d.bonus?.get(sid) ?? null, { inp: true });
      cell(ws, `${totc}${r}`, f(`IF(ISNUMBER(${bc}${r}),${bc}${r}+N(${bonus}${r}),${bc}${r})`));
    });
    if (n) {
      statsRows(ws, [...ctCols, totc], 2, 1 + n);
      for (const c of ctCols) validateMarks(ws, c, 2, 1 + n, fmtNum(spec.ctMax!));
    }
    ws.getColumn(1).width = 16; for (let j = 2; j <= 4 + nct; j++) ws.getColumn(j).width = 12; ws.getColumn(colN(bc)).width = 14;
    ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];

    // TF Marks
    ws = wb.addWorksheet('TF Marks');
    const sm = fmtNum(spec.tfSection!);
    ([['A', 'Student ID'], ['B', `Section A (${sm})`], ['C', `Section B (${sm})`], ['D', 'Total']] as const).forEach(([c, v]) => hdr(ws, `${c}1`, v));
    ids.forEach((sid, i) => {
      const r = 2 + i;
      cell(ws, `A${r}`, sid);
      cell(ws, `B${r}`, markOut(d.tf?.get(key(sid, 0)), filled), { inp: true });
      cell(ws, `C${r}`, markOut(d.tf?.get(key(sid, 1)), filled), { inp: true });
      cell(ws, `D${r}`, f(`IF(COUNT(B${r},C${r})=0,IF(COUNTIF(B${r}:C${r},"Abs*")>0,"Absent",""),SUM(B${r},C${r}))`));
    });
    if (n) {
      statsRows(ws, ['B', 'C', 'D'], 2, 1 + n);
      for (const c of ['B', 'C']) validateMarks(ws, c, 2, 1 + n, sm);
    }
    ws.getColumn(1).width = 16; for (let j = 2; j <= 4; j++) ws.getColumn(j).width = 16;
    ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];
  } else {
    // Sessional: CA Marks = the uploaded `ca` sheet, one column per assessment
    const ws = wb.addWorksheet('CA Marks');
    const items = spec.items!;
    const cols = items.map((_, k) => colL(2 + k));
    const tc = colL(2 + items.length);
    hdr(ws, 'A1', 'Student ID');
    items.forEach((it, k) => hdr(ws, `${cols[k]}1`, `${it.name} (${fmtNum(it.max)})`));
    hdr(ws, `${tc}1`, `Total (${fmtNum(items.reduce((a, i) => a + i.max, 0))})`);
    ids.forEach((sid, i) => {
      const r = 2 + i;
      cell(ws, `A${r}`, sid);
      cols.forEach((c, k) => cell(ws, `${c}${r}`, markOut(d.item?.get(key(sid, k)), filled), { inp: true }));
      const refs = cols.map((c) => `${c}${r}`).join(',');
      cell(ws, `${tc}${r}`, f(`IF(COUNT(${refs})=0,"Absent",SUM(${refs}))`));
    });
    if (n) {
      statsRows(ws, [...cols, tc], 2, 1 + n);
    }
    ws.getColumn(1).width = 16; for (let j = 2; j <= 2 + items.length; j++) ws.getColumn(j).width = 16;
    ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];
  }

  // ---- Assessment-CO Mapping
  const slots = spec.slots;
  let ws = wb.addWorksheet(MAP);
  hdr(ws, 'A1', 'CO-Assessment Mapping'); hdr(ws, 'B1', 'Assessment'); hdr(ws, 'C1', 'Marks');
  const coCol = new Map(cos.map((c, k) => [c, colL(4 + k)]));
  for (const c of cos) hdr(ws, `${coCol.get(c)}1`, `CO${c}`);
  const groups: [string, number, number][] = [];
  slots.forEach((s, k) => {
    const r = 2 + k;
    s.row = r;
    if (!groups.length || groups[groups.length - 1][0] !== s.group) groups.push([s.group, r, r]);
    groups[groups.length - 1][2] = r;
    cell(ws, `B${r}`, s.name, { bold: true, inp: template && !s.src });
    cell(ws, `C${r}`, s.max, { inp: template && !s.src });
    for (const c of cos) {
      cell(ws, `${coCol.get(c)}${r}`, s.cos.includes(c) ? 1 : null, { inp: template });
      ws.getCell(`${coCol.get(c)}${r}`).dataValidation = { type: 'whole', operator: 'equal', formulae: [1], allowBlank: true, showErrorMessage: true, error: 'Put 1 under each CO this item assesses.' };
    }
  });
  const lastSlot = 1 + slots.length;
  for (const [g, a, b] of groups) { if (b > a) ws.mergeCells(`A${a}:A${b}`); cell(ws, `A${a}`, g, { bold: true }); }
  const pr = lastSlot + 2;
  ws.mergeCells(`A${pr}:A${pr + cos.length}`); hdr(ws, `A${pr}`, 'CO-PO Mapping'); hdr(ws, `B${pr}`, 'CO\\PO');
  for (let p = 1; p <= MAX_PO; p++) hdr(ws, `${colL(2 + p)}${pr}`, `PO${p}`);
  o.cos.forEach((c, k) => {
    const rr = pr + 1 + k;
    cell(ws, `B${rr}`, `CO${c.no}`, { bold: true });
    for (let p = 1; p <= MAX_PO; p++) cell(ws, `${colL(2 + p)}${rr}`, c.pos.includes(p) ? 1 : null);
  });
  ws.getColumn(1).width = 32; ws.getColumn(2).width = 18; ws.getColumn(3).width = 8;
  ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 0 }];
  if (template && spec.kind === 'theory') {
    const nc = colL(6 + Math.max(cos.length, MAX_PO));
    ws.getCell(`${nc}1`).value = 'Fill the yellow cells: for each Term Final sub-part (Q1 and Q5) give its marks and put 1 under its CO. Leave unused rows blank. CTs count towards a CO only if you tick one.';
    ws.getCell(`${nc}1`).alignment = { wrapText: true, vertical: 'top' };
    ws.getColumn(colN(nc)).width = 60;
  }

  // ---- CO Marks
  ws = wb.addWorksheet(COM);
  ws.mergeCells('A1:A3'); hdr(ws, 'A1', 'Student ID');
  const scol = slots.map((_, k) => colL(2 + k));
  slots.forEach((s, k) => {
    const c = scol[k], mr = s.row!;
    hdr(ws, `${c}2`, f(`IF('${MAP}'!B${mr}="","",IF('${MAP}'!C${mr}="",'${MAP}'!B${mr},'${MAP}'!B${mr}&" ("&TEXT('${MAP}'!C${mr},"0.0")&")"))`,
      s.name + (s.max ? ` (${s.max.toFixed(1)})` : '')));
    // Every ticked CO, e.g. "CO1, CO2".
    hdr(ws, `${c}3`, f(`SUBSTITUTE(TRIM(${cos.map((x) => `IF('${MAP}'!${coCol.get(x)}${mr}=1,"CO${x} ","")`).join('&')})," ",", ")`, s.cos.map((x) => `CO${x}`).join(', ')));
  });
  for (const [g] of groups) {
    const ks = slots.map((s, k) => (s.group === g ? k : -1)).filter((k) => k >= 0);
    const c1 = scol[ks[0]], c2 = scol[ks[ks.length - 1]];
    if (c1 !== c2) ws.mergeCells(`${c1}1:${c2}1`);
    hdr(ws, `${c1}1`, g);
  }
  ids.forEach((sid, i) => {
    const r = 4 + i;
    cell(ws, `A${r}`, sid);
    slots.forEach((s, k) => {
      if (!s.src) {
        const v = d.slot?.get(key(sid, k));
        cell(ws, `${scol[k]}${r}`, v ?? (filled && s.cos.length ? 'Abs' : null), { inp: true });
      } else {
        const src = `'${s.src[0]}'!${s.src[1]}${2 + i}`;
        cell(ws, `${scol[k]}${r}`, f(`IF(ISNUMBER(${src}),${src},IF(${src}="","","Abs"))`));
      }
    });
  });
  slots.forEach((s, k) => { if (!s.src && n) validateMarks(ws, scol[k], 4, 3 + n, `'${MAP}'!$C$${s.row}`); });
  ws.getColumn(1).width = 14; scol.forEach((c) => (ws.getColumn(colN(c)).width = 16));
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 3 }];

  // ---- Individual Attainment CO & PO
  ws = wb.addWorksheet(IND);
  ws.mergeCells('A1:A2'); hdr(ws, 'A1', 'Student ID');
  const posUsed = [...new Set(o.cos.flatMap((c) => c.pos))].sort((a, b) => a - b);
  const pct = new Map<string, string>();
  let j = 2;
  const pair = (k: string, label: string) => {
    const a = colL(j), b = colL(j + 1);
    pct.set(k, a);
    ws.mergeCells(`${a}1:${b}1`); hdr(ws, `${a}1`, label); hdr(ws, `${a}2`, 'Percentage'); hdr(ws, `${b}2`, 'Y/N');
    j += 2;
  };
  cos.forEach((c) => pair(`co${c}`, `CO${c} Attainment`));
  posUsed.forEach((p) => pair(`po${p}`, `PO${p} Attainment`));
  const tl = colL(j + 1), tv = colL(j + 2);
  hdr(ws, `${tl}1`, 'CO Attainment Threshold'); cell(ws, `${tv}1`, STUDENT_THRESHOLD, { fmt: '0%', inp: true });
  hdr(ws, `${tl}2`, 'PO Attainment Threshold'); cell(ws, `${tv}2`, STUDENT_THRESHOLD, { fmt: '0%', inp: true });
  const MX = `'${MAP}'!$C$2:$C$${lastSlot}`;
  const res = (m: Map<string, number | null> | undefined, k: string, used: boolean, thr: number): [V, V] => {
    if (!att || !m) return [undefined, undefined];
    if (!used) return ['NA', 'NA'];
    const v = m.get(k);
    return v === null || v === undefined ? ['Abs', 'Abs'] : [v / 100, v >= thr * 100 - 1e-9 ? 'Y' : 'N'];
  };
  ids.forEach((sid, i) => {
    const r = 3 + i, cr = 4 + i;
    cell(ws, `A${r}`, sid);
    for (const c of cos) {
      const pc = pct.get(`co${c}`)!, yc = next(pc), cc = coCol.get(c)!;
      const TICK = `'${MAP}'!$${cc}$2:$${cc}$${lastSlot}`;
      const [rv, ry] = res(att?.studentCo, key(sid, c), !!att?.co.has(c), STUDENT_THRESHOLD);
      // Marks of every item ticked for this CO (an item ticked for two COs counts for both) / their maximum.
      const tick = (s: Slot) => `'${MAP}'!$${cc}$${s.row}=1`, mark = (k: number) => `'${COM}'!${scol[k]}${cr}`;
      const got = slots.map((s, k) => `IF(${tick(s)},N(${mark(k)}),0)`).join('+');
      const sat = slots.map((s, k) => `IF(AND(${tick(s)},ISNUMBER(${mark(k)})),1,0)`).join('+');
      cell(ws, `${pc}${r}`, f(`IF(SUMIF(${TICK},1,${MX})=0,"NA",IF((${sat})=0,"Abs",(${got})/SUMIF(${TICK},1,${MX})))`, rv as number | string | undefined), { fmt: '0.00%' });
      cell(ws, `${yc}${r}`, f(`IF(ISNUMBER(${pc}${r}),IF(${pc}${r}>=$${tv}$1,"Y","N"),${pc}${r})`, ry as string | undefined));
    }
    for (const p of posUsed) {
      const pc = pct.get(`po${p}`)!, yc = next(pc);
      const refs = o.cos.filter((c) => c.pos.includes(p)).map((c) => `${pct.get(`co${c.no}`)}${r}`);
      const allNa = refs.length > 1 ? `AND(${refs.map((x) => `${x}="NA"`).join(',')})` : `${refs[0]}="NA"`;
      const [rv, ry] = res(att?.studentPo, key(sid, p), !!att?.po.has(p), STUDENT_THRESHOLD);
      cell(ws, `${pc}${r}`, f(`IF(${allNa},"NA",IFERROR(AVERAGE(${refs.join(',')}),"Abs"))`, rv as number | string | undefined), { fmt: '0.00%' });
      cell(ws, `${yc}${r}`, f(`IF(ISNUMBER(${pc}${r}),IF(${pc}${r}>=$${tv}$2,"Y","N"),${pc}${r})`, ry as string | undefined));
    }
  });
  ws.getColumn(1).width = 14; for (let k = 2; k < j; k++) ws.getColumn(k).width = 13; ws.getColumn(colN(tl)).width = 28; ws.getColumn(colN(tv)).width = 14;
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 2 }];

  // ---- Cohort Attainment
  ws = wb.addWorksheet(COH);
  const lastInd = 2 + n;
  for (const [r0, lab] of [[1, 'CO Attainment'], [6, 'PO Attainment']] as const) {
    hdr(ws, `A${r0}`, lab); hdr(ws, `A${r0 + 1}`, '%student attained'); hdr(ws, `A${r0 + 2}`, 'Cohort Attainment'); hdr(ws, `A${r0 + 3}`, 'Students assessed');
  }
  const cohortRes = (m: Map<number, { pct: number | null; ok: boolean | null; assessed: number }> | undefined, k: number) => {
    const x = att && m ? m.get(k) : undefined;
    if (!att) return [undefined, undefined, undefined] as const;
    if (!x || x.pct === null) return ['NA', 'NA', x?.assessed ?? 0] as const;
    return [x.pct / 100, x.ok ? 'Y' : 'N', x.assessed] as const;
  };
  cos.forEach((c, k) => {
    const col = colL(2 + k), yc = next(pct.get(`co${c}`)!);
    const rng = `'${IND}'!${yc}3:${yc}${lastInd}`;
    const [rv, ry, rn] = cohortRes(att?.co, c);
    hdr(ws, `${col}1`, `CO${c}`);
    cell(ws, `${col}4`, f(`COUNTIF(${rng},"Y")+COUNTIF(${rng},"N")`, rn));
    cell(ws, `${col}2`, f(`IF(${col}4=0,"NA",COUNTIF(${rng},"Y")/${col}4)`, rv), { fmt: '0.00%' });
    cell(ws, `${col}3`, f(`IF(ISNUMBER(${col}2),IF(${col}2>=$P$2,"Y","N"),"NA")`, ry));
  });
  for (let p = 1; p <= MAX_PO; p++) {
    const col = colL(1 + p);
    hdr(ws, `${col}6`, `PO${p}`);
    if (posUsed.includes(p)) {
      const yc = next(pct.get(`po${p}`)!);
      const rng = `'${IND}'!${yc}3:${yc}${lastInd}`;
      const [rv, ry, rn] = cohortRes(att?.po, p);
      cell(ws, `${col}9`, f(`COUNTIF(${rng},"Y")+COUNTIF(${rng},"N")`, rn));
      cell(ws, `${col}7`, f(`IF(${col}9=0,"NA",COUNTIF(${rng},"Y")/${col}9)`, rv), { fmt: '0.00%' });
      cell(ws, `${col}8`, f(`IF(ISNUMBER(${col}7),IF(${col}7>=$P$3,"Y","N"),"NA")`, ry));
    } else for (const rr of [7, 8, 9]) cell(ws, `${col}${rr}`, 'N/A');
  }
  hdr(ws, 'O1', 'Number of students'); cell(ws, 'P1', f(`COUNTA('${IND}'!A3:A${Math.max(lastInd, 3)})`, att ? n : undefined));
  hdr(ws, 'O2', 'Cohort CO Attainment Threshold'); cell(ws, 'P2', COHORT_THRESHOLD, { fmt: '0%', inp: true });
  hdr(ws, 'O3', 'Cohort PO Attainment Threshold'); cell(ws, 'P3', COHORT_THRESHOLD, { fmt: '0%', inp: true });
  ws.getColumn(1).width = 22; for (let k = 2; k <= 13; k++) ws.getColumn(k).width = 12; ws.getColumn(15).width = 32; ws.getColumn(16).width = 14;

  meta(wb, { course_no: info.courseNo, semester: info.semester, kind: spec.kind, layout: `${spec.kind}-bme211-v2`, n_students: n, n_ct: spec.nCt ?? '', att_pct: spec.att ?? '', ca_pct: spec.ca ?? '', tf_pct: spec.tf ?? '' });
  return save(wb);
}

// ------------------------------------------------------------------ reading the uploads
const v = (ws: ExcelJS.Worksheet, a: string | [number, number]) => plain(typeof a === 'string' ? ws.getCell(a).value : ws.getCell(a[0], a[1]).value);

/** Sessional: the `ca` sheet (rows Assessment / CO / Total / Student ID). */
export async function readSessionalMarks(data: ArrayBuffer | Uint8Array, o: Outline, w: Warnings): Promise<Marks> {
  const wb = await loadWorkbook(data);
  const ws = wb.getWorksheet('ca') ?? wb.worksheets[0];
  const rows: Record<string, number> = {};
  for (let r = 1; r <= Math.min(ws.rowCount, 30); r++) {
    const a = clean(v(ws, [r, 1])).toLowerCase();
    if (['assessment', 'co', 'total', 'student id'].includes(a) && !(a in rows)) rows[a] = r;
  }
  for (const need of ['assessment', 'co', 'total', 'student id']) if (!(need in rows)) throw new Error(`marks sheet: no row labelled '${need}' in column A`);
  const items: Item[] = [], cols: number[] = [];
  for (let j = 2; ; j++) {
    const name = clean(v(ws, [rows.assessment, j]));
    if (!name || name.toLowerCase() === 'total') break;
    const cos = parseNums(v(ws, [rows.co, j]), 'CO');
    const mx = Number(v(ws, [rows.total, j]));
    if (!Number.isFinite(mx) || mx <= 0) throw new Error(`marks sheet: column '${name}' has no numeric Total`);
    if (!cos.length) w.add(`marks sheet: column '${name}' has no CO; ignored for attainment`);
    for (const c of cos) if (!o.cos.some((x) => x.no === c)) w.add(`marks sheet: column '${name}' maps to CO${c}, which is not in the outline`);
    items.push({ name, cos, max: mx }); cols.push(j);
  }
  const ids: number[] = [];
  const values = new Map<string, number | null>();
  for (let r = rows['student id'] + 1; r <= ws.rowCount; r++) {
    const sid = toId(v(ws, [r, 1]));
    if (sid === null) continue;
    ids.push(sid);
    cols.forEach((c, k) => values.set(key(sid, k), readMark(v(ws, [r, c]), sid, items[k], w)));
  }
  return { items, ids, values };
}

function readMark(raw: string | number | null, sid: number, it: { name: string; max: number | null }, w: Warnings, blankIsAbsent = true): number | null {
  if (raw === null || clean(raw) === '') { if (blankIsAbsent) w.add(`${sid} '${it.name}' is blank; treated as Abs`); return null; }
  const m = toMark(raw);
  if (m === null && !isAbsentToken(raw)) w.add(`${sid} '${it.name}' = '${raw}' is not a mark; treated as Abs`);
  if (m !== null && it.max !== null && (m < 0 || m > it.max + 1e-9)) w.add(`${sid} '${it.name}' = ${m} is outside 0–${fmtNum(it.max)}`);
  return m;
}

export function sessionalInputs(m: Marks, _w?: Warnings): { spec: Spec; data: Data; folders: FolderAssessment[] } {
  const spec: Spec = { kind: 'sessional', items: m.items,
    slots: m.items.map((it, k) => ({ group: 'Assessments', name: it.name, max: it.max, cos: it.cos, src: ['CA Marks', colL(2 + k)] })) };
  const item = new Map<string, number | null>();
  m.ids.forEach((s) => m.items.forEach((_, k) => item.set(key(s, k), m.values.get(key(s, k)) ?? null)));
  const folders = m.items.map((it, k) => ({ folder: it.name, name: it.name, max: it.max, values: new Map(m.ids.map((s) => [s, m.values.get(key(s, k)) ?? null])) }));
  return { spec, data: { item }, folders };
}

/** Theory: the filled BME 211-layout workbook. CO marks come from CO Marks (term-final sub-parts) and CA Marks (ticked CTs). */
export async function readTheoryWorkbook(data: ArrayBuffer | Uint8Array, info: CourseInfo, o: Outline, w: Warnings) {
  const wb = await loadWorkbook(data);
  for (const sh of ['Attendance Summary', 'CA Marks', 'TF Marks', MAP, COM]) if (!wb.getWorksheet(sh)) throw new Error(`marks workbook: sheet '${sh}' is missing (download a fresh template)`);
  const metaWs = wb.getWorksheet('_meta');
  const mv: Record<string, number> = {};
  if (metaWs) for (let r = 1; r <= metaWs.rowCount; r++) { const n = Number(v(metaWs, [r, 2])); if (Number.isFinite(n) && clean(v(metaWs, [r, 2])) !== '') mv[clean(v(metaWs, [r, 1]))] = n; }
  // The weights the template was made with (the faculty may have edited them on the page); older templates: from the outline.
  const spec = theorySpec(info, o, new Warnings(), 'tf_pct' in mv ? { att: mv.att_pct ?? 0, ca: mv.ca_pct ?? 0, tf: mv.tf_pct } : undefined);
  if (mv.n_ct) spec.nCt = mv.n_ct;
  const cm = wb.getWorksheet(COM)!, mp = wb.getWorksheet(MAP)!, ca = wb.getWorksheet('CA Marks')!, tf = wb.getWorksheet('TF Marks')!, at = wb.getWorksheet('Attendance Summary')!;
  const ids: number[] = [];
  const crow = new Map<number, number>();
  for (let r = 4; r <= cm.rowCount; r++) { const s = toId(v(cm, [r, 1])); if (s !== null) { ids.push(s); crow.set(s, r); } }
  const coCols = new Map<number, number>();
  for (let c = 4; c <= mp.columnCount; c++) { const m = clean(v(mp, [1, c])).match(/^CO\s*(\d+)$/i); if (m) coCols.set(c, Number(m[1])); }
  const caCols = new Map<number, number>();
  let bonusCol = 0;
  for (let c = 2; c <= ca.columnCount; c++) { const h = clean(v(ca, [1, c])); const m = h.match(/^CT\s*(\d+)/i); if (m) caCols.set(Number(m[1]), c); if (/^bonus/i.test(h)) bonusCol = c; }
  const tfCol = (rx: RegExp, dflt: number) => { for (let c = 2; c <= tf.columnCount; c++) if (rx.test(clean(v(tf, [1, c])))) return c; return dflt; };
  const tfA = tfCol(/^section\s*a/i, 2), tfB = tfCol(/^section\s*b/i, 3);
  const slots: (Slot & { col: number })[] = [];
  let group = '';
  for (let r = 2; r <= mp.rowCount; r++) {
    const b = clean(v(mp, [r, 2]));
    const a = clean(v(mp, [r, 1]));
    if (a) group = a;
    if (b.toUpperCase().startsWith('CO\\PO') || group.toLowerCase().startsWith('co-po')) break;
    if (!b) continue;
    const ticks = [...coCols].filter(([c]) => toMark(v(mp, [r, c])) === 1).map(([, co]) => co);
    const mx = toMark(v(mp, [r, 3]));
    if (ticks.length && !mx) w.add(`mapping: '${b}' is ticked for CO${ticks.join(', CO')} but has no marks`);
    const ct = b.match(/^CT\s*(\d+)/i);
    const src: [string, string] | null = ct && caCols.has(Number(ct[1])) ? ['CA Marks', colL(caCols.get(Number(ct[1]))!)] : null;
    slots.push({ group, name: b, max: mx, cos: ticks, src, col: 2 + slots.length });
  }
  const caRow = new Map<number, number>();
  for (let r = 2; r <= ca.rowCount; r++) { const s = toId(v(ca, [r, 1])); if (s !== null) caRow.set(s, r); }
  const slot = new Map<string, number | null>();
  const items: Item[] = [];
  const values = new Map<string, number | null>();
  slots.forEach((s, k) => {
    for (const sid of ids) {
      let val: number | null;
      if (s.src) { const rr = caRow.get(sid); val = rr ? toMark(v(ca, `${s.src[1]}${rr}`)) : null; }
      else val = s.cos.length ? readMark(v(cm, [crow.get(sid)!, s.col]), sid, s, w) : toMark(v(cm, [crow.get(sid)!, s.col]));
      slot.set(key(sid, k), val);
    }
    if (s.cos.length && s.max) {
      items.push({ name: s.name, cos: s.cos, max: s.max });
      for (const sid of ids) values.set(key(sid, items.length - 1), slot.get(key(sid, k)) ?? null);
    }
  });
  const d: Data = { slot, att: new Map(), ct: new Map(), bonus: new Map(), tf: new Map() };
  const nf = spec.faculty!.length;
  for (let r = 3; r <= at.rowCount; r++) { const s = toId(v(at, [r, 1])); if (s !== null) for (let k = 0; k < nf; k++) d.att!.set(key(s, k), toMark(v(at, [r, 2 + k]))); }
  for (const [s, rr] of caRow) {
    for (let k = 0; k < spec.nCt!; k++) if (caCols.has(k + 1)) d.ct!.set(key(s, k), toMark(v(ca, [rr, caCols.get(k + 1)!])));
    if (bonusCol) d.bonus!.set(s, toMark(v(ca, [rr, bonusCol])));
  }
  const tfTotal = new Map<number, number | null>();
  for (let r = 2; r <= tf.rowCount; r++) {
    const s = toId(v(tf, [r, 1]));
    if (s === null) continue;
    const a = toMark(v(tf, [r, tfA])), b = toMark(v(tf, [r, tfB]));
    d.tf!.set(key(s, 0), a); d.tf!.set(key(s, 1), b);
    tfTotal.set(s, a === null && b === null ? null : (a ?? 0) + (b ?? 0));
  }
  const folders: FolderAssessment[] = Array.from({ length: spec.nCt! }, (_, k) => ({
    folder: `Assessments ${k + 1}`, name: `CT${String(k + 1).padStart(2, '0')}`, max: spec.ctMax!, values: new Map(ids.map((s) => [s, d.ct!.get(key(s, k)) ?? null])) }));
  folders.push({ folder: 'Term Final', name: 'Term Final', max: spec.tfSection! * 2, values: new Map(ids.map((s) => [s, tfTotal.get(s) ?? null])) });
  spec.slots = slots.map(({ col: _c, ...s }) => s);
  return { marks: { items, ids, values } as Marks, spec, data: d, folders };
}

/** Last term's generated workbook → CAR Part B rows for the previous term. */
export async function readPrevious(data: ArrayBuffer | Uint8Array, w: Warnings) {
  const wb = await loadWorkbook(data);
  const ws = wb.getWorksheet(COH);
  if (!ws) { w.add("the previous term's workbook has no 'Cohort Attainment' sheet; previous term shown as Not available"); return null; }
  let semester = '';
  const m = wb.getWorksheet('_meta');
  if (m) for (let r = 1; r <= m.rowCount; r++) if (clean(v(m, [r, 1])) === 'semester') semester = clean(v(m, [r, 2]));
  const row = (hdrRow: number, kind: string): [string, string][] => {
    const vals = new Map<number, [string, string]>();
    for (let c = 2; c <= ws.columnCount; c++) {
      const mm = clean(v(ws, [hdrRow, c])).match(new RegExp(`^${kind}(\\d+)$`));
      if (!mm) continue;
      const pv = v(ws, [hdrRow + 1, c]);
      vals.set(Number(mm[1]), typeof pv === 'number' ? [(pv * 100).toFixed(2), clean(v(ws, [hdrRow + 2, c]))] : ['NA', 'NA']);
    }
    return Array.from({ length: 12 }, (_, i) => vals.get(i + 1) ?? ['NA', 'NA']);
  };
  return { semester: semester || 'Previous term', co: row(1, 'CO'), po: row(6, 'PO') };
}

/** A blank course_information.xlsx: the website's sheets plus `sections`, one example row each and a notes sheet. */
export async function courseInfoTemplate(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const sheets: [string, string[], (string | number)[]][] = [
    ['info', ['course_no', 'credit_hours', 'contact_hours', 'level', 'term', 'semester', 'session', 'last_offered', 'bugs_resolution_link', 'batch', 'course_type', 'ct_count', 'ct_best'],
      ['BME 211', 3, 3, 2, 2, 'July 2025', '2023-2024', 'January 2024', '', '', '', '', '']],
    ['faculties', ['name', 'section', 'office_room', 'email', 'telephone', 'consultation'], ['Teacher Name', '', 'ECE-1121', 'teacher@bme.buet.ac.bd', '+880 1XXXXXXXXX', 'Sunday 2:00-3:00 PM']],
    ['routine', ['section', 'day', 'start_time', 'end_time'], ['', 'Sunday', '09:00 AM', '09:50 AM']],
    ['sections', ['section', 'first_roll', 'last_roll', 'extra_ids', 'exclude_ids'], ['A', 1, 50, '', '']],
  ];
  for (const [name, cols, example] of sheets) {
    const ws = wb.addWorksheet(name);
    ws.addRow(cols).font = { bold: true };
    ws.addRow(example);
    cols.forEach((_, k) => (ws.getColumn(k + 1).width = 18));
  }
  const n = wb.addWorksheet('notes');
  [['sheet', 'column', 'required', 'meaning'],
    ['all', '-', '-', 'Row 2 of each sheet is an example: replace it with the course\'s data.'],
    ['info', 'course_no … session', 'yes', 'as on the course outline; semester like "July 2025", session like "2023-2024"'],
    ['info', 'last_offered', 'no', 'CAR Part A "Last term when the course was offered"'],
    ['info', 'bugs_resolution_link', 'no', 'URL; adds "BUGS Resolution.url" to the folder'],
    ['info', 'batch', 'no', 'two digits; default = session start year − (level − 1), e.g. 2023-2024 at level 2 → 22'],
    ['info', 'course_type', 'no', 'theory or sessional; default: odd course number = theory, even = sessional'],
    ['info', 'ct_count, ct_best', 'no', 'theory only; default best = credit hours, count = best + 1 (3 credits → best 3 of 4)'],
    ['faculties', 'section', 'no', 'blank = teaches every section (A1, A2…)'],
    ['routine', 'all', 'yes', 'one row per class slot'],
    ['sections', 'first_roll, last_roll', 'yes', 'student IDs = batch + 18 + three-digit roll'],
    ['sections', 'extra_ids, exclude_ids', 'no', 'comma-separated full IDs: repeaters to add, IDs to drop'],
  ].forEach((r, i) => { const row = n.addRow(r); if (i === 0) row.font = { bold: true }; });
  [12, 24, 10, 90].forEach((wd, k) => (n.getColumn(k + 1).width = wd));
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
