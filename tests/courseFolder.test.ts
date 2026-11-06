import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { buildCourseFolder, buildMarksTemplate } from '../src/lib/courseFolder/build';
import { batchOf, computeAttainment, key, norm, parseNums, sampleStats, studentIds, Warnings, type CourseInfo, type Outline } from '../src/lib/courseFolder/model';

// Fictional course data only. The outline is the website's outline template (BME 320, three COs → PO6, PO5, PO10).
const A = 'src/assets/course-folder';
const outline = readFileSync(`${A}/course_outline_template.docx`);
const templates = { car: readFileSync(`${A}/car.docx`), coPoMapping: readFileSync(`${A}/co_po_mapping.docx`), instructors: readFileSync(`${A}/instructors_and_schedule.docx`) };

async function infoXlsx(info: Record<string, string | number>, sections: (string | number)[][]) {
  const wb = new ExcelJS.Workbook();
  const add = (name: string, rows: (string | number)[][]) => { const ws = wb.addWorksheet(name); rows.forEach((r) => ws.addRow(r)); };
  add('info', [Object.keys(info), Object.values(info)]);
  add('faculties', [['name', 'section', 'office_room', 'email', 'telephone', 'consultation'], ['Teacher One', '', 'ECE-1', 'one@example.edu', '+880 100', ''], ['Teacher Two', '', 'ECE-2', 'two@example.edu', '+880 200', '']]);
  add('routine', [['section', 'day', 'start_time', 'end_time'], ['A1', 'Monday', '02:00 PM', '05:00 PM'], ['A2', 'Tuesday', '02:00 PM', '05:00 PM']]);
  add('sections', [['section', 'first_roll', 'last_roll', 'extra_ids', 'exclude_ids'], ...sections]);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
const docText = async (zip: JSZip, path: string) => (await JSZip.loadAsync(await zip.file(path)!.async('uint8array'))).file('word/document.xml')!.async('string');

describe('model', () => {
  const base: CourseInfo = { courseNo: 'BME 211', credit: 3, contactHours: '3', level: '2', term: '2', semester: 'July 2025', session: '2023-2024', extra: {}, faculties: [], routine: [], sections: [] };
  it('reads CO and PO numbers', () => {
    expect(parseNums('PO-6', 'PO')).toEqual([6]);
    expect(parseNums('CO1, CO-2', 'CO')).toEqual([1, 2]);
    expect(norm('Daily Reports')).toBe(norm('Daily report'));
  });
  it('builds student IDs from the batch and roll range', () => {
    expect(batchOf(base)).toBe(22);
    expect(batchOf({ ...base, level: '3' })).toBe(21);
    expect(batchOf({ ...base, extra: { batch: '20' } })).toBe(20);
    const ids = studentIds({ ...base, sections: [{ section: 'A', first_roll: '1', last_roll: '4', extra_ids: '2018055', exclude_ids: '2218003' }] });
    expect(ids).toEqual([2018055, 2218001, 2218002, 2218004]);
  });
  it('applies the absent rule and the 40% thresholds', () => {
    const o = { cos: [{ no: 1, statement: '', pos: [1], domain: '', delivery: '', tools: '' }, { no: 2, statement: '', pos: [1], domain: '', delivery: '', tools: '' }] } as unknown as Outline;
    const values = new Map<string, number | null>([[key(1, 0), 4], [key(1, 1), 10], [key(2, 0), null], [key(2, 1), 3], [key(3, 0), null], [key(3, 1), null]]);
    const att = computeAttainment(o, { items: [{ name: 'a', cos: [1], max: 10 }, { name: 'b', cos: [2], max: 10 }], ids: [1, 2, 3], values }, new Warnings());
    expect(att.co.get(1)).toMatchObject({ assessed: 1, attained: 1, pct: 100, ok: true });   // 40% exactly attains
    expect(att.co.get(2)).toMatchObject({ assessed: 2, attained: 1, pct: 50, ok: true });
    expect(att.studentPo.get(key(2, 1))).toBe(30);                                              // only CO2 counts for student 2
    expect(att.absentees.get(3)).toEqual([1, 2]);
  });
  it('picks highest, lowest and the student closest to the mean', () => {
    const s = sampleStats(new Map([[1, 10], [2, 4], [3, 7], [4, null], [5, 6]]));
    expect([s.highest, s.lowest, s.average]).toEqual([[1, 10], [2, 4], [3, 7]]);
  });
});

describe('sessional course folder', () => {
  it('makes the marks sheet, reads it back and builds the folder', async () => {
    const info = await infoXlsx({ course_no: 'BME 320', credit_hours: 1, contact_hours: '3 weeks', level: 3, term: 2, semester: 'July 2025', session: '2023-2024', last_offered: 'July 2024' },
      [['A1', 1, 2, '', ''], ['A2', 3, 4, '', '']]);
    const t = await buildMarksTemplate(info, outline);
    expect(t.sessional).toBe(true);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(t.bytes as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('ca')!;
    expect([1, 2, 3].map((r) => [1, 2, 3, 4, 5].map((c) => ws.getCell(r, c).value))).toEqual([['Assessment', 'Presentation', 'Daily report', 'Assessment report', 'Total'], ['CO', 'CO1', 'CO2', 'CO3', null], ['Total', 70, 10, 20, { formula: 'SUM(B3:D3)' }]]);
    expect(ws.getCell('A5').value).toBe(2118001);
    const marks: Record<number, (number | string)[]> = { 2118001: [56, 10, 20], 2118002: [20, 'Abs', 10], 2118003: ['Abs', 'Abs', 'Abs'], 2118004: [30, 3, 8] };
    for (let r = 5; r <= 8; r++) marks[ws.getCell(`A${r}`).value as number].forEach((v, k) => (ws.getCell(r, 2 + k).value = v));
    const filled = new Uint8Array(await wb.xlsx.writeBuffer());

    const res = await buildCourseFolder({ info, outline, marks: filled, templates });
    expect(res.fileName).toBe('BME 320 (July 2025).zip');
    const pct = (m: Map<number, { pct: number | null }>) => Object.fromEntries([...m].map(([k, v]) => [k, Number(v.pct!.toFixed(2))]));
    expect(pct(res.attainment.co)).toEqual({ 1: 66.67, 2: 50, 3: 100 });
    expect(pct(res.attainment.po)).toEqual({ 5: 50, 6: 66.67, 10: 100 });
    expect([...res.attainment.absentees]).toEqual([[2118002, [2]], [2118003, [1, 2, 3]]]);
    const zip = await JSZip.loadAsync(res.zip);
    const root = 'BME 320 (July 2025)/';
    for (const f of ['CAR.docx', 'CO-PO Mapping.docx', 'Instructors and Schedule.docx', 'CO-PO Attainment Report.docx', 'BME 320_Course outline.docx',
      'Assessment and Scripts/BME 320-CO-PO-Assessment-marks.xlsx', 'Assessment and Scripts/Presentation/Sample scripts to upload.txt', 'Lecture Materials/Week - 01/'])
      expect(zip.file(root + f) ?? zip.folder(root + f), f).toBeTruthy();
    const car = await docText(zip, `${root}CAR.docx`);
    expect(car).toContain('66.67');
    expect(car).toContain('Industrial Attachment');
    expect(car).toContain('Name: Teacher Two');
    expect(await docText(zip, `${root}CO-PO Mapping.docx`)).toContain('Mapping of Knowledge Profile');
    expect(await docText(zip, `${root}Instructors and Schedule.docx`)).toContain('Monday (A1):');
    const sample = await zip.file(`${root}Assessment and Scripts/Presentation/Sample scripts to upload.txt`)!.async('string');
    expect(sample).toMatch(/Highest : 2118001 {2}\(56\)/);
  }, 30000);
});

describe('theory course folder (BME 211 workbook layout)', () => {
  it('reads the term-final sub-part mapping and CO marks', async () => {
    const info = await infoXlsx({ course_no: 'BME 320', credit_hours: 3, contact_hours: 3, level: 2, term: 2, semester: 'July 2025', session: '2023-2024', course_type: 'theory' },
      [['A', 1, 3, '', '']]);
    const t = await buildMarksTemplate(info, outline);
    expect(t.sessional).toBe(false);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(t.bytes as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Attendance Summary', 'CA Marks', 'TF Marks', 'Assessment-CO Mapping', 'CO Marks', 'Individual Attainment CO & PO', 'Cohort Attainment', '_meta']);
    const mp = wb.getWorksheet('Assessment-CO Mapping')!;
    // Q01 (a) 10 → CO1, Q01 (b) 20 → CO2, Q05 (a) 15 → CO3 (columns D, E, F are CO1–CO3)
    for (const [row, mx, col] of [[2, 10, 'D'], [3, 20, 'E'], [7, 15, 'F']] as const) { mp.getCell(`C${row}`).value = mx; mp.getCell(`${col}${row}`).value = 1; }
    const cm = wb.getWorksheet('CO Marks')!;
    const rows: (number | string)[][] = [[5, 10, 15], [3, 'Abs', 6], ['Abs', 'Abs', 'Abs']];
    rows.forEach((r, i) => ['B', 'C', 'G'].forEach((c, k) => (cm.getCell(`${c}${4 + i}`).value = r[k])));
    const filled = new Uint8Array(await wb.xlsx.writeBuffer());

    const res = await buildCourseFolder({ info, outline, marks: filled, templates });
    expect(res.students).toBe(3);
    expect(Object.fromEntries([...res.attainment.co].map(([k, v]) => [k, v.pct]))).toEqual({ 1: 50, 2: 100, 3: 100 });
    const zip = await JSZip.loadAsync(res.zip);
    const root = 'BME 320 (July 2025)/';
    for (const f of ['Assessments and scripts/Assessments 1/Sample scripts to upload.txt', 'Assessments and scripts/Assessments 4/Sample scripts to upload.txt',
      'Assessments and scripts/Term Final/Sample scripts to upload.txt']) expect(zip.file(root + f), f).toBeTruthy();
    for (const d of ['Book/', 'Note/', 'TO/', 'TT/']) expect(zip.folder(`${root}Lecture Materials/${d}`), d).toBeTruthy();
    expect(res.warnings.some((w) => w.includes('10% / 20% / 70%'))).toBe(false);   // only reported when the template is made
  }, 30000);
});
