import { describe, expect, it } from 'vitest';
import { blockers, examProgress, stepOwner, stepState, validateAssignment } from '../src/lib/workflow';
import type { ExamTask } from '../src/lib/types';

const t = (step: string, status: string) => ({ offering_id: 'o', step, status, due_on: null, note: null, updated_by: null, updated_at: '' }) as ExamTask;

describe('exam chain', () => {
  it('locks moderation until both halves are submitted', () => {
    const tasks = [t('qp_a', 'submitted'), t('qp_b', 'under_preparation'), t('mod_1', 'not_started')];
    expect(stepState(tasks, 'mod_1')).toBe('locked');
    expect(blockers(tasks, 'mod_1')).toEqual(['qp_b']);
    tasks[1] = t('qp_b', 'submitted');
    expect(stepState(tasks, 'mod_1')).toBe('ready');
  });
  it('derives examiners and gradesheet roles from the five assignments', () => {
    const a = { offering_id: 'o', qp_a: 'A', qp_b: 'B', mod_1: 'M1', mod_2: 'M2', scrutinizer: 'S' };
    expect(stepOwner(a, 'exam_a')).toBe('A');
    expect(stepOwner(a, 'exam_b')).toBe('B');
    expect(stepOwner(a, 'gs_prep')).toBe('A');
    expect(stepOwner(a, 'gs_scrutiny')).toBe('S');
    expect(stepOwner(a, 'printing')).toBeNull();
  });
  it('reports progress and the current step', () => {
    const p = examProgress([t('qp_a', 'submitted'), t('qp_b', 'submitted')]);
    expect(p.done).toBe(2);
    expect(p.current?.key).toBe('mod_1');
  });
});

describe('assignment rules', () => {
  it('flags hard errors that match the database constraints', () => {
    const issues = validateAssignment({ qp_a: 'A', qp_b: 'A', mod_1: 'A', mod_2: 'M', scrutinizer: 'A' });
    expect(issues.filter((i) => i.level === 'error')).toHaveLength(3);
  });
  it('only warns when the scrutinizer also moderates', () => {
    const issues = validateAssignment({ qp_a: 'A', qp_b: 'B', mod_1: 'M', mod_2: 'S', scrutinizer: 'S' });
    expect(issues).toEqual([{ level: 'warning', message: expect.stringContaining('also a moderator') }]);
  });
});
