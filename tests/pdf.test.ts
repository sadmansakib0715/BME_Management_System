import { writeFileSync, mkdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { clean } from '../src/lib/pdf/base';
import { basicInfoPdf, carPdf, instructorsPdf, mappingPdf, moderationPdf, outlinePdf, rubricPdf, type CoRow } from '../src/lib/pdf/obeDocs';

const course = { code: 'BME 203', title: 'Human Physiology', creditHours: 3, contactHours: 3, levelTerm: '2/1', session: '2023-2024', term: 'July 2025', routine: 'Sunday: 09:00 AM-09:50 AM\nMonday: 09:00 AM-09:50 AM',
  teachers: [{ name: 'Ms. Chaity Chakraborty', room: 'ECE-1013', email: 'chaity@bme.buet.ac.bd', phone: '+880 1521258181' }, { name: 'Ms. Tasnia Binte Mamun', room: 'ECE-1125' }] };
const cos: CoRow[] = [
  { code: 'CO1', statement: 'Explain human physiological mechanisms by applying basic principles of biology and chemistry', pos: ['PO1'], domains: ['C2'], delivery: ['Lectures', 'Homework'], tools: ['Written exams'], kpa: ['K1', 'K2'] },
  { code: 'CO2', statement: 'Describe the fundamental mechanisms underlying normal function of cells, tissues, organs, and organ systems in humans', pos: ['PO1'], domains: ['C1'], delivery: ['Lectures'], tools: ['Written exams'], kpa: ['K1', 'K2'] },
  { code: 'CO4', statement: 'Apply knowledge of functional mechanisms and their regulation to explain the pathophysiology of common diseases', pos: ['PO1'], domains: ['C3'], delivery: ['Lectures'], tools: ['Written exams'], kpa: ['K1', 'K2', 'K3', 'K4', 'P1'] },
];
const pos = Array.from({ length: 12 }, (_, i) => ({ code: `PO${i + 1}`, title: ['Engineering knowledge', 'Problem analysis', 'Design/development of solutions', 'Investigation', 'Modern tool usage', 'Engineer and society', 'Environment and sustainability', 'Ethics', 'Individual and teamwork', 'Communication', 'Project management and finance', 'Lifelong learning'][i] }));
// PDF strings escape ( ) and \ with a backslash; undo that so assertions read naturally.
const text = (doc: { output: (t: 'arraybuffer') => ArrayBuffer }) => Buffer.from(doc.output('arraybuffer')).toString('latin1').replace(/\\([()\\])/g, '$1');
const OUT = process.env.PDF_OUT; // set to write the PDFs for a visual check
const keep = (name: string, doc: { output: (t: 'arraybuffer') => ArrayBuffer }) => { if (OUT) { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/${name}`, Buffer.from(doc.output('arraybuffer'))); } };

describe('OBE document PDFs', () => {
  it('maps symbols the PDF fonts cannot show', () => {
    expect(clean('CO% ≥ 40% ✓ → done')).toBe('CO% >= 40% Yes -> done');
    expect(clean('Rāhim 😀 – “ok”')).toBe('Rāhim  – “ok”'.replace('ā', ''));
  });

  it('builds the course outline in the department layout', () => {
    const doc = outlinePdf({ course, contents: 'Cell physiology; membrane transport; nerve and muscle; cardiovascular, respiratory and renal physiology. '.repeat(4), objectives: 'Introduce physiology\nRelate function to disease',
      cos, scheduleUnit: 'Week',
      marks: [{ component: 'Class participation', percent: 10 }, { component: 'Continuous assessment', percent: 20 }, { component: 'Final examination', percent: 70 }],
      textbooks: 'Silverthorn, Human Physiology: An Integrated Approach, 7th ed.\nGuyton and Hall, Textbook of Medical Physiology, 13th ed.',
      lecturePlan: [{ lectures: '1', topic: 'Cell physiology', cos: 'CO1, CO2' }, { lectures: '', topic: 'Mid-term break', cos: '' }, { lectures: '2', topic: 'Membrane transport', cos: '' }], preparedBy: course.teachers.map((t) => t.name) });
    const s = text(doc);
    expect(s.startsWith('%PDF')).toBe(true);
    for (const t of ['Course Outline', 'BME 203', 'Academic Session:', '2023-2024', 'Course Teacher(s):', 'Email & Telephone', 'Class routine', 'Course Outcomes:', 'Assessment:', 'Class participation:', 'Textbooks and References:', 'Weekly Schedule:', 'Mid-term break', 'Prepared by:', '/Image']) expect(s).toContain(t);
    expect(Math.round(doc.internal.pageSize.getWidth())).toBe(216); // US Letter, as the Word templates
    keep('outline.pdf', doc);
  });

  it('builds the CO-PO mapping with the K/P/A table', () => {
    const doc = mappingPdf({ course, cos, pos, approval: 'BUGS meeting 8, 26 Oct 2025' });
    const s = text(doc);
    expect(s).toContain('CO-PO Mapping');
    expect(s).toContain('Mapping of Knowledge Profile');
    for (const t of ['Course Outcomes:', 'Corresponding', 'PO-1', 'Complex Engineering Problem']) expect(s).toContain(t);
    keep('mapping.pdf', doc);
  });

  it('builds a rubric with mark bands', () => {
    const doc = rubricPdf({ course: { ...course, code: 'BME 350', title: 'Biomedical Engineering Design II' }, rubric: { title: 'Final Report', assessment: 'Report', levels: ['Excellent (80-100%)', 'Satisfactory (50-79%)', 'Needs Improvement (<50%)'],
      note: 'IEEE citation style.', criteria: [
        { name: 'Problem Framing & Prior Art', max: 15, cos: ['CO1'], levels: [{ label: 'E', min: 12, max: 15, text: 'Clear, compelling problem definition.' }, { label: 'S', min: 8, max: 11, text: 'Adequate problem definition.' }, { label: 'N', min: 0, max: 7, text: 'Vague problem statement.' }] },
        { name: 'Ethical & Regulatory Compliance', max: 15, cos: ['CO8'], levels: [{ label: 'E', min: 12, max: 15, text: 'IRB protocol impeccably completed.' }, { label: 'S', min: 8, max: 11, text: 'Standard ethical risks identified.' }, { label: 'N', min: 0, max: 7, text: 'Missing major considerations.' }] }] } });
    const s = text(doc);
    expect(s).toContain('Criterion & CO Mapping');
    expect(s).toContain('[12 - 15]');
    keep('rubric.pdf', doc);
  });

  it('builds the CAR with parts A to E and both terms', () => {
    const block = (term: string, v: number[]) => ({ term, co: Object.fromEntries(v.map((x, i) => [`CO${i + 1}`, { value: x, yn: (x >= 40 ? 'Y' : 'N') as 'Y' | 'N' }])),
      po: { PO1: { value: 78.43, yn: 'Y' as const } } });
    const doc = carPdf({ course, section: null, textbooks: 'Silverthorn, Human Physiology\nGuyton and Hall, Medical Physiology', lastTerm: 'January 2025',
      current: block('July 2025', [78.43, 84.31, 90.2, 35.29]), previous: block('January 2025', [60, 72, 86, 62]),
      partC: "Teachers' comment on attainment: CO4 needs improvement.\n\nInterpretation of student feedback: Satisfactory\n\nTeachers' comment on teaching-learning: Good.", partD: '', partE: 'Major issues: None.' });
    const s = text(doc);
    for (const t of ['Course Assessment Report', 'Department of BME, BUET', 'Part A. Course Information', '1.   Course Number:', 'Part B. Attainment for current and previous terms',
      'Previous term: January 2025', 'Part C. Analysis', "Teachers' comment on teaching learning: Good.", 'Part D.', 'Part E. Recommendation',
      'Plan for future actions for further improvement: N/A', 'Signature(s):', 'Name: Ms. Chaity Chakraborty', '78.43', '35.29']) expect(s).toContain(t);
    expect(s.indexOf('78.43')).toBeLessThan(s.indexOf('Previous term')); // current term first, as in the template
    keep('car.pdf', doc);
  });

  it('builds the course-file pieces and the moderation form', () => {
    const basic = text(basicInfoPdf({ course, marks: [{ component: 'Term Final', percent: 70 }] }));
    for (const t of ['Course No:', 'Contact hours:', 'Level/Term:', 'Assessment:', 'Term Final:', '70%']) expect(basic).toContain(t);
    const inst = text(instructorsPdf({ course }));
    for (const t of ['Course Teacher(s):', 'ECE-1013', 'Sunday:']) expect(inst).toContain(t);
    const doc = moderationPdf({ course, sections: [{ section: 'A', teacher: 'Ms. Chaity Chakraborty', rows: [{ question: '1(a)', cos: ['CO1'], domains: ['Cognitive'], levels: ['C2'] }] },
      { section: 'B', teacher: 'Ms. Tasnia Binte Mamun', rows: [{ question: '5(a)', cos: ['CO4'], domains: ['Cognitive'], levels: ['C3'] }] }] });
    const s = text(doc);
    for (const t of ['Question Moderation Form for Term Final Examination', 'Section 1: To be completed by Course Teacher', 'CO-4', 'Checked by:']) expect(s).toContain(t);
    expect(doc.getNumberOfPages()).toBe(2);
    expect(doc.internal.pageSize.getWidth()).toBeGreaterThan(doc.internal.pageSize.getHeight());
    keep('moderation.pdf', doc);
  });
});
