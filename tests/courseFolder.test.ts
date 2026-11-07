import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { buildCourseFolder, buildMarksTemplate, previewSources } from '../src/lib/courseFolder/build';
import { readOutline, splitCount } from '../src/lib/courseFolder/inputs';
import { websiteMappingDocx } from '../src/lib/courseFolder/docs';
import { checkPlan, cosFor, planColumns, type Plan } from '../src/lib/courseFolder/plan';
import { batchOf, computeAttainment, key, norm, parseNums, sampleStats, studentIds, Warnings, type CourseInfo, type Outline } from '../src/lib/courseFolder/model';

// Fictional course data only. The outline is the website's outline template (BME 320, three COs → PO6, PO5, PO10).
const A = 'src/assets/course-folder';
// The website's earlier outline format (fictional BME 320: CO table, Distribution of Marks): still read.
const outline = readFileSync('tests/fixtures/outline_website_format.docx');
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
    const t = await buildMarksTemplate({ info, outline });
    expect(t.sessional).toBe(true);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(t.bytes as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('ca')!;
    // In the outline's order, each with the CO whose Assessment Tool(s) name it and its weight × credit × 100.
    expect([1, 2, 3].map((r) => [1, 2, 3, 4, 5].map((c) => ws.getCell(r, c).value))).toEqual([['Assessment', 'Assessment report', 'Daily report', 'Presentation', 'Total'], ['CO', 'CO3', 'CO2', 'CO1', null], ['Total', 20, 10, 70, { formula: 'SUM(B3:D3)' }]]);
    expect(ws.getCell('A5').value).toBe(2118001);
    const marks: Record<number, (number | string)[]> = { 2118001: [20, 10, 56], 2118002: [10, 'Abs', 20], 2118003: ['Abs', 'Abs', 'Abs'], 2118004: [8, 3, 30] };
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
    // A theory course assessed by attendance, class tests and the term final uses the department's theory workbook.
    const plan: Plan = { total: 300, layout: 'theory', items: [
      { name: 'Class participation', pct: 10, kind: 'attendance', cos: [], marks: 30 },
      { name: 'Class tests', pct: 20, kind: 'ct', cos: [], marks: 60 },
      { name: 'Term final', pct: 70, kind: 'final', cos: [], marks: 210 }] };
    const t = await buildMarksTemplate({ info, outline }, plan);
    expect(t.sessional).toBe(false);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(t.bytes as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Attendance Summary', 'CA Marks', 'TF Marks', 'Assessment-CO Mapping', 'CO Marks', 'Individual Attainment CO & PO', 'Cohort Attainment', '_meta']);
    for (const [sheet, hdrs] of [['CA Marks', ['Student ID', 'CT01 (20)', 'CT02 (20)', 'CT03 (20)', 'CT04 (20)', 'Best 3 of 4', 'Bonus', 'Total']], ['TF Marks', ['Student ID', 'Section A (105)', 'Section B (105)', 'Total']]] as const)
      expect(hdrs.map((_, c) => wb.getWorksheet(sheet)!.getCell(1, c + 1).value), sheet).toEqual(hdrs);   // no Position columns
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

// ------------------------------------------------------------------ the department's outline layout
// A made-up course in the layout of the department's outlines: header fields, Course Teacher(s) table, COs as a list,
// "Assessment:" lines; the POs and assessment tools come from a separate CO-PO Mapping document.
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const P = (t: string) => `<w:p>${t.split('\t').map((x, i) => `${i ? '<w:r><w:tab/></w:r>' : ''}<w:r><w:t xml:space="preserve">${esc(x)}</w:t></w:r>`).join('')}</w:p>`;
const TBL = (rows: string[][]) => `<w:tbl>${rows.map((r) => `<w:tr>${r.map((c) => `<w:tc>${c.split('\n').map(P).join('')}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
async function docx(body: string) {
  const z = new JSZip();
  z.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  z.file('word/_rels/document.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
  z.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`);
  return z.generateAsync({ type: 'uint8array' });
}
const deptOutline = () => docx([
  P('Course Outline'), P('Course No:\t\tBME 999'), P('Course Title:\tTest Course Sessional'), P('Credit hours:\t\t1.5\t\t\tContact hours:\t3'),
  P('Level/Term:\t\t3/1'), P('Academic Session: \t2022-2023'), P('Course Teacher(s):'),
  TBL([['Name', 'Office/Room', 'Email & Telephone', 'Class routine'], ['Teacher One', 'ECE 1', 'one@example.edu\n+8801000000000', 'Sunday (A1):\n02:00 PM-05:00 PM'], ['Teacher Two', 'ECE 2', 'two@example.edu', '']]),
  P('Course Outcomes:'), P('Design a simple device'), P('Present the design'), P('Write a report'),
  P('Assessment: '), P('\t\t\tQuiz\t20%'), P('\t\t\tContinuous Assessment\t30%'), P('\t\t\tProject\t50%'),
  P('Weekly Schedule:'), TBL([['Week', 'Topics'], ['1', 'Introduction']]),
].join(''));
const deptMapping = () => docx([P('Course Outcomes:'), TBL([
  ['CO No.', 'CO Statement', 'Corresponding PO(s)*', 'Domains and Taxonomy level(s)*', 'Delivery Method(s) and Activity(-ies)', 'Assessment Tool(s)'],
  ['1', 'Design a simple device', 'PO-3', 'C6', 'Lectures', 'Project, Continuous Assessment'], ['2', 'Present the design', 'PO-10', 'A2', 'Lectures', 'Project'],
  ['3', 'Write a report', 'PO-10', 'C2', 'Lectures', 'Quiz']])].join(''));

describe("the department's outline layout", () => {
  it('reads the course details, COs and assessments, with the CO-PO mapping document, into an assessment tree', async () => {
    const p = await previewSources({ outline: await deptOutline(), mapping: await deptMapping(), roll: { semester: 'July 2025', batch: '21', count: 5, missingIds: ['2118003'] } });
    expect(p.info).toMatchObject({ courseNo: 'BME 999', credit: 1.5, contactHours: '3', level: '3', term: '1', session: '2022-2023', semester: 'July 2025' });
    expect(p.info.faculties.map((f) => [f.name, f.office_room, f.email, f.telephone])).toEqual([['Teacher One', 'ECE 1', 'one@example.edu', '+8801000000000'], ['Teacher Two', 'ECE 2', 'two@example.edu', '']]);
    expect(p.info.routine).toEqual([{ day: 'Sunday', section: 'A1', start_time: '02:00 PM', end_time: '05:00 PM' }]);
    expect(p.outline.cos.map((c) => [c.no, c.statement, c.pos])).toEqual([[1, 'Design a simple device', [3]], [2, 'Present the design', [10]], [3, 'Write a report', [10]]]);
    expect(p.plan.layout).toBe('columns');
    expect(p.plan.items.map((i) => [i.name, i.pct, i.cos, i.marks])).toEqual([['Quiz', 20, [3], 30], ['Continuous Assessment', 30, [1], 45], ['Project', 50, [1, 2], 75]]);
    expect(checkPlan(p.plan, p.outline)).toEqual({ errors: [], warnings: [] });
    expect(planColumns(p.plan).map((c) => [c.name, c.cos, c.max])).toEqual([['Quiz', [3], 30], ['Continuous Assessment', [1], 45], ['Project', [1, 2], 75]]);   // two COs, still one assessment
  });

  it('builds the marks sheet from the edited tree, with the student IDs from the roll range', async () => {
    const src = { outline: await deptOutline(), mapping: await deptMapping(), roll: { semester: 'July 2025', batch: '21', count: 5, missingIds: ['2118003'] } };
    const { plan } = await previewSources(src);
    plan.items[0].cos = [2, 3];   // the faculty ticks a second CO on the page
    const t = await buildMarksTemplate(src, plan);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(t.bytes as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('ca')!;
    expect([1, 2, 3].map((r) => [2, 3, 4, 5].map((c) => ws.getCell(r, c).value))).toEqual([['Quiz', 'Continuous Assessment', 'Project', 'Total'], ['CO2, CO3', 'CO1', 'CO1, CO2', null], [30, 45, 75, { formula: 'SUM(B3:D3)' }]]);
    expect([5, 6, 7, 8, 9].map((r) => ws.getCell(`A${r}`).value)).toEqual([2118001, 2118002, 2118004, 2118005, null]);
  });

  it('counts an assessment that covers two COs for both, as one column, through to the course folder', async () => {
    const src = { outline: await deptOutline(), mapping: await deptMapping(), roll: { semester: 'July 2025', batch: '21', count: 2, missingIds: [] } };
    const t = await buildMarksTemplate(src);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(t.bytes as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('ca')!;
    // Quiz (30, CO3) | Continuous Assessment (45, CO1) | Project (75, CO1 and CO2)
    [[15, 45, 75], [12, 9, 15]].forEach((row, i) => row.forEach((v, k) => (ws.getCell(5 + i, 2 + k).value = v)));
    const res = await buildCourseFolder({ ...src, marks: new Uint8Array(await wb.xlsx.writeBuffer()), templates });
    // Student 1: CO1 = (45 + 75) / 120 = 100%, CO2 = 75 / 75, CO3 = 15 / 30. Student 2: CO1 = 24 / 120 = 20%, CO2 = 20%, CO3 = 40%.
    expect([...res.attainment.studentCo].map(([k, v]) => [k, Math.round(v! * 100) / 100])).toEqual([
      ['2118001:1', 100], ['2118001:2', 100], ['2118001:3', 50], ['2118002:1', 20], ['2118002:2', 20], ['2118002:3', 40]]);
    const out = new ExcelJS.Workbook();
    const zip = await JSZip.loadAsync(res.zip);
    await out.xlsx.load(await zip.file(/CO-PO-Assessment-marks\.xlsx$/)[0].async('arraybuffer'));
    const mp = out.getWorksheet('Assessment-CO Mapping')!;
    expect(['B', 'D', 'E', 'F'].map((c) => mp.getCell(`${c}4`).value)).toEqual(['Project', 1, 1, null]);   // ticked under CO1 and CO2
    expect((out.getWorksheet('CO Marks')!.getCell('D3').value as { result: string }).result).toBe('CO1, CO2');
  }, 30000);

  it('accepts "Course No" and "Course Number" for the course number', async () => {
    for (const label of ['Course No:\t\tBME 999', 'Course No. BME 999', 'Course Number:\tBME 999', 'COURSE NUMBER : bme-999']) {
      const doc = await docx([P(label), P('Credit hours:\t1.5'), P('Course Outcomes:'), P('Design a simple device')].join(''));
      const p = await previewSources({ outline: doc, roll: { semester: 'July 2025', batch: '21', count: 2, missingIds: [] } });
      expect(p.info.courseNo, label).toBe('BME 999');
    }
  });

  it('uses the number of students typed on the page, not the sections sheet of the course information', async () => {
    const info = await infoXlsx({ course_no: 'BME 999', credit_hours: 1.5, level: 3, term: 1, semester: 'July 2025', session: '2022-2023' }, [['A', 1, 60, '', '']]);
    const src = { outline: await deptOutline(), mapping: await deptMapping(), info, roll: { semester: '', batch: '21', count: 50, missingIds: ['2118007'] } };
    const p = await previewSources(src);
    expect(p.warnings.some((x) => /lists 60 students .* uses the 49 entered on this page/.test(x))).toBe(true);
    const t = await buildMarksTemplate(src, p.plan);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(t.bytes as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('ca')!;
    const ids: unknown[] = [];
    for (let r = 5; r <= ws.rowCount; r++) if (ws.getCell(`A${r}`).value) ids.push(ws.getCell(`A${r}`).value);
    expect(ids.length).toBe(49);
    expect([ids[0], ids[ids.length - 1], ids.includes(2118007)]).toEqual([2118001, 2118050, false]);
  });

  it('makes numbered folders for an assessment taken several times, and no generation log', async () => {
    const src = { outline: await deptOutline(), mapping: await deptMapping(), roll: { semester: 'July 2025', batch: '21', count: 2, missingIds: [] } };
    const { plan } = await previewSources(src);
    expect(plan.items.map((i) => i.count)).toEqual([1, 1, 1]);
    plan.items[0].count = 3;   // three quizzes were taken; marks are unchanged
    const t = await buildMarksTemplate(src, plan);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(t.bytes as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('ca')!;
    expect([2, 3, 4].map((c) => ws.getCell(3, c).value)).toEqual([30, 45, 75]);
    [[15, 45, 75], [12, 9, 15]].forEach((row, i) => row.forEach((v, k) => (ws.getCell(5 + i, 2 + k).value = v)));
    const marks = new Uint8Array(await wb.xlsx.writeBuffer());
    const names = async (counts?: Record<string, number>) => Object.keys((await JSZip.loadAsync((await buildCourseFolder({ ...src, marks, templates, counts })).zip)).files);
    const files = await names();   // the count saved in the marks sheet
    for (const f of ['Quiz 01/', 'Quiz 02/', 'Quiz 03/']) expect(files.some((x) => x.endsWith(`/Assessments and scripts/${f}Sample scripts to upload.txt`)), f).toBe(true);
    expect(files.some((x) => x.endsWith('/Assessments and scripts/Quiz/'))).toBe(false);
    expect(files.some((x) => x.endsWith('/Assessments and scripts/Project/Sample scripts to upload.txt'))).toBe(true);
    expect(files.some((x) => x.includes('_generation_log'))).toBe(false);
    const changed = await names({ Quiz: 1, Project: 2 });   // as changed on the page after the download
    expect(['Quiz/', 'Project 01/', 'Project 02/'].every((f) => changed.some((x) => x.endsWith(`/Assessments and scripts/${f}Sample scripts to upload.txt`)))).toBe(true);
  }, 30000);

  it('reads "Lab test (x2): 40%" as one assessment taken twice, and a header block written as a table', async () => {
    expect(['Lab test (x2)', 'Lab Tests (×3)', 'Quiz x4', 'Max 10', 'Project'].map(splitCount)).toEqual([
      { name: 'Lab test', count: 2 }, { name: 'Lab Tests', count: 3 }, { name: 'Quiz', count: 4 }, { name: 'Max 10', count: 1 }, { name: 'Project', count: 1 }]);
    const doc = await docx([
      TBL([['Course No:', 'BME 998'], ['Course Title:', 'Protocols Sessional'], ['Credit hours:', '1.5', 'Contact hours:', '3'], ['Level/Term:', '3/1'], ['Academic Session:', '2023-2024']]),
      P('Course Outcomes:'), P('Apply the protocols'), P('Inspect the findings'),
      P('Assessment:'), P('Class participation:\t10%'), P('Continuous assessment:\t20%'), P('Lab test (x2):\t40%'), P('Project:\t30%'),
    ].join(''));
    const p = await previewSources({ outline: doc, roll: { semester: 'January 2025', batch: '21', count: 3, missingIds: [] } });
    expect(p.info).toMatchObject({ courseNo: 'BME 998', credit: 1.5, contactHours: '3', level: '3', term: '1', session: '2023-2024' });
    expect(p.plan.items.map((i) => [i.name, i.pct, i.marks, i.count])).toEqual([['Class participation', 10, 15, 1], ['Continuous assessment', 20, 30, 1], ['Lab test', 40, 60, 2], ['Project', 30, 45, 1]]);
  });

  it("reads the website's outline template (the 20.26 Description of the Course format)", async () => {
    const o = await readOutline(readFileSync(`${A}/course_outline_template.docx`));
    expect([o.courseNo, o.title]).toEqual(['BME 320', 'Industrial Attachment']);
    expect(o.cos.map((c) => [c.no, c.pos, c.tools])).toEqual([[1, [6], 'Presentation'], [2, [5], 'Daily Reports'], [3, [10], 'Assessment Report']]);
    expect(o.distribution.map((d) => [d.name, d.pct])).toEqual([['Assessment report', 20], ['Daily report', 10], ['Presentation', 70]]);
    expect(o.contents[0]).toMatch(/^The student will be placed in an organization/);
    expect(o.objectives.length).toBe(5);
    expect(!!o.kpaTable).toBe(true);
    expect(o.planHeader[0]).toBe('Week#');
  });

  it('takes the course details, teachers and routine from the website, and lays the outline out in the department format in the zip', async () => {
    const site = { courseNo: 'BME 320', title: 'Industrial Attachment', credit: 1, contactHours: '3 weeks', level: '3', term: '2', session: '2022-2023', semester: 'July 2025', courseType: 'sessional',
      faculties: [{ name: 'Dr. Web Teacher', section: '', office_room: 'ECE-1201', email: 'web@example.edu', telephone: '+880 1700-000000', consultation: '' }],
      routine: [], routineText: 'Sunday (A1): 02:00 PM-05:00 PM\nBy appointment' };
    const src = { outline, site, roll: { semester: '', batch: '21', count: 2, missingIds: [] } };
    const p = await previewSources(src);   // the 20.26 outline has no credit hours, teachers or routine: the website gives them
    expect(p.info).toMatchObject({ courseNo: 'BME 320', credit: 1, level: '3', term: '2', session: '2022-2023', semester: 'July 2025' });
    expect(p.info.faculties.map((f) => f.name)).toEqual(['Dr. Web Teacher']);
    expect(p.info.routine).toEqual([{ day: 'Sunday', section: 'A1', start_time: '02:00 PM', end_time: '05:00 PM' }, { day: 'By appointment', section: '', start_time: '', end_time: '' }]);
    p.plan.items[1].count = 2;
    const t = await buildMarksTemplate(src, p.plan);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(t.bytes as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('ca')!;
    [[16, 8, 56], [12, 6, 40]].forEach((r, i) => r.forEach((v, k) => (ws.getCell(5 + i, 2 + k).value = v)));
    const res = await buildCourseFolder({ ...src, marks: new Uint8Array(await wb.xlsx.writeBuffer()), templates, counts: { 'Daily report': 2 } });
    const zip = await JSZip.loadAsync(res.zip);
    const xml = await docText(zip, 'BME 320 (July 2025)/BME 320_Course outline.docx');
    for (const x of ['DEPARTMENT OF BIOMEDICAL ENGINEERING', 'Course Outline', 'BME 320', 'Industrial Attachment', 'Dr. Web Teacher', 'ECE-1201', 'web@example.edu',
      '+880 1700-000000', 'Sunday (A1)', '02:00 PM - 05:00 PM', 'By appointment', '2022-2023', '3/2', 'The student will be placed', 'Understand and describe',
      'Daily report (x2):', '10%', 'Corresponding CO(s)', 'To be coordinated by the industry', 'Prepared by:']) expect(xml, x).toContain(x);
    expect(Object.keys((await JSZip.loadAsync(await zip.file('BME 320 (July 2025)/BME 320_Course outline.docx')!.async('uint8array'))).files).some((f) => f.startsWith('word/media/') && f.endsWith('.png'))).toBe(true);   // the BUET crest
    expect(res.warnings.some((w) => /could not be laid out/.test(w))).toBe(false);
  }, 30000);

  it('puts the marks sheet columns in the order set on the page', async () => {
    const src = { outline: await deptOutline(), mapping: await deptMapping(), roll: { semester: 'July 2025', batch: '21', count: 2, missingIds: [] } };
    const { plan } = await previewSources(src);
    expect(plan.items.map((i) => i.name)).toEqual(['Quiz', 'Continuous Assessment', 'Project']);   // the outline's order
    plan.items = [plan.items[2], plan.items[0], plan.items[1]];                                     // the faculty moves Project first
    const t = await buildMarksTemplate(src, plan);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(t.bytes as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('ca')!;
    expect([1, 2, 3].map((r) => [2, 3, 4].map((c) => ws.getCell(r, c).value))).toEqual([['Project', 'Quiz', 'Continuous Assessment'], ['CO1, CO2', 'CO3', 'CO1'], [75, 30, 45]]);
    [[75, 15, 45], [15, 12, 9]].forEach((r, i) => r.forEach((v, k) => (ws.getCell(5 + i, 2 + k).value = v)));
    const res = await buildCourseFolder({ ...src, marks: new Uint8Array(await wb.xlsx.writeBuffer()), templates });
    expect(Object.fromEntries([...res.attainment.co].map(([k, v]) => [k, v.pct]))).toEqual({ 1: 50, 2: 50, 3: 100 });   // read by the column headers, whatever the order
  }, 30000);

  it('matches assessment names to CO assessment tools without false hits', async () => {
    const o = (tools: string[]) => ({ cos: tools.map((t, i) => ({ no: i + 1, statement: '', pos: [], domain: '', delivery: '', tools: t })) }) as unknown as Outline;
    expect(cosFor(o(['Lab Test, Continuous Assessment', 'Lab Quiz, Continuous Assessment']), 'Class Participation and Continuous Assessment')).toEqual([1, 2]);
    expect(cosFor(o(['Lab Test, Continuous Assessment', 'Lab Quiz, Continuous Assessment']), 'Lab Quiz')).toEqual([2]);
    expect(cosFor(o(['Written exams', 'CT']), 'Term Final Examination')).toEqual([1]);
    expect(cosFor(o(['CT', 'Project report']), 'Project')).toEqual([2]);
  });
});

describe('CO-PO mapping as a Word file', () => {
  it("fills the department's CO-PO Mapping template and adds the K/P/A table", async () => {
    const bytes = await websiteMappingDocx(templates.coPoMapping, [
      { no: 1, statement: 'Explain cell physiology', pos: [1], domain: 'C2', delivery: 'Lectures', tools: 'Written exams', kpa: ['K1', 'K2'] },
      { no: 2, statement: 'Design a sensor', pos: [3, 5], domain: 'C6', delivery: 'Lectures, Project', tools: 'Project', kpa: ['K5', 'P1', 'A1'] },
    ], [{ group: 'Knowledge Profile', codes: ['K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7', 'K8'] }, { group: 'Complex Engineering Problem', codes: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'] },
      { group: 'Complex Engineering Activities', codes: ['A1', 'A2', 'A3', 'A4', 'A5'] }]);
    const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string');
    for (const t of ['Explain cell physiology', 'Design a sensor', 'PO-3, PO-5', 'Mapping of Knowledge Profile', 'Complex Engineering Activities', 'CO2']) expect(xml, t).toContain(t);
    expect(xml.match(/✓/g)?.length).toBe(5);
    expect(xml).not.toContain('Understand the fundamenta');   // the template's example rows are gone
  });
});
