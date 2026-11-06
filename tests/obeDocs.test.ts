import { describe, expect, it } from 'vitest';
import * as X from 'xlsx';
import { attainmentSummaryWorkbook } from '../src/lib/attainmentXlsx';
import { impliedKpa, kpaAfterPoChange } from '../src/lib/obe';
import { moderationSections, questionNo } from '../src/pages/course/obe/docData';

// PO1–PO12 as seeded (k_profiles and the wording that marks complex problems / activities).
const pos = [
  { code: 'PO1', k_profiles: 'K1–K4', statement: 'Apply knowledge of mathematics … to the solution of complex engineering problems.' },
  { code: 'PO3', k_profiles: 'K5', statement: 'Design solutions for complex engineering problems …' },
  { code: 'PO5', k_profiles: 'K6', statement: 'Create, select and apply appropriate techniques … to complex engineering problems, with an understanding of the limitations.' },
  { code: 'PO9', k_profiles: null, statement: 'Function effectively as an individual, and as a member or leader in diverse teams.' },
  { code: 'PO10', k_profiles: null, statement: 'Communicate effectively on complex engineering activities with the engineering community …' },
];

describe('K/P/A ticks from the CO–PO mapping', () => {
  it('ticks the PO knowledge profiles, P1 for complex problems and A1 for complex activities', () => {
    expect(impliedKpa(pos[0])).toEqual(['K1', 'K2', 'K3', 'K4', 'P1']);
    expect(impliedKpa(pos[1])).toEqual(['K5', 'P1']);
    expect(impliedKpa(pos[3])).toEqual([]);
    expect(impliedKpa(pos[4])).toEqual(['A1']);
  });

  it('adds ticks on mapping, removes only those no remaining PO implies, and keeps hand-set ones', () => {
    const a = kpaAfterPoChange([], [], ['PO1'], pos);
    expect(a).toEqual(['K1', 'K2', 'K3', 'K4', 'P1']);
    const b = kpaAfterPoChange([...a, 'P3'], ['PO1'], ['PO1', 'PO5'], pos);  // P3 set by hand
    expect(b).toEqual(['K1', 'K2', 'K3', 'K4', 'K6', 'P1', 'P3']);
    expect(kpaAfterPoChange(b, ['PO1', 'PO5'], ['PO5'], pos)).toEqual(['K6', 'P1', 'P3']); // P1 still implied by PO5
    // A tick the teacher removed is not forced back when another PO changes.
    expect(kpaAfterPoChange(['K1', 'K2', 'P1'], ['PO1'], ['PO1', 'PO9'], pos)).toEqual(['K1', 'K2', 'P1']);
  });
});

describe('question moderation form', () => {
  const cos = [{ id: 'a', domain_levels: ['C2'] }, { id: 'b', domain_levels: ['C3'] }, { id: 'c', domain_levels: ['C4', 'PS2'] }];
  it('writes question numbers as the form does', () => {
    expect(questionNo('Q01 (a)')).toBe('1(a)');
    expect(questionNo('Question 5(b)')).toBe('5(b)');
  });
  it('splits the term final into sections A (Q1–4) and B (Q5–8) with domains and levels', () => {
    const rows = [{ assessment: 'Term Final', label: 'Q01 (a)', cos: ['a'] }, { assessment: 'Term Final', label: 'Q05 (b)', cos: ['c', 'b'] },
      { assessment: 'Class Test', label: 'CT1', cos: ['a'] }];
    const s = moderationSections(rows, cos, { A: 'Setter A', B: 'Setter B', all: 'Both' });
    expect(s.map((x) => [x.section, x.teacher, x.rows.length])).toEqual([['A', 'Setter A', 1], ['B', 'Setter B', 1]]);
    expect(s[1].rows[0]).toEqual({ question: '5(b)', cos: ['CO2', 'CO3'], levels: ['C3', 'C4', 'PS2'], domains: ['Cognitive', 'Psychomotor'] });
  });
  it('keeps one section when the questions are not numbered 1–8', () => {
    const s = moderationSections([{ assessment: 'Final', label: 'Part A', cos: ['a'] }], cos, { A: 'x', B: 'y', all: 'Both' });
    expect(s).toHaveLength(1);
    expect(s[0].teacher).toBe('Both');
  });
});

describe('CO and PO attainment workbook', () => {
  it('lays out the department sheets with %, Y/N and N/A', () => {
    const na = { value: null, yn: 'NA' as const };
    const block = { term: 'July 2025', co: { CO1: { value: 79.59, yn: 'Y' as const }, CO2: { value: 35, yn: 'N' as const }, CO3: na },
      po: { PO1: { value: 91.84, yn: 'Y' as const }, PO2: na } };
    const wb = attainmentSummaryWorkbook(X, { code: 'BME 210', title: 'Numerical Techniques Sessional', sessions: [{ block, teachers: ['T One', 'T Two', 'T Three'] }] });
    expect(wb.SheetNames).toEqual(['CO Attainment', 'PO Attainment']);
    const co = wb.Sheets['CO Attainment'];
    expect(co.A1.v).toBe('CO Attainment of BME 210 (Numerical Techniques Sessional)');
    expect([co.A2.v, co.B2.v, co.D2.v, co.E2.v]).toEqual(['Session', 'Course Teacher (1)', 'Course Teacher (3)', 'CO1']);
    expect([co.A3.v, co.D3.v, co.E3.v, co.E3.z, co.F4.v, co.G3.v, co.G4.v]).toEqual(['July 2025', 'T Three', 0.7959, '0.00%', 'N', 'N/A', 'N/A']);
    expect(co['!merges']).toContainEqual({ s: { r: 2, c: 0 }, e: { r: 3, c: 0 } });
    expect(wb.Sheets['PO Attainment'].E3.v).toBe(0.9184);
  });
});
