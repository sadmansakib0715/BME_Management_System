import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { previewSources } from '../src/lib/courseFolder/build';
import { autoFill } from '../src/lib/outlineAutoFill';
import { outlineDocx } from '../src/lib/outlineDocx';
import { applyDrop, draftGaps, emptyDraft, toAssessments, toItems, toTeachers, toWeeks } from '../src/lib/outlineDraft';
import { docxBlocks, pdfLinesToBlocks } from '../src/lib/sourceDoc';

// Made-up course data only.
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const P = (t: string, list = false) => `<w:p>${list ? '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' : ''}<w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`;
const TBL = (rows: string[][]) => `<w:tbl>${rows.map((r) => `<w:tr>${r.map((c) => `<w:tc>${c.split('\n').map((x) => P(x)).join('')}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
async function docx(body: string) {
  const z = new JSZip();
  z.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
  z.file('word/_rels/document.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
  z.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`);
  return z.generateAsync({ type: 'uint8array' });
}

describe('shaping dropped text', () => {
  it('turns bullets and numbers into list items, joining wrapped lines', () => {
    expect(toItems('● Introduce protocols for safe,\neffective operation\n● Analyse data')).toEqual(['Introduce protocols for safe, effective operation', 'Analyse data']);
    expect(toItems('1. Apply X\n2. Inspect Y')).toEqual(['Apply X', 'Inspect Y']);
    expect(toItems('Book one\nBook two')).toEqual(['Book one', 'Book two']);
    expect(toItems('CO No.\tCO Statement\tPO\n1\tApply the protocols\tPO-1')).toEqual(['Apply the protocols']);   // a CO table: the statement column
  });
  it('reads assessment lines with (x2)', () => {
    expect(toAssessments('Class participation: 10%\nLab test (x2): 40%\nTotal 100%')).toEqual([{ name: 'Class participation', pct: '10', count: 1 }, { name: 'Lab test', pct: '40', count: 2 }]);
  });
  it('reads schedule rows from lines and from a table', () => {
    expect(toWeeks('1 Python basics\nand packages\n2 Data analysis')).toEqual([{ week: '1', topic: 'Python basics and packages', basis: '' }, { week: '2', topic: 'Data analysis', basis: '' }]);
    expect(toWeeks('Week\tTopics\tEvaluation Basis\n1\tPython basics\tContinuous evaluation\nMid Break and Eid Vacation\n2\tData analysis\t')).toEqual([
      { week: '1', topic: 'Python basics', basis: 'Continuous evaluation' }, { week: '', topic: 'Mid Break and Eid Vacation', basis: '' }, { week: '2', topic: 'Data analysis', basis: '' }]);
  });
  it('reads teachers from a table and from PDF lines', () => {
    expect(toTeachers('Name\tOffice/Room\tEmail & Telephone\tClass routine\nMr. A One\tECE-1001\ta@example.edu +880 1000-000001\tSunday (A1) 09:00 AM - 11:00 AM\nMs. B Two\tECE-1002\tb@example.edu')).toEqual({
      teachers: [{ name: 'Mr. A One', room: 'ECE-1001', email: 'a@example.edu', phone: '+880 1000-000001' }, { name: 'Ms. B Two', room: 'ECE-1002', email: 'b@example.edu', phone: '' }],
      routine: 'Sunday (A1) 09:00 AM - 11:00 AM' });
    const pdf = toTeachers('Mr. A\tECE-1001\ta@example.edu\nOne\t+880 1000-000001');   // a wrapped PDF row
    expect(pdf.teachers).toEqual([{ name: 'Mr. A One', room: 'ECE-1001', email: 'a@example.edu', phone: '+880 1000-000001' }]);
  });
  it('drops onto a part: single fields take the value, lists append or replace an empty list', () => {
    let d = applyDrop(emptyDraft(), 'courseNo', 'Course No: bme-310');
    d = applyDrop(d, 'credit', 'Credit hours: 1.5');
    d = applyDrop(d, 'outcomes', '1. Apply X\n2. Inspect Y');
    d = applyDrop(d, 'outcomes', '3. Determine Z');
    expect([d.courseNo, d.credit, d.outcomes]).toEqual(['BME 310', '1.5', ['Apply X', 'Inspect Y', 'Determine Z']]);
    expect(draftGaps(d)).toEqual(['Course Title', 'Assessment']);
  });
});

describe('the first pass and the Word file', () => {
  it('fills the template from an outline in another layout, and the Word file reads back in the course folder', async () => {
    const src = await docx([
      P('Department of Biomedical Engineering'), P('Course Number: BME 997'), P('Course Title: Test Sessional'), P('Credit hours: 1.5   Contact hours: 3'),
      P('Level/Term: 3/1'), P('Session: 2023-2024'), P('Instructors:'),
      TBL([['Name', 'Room', 'Contact'], ['Dr. A One', 'ECE-1001', 'a@example.edu\n+880 1000-000001']]),
      P('Syllabus:'), P('Protocols used in biomedical instruments.'),
      P('Objectives'), P('Introduce protocols', true), P('Analyse biomedical data', true),
      P('Learning Outcomes:'), P('Apply the protocols', true), P('Inspect the findings', true),
      P('Marks distribution:'), P('Quiz: 30%'), P('Lab test (x2): 40%'), P('Project: 30%'),
      P('References'), P('A. Author, Book One (2020).'), P('B. Author, Book Two (2021).'),
      P('Weekly Schedule:'), TBL([['Week', 'Topics', 'Evaluation Basis'], ['1', 'Introduction', 'Quiz'], ['Mid Break'], ['2', 'Protocols', 'Lab Test 01']]),
    ].join(''));
    const d = autoFill(await docxBlocks(src));
    expect([d.courseNo, d.title, d.credit, d.contact, d.levelTerm, d.session]).toEqual(['BME 997', 'Test Sessional', '1.5', '3', '3/1', '2023-2024']);
    expect(d.teachers).toEqual([{ name: 'Dr. A One', room: 'ECE-1001', email: 'a@example.edu', phone: '+880 1000-000001' }]);
    expect(d.contents).toBe('Protocols used in biomedical instruments.');
    expect([d.objectives, d.outcomes, d.textbooks]).toEqual([['Introduce protocols', 'Analyse biomedical data'], ['Apply the protocols', 'Inspect the findings'], ['A. Author, Book One (2020).', 'B. Author, Book Two (2021).']]);
    expect(d.assessment).toEqual([{ name: 'Quiz', pct: '30', count: 1 }, { name: 'Lab test', pct: '40', count: 2 }, { name: 'Project', pct: '30', count: 1 }]);
    expect(d.schedule).toEqual([{ week: '1', topic: 'Introduction', basis: 'Quiz' }, { week: '', topic: 'Mid Break', basis: '' }, { week: '2', topic: 'Protocols', basis: 'Lab Test 01' }]);
    expect(draftGaps(d)).toEqual([]);

    // The generated outline is in the department layout: the course folder reads it back.
    const out = await outlineDocx(d);
    const p = await previewSources({ outline: out, roll: { semester: 'July 2025', batch: '21', count: 2, missingIds: [] } });
    expect(p.info).toMatchObject({ courseNo: 'BME 997', credit: 1.5, contactHours: '3', level: '3', term: '1', session: '2023-2024' });
    expect(p.outline.cos.map((c) => c.statement)).toEqual(['Apply the protocols', 'Inspect the findings']);
    expect(p.plan.items.map((i) => [i.name, i.pct, i.count])).toEqual([['Quiz', 30, 1], ['Lab test', 40, 2], ['Project', 30, 1]]);
    expect(p.info.faculties.map((f) => [f.name, f.office_room, f.email, f.telephone])).toEqual([['Dr. A One', 'ECE-1001', 'a@example.edu', '+880 1000-000001']]);
    expect(p.outline.planHeader).toEqual(['Week', 'Topics', 'Evaluation Basis']);
  });

  it('joins PDF text pieces split at ligatures and turns wide gaps into columns', () => {
    const b = pdfLinesToBlocks([[{ s: 'safe, e', x: 108, y: 500, w: 40 }, { s: 'ff', x: 148, y: 500, w: 7 }, { s: 'ective', x: 155, y: 500, w: 30 },
      { s: 'Mr. A', x: 100, y: 480, w: 30 }, { s: 'ECE-1001', x: 200, y: 480, w: 40 }, { s: '7', x: 300, y: 40, w: 5 }]]);
    expect(b).toEqual([{ kind: 'p', text: 'safe, effective', list: false, line: true }, { kind: 'p', text: 'Mr. A\tECE-1001', list: false, row: true, line: true }]);
  });
});
