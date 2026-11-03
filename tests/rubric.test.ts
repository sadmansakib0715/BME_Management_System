import { describe, expect, it } from 'vitest';
import { bands, blankRubric, marksPerCo, parseBand, rubricChecks, rubricFromSheet, SAMPLE_RUBRIC, total } from '../src/lib/rubric';

describe('rubrics', () => {
  it('splits a criterion into even bands from the top mark down to 0', () => {
    expect(bands(10, 5)).toEqual([{ min: 9, max: 10 }, { min: 7, max: 8 }, { min: 5, max: 6 }, { min: 3, max: 4 }, { min: 0, max: 2 }]);
    const b = bands(8, 4);
    expect(b[0].max).toBe(8);
    expect(b[b.length - 1].min).toBe(0);
  });

  it('accepts the department sample once every criterion is linked to a CO', () => {
    const r = SAMPLE_RUBRIC();
    expect(total(r)).toBe(50);
    expect(rubricChecks(r)).toEqual(r.criteria.map((c) => `${c.name} is not linked to a CO.`));
    const linked = { ...r, criteria: r.criteria.map((c, i) => ({ ...c, cos: [i < 2 ? 'co1' : 'co2'] })) };
    expect(rubricChecks(linked)).toEqual([]);
    expect(marksPerCo(linked)).toEqual({ co1: 20, co2: 30 });
  });

  it('flags gaps and overlaps between bands', () => {
    const r = blankRubric();
    r.title = 'Demo';
    r.criteria[0] = { ...r.criteria[0], name: 'Prototype', cos: ['co1'], levels: r.criteria[0].levels.map((l, i) => (i === 1 ? { ...l, max: 9 } : l)) };
    expect(rubricChecks(r)).toEqual(['Prototype: Excellent and Good overlap.']);
  });

  it('reads bands and a pasted sheet', () => {
    expect(parseBand('7–8: Problem is clear')).toEqual({ min: 7, max: 8, text: 'Problem is clear' });
    expect(parseBand('2: Vague')).toEqual({ min: 2, max: 2, text: 'Vague' });
    const sheet = 'Project Presentation — Total 18\nCriterion\tMax Marks\tExcellent\tPoor\nDefinition\t8\t"5–8: Very\nclear"\t0–4: Unclear\nDemo\t10\t6–10: Works\t0–5: Fails\nNote: keep to time';
    const r = rubricFromSheet(sheet)!;
    expect(r.title).toBe('Project Presentation');
    expect(r.levels).toEqual(['Excellent', 'Poor']);
    expect(r.criteria.map((c) => [c.name, c.max, c.levels[0].min, c.levels[0].text])).toEqual([['Definition', 8, 5, 'Very clear'], ['Demo', 10, 6, 'Works']]);
    expect(r.note).toBe('keep to time');
    expect(rubricFromSheet('just text')).toBeNull();
  });
});
