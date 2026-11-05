import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSheetDate } from '../src/lib/dates';
import { fixSpelling, nameMatcher, normCode, parseWorkbook } from '../src/lib/importer';
describe('date parsing', () => {
    it.each([
        [46200, '2026-06-27'], ['46210', '2026-07-07'], ['Saturday, July 18, 2026', '2026-07-18'], ['18/08/2026', '2026-08-18'],
        ['July 21,2026', '2026-07-21'], ['Sunday, Auguest 23, 2026', '2026-08-23'], ['2026-10-05', '2026-10-05'], ['31/02/2026', null], ['soon', null],
    ])('%s -> %s', (input, out) => expect(parseSheetDate(input)).toBe(out));
});
describe('normalizers', () => {
    it('normalizes course codes', () => {
        expect(normCode('BME  207')).toBe('BME 207');
        expect(normCode('BME 409 (Elective)')).toBe('BME 409');
    });
    it('fixes known spellings', () => expect(fixSpelling('Conitnuous Assessment 02')).toBe('Continuous Assessment 02'));
    it('matches faculty name variants', () => {
        const match = nameMatcher(['Ms. Rina Banik', 'Dr. Karim Hasan']);
        expect(match('Ms. Rina Bonik')).toEqual({ name: 'Ms. Rina Banik', fixed: true });
        expect(match('Dr. Karim Hasan')).toEqual({ name: 'Dr. Karim Hasan', fixed: false });
    });
});
// Runs against the department workbook when it is available locally. The file is never committed.
const BOOK = process.env.TRACKER_XLSX ?? '';
describe.skipIf(!BOOK || !existsSync(BOOK))('January 2026 workbook', () => {
    it('produces a complete, valid plan', () => {
        const r = parseWorkbook(readFileSync(BOOK), { code: '2026-01', name: 'January 2026' });
        expect(r.errors).toEqual([]);
        expect(r.plan.offerings).toHaveLength(23);
        expect(r.plan.faculty).toHaveLength(14);
        expect(r.plan.exam).toHaveLength(13);
        expect(r.plan.offerings.find((o) => o.code === 'BME 300').sections.map((s) => s.name)).toEqual(['A1', 'A2']);
        expect(r.plan.milestones.find((m) => m.kind === 'question_submission')?.due_on).toBe('2026-10-05');
        expect(r.plan.class_tests.filter((c) => !c.held_on)).toHaveLength(12);
        expect(r.fixes.some((f) => f.message.includes('normalized to BME 207'))).toBe(true);
        expect(r.plan.sessional_items.some((i) => i.title.startsWith('Untitled'))).toBe(true);
    });
});
