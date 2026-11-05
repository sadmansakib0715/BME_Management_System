// Attainment from an uploaded marksheet (spec sections 6–8). The marksheet template is generated from the offering's assessment map:
// one column per question part or rubric criterion, already tagged to COs. The teacher fills in marks, uploads the file, and the
// student CO% → student PO% → cohort CO% / PO% cascade is computed here, in the browser. Raw marks are never saved; only results are.
import type * as XLSXNS from 'xlsx';
import type { CoPo, CourseOutcome, CriterionCo, ObeCriterion } from './types';
import { byAssessment } from './obe';

type XLSX = typeof XLSXNS;

/** One marksheet column: a question part or criterion, its marks and the CO codes it assesses. */
export interface MarkColumn { id: string; assessment: string; label: string; max: number; cos: string[] }
/** A mark cell after parsing: a number, absent (counts as 0), exempt (left out of that student's denominators) or blank. */
export type Mark = number | 'absent' | 'exempt' | null;
export interface StudentMarks { studentNo: string; name: string; row: number; marks: Record<string, Mark> }
export interface Issue { level: 'error' | 'warning'; message: string }
export interface Thresholds { studentCo: number; cohortCo: number; studentPo: number; cohortPo: number } // fractions, e.g. 0.4

export const SHEET = 'Marks';
const KEY_LABEL = 'Column key (do not edit)';
const MAX_LABEL = 'Max marks';
const ABSENT = /^(a|ab|abs|absent)$/i;
const EXEMPT = /^(ex|exempt|exempted)$/i;

/** Marksheet columns in assessment-map order; CO codes follow the CO order (CO1 = first CO). */
export function marksheetColumns(cos: Pick<CourseOutcome, 'id'>[], criteria: ObeCriterion[], links: CriterionCo[]): MarkColumn[] {
  const code = new Map(cos.map((c, i) => [c.id, `CO${i + 1}`]));
  return byAssessment(criteria).flatMap((g) => g.items).map((c) => ({
    id: c.id, assessment: c.assessment, label: c.label, max: Number(c.max_marks),
    cos: links.filter((l) => l.criterion_id === c.id).map((l) => code.get(l.co_id)).filter((x): x is string => !!x)
      .sort((a, b) => Number(a.slice(2)) - Number(b.slice(2))),
  }));
}

/** CO code → PO codes it maps to. */
export function coPoCodes(cos: Pick<CourseOutcome, 'id'>[], coPo: Pick<CoPo, 'co_id' | 'po_code'>[]): Record<string, string[]> {
  return Object.fromEntries(cos.map((c, i) => [`CO${i + 1}`, coPo.filter((m) => m.co_id === c.id).map((m) => m.po_code)
    .sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)))]));
}

/** A short fingerprint of what the calculation depends on (columns, marks, CO tags, CO→PO), to tell when results are out of date. */
export function mapFingerprint(columns: MarkColumn[], coToPo: Record<string, string[]>): string {
  const s = JSON.stringify([columns.map((c) => [c.id, c.max, c.cos]), coToPo]);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// ---------------------------------------------------------------- template
/** The marksheet template: a hidden key row, then assessment / item / COs / max marks header rows, then one row per student. */
export function buildTemplate(X: XLSX, a: { title: string; columns: MarkColumn[]; roster: { studentNo: string; name: string }[] }): XLSXNS.WorkBook {
  const rows: (string | number | null)[][] = [
    [KEY_LABEL, '', ...a.columns.map((c) => c.id)],
    ['Assessment', '', ...a.columns.map((c) => c.assessment)],
    ['Question part / criterion', '', ...a.columns.map((c) => c.label)],
    ['COs assessed', '', ...a.columns.map((c) => c.cos.join(', '))],
    [MAX_LABEL, '', ...a.columns.map((c) => c.max)],
    ['Student ID', 'Name', ...a.columns.map(() => null)],
    ...(a.roster.length ? a.roster : Array.from({ length: 5 }, () => ({ studentNo: '', name: '' })))
      .map((s) => [s.studentNo, s.name, ...a.columns.map(() => null)]),
  ];
  const ws = X.utils.aoa_to_sheet(rows);
  ws['!rows'] = [{ hidden: true }];
  ws['!cols'] = [{ wch: 14 }, { wch: 26 }, ...a.columns.map((c) => ({ wch: Math.min(28, Math.max(10, c.label.length + 2)) }))];
  ws['!freeze'] = { xSplit: 2, ySplit: 6 };
  const help = X.utils.aoa_to_sheet([
    [a.title],
    [],
    ['How to fill this marksheet'],
    ['1. One row per student, from row 7 of the Marks sheet. Keep the student ID in column A.'],
    ['2. Enter the marks obtained for each question part or criterion. Decimals are fine; a mark cannot exceed the Max marks row.'],
    ['3. Type A (absent) where the student missed it: it counts as 0, as in the department workbooks.'],
    ['4. Type EX (exempt) only where the student was officially excused: that item is left out of that student\'s CO totals.'],
    ['5. Do not add, delete or reorder columns. The hidden first row links each column to the assessment map.'],
    ['6. Upload the file on the course\'s OBE → Attainment page. Marks are read in your browser and are not stored; only the CO and PO results are saved.'],
    [],
    ['A student attains a CO at ≥ 40% of the marks tagged to it; the cohort attains it when ≥ 40% of students do (SAR §8.4). PO% is the mean of the COs mapped to the PO.'],
  ]);
  help['!cols'] = [{ wch: 120 }];
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, SHEET);
  X.utils.book_append_sheet(wb, help, 'Instructions');
  return wb;
}

// ---------------------------------------------------------------- parsing
const cellText = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

/** Reads a filled marksheet. Columns are matched by the hidden key row; if that row is gone, by assessment + question/criterion text. */
export function parseMarksheet(X: XLSX, wb: XLSXNS.WorkBook, columns: MarkColumn[]): { students: StudentMarks[]; issues: Issue[] } {
  const issues: Issue[] = [];
  const ws = wb.Sheets[SHEET] ?? wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { students: [], issues: [{ level: 'error', message: 'The file has no sheets.' }] };
  const rows = X.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: true });
  const byId = new Map(columns.map((c) => [c.id, c]));
  const colOf = new Map<number, MarkColumn>();

  // 1) hidden key row
  const keyRow = rows.findIndex((r) => (r ?? []).some((v) => byId.has(cellText(v))));
  if (keyRow >= 0) (rows[keyRow] ?? []).forEach((v, i) => { const c = byId.get(cellText(v)); if (c) colOf.set(i, c); });
  // 2) fallback: assessment row + question/criterion row
  const itemRow = rows.findIndex((r) => /^question part/i.test(cellText(r?.[0])));
  if (!colOf.size && itemRow > 0) {
    const asRow = rows[itemRow - 1] ?? [];
    (rows[itemRow] ?? []).forEach((v, i) => {
      if (i < 2) return;
      const hit = columns.find((c) => !([...colOf.values()].includes(c)) && c.label.toLowerCase() === cellText(v).toLowerCase()
        && c.assessment.toLowerCase() === cellText(asRow[i]).toLowerCase());
      if (hit) colOf.set(i, hit);
    });
    if (colOf.size) issues.push({ level: 'warning', message: 'The hidden key row was missing, so columns were matched by their assessment and question names.' });
  }
  if (!colOf.size) return { students: [], issues: [{ level: 'error', message: 'This does not look like this course\'s marksheet template. Download the template from this page and fill that in.' }] };

  const missing = columns.filter((c) => ![...colOf.values()].includes(c));
  for (const c of missing) issues.push({ level: 'error', message: `Column missing: ${c.assessment} · ${c.label}. Download a fresh template (the assessment map may have changed).` });

  // Header rows end at "Student ID" (or "Max marks"); students follow.
  let start = rows.findIndex((r) => /^student id$/i.test(cellText(r?.[0])));
  if (start < 0) start = rows.findIndex((r) => cellText(r?.[0]).toLowerCase() === MAX_LABEL.toLowerCase());
  if (start < 0) start = Math.max(keyRow, itemRow) + 1;
  const maxRow = rows.findIndex((r) => cellText(r?.[0]).toLowerCase() === MAX_LABEL.toLowerCase());
  if (maxRow >= 0) for (const [i, c] of colOf) {
    const m = Number(rows[maxRow]?.[i]);
    if (Number.isFinite(m) && Math.abs(m - c.max) > 1e-9) issues.push({ level: 'error', message: `${c.assessment} · ${c.label}: the marksheet says ${m} marks but the assessment map says ${c.max}. Download a fresh template.` });
  }

  const students: StudentMarks[] = [];
  const seen = new Map<string, number>();
  let blanks = 0, absents = 0;
  for (let r = start + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const studentNo = cellText(row[0]).replace(/\.0+$/, '');
    const cells = [...colOf.keys()].map((i) => row[i]);
    if (!studentNo) {
      if (cells.some((v) => cellText(v) !== '')) issues.push({ level: 'error', message: `Row ${r + 1}: marks without a student ID.` });
      continue;
    }
    if (cells.every((v) => cellText(v) === '')) { issues.push({ level: 'warning', message: `Row ${r + 1} (${studentNo}): no marks at all, left out of the calculation.` }); continue; }
    if (seen.has(studentNo)) { issues.push({ level: 'error', message: `Student ${studentNo} appears twice (rows ${seen.get(studentNo)! + 1} and ${r + 1}).` }); continue; }
    seen.set(studentNo, r);
    const marks: Record<string, Mark> = {};
    for (const [i, c] of colOf) {
      const v = row[i];
      const t = cellText(v);
      if (t === '') { marks[c.id] = null; blanks++; continue; }
      if (ABSENT.test(t)) { marks[c.id] = 'absent'; absents++; continue; }
      if (EXEMPT.test(t)) { marks[c.id] = 'exempt'; continue; }
      const n = typeof v === 'number' ? v : Number(t.replace(',', '.'));
      if (!Number.isFinite(n)) { issues.push({ level: 'error', message: `Row ${r + 1} (${studentNo}), ${c.label}: “${t}” is not a mark. Use a number, A (absent) or EX (exempt).` }); marks[c.id] = null; continue; }
      if (n < 0 || n > c.max + 1e-9) { issues.push({ level: 'error', message: `Row ${r + 1} (${studentNo}), ${c.label}: ${n} is outside 0–${c.max}.` }); }
      marks[c.id] = n;
    }
    students.push({ studentNo, name: cellText(row[1]), row: r + 1, marks });
  }
  if (!students.length && !issues.some((i) => i.level === 'error')) issues.push({ level: 'error', message: 'No student rows with marks were found.' });
  if (blanks) issues.push({ level: 'warning', message: `${blanks} blank ${blanks === 1 ? 'cell was' : 'cells were'} counted as 0. Type A for absent to make that explicit.` });
  if (absents) issues.push({ level: 'warning', message: `${absents} ${absents === 1 ? 'mark is' : 'marks are'} A (absent) and counted as 0.` });
  return { students, issues };
}

// ---------------------------------------------------------------- calculation
export interface StudentResult { studentNo: string; name: string; co: Record<string, number | null>; po: Record<string, number | null> }
export interface CohortValue { value: number | null; attained: boolean | null; count: number; n: number }
export interface Sample { assessment: string; max: number; mean: number | null; highest: { studentNo: string; total: number } | null;
  average: { studentNo: string; total: number } | null; lowest: { studentNo: string; total: number } | null }
export interface AttainmentResult { students: StudentResult[]; co: Record<string, CohortValue>; po: Record<string, CohortValue>; samples: Sample[]; issues: Issue[] }

const ge = (v: number | null, t: number) => (v === null ? null : v >= t * 100 - 1e-9);

/** Spec §7–8: student CO% = marks on the CO's items ÷ their maximum; student PO% = mean of the student's CO% over COs mapped to the PO;
    cohort % = share of students at or above the student threshold, attained at ≥ the cohort threshold. */
export function computeAttainment(a: { columns: MarkColumn[]; students: StudentMarks[]; coCodes: string[]; coToPo: Record<string, string[]>; t: Thresholds }): AttainmentResult {
  const issues: Issue[] = [];
  const poCodes = [...new Set(Object.values(a.coToPo).flat())].sort((x, y) => Number(x.slice(2)) - Number(y.slice(2)));
  for (const co of a.coCodes) if (!a.columns.some((c) => c.cos.includes(co))) issues.push({ level: 'warning', message: `${co} is not assessed by any question or criterion, so it has no result (Info missing).` });
  for (const co of a.coCodes) if (!(a.coToPo[co] ?? []).length) issues.push({ level: 'warning', message: `${co} is not mapped to a PO.` });

  const students: StudentResult[] = a.students.map((s) => {
    const co: Record<string, number | null> = {};
    for (const code of a.coCodes) {
      let got = 0, max = 0;
      for (const c of a.columns) {
        if (!c.cos.includes(code)) continue;
        const m = s.marks[c.id];
        if (m === 'exempt') continue;
        max += c.max;
        got += typeof m === 'number' ? m : 0;
      }
      co[code] = max > 0 ? (got / max) * 100 : null;
    }
    const po: Record<string, number | null> = {};
    for (const p of poCodes) {
      const vals = a.coCodes.filter((c) => (a.coToPo[c] ?? []).includes(p)).map((c) => co[c]).filter((v): v is number => v !== null);
      po[p] = vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : null;
    }
    return { studentNo: s.studentNo, name: s.name, co, po };
  });

  const cohort = (pick: (s: StudentResult) => number | null, studentT: number, cohortT: number): CohortValue => {
    const vals = students.map(pick).filter((v): v is number => v !== null);
    const count = vals.filter((v) => ge(v, studentT)).length;
    const value = vals.length ? (count / vals.length) * 100 : null;
    return { value, attained: ge(value, cohortT), count, n: vals.length };
  };
  const co = Object.fromEntries(a.coCodes.map((c) => [c, cohort((s) => s.co[c], a.t.studentCo, a.t.cohortCo)]));
  const po = Object.fromEntries(poCodes.map((p) => [p, cohort((s) => s.po[p], a.t.studentPo, a.t.cohortPo)]));
  for (const [c, v] of Object.entries(co)) if (v.attained === false) issues.push({ level: 'warning', message: `${c} is not attained: ${v.value!.toFixed(2)}% of students reached ${a.t.studentCo * 100}%. The CAR will ask for a comment and an action.` });

  // Highest / average / lowest script per assessment, as the course file asks (average = the student closest to the mean).
  const samples: Sample[] = byAssessment(a.columns.map((c, i) => ({ ...c, sort: i }))).map((g) => {
    const max = g.items.reduce((n, c) => n + c.max, 0);
    const totals = a.students.flatMap((s) => {
      const ms = g.items.map((c) => s.marks[c.id]);
      if (ms.every((m) => typeof m !== 'number')) return []; // absent or exempt throughout: not a script
      return [{ studentNo: s.studentNo, total: ms.reduce<number>((n, m) => n + (typeof m === 'number' ? m : 0), 0) }];
    });
    if (!totals.length) return { assessment: g.assessment, max, mean: null, highest: null, average: null, lowest: null };
    const mean = totals.reduce((n, x) => n + x.total, 0) / totals.length;
    const by = (f: (x: { total: number }) => number) => totals.reduce((best, x) => (f(x) < f(best) ? x : best));
    return { assessment: g.assessment, max, mean, highest: by((x) => -x.total), lowest: by((x) => x.total), average: by((x) => Math.abs(x.total - mean)) };
  });
  return { students, co, po, samples, issues };
}

// ---------------------------------------------------------------- results workbook (for the course file)
export function buildResultsWorkbook(X: XLSX, a: { title: string; result: AttainmentResult; coCodes: string[]; t: Thresholds }): XLSXNS.WorkBook {
  const r = a.result;
  const poCodes = Object.keys(r.po);
  const pct = (v: number | null) => (v === null ? 'NA' : Math.round(v * 100) / 100);
  const yn = (v: boolean | null) => (v === null ? 'NA' : v ? 'Y' : 'N');
  const cohort = X.utils.aoa_to_sheet([
    [a.title], [],
    ['Outcome', '% of students attained', 'Students attained', 'Students', 'Cohort attained (Y/N)'],
    ...a.coCodes.map((c) => [c, pct(r.co[c].value), r.co[c].count, r.co[c].n, yn(r.co[c].attained)]),
    ...poCodes.map((p) => [p, pct(r.po[p].value), r.po[p].count, r.po[p].n, yn(r.po[p].attained)]),
    [], [`Thresholds: student CO ${a.t.studentCo * 100}%, cohort CO ${a.t.cohortCo * 100}%, student PO ${a.t.studentPo * 100}%, cohort PO ${a.t.cohortPo * 100}%.`],
  ]);
  const students = X.utils.aoa_to_sheet([
    ['Student ID', 'Name', ...a.coCodes.flatMap((c) => [`${c} %`, `${c} Y/N`]), ...poCodes.flatMap((p) => [`${p} %`, `${p} Y/N`])],
    ...r.students.map((s) => [s.studentNo, s.name,
      ...a.coCodes.flatMap((c) => [pct(s.co[c]), yn(ge(s.co[c], a.t.studentCo))]),
      ...poCodes.flatMap((p) => [pct(s.po[p]), yn(ge(s.po[p], a.t.studentPo))])]),
  ]);
  const samples = X.utils.aoa_to_sheet([
    ['Assessment', 'Max marks', 'Mean', 'Highest (ID)', 'Highest', 'Average (ID)', 'Average', 'Lowest (ID)', 'Lowest'],
    ...r.samples.map((s) => [s.assessment, s.max, s.mean === null ? 'NA' : Math.round(s.mean * 100) / 100,
      s.highest?.studentNo ?? '', s.highest?.total ?? '', s.average?.studentNo ?? '', s.average?.total ?? '', s.lowest?.studentNo ?? '', s.lowest?.total ?? '']),
  ]);
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, cohort, 'Cohort attainment');
  X.utils.book_append_sheet(wb, students, 'Individual attainment');
  X.utils.book_append_sheet(wb, samples, 'Sample scripts');
  return wb;
}
