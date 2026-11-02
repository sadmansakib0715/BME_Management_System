import { describe, expect, it } from 'vitest';
import { attained, coWarnings, courseFile, kProfiles, mappedPos, nearThreshold, parseAttainment } from '../src/lib/obe';
import type { CoPo } from '../src/lib/types';

describe('OBE rules', () => {
  it('uses ≥ on the unrounded value (SAR §8.4)', () => {
    expect(attained(40)).toBe(true);
    expect(attained(39.999)).toBe(false);
    expect(attained(78.43)).toBe(true); // BME 203 Jul 2025 cohort CO1
    expect(attained(null)).toBeNull();
    expect(attained(55, 0.6)).toBe(false);
  });

  it('flags results within 10 points above the threshold for a CAR comment', () => {
    expect(nearThreshold(45)).toBe(true);
    expect(nearThreshold(50)).toBe(false);
    expect(nearThreshold(35)).toBe(false);
  });

  it('expands knowledge profiles', () => {
    expect(kProfiles({ k_profiles: 'K1–K4' })).toEqual(['K1', 'K2', 'K3', 'K4']);
    expect(kProfiles({ k_profiles: 'K5' })).toEqual(['K5']);
    expect(kProfiles({ k_profiles: '—' })).toEqual([]);
  });

  it('parses pasted attainment in the shapes the workbooks use', () => {
    expect(parseAttainment('CO1 78.43\nCO2\t84.31%\nPO5, 99.33')).toEqual([
      { type: 'CO', code: 'CO1', value: 78.43 }, { type: 'CO', code: 'CO2', value: 84.31 }, { type: 'PO', code: 'PO5', value: 99.33 }]);
    expect(parseAttainment('CO1\tCO2\tCO3\n0.7843\t0.8431\t0.902')).toEqual([
      { type: 'CO', code: 'CO1', value: 78.43 }, { type: 'CO', code: 'CO2', value: 84.31 }, { type: 'CO', code: 'CO3', value: 90.2 }]);
    expect(parseAttainment('CO13 50\nPO2 140\nnotes')).toEqual([]);
  });

  it('treats a PO with no mapped CO as NA', () => {
    const coPo: CoPo[] = [{ co_id: 'a', po_code: 'PO1', strength: 1 }, { co_id: 'b', po_code: 'PO2', strength: 1 }];
    expect([...mappedPos([{ id: 'a' }], coPo)]).toEqual(['PO1']);
  });

  it('warns about missing K-profile ticks and culminating coverage', () => {
    const pos = [{ code: 'PO3', k_profiles: 'K5' }, { code: 'PO5', k_profiles: 'K6' }];
    const w = coWarnings({ code: 'BME 300', is_culminating: true },
      [{ id: 'a', statement: 'Develop a working prototype', kpa: ['K6'], domain_levels: ['PS4'] }],
      [{ co_id: 'a', po_code: 'PO3', strength: 1 }, { co_id: 'a', po_code: 'PO5', strength: 1 }], pos);
    expect(w.some((x) => x.includes('PO3') && x.includes('K5'))).toBe(true);
    expect(w.some((x) => x.startsWith('BAETE coverage for BME 300') && x.includes('Missing: PO2'))).toBe(true);
    expect(w.some((x) => x.includes('PO5 but'))).toBe(false);
  });

  it('derives course-file completeness from the data', () => {
    const items = courseFile({ cos: [{ id: 'a' }], coPo: [{ co_id: 'a', po_code: 'PO1', strength: 1 }], attainment: [{ offering_id: 'o', outcome_type: 'CO', code: 'CO1', value: 70, source: 'import', updated_at: '' }],
      car: { status: 'final' }, files: [{ offering_id: 'o', slot: 'outline', done: true, link: null }], hasTeachers: true, hasResolution: false });
    expect(items.filter((i) => i.done).map((i) => i.slot)).toEqual(['outline', 'mapping', 'instructors', 'attainment', 'car']);
  });
});
