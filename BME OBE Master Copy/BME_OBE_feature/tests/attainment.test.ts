import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { buildResultsWorkbook, buildTemplate, computeAttainment, coPoCodes, mapFingerprint, marksheetColumns, parseMarksheet, type MarkColumn, type StudentMarks } from '../src/lib/attainment';
import type { CriterionCo, ObeCriterion } from '../src/lib/types';

const T = { studentCo: 0.4, cohortCo: 0.4, studentPo: 0.4, cohortPo: 0.4 };
// BME 203, July 2025 term final: Q1 and Q5 sub-parts mapped to CO1–CO4 (CO-PO-Assessment-marks.xlsx, "Assessment-CO Mapping").
const cols: MarkColumn[] = [
  { id: 'q1a', assessment: 'Term Final', label: 'Q01 (a)', max: 15, cos: ['CO3'] },
  { id: 'q1b', assessment: 'Term Final', label: 'Q01 (b)', max: 15, cos: ['CO1'] },
  { id: 'q1c', assessment: 'Term Final', label: 'Q01 (c)', max: 15, cos: ['CO1'] },
  { id: 'q5a', assessment: 'Term Final', label: 'Q05 (a)', max: 16, cos: ['CO2'] },
  { id: 'q5b', assessment: 'Term Final', label: 'Q05 (b)', max: 18, cos: ['CO2'] },
  { id: 'q5c', assessment: 'Term Final', label: 'Q05 (c)', max: 11, cos: ['CO4'] },
];
const CO = ['CO1', 'CO2', 'CO3', 'CO4'];
const toPo = { CO1: ['PO1'], CO2: ['PO1'], CO3: ['PO1'], CO4: ['PO1'] };
const st = (studentNo: string, m: (number | 'absent' | 'exempt' | null)[]): StudentMarks =>
  ({ studentNo, name: '', row: 0, marks: Object.fromEntries(cols.map((c, i) => [c.id, m[i]])) });

describe('attainment from marks', () => {
  it('matches the BME 203 workbook for student 23RR501', () => {
    const r = computeAttainment({ columns: cols, students: [st('23RR501', [15, 15, 11, 16, 11, 9])], coCodes: CO, coToPo: toPo, t: T });
    const s = r.students[0];
    expect(s.co.CO1).toBeCloseTo(86.667, 2); // (15+11)/30
    expect(s.co.CO2).toBeCloseTo(79.412, 2); // (16+11)/34
    expect(s.co.CO3).toBeCloseTo(100, 6);
    expect(s.co.CO4).toBeCloseTo(81.818, 2); // 9/11
    expect(s.po.PO1).toBeCloseTo(86.97, 1);  // workbook: 0.87
  });

  it('gives the cohort % as the share of students at ≥ 40% (BME 203 CO1: 40 of 51 → 78.43%)', () => {
    const students = Array.from({ length: 51 }, (_, i) => st(`s${i}`, [10, i < 40 ? 12 : 5, 0, 10, 10, 5])); // CO1 = 12/30 = 40% exactly, or 5/30
    const r = computeAttainment({ columns: cols, students, coCodes: CO, coToPo: toPo, t: T });
    expect(r.co.CO1.count).toBe(40);
    expect(r.co.CO1.n).toBe(51);
    expect(r.co.CO1.value).toBeCloseTo(78.43, 2);
    expect(r.co.CO1.attained).toBe(true);
  });

  it('reproduces the BAETE PO5 example (BME 300 CO4: 31.081 of 37.5 → 82.88%)', () => {
    const c: MarkColumn[] = [{ id: 'p', assessment: 'Final Presentation', label: 'Prototype development', max: 37.5, cos: ['CO4'] }];
    const r = computeAttainment({ columns: c, students: [{ studentNo: '2018001', name: '', row: 0, marks: { p: 31.081 } }],
      coCodes: ['CO1', 'CO2', 'CO3', 'CO4'], coToPo: { CO1: [], CO2: [], CO3: [], CO4: ['PO5'] }, t: T });
    expect(r.students[0].co.CO4).toBeCloseTo(82.88, 2);
    expect(r.students[0].po.PO5).toBeCloseTo(82.88, 2);
    expect(r.po.PO5.value).toBe(100);
    expect(r.co.CO1.value).toBeNull(); // not assessed → Info missing
    expect(r.issues.some((i) => i.message.startsWith('CO1 is not assessed'))).toBe(true);
  });

  it('counts absent as 0 and leaves exempt items out of the denominator', () => {
    const r = computeAttainment({ columns: cols, students: [st('x', [15, 'absent', 15, 'exempt', 18, 11])], coCodes: CO, coToPo: toPo, t: T });
    expect(r.students[0].co.CO1).toBeCloseTo(50, 6);   // (0+15)/30
    expect(r.students[0].co.CO2).toBeCloseTo(100, 6);  // 18/18, Q05 (a) exempt
  });

  it('averages a student PO over the mapped COs only and leaves unmapped POs out', () => {
    const r = computeAttainment({ columns: cols, students: [st('x', [15, 0, 0, 16, 18, 0])], coCodes: CO,
      coToPo: { CO1: ['PO1'], CO2: ['PO2'], CO3: ['PO1'], CO4: [] }, t: T });
    expect(r.students[0].po.PO1).toBeCloseTo(50, 6); // (0 + 100) / 2
    expect(r.students[0].po.PO2).toBeCloseTo(100, 6);
    expect(Object.keys(r.po)).toEqual(['PO1', 'PO2']);
    expect(r.co.CO4.attained).toBe(false);
  });

  it('picks highest, average (closest to the mean) and lowest scripts per assessment', () => {
    const r = computeAttainment({ columns: cols, students: [st('a', [15, 15, 15, 16, 18, 11]), st('b', [5, 5, 5, 5, 5, 5]), st('c', [10, 10, 10, 10, 10, 10]),
      st('d', ['absent', 'absent', 'absent', 'absent', 'absent', 'absent'])], coCodes: CO, coToPo: toPo, t: T });
    const s = r.samples[0];
    expect(s.max).toBe(90);
    expect(s.highest?.studentNo).toBe('a');
    expect(s.lowest?.studentNo).toBe('b');
    expect(s.average?.studentNo).toBe('c');
  });
});

describe('marksheet template', () => {
  const roster = [{ studentNo: '2318001', name: 'A' }, { studentNo: '2318002', name: 'B' }, { studentNo: '2318003', name: 'C' }];
  const roundTrip = (fill: (aoa: unknown[][]) => void) => {
    const wb = buildTemplate(XLSX, { title: 'BME 203', columns: cols, roster });
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Marks, { header: 1, defval: null });
    fill(aoa);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const out = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(out, ws, 'Marks');
    const buf = XLSX.write(out, { type: 'array', bookType: 'xlsx' });
    return parseMarksheet(XLSX, XLSX.read(buf, { type: 'array' }), cols);
  };

  it('round-trips marks, A and EX through the template', () => {
    const p = roundTrip((a) => { a[6] = ['2318001', 'A', 15, 15, 11, 16, 11, 9]; a[7] = ['2318002', 'B', 'A', 3, 0, 4, 8, 'ex']; a[8] = ['2318003', 'C', 1, 2, 3, 4, 5, 6]; });
    expect(p.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(p.students.map((s) => s.studentNo)).toEqual(['2318001', '2318002', '2318003']);
    expect(p.students[1].marks.q1a).toBe('absent');
    expect(p.students[1].marks.q5c).toBe('exempt');
    expect(p.students[0].marks.q5a).toBe(16);
  });

  it('rejects marks above the maximum, duplicates and text', () => {
    const p = roundTrip((a) => { a[6] = ['2318001', '', 16, 15, 11, 16, 11, 9]; a[7] = ['2318001', '', 1, 1, 1, 1, 1, 1]; a[8] = ['2318003', '', 'good', 1, 1, 1, 1, 1]; });
    const errs = p.issues.filter((i) => i.level === 'error').map((i) => i.message).join('\n');
    expect(errs).toMatch(/16 is outside 0–15/);
    expect(errs).toMatch(/appears twice/);
    expect(errs).toMatch(/“good” is not a mark/);
  });

  it('skips students with no marks and warns about blank cells', () => {
    const p = roundTrip((a) => { a[6] = ['2318001', '', 15, null, 11, 16, 11, 9]; });
    expect(p.students.length).toBe(1);
    expect(p.issues.some((i) => /no marks at all/.test(i.message))).toBe(true);
    expect(p.issues.some((i) => /1 blank cell was counted as 0/.test(i.message))).toBe(true);
  });

  it('falls back to column names when the hidden key row is deleted', () => {
    const p = roundTrip((a) => { a.shift(); a[5] = ['2318001', '', 15, 15, 11, 16, 11, 9]; });
    expect(p.students.length).toBe(1);
    expect(p.issues.some((i) => /matched by their assessment and question names/.test(i.message))).toBe(true);
  });

  it('flags a column missing from an old template', () => {
    const extra: MarkColumn[] = [...cols, { id: 'new', assessment: 'Term Final', label: 'Q05 (d)', max: 5, cos: ['CO4'] }];
    const wb = buildTemplate(XLSX, { title: 'x', columns: cols, roster });
    const p = parseMarksheet(XLSX, wb, extra);
    expect(p.issues.some((i) => i.level === 'error' && /Column missing: Term Final · Q05 \(d\)/.test(i.message))).toBe(true);
  });

  it('builds columns from the assessment map in its order with CO codes', () => {
    const cos = [{ id: 'c1' }, { id: 'c2' }];
    const criteria: ObeCriterion[] = [
      { id: 'x2', offering_id: 'o', assessment: 'Report', label: 'Ethics', max_marks: 15, sort: 1 },
      { id: 'x1', offering_id: 'o', assessment: 'Report', label: 'Design', max_marks: 20, sort: 0 },
    ];
    const links: CriterionCo[] = [{ criterion_id: 'x1', co_id: 'c2' }, { criterion_id: 'x1', co_id: 'c1' }, { criterion_id: 'x2', co_id: 'c2' }];
    expect(marksheetColumns(cos, criteria, links)).toEqual([
      { id: 'x1', assessment: 'Report', label: 'Design', max: 20, cos: ['CO1', 'CO2'] },
      { id: 'x2', assessment: 'Report', label: 'Ethics', max: 15, cos: ['CO2'] },
    ]);
    expect(coPoCodes(cos, [{ co_id: 'c1', po_code: 'PO3' }, { co_id: 'c1', po_code: 'PO1' }])).toEqual({ CO1: ['PO1', 'PO3'], CO2: [] });
  });

  it('changes the fingerprint when marks or tags change', () => {
    const a = mapFingerprint(cols, toPo);
    expect(mapFingerprint(cols, toPo)).toBe(a);
    expect(mapFingerprint(cols.map((c, i) => (i ? c : { ...c, max: 14 })), toPo)).not.toBe(a);
    expect(mapFingerprint(cols, { ...toPo, CO4: ['PO2'] })).not.toBe(a);
  });

  it('writes a results workbook with cohort, individual and sample sheets', () => {
    const r = computeAttainment({ columns: cols, students: [st('a', [15, 15, 11, 16, 11, 9])], coCodes: CO, coToPo: toPo, t: T });
    const wb = buildResultsWorkbook(XLSX, { title: 'BME 203', result: r, coCodes: CO, t: T });
    expect(wb.SheetNames).toEqual(['Cohort attainment', 'Individual attainment', 'Sample scripts']);
  });
});
