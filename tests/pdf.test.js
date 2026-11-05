import { writeFileSync, mkdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { clean } from '../src/lib/pdf/base';
import { carPdf, mappingPdf, outlinePdf, rubricPdf } from '../src/lib/pdf/obeDocs';
const course = { code: 'BME 203', title: 'Human Physiology', creditHours: 3, contactHours: 3, levelTerm: 'Level 2, Term 1', term: 'July 2025',
    teachers: [{ name: 'Ms. Chaity Chakraborty', room: 'ECE-1013', email: 'chaity@bme.buet.ac.bd' }, { name: 'Ms. Tasnia Binte Mamun', room: 'ECE-1125' }] };
const cos = [
    { code: 'CO1', statement: 'Explain human physiological mechanisms by applying basic principles of biology and chemistry', pos: ['PO1'], domains: ['C2'], delivery: ['Lectures', 'Homework'], tools: ['Written exams'], kpa: ['K1', 'K2'] },
    { code: 'CO2', statement: 'Describe the fundamental mechanisms underlying normal function of cells, tissues, organs, and organ systems in humans', pos: ['PO1'], domains: ['C1'], delivery: ['Lectures'], tools: ['Written exams'], kpa: ['K1', 'K2'] },
    { code: 'CO4', statement: 'Apply knowledge of functional mechanisms and their regulation to explain the pathophysiology of common diseases', pos: ['PO1'], domains: ['C3'], delivery: ['Lectures'], tools: ['Written exams'], kpa: ['K1', 'K2', 'K3', 'K4', 'P1'] },
];
const pos = Array.from({ length: 12 }, (_, i) => ({ code: `PO${i + 1}`, title: ['Engineering knowledge', 'Problem analysis', 'Design/development of solutions', 'Investigation', 'Modern tool usage', 'Engineer and society', 'Environment and sustainability', 'Ethics', 'Individual and teamwork', 'Communication', 'Project management and finance', 'Lifelong learning'][i] }));
const text = (doc) => Buffer.from(doc.output('arraybuffer')).toString('latin1');
const OUT = process.env.PDF_OUT; // set to write the PDFs for a visual check
const keep = (name, doc) => { if (OUT) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/${name}`, Buffer.from(doc.output('arraybuffer')));
} };
describe('OBE document PDFs', () => {
    it('maps symbols the PDF fonts cannot show', () => {
        expect(clean('CO% ≥ 40% ✓ → done')).toBe('CO% >= 40% Yes -> done');
        expect(clean('Rāhim 😀 – “ok”')).toBe('Rāhim  – “ok”'.replace('ā', ''));
    });
    it('builds the course outline with COs, mapping, marks and lecture plan', () => {
        const doc = outlinePdf({ course, contents: 'Cell physiology; membrane transport; nerve and muscle; cardiovascular, respiratory and renal physiology.', objectives: 'Introduce physiology\nRelate function to disease',
            cos, pos, assessmentStrategy: 'Class participation and attendance are recorded in every class. Continuous assessment through class tests. A comprehensive term final at the end of the term.',
            marks: [{ component: 'Class participation', percent: 10 }, { component: 'Continuous assessment', percent: 20 }, { component: 'Final examination', percent: 70 }],
            textbooks: 'Silverthorn, Human Physiology: An Integrated Approach, 7th ed.\nGuyton and Hall, Textbook of Medical Physiology, 13th ed.',
            lecturePlan: [{ lectures: '1-3', topic: 'Cell physiology', cos: 'CO1, CO2' }, { lectures: '4-6', topic: 'Membrane transport', cos: 'CO1' }], preparedBy: course.teachers.map((t) => t.name) });
        const s = text(doc);
        expect(s.startsWith('%PDF')).toBe(true);
        for (const t of ['Course Outline', 'BME 203', 'Course Outcomes', 'Distribution of Marks', 'Lecture Plan', 'Prepared by'])
            expect(s).toContain(t);
        keep('outline.pdf', doc);
    });
    it('builds the CO-PO mapping in landscape', () => {
        const doc = mappingPdf({ course, cos, pos, approval: 'BUGS meeting 8, 26 Oct 2025' });
        const s = text(doc);
        expect(s).toContain('CO-PO Mapping');
        expect(s).toContain('Mapping of Knowledge Profile');
        expect(doc.internal.pageSize.getWidth()).toBeGreaterThan(doc.internal.pageSize.getHeight());
        keep('mapping.pdf', doc);
    });
    it('builds a rubric with mark bands', () => {
        const doc = rubricPdf({ course: { ...course, code: 'BME 350', title: 'Biomedical Engineering Design II' }, rubric: { title: 'Final Report', assessment: 'Report', levels: ['Excellent (80-100%)', 'Satisfactory (50-79%)', 'Needs Improvement (<50%)'],
                note: 'IEEE citation style.', criteria: [
                    { name: 'Problem Framing & Prior Art', max: 15, cos: ['CO1'], levels: [{ label: 'E', min: 12, max: 15, text: 'Clear, compelling problem definition.' }, { label: 'S', min: 8, max: 11, text: 'Adequate problem definition.' }, { label: 'N', min: 0, max: 7, text: 'Vague problem statement.' }] },
                    { name: 'Ethical & Regulatory Compliance', max: 15, cos: ['CO8'], levels: [{ label: 'E', min: 12, max: 15, text: 'IRB protocol impeccably completed.' }, { label: 'S', min: 8, max: 11, text: 'Standard ethical risks identified.' }, { label: 'N', min: 0, max: 7, text: 'Missing major considerations.' }] }
                ] } });
        const s = text(doc);
        expect(s).toContain('Criterion & CO Mapping');
        expect(s).toContain('[12 - 15] Clear, compelling problem definition.');
        keep('rubric.pdf', doc);
    });
    it('builds the CAR with parts A to E and both terms', () => {
        const block = (term, v) => ({ term, co: Object.fromEntries(v.map((x, i) => [`CO${i + 1}`, { value: x, yn: (x >= 40 ? 'Y' : 'N') }])),
            po: { PO1: { value: 78.43, yn: 'Y' } } });
        const doc = carPdf({ course, section: null, textbooks: 'Silverthorn; Guyton and Hall', lastTerm: 'January 2025', status: 'Draft',
            blocks: [block('January 2025', [60, 72, 86, 62]), block('July 2025', [78.43, 84.31, 90.2, 35.29])],
            partC: "Teachers' comment on attainment: Satisfactory.", partD: 'N/A', partE: 'Major issues: None.', thresholds: 'Attained at >= 40% of students reaching 40%.' });
        const s = text(doc);
        for (const t of ['Part A. Course Information', 'Part B. Attainment', 'Part C. Comments', 'Part D.', 'Part E. Recommendation', '78.43', '35.29'])
            expect(s).toContain(t);
        keep('car.pdf', doc);
    });
});
