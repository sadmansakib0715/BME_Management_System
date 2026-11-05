import { KPA } from '../obe';
import { byNum, Doc, pct, TICK } from './base';
const KPA_CODES = KPA.flatMap((g) => g.items.map(([k]) => k));
const join = (xs) => xs.filter(Boolean).join(', ');
function coTable(d, cos) {
    d.table([['CO No.', 'CO Statement', 'Corresponding PO(s)*', 'Domains and Taxonomy level(s)**', 'Delivery Method(s) and Activity(-ies)', 'Assessment Tool(s)']], cos.map((c) => [c.code.replace('CO', ''), c.statement, join([...c.pos].sort(byNum)), join(c.domains), join(c.delivery), join(c.tools)]), { headStyles: { fontSize: 7.8 }, columnStyles: { 0: { halign: 'center', cellWidth: 11 }, 1: { cellWidth: 60 }, 2: { halign: 'center', cellWidth: 25 }, 3: { halign: 'center', cellWidth: 24 } } });
}
function kpaTable(d, cos) {
    d.para('Mapping of Knowledge Profile, Complex Engineering Problem Solving and Complex Engineering Activities', { bold: true, size: 10 });
    d.table([['COs', ...KPA_CODES]], cos.map((c) => [c.code.replace('CO', 'CO-'), ...KPA_CODES.map((k) => (c.kpa.includes(k) ? TICK : ''))]), { styles: { fontSize: 7.5, halign: 'center', cellPadding: 1 }, columnStyles: { 0: { cellWidth: 13 } } });
}
function poMatrix(d, cos, pos) {
    d.table([['CO \\ PO', ...pos.map((p) => p.code)]], cos.map((c) => [c.code, ...pos.map((p) => (c.pos.includes(p.code) ? TICK : ''))]), { styles: { fontSize: 8, halign: 'center' }, columnStyles: { 0: { cellWidth: 16 } } });
}
function footnotes(d, pos) {
    d.para(`* ${pos.map((p) => `${p.code}: ${p.title}`).join('; ')}.`, { size: 7.5 });
    d.para('** Domains: C = Cognitive (C1 Remember … C6 Create), PS = Psychomotor (PS1–PS7), AF = Affective (AF1–AF5). '
        + 'K1–K8: knowledge profile; P1–P7: range of complex engineering problem solving; A1–A5: range of complex engineering activities (BAETE).', { size: 7.5 });
}
export function outlinePdf(a) {
    const d = new Doc();
    d.letterhead('Course Outline');
    d.fields([['Course No:', a.course.code], ['Course Title:', a.course.title], ['Credit hours:', String(a.course.creditHours ?? '')],
        ['Contact hours:', String(a.course.contactHours ?? '')], ['Level/Term:', a.course.levelTerm ?? ''], ['Academic Term:', a.course.term]]);
    d.heading('Course Teacher(s)');
    d.table([['Name', 'Office/Room', 'Email']], (a.course.teachers.length ? a.course.teachers : [{ name: '' }]).map((t) => [t.name, t.room ?? '', t.email ?? '']));
    if (a.contents.trim()) {
        d.heading('Course Contents');
        d.para(a.contents);
    }
    if (a.objectives.trim()) {
        d.heading('Course Objectives');
        d.bullets(a.objectives.split('\n'));
    }
    if (a.cos.length) {
        d.heading('Course Outcomes (COs)');
        coTable(d, a.cos);
        d.heading('CO-PO Mapping');
        poMatrix(d, a.cos, a.pos);
        kpaTable(d, a.cos);
        footnotes(d, a.pos);
    }
    if (a.assessmentStrategy.trim()) {
        d.heading('Assessment Strategy');
        d.para(a.assessmentStrategy);
    }
    if (a.marks.length) {
        d.heading('Distribution of Marks');
        const total = a.marks.reduce((n, m) => n + Number(m.percent || 0), 0);
        d.table([['Component', 'Share']], [...a.marks.map((m) => [m.component, `${m.percent}%`]), [{ content: 'Total', styles: { fontStyle: 'bold' } }, { content: `${Math.round(total * 100) / 100}%`, styles: { fontStyle: 'bold' } }]], { tableWidth: 110, columnStyles: { 1: { halign: 'right', cellWidth: 28 } } });
    }
    if (a.textbooks.trim()) {
        d.heading('Textbooks and References');
        d.bullets(a.textbooks.split('\n'));
    }
    if (a.lecturePlan.length) {
        d.heading('Lecture Plan');
        d.table([['Lecture(s)', 'Topics', 'CO(s)']], a.lecturePlan.map((r) => [r.lectures, r.topic, r.cos]), { columnStyles: { 0: { cellWidth: 22, halign: 'center' }, 2: { cellWidth: 22, halign: 'center' } } });
    }
    d.heading('Prepared by');
    d.signatures(a.preparedBy.length ? a.preparedBy : [''], 'Name, signature and date');
    return d.finish(`${a.course.code} Course Outline · ${a.course.term}`);
}
// ---------------------------------------------------------------- CO-PO mapping
export function mappingPdf(a) {
    const d = new Doc('landscape');
    d.letterhead('CO-PO Mapping', `${a.course.code}: ${a.course.title} · ${a.course.term}`);
    d.heading('Course outcomes');
    coTable(d, a.cos);
    d.heading('CO-PO mapping');
    poMatrix(d, a.cos, a.pos);
    kpaTable(d, a.cos);
    footnotes(d, a.pos);
    if (a.approval)
        d.para(`Approved: ${a.approval}`, { size: 9 });
    return d.finish(`${a.course.code} CO-PO Mapping · ${a.course.term}`);
}
export function rubricPdf(a) {
    const d = new Doc('landscape'), r = a.rubric;
    const total = r.criteria.reduce((n, c) => n + (Number(c.max) || 0), 0);
    d.letterhead(`Rubric: ${r.title || 'Untitled'}`, `${a.course.code}: ${a.course.title} · ${a.course.term}${r.assessment ? ` · ${r.assessment}` : ''} · Total ${total} marks`);
    const band = (l) => (l.min !== null && l.max !== null ? `[${l.min === l.max ? l.max : `${l.min} - ${l.max}`}] ${l.text}` : l.text);
    d.table([['Criterion & CO Mapping', 'Max Score', ...r.levels]], r.criteria.map((c, i) => [`${i + 1}. ${c.name}${c.cos.length ? ` (${[...c.cos].sort(byNum).join(', ')})` : ''}`, String(c.max), ...r.levels.map((_, k) => band(c.levels[k] ?? { min: null, max: null, text: '' }))]), { styles: { fontSize: 8, valign: 'top' }, columnStyles: { 0: { cellWidth: 46, fontStyle: 'bold' }, 1: { cellWidth: 16, halign: 'center' } } });
    if (r.note?.trim())
        d.para(`Note: ${r.note}`, { size: 9 });
    return d.finish(`${a.course.code} Rubric · ${r.title}`);
}
export function carPdf(a) {
    const d = new Doc();
    d.letterhead('Course Assessment Report (CAR)');
    d.heading('Part A. Course Information');
    d.table([], [
        ['Course Number', a.course.code], ['Course Title', a.course.title], ['Level, Term and Section', [a.course.levelTerm, a.section].filter(Boolean).join(' · ') || '-'],
        ['Academic Term', a.course.term], ['Textbooks used', a.textbooks.trim() || '-'], ['Last term when the course was offered', a.lastTerm ?? '-'],
    ], { columnStyles: { 0: { cellWidth: 55, fontStyle: 'bold', fillColor: [245, 247, 250] } } });
    d.heading('Part B. Attainment for current and previous terms');
    const codes = (p) => Array.from({ length: 12 }, (_, i) => `${p}${i + 1}`);
    for (const b of a.blocks) {
        d.para(b.term, { bold: true, size: 9.5 });
        for (const [kind, map] of [['CO', b.co], ['PO', b.po]]) {
            const cs = codes(kind);
            d.table([cs], [cs.map((c) => (map[c] ? pct(map[c].value) : 'NA')), cs.map((c) => map[c]?.yn ?? 'NA')], { styles: { fontSize: 7.5, halign: 'center', cellPadding: 1 }, didParseCell: (h) => {
                    if (h.section === 'body' && h.row.index === 1) {
                        h.cell.styles.fontStyle = 'bold';
                        if (h.cell.raw === 'N')
                            h.cell.styles.textColor = [170, 30, 30];
                    }
                } });
        }
    }
    d.para(a.thresholds, { size: 8 });
    d.heading('Part C. Comments');
    d.para(a.partC.trim() || 'Teachers\' comment on attainment: -\n\nInterpretation of student feedback: -\n\nTeachers\' comment on teaching-learning: -');
    d.heading('Part D. Comments on CQI implemented based on last assessment');
    d.para(a.partD.trim() || 'N/A');
    d.heading('Part E. Recommendation');
    d.para(a.partE.trim() || 'Major issues: -\n\nPlan for future actions for further improvement: -');
    d.heading('Signature(s)');
    d.signatures(a.course.teachers.map((t) => t.name), 'Signature');
    d.para(`Status: ${a.status}`, { size: 8 });
    return d.finish(`${a.course.code} CAR · ${a.course.term}`);
}
