import { describe as suite, expect, it } from 'vitest';
import { describe, groupEntries } from '../src/lib/activity';
import type { AuditEntry } from '../src/lib/types';

const ME = 'f-1', AT = '2026-11-06T04:00:00+00:00';
const names: Record<string, string> = { 'f-1': 'Sadman Sakib Himel', 'f-2': 'Dr. Ayesha Rahman' };
const ctx = { nameOf: (id: string) => names[id] ?? 'Unknown', coCode: (id: string) => ({ c1: 'CO1' } as Record<string, string>)[id] };
let id = 0;
const entry = (table: string, action: AuditEntry['action'], old_row: Record<string, unknown> | null, new_row: Record<string, unknown> | null, extra: Partial<AuditEntry> = {}): AuditEntry =>
  ({ id: ++id, table_name: table, row_pk: String((new_row ?? old_row)?.id ?? ''), action, old_row, new_row, actor: ME, actor_name: 'Sadman Sakib Himel',
    offering_id: 'o-1', course_code: 'BME 203', term_id: 't-1', at: AT, ...extra });
const say = (es: AuditEntry[]) => groupEntries(es).map((g) => describe(g, ctx));

const ct = { id: 'i-1', title: 'CT 01', held_on: null, held_time: null, status: 'planned', marks_status: 'none', total_marks: 20, responsible: null };

suite('activity log sentences', () => {
  it('says when an assessment is scheduled, rescheduled and marked held', () => {
    expect(say([entry('assessment_items', 'UPDATE', ct, { ...ct, held_on: '2026-11-20', held_time: '10:00' })])[0].text)
      .toBe('scheduled CT 01 for Fri, 20 Nov 2026 at 10:00');
    const moved = say([
      entry('assessment_items', 'UPDATE', { ...ct, held_on: '2026-11-20' }, { ...ct, held_on: '2026-11-23' }),
      entry('item_date_history', 'INSERT', null, { id: 'h', item_id: 'i-1', reason: 'Holiday' }, { row_pk: 'i-1' }),
    ]);
    expect(moved).toHaveLength(1); // the reason joins the reschedule instead of being a second line
    expect(moved[0].text).toBe('rescheduled CT 01 from Fri, 20 Nov 2026 to Mon, 23 Nov 2026');
    expect(moved[0].details).toContain('Reason: Holiday');
    expect(say([entry('assessment_items', 'UPDATE', ct, { ...ct, status: 'held' })])[0].text).toBe('marked CT 01 as held');
    expect(say([entry('assessment_items', 'INSERT', null, { ...ct, held_on: '2026-12-01' })])[0].text).toBe('scheduled CT 01 for Tue, 1 Dec 2026');
  });

  it('lists the changed fields of an edit with names, not ids', () => {
    const d = say([entry('assessment_items', 'UPDATE', ct, { ...ct, total_marks: 30, responsible: 'f-2', updated_at: 'x' })])[0];
    expect(d.text).toBe('edited CT 01');
    expect(d.details).toEqual(['Marks: 20 → 30', 'Responsible: — → Dr. Ayesha Rahman']);
  });

  it('groups rows saved together and keeps separate saves apart', () => {
    const gen = [1, 2, 3].map((n) => entry('assessment_items', 'INSERT', null, { ...ct, id: `i-${n}`, title: `CT 0${n}` }));
    const later = entry('assessment_items', 'DELETE', ct, null, { at: '2026-11-06T03:00:00+00:00' });
    const out = say([...gen, later]);
    expect(out.map((d) => d.text)).toEqual(['added 3 assessments', 'removed CT 01']);
    expect(out[0].details[0]).toBe('Added CT 01 (date to be set)');
  });

  it('describes exam steps, teachers, mapping and course records', () => {
    expect(say([entry('exam_tasks', 'UPDATE', { step: 'qp_a', status: 'under_preparation' }, { step: 'qp_a', status: 'submitted', note: null })])[0].text)
      .toBe('set Question preparation · Section A to “Submitted”');
    expect(say([entry('section_teachers', 'INSERT', null, { section_id: 's', faculty_id: 'f-2' })])[0].text).toBe('assigned Dr. Ayesha Rahman as course teacher');
    expect(say([entry('co_po_map', 'INSERT', null, { co_id: 'c1', po_code: 'PO2' })])[0].text).toBe('mapped CO1 → PO2');
    expect(say([entry('course_records', 'UPDATE', { outline_status: 'prepared' }, { outline_status: 'shared' })])[0].text).toBe('set the course outline to “Shared with students”');
    expect(say([entry('obe_offering_docs', 'UPDATE', { contents: 'a', academic_session: null }, { contents: 'a'.repeat(80), academic_session: '2023-2024' })])[0].details)
      .toEqual(['Contents edited', 'Academic session: — → 2023-2024']);
  });
});
