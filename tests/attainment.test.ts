import { describe, expect, it } from 'vitest';
import { computeAttainment, countedItems, poContribution, programPo } from '../src/lib/attainment';
import type { AssessmentComponent, AssessmentItem, Mark, Question } from '../src/lib/types';

const comp = (id: string, best_n: number | null): AssessmentComponent => ({ id, offering_id: 'o', kind: 'class_test', name: id, item_count: 3, marks_each: 10, weight: 20, best_n, per_section: false, sort: 0 });
const item = (id: string, component_id: string, status: AssessmentItem['status'] = 'held'): AssessmentItem =>
  ({ id, component_id, offering_id: 'o', section_id: null, seq: 1, title: id, held_on: null, held_time: null, total_marks: 10, status, marks_status: 'published', responsible: null, syllabus: null });
const q = (id: string, item_id: string, co_id: string, max_marks = 10): Question => ({ id, item_id, label: id, max_marks, co_id, sort: 0 });
const m = (question_id: string, student_id: string, value: number | null, flag: Mark['flag'] = null): Mark => ({ question_id, student_id, value, flag });
const settings = { x_pct: 60, y_pct: 50, level1: 50, level2: 60, level3: 70 };
const cos = [{ id: 'c1', offering_id: 'o', code: 'CO1', statement: '', domain: 'cognitive' as const, level: 3, sort: 1 }];

describe('CO attainment', () => {
  it('applies "X% of students score at least Y%"', () => {
    // 5 students on one 10-mark question: 8, 6, 5, 4, 2 -> 3 of 5 reach 50% -> A = 60% -> attained at X = 60
    const r = computeAttainment({ cos, coPo: [], components: [comp('ct', null)], items: [item('i1', 'ct')], questions: [q('q1', 'i1', 'c1')],
      marks: [m('q1', 's1', 8), m('q1', 's2', 6), m('q1', 's3', 5), m('q1', 's4', 4), m('q1', 's5', 2)],
      studentIds: ['s1', 's2', 's3', 's4', 's5'], settings });
    expect(r.cos[0]).toMatchObject({ students: 5, attainedStudents: 3, attainmentPct: 60, attained: true, level: 2, averagePct: 50 });
  });

  it('drops each student\'s weakest class test under best N', () => {
    const input = { cos, coPo: [], components: [comp('ct', 2)], items: [item('i1', 'ct'), item('i2', 'ct'), item('i3', 'ct')],
      questions: [q('q1', 'i1', 'c1'), q('q2', 'i2', 'c1'), q('q3', 'i3', 'c1')],
      marks: [m('q1', 's1', 2), m('q2', 's1', 9), m('q3', 's1', 7)], studentIds: ['s1'], settings };
    expect([...countedItems(input).get('s1')!].sort()).toEqual(['i2', 'i3']);
    expect(computeAttainment(input).studentCo.s1.c1).toBe(80);
  });

  it('removes absent, exempt, blank and cancelled marks from both sides', () => {
    const r = computeAttainment({ cos, coPo: [], components: [comp('ct', null)],
      items: [item('i1', 'ct'), item('i2', 'ct', 'cancelled')], questions: [q('q1', 'i1', 'c1'), q('q2', 'i2', 'c1')],
      marks: [m('q1', 's1', null, 'AB'), m('q1', 's2', 7), m('q2', 's2', 0), m('q1', 's3', null)],
      studentIds: ['s1', 's2', 's3'], settings });
    expect(r.cos[0].students).toBe(1);
    expect(r.studentCo.s1.c1).toBeNull();
    expect(r.studentCo.s2.c1).toBe(70);
  });
});

describe('PO roll-up', () => {
  it('weights CO levels by correlation strength', () => {
    const pos = poContribution([{ coId: 'a', level: 3 }, { coId: 'b', level: 1 }], [
      { co_id: 'a', po_code: 'PO1', strength: 3 }, { co_id: 'b', po_code: 'PO1', strength: 1 }, { co_id: 'b', po_code: 'PO10', strength: 2 }]);
    expect(pos).toEqual([{ po: 'PO1', level: 2.5 }, { po: 'PO10', level: 1 }]);
  });
  it('credit-weights courses for the program', () => {
    expect(programPo([{ credits: 3, pos: [{ po: 'PO1', level: 3 }] }, { credits: 1.5, pos: [{ po: 'PO1', level: 0 }] }]))
      .toEqual([{ po: 'PO1', level: 2, courses: 2 }]);
  });
});
