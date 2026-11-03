// OBE rules from the department's OBE module specification (sections 2, 5, 7–9), without student marks:
// cohort CO% and PO% are imported per offering; this module decides Y/N, NA, warnings and completeness.
import type { CarReport, CoPo, Course, CourseFileItem, CourseOutcome, CriterionCo, FileSlot, ObeAttainment, ObeCriterion, PO } from './types';

export const DOMAIN_LEVELS: { domain: string; codes: string[] }[] = [
  { domain: 'Cognitive', codes: ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'] },
  { domain: 'Psychomotor', codes: ['PS1', 'PS2', 'PS3', 'PS4', 'PS5', 'PS6', 'PS7'] },
  { domain: 'Affective', codes: ['AF1', 'AF2', 'AF3', 'AF4', 'AF5'] },
];

/** Knowledge profile, complex problem and complex activity attributes (Washington Accord / BAETE). */
export const KPA: { group: string; items: [string, string][] }[] = [
  { group: 'Knowledge profile', items: [['K1', 'Natural sciences'], ['K2', 'Mathematics and computing'], ['K3', 'Engineering fundamentals'], ['K4', 'Specialist knowledge'],
    ['K5', 'Engineering design'], ['K6', 'Engineering practice and tools'], ['K7', 'Engineering in society'], ['K8', 'Research literature']] },
  { group: 'Complex problem', items: [['P1', 'Depth of knowledge'], ['P2', 'Conflicting requirements'], ['P3', 'Depth of analysis'], ['P4', 'Unfamiliar issues'],
    ['P5', 'Beyond codes of practice'], ['P6', 'Diverse stakeholders'], ['P7', 'Interdependence']] },
  { group: 'Complex activity', items: [['A1', 'Diverse resources'], ['A2', 'Significant interactions'], ['A3', 'Innovation'], ['A4', 'Consequences for society and environment'], ['A5', 'Beyond previous experience']] },
];

/** Delivery methods and assessment tools as the department's CO-PO Mapping documents word them. */
export const DELIVERY = ['Lectures', 'Homework', 'Tutorials', 'Discussion', 'Interactive discussions', 'Case Study', 'Guided Instruction', 'Guided Discussion and Practice',
  'Demonstrations', 'Audio-visual demonstration', 'Coding Tasks', 'Simulation', 'Lab sessions', 'Hands-on Group Activities', 'Report writing', 'Term Project',
  'Weekly meetings', 'Hospital visits', 'Clinical Observation'];
export const TOOLS = ['Written exams', 'Class tests', 'Continuous Assessment', 'Assignments', 'Lab Test', 'Lab Quiz', 'Lab Report', 'Lab Viva', 'Final Quiz', 'Final Viva',
  'Presentations', 'Demonstration', 'Reports', 'Final Report', 'Intermediate Submission', 'Peer Review'];
/** Assessments offered when a teacher adds a group to the assessment map; any other name can be typed. */
export const ASSESSMENTS = ['Term Final', 'Class Test', 'Continuous Assessment', 'Assignment', 'Lab Test', 'Lab Quiz', 'Lab Report', 'Viva', 'Presentation 01', 'Presentation 02',
  'Demo 01', 'Demo 02', 'Project', 'Final Report', 'Oral Examination', 'Intermediate Submissions'];

/** BAETE PO coverage expected of each culminating course (spec section 5). */
export const CULMINATING_POS: Record<string, number[]> = {
  'BME 300': [2, 3, 5, 6, 8, 9, 10, 11],
  'BME 350': [2, 4, 5, 6, 7, 8, 9, 10, 11],
  'BME 400': [1, 2, 3, 4, 5, 6, 8, 9, 10, 12],
};

export const DEFAULT_THRESHOLD = 0.4;
export const coCodes = (n = 12) => Array.from({ length: n }, (_, i) => `CO${i + 1}`);
export const PO_CODES = Array.from({ length: 12 }, (_, i) => `PO${i + 1}`);

/** 'K1–K4' → K1..K4, 'K5' → [K5], '—' → []. */
export function kProfiles(po: Pick<PO, 'k_profiles'>): string[] {
  const s = (po.k_profiles ?? '').replace(/\s/g, '');
  const range = s.match(/^K(\d)[–-]K(\d)$/);
  if (range) return Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_, i) => `K${Number(range[1]) + i}`);
  return s.match(/K\d/g) ?? [];
}

/** Attained on the unrounded value, with ≥ (SAR §8.4). value and threshold: value in %, threshold as a fraction. */
export const attained = (value: number | null | undefined, threshold = DEFAULT_THRESHOLD) => value === null || value === undefined ? null : value >= threshold * 100;
/** Within 10 points above the threshold: the CAR asks for a comment (spec section 9). */
export const nearThreshold = (value: number | null | undefined, threshold = DEFAULT_THRESHOLD) => value !== null && value !== undefined && value >= threshold * 100 && value < threshold * 100 + 10;
export const fmtPct = (v: number | null | undefined) => (v === null || v === undefined ? 'NA' : `${(Math.round(v * 100) / 100).toFixed(2)}%`);

/** POs mapped by at least one CO of the offering; the rest are NA everywhere. */
export function mappedPos(cos: Pick<CourseOutcome, 'id'>[], coPo: CoPo[]): Set<string> {
  const ids = new Set(cos.map((c) => c.id));
  return new Set(coPo.filter((m) => ids.has(m.co_id)).map((m) => m.po_code));
}

export const valueOf = (att: ObeAttainment[], type: 'CO' | 'PO', code: string) => att.find((a) => a.outcome_type === type && a.code === code)?.value ?? null;

/** Parses pasted results such as "CO1 78.43", "PO5,99.33%" or a two-row header/value table copied from Excel. */
export function parseAttainment(text: string): { type: 'CO' | 'PO'; code: string; value: number }[] {
  const out = new Map<string, { type: 'CO' | 'PO'; code: string; value: number }>();
  const put = (code: string, raw: string) => {
    const m = code.trim().toUpperCase().match(/^(CO|PO)\s*0?(\d{1,2})$/);
    let v = Number(raw.replace('%', '').trim());
    if (!m || !Number.isFinite(v) || raw.trim() === '') return;
    if (v > 0 && v <= 1 && raw.includes('.') && !raw.includes('%')) v *= 100; // 0.7843 → 78.43
    const n = Number(m[2]);
    if (n < 1 || n > 12 || v < 0 || v > 100) return;
    out.set(`${m[1]}${n}`, { type: m[1] as 'CO' | 'PO', code: `${m[1]}${n}`, value: v });
  };
  const lines = text.split(/\r?\n/).map((l) => l.split(/\t|,|;|:|\s{2,}|\s(?=\d)/).map((x) => x.trim()).filter(Boolean)).filter((l) => l.length);
  const header = lines.findIndex((l) => l.length > 2 && l.every((c) => /^(CO|PO)\s*\d{1,2}$/i.test(c)));
  if (header >= 0 && lines[header + 1]) lines[header].forEach((c, i) => put(c, lines[header + 1][i] ?? ''));
  for (const l of lines) if (l.length >= 2) put(l[0], l[1]);
  return [...out.values()];
}

/** Warnings for the COs & mapping section (spec section 5). */
export function coWarnings(course: Pick<Course, 'code' | 'is_culminating'>, cos: Pick<CourseOutcome, 'id' | 'statement' | 'kpa' | 'domain_levels'>[], coPo: CoPo[], pos: Pick<PO, 'code' | 'k_profiles'>[]): string[] {
  const w: string[] = [];
  if (cos.length > 12) w.push('At most 12 COs: the CAR and attainment sheets hold CO1–CO12.');
  cos.forEach((c, i) => {
    const n = `CO${i + 1}`;
    if (!c.statement.trim()) w.push(`${n} has no statement.`);
    else if (!/^[A-Z][a-z]+/.test(c.statement.trim())) w.push(`${n} should start with an action verb.`);
    const mine = coPo.filter((m) => m.co_id === c.id).map((m) => m.po_code);
    if (!mine.length) w.push(`${n} is not mapped to any PO.`);
    if (!(c.domain_levels ?? []).length) w.push(`${n} has no domain and taxonomy level.`);
    for (const po of mine) {
      const need = kProfiles(pos.find((p) => p.code === po) ?? { k_profiles: null });
      if (need.length && !need.some((k) => (c.kpa ?? []).includes(k))) w.push(`${n} maps to ${po} but none of ${need.join(', ')} is ticked.`);
    }
  });
  const expected = CULMINATING_POS[course.code];
  if (expected && cos.length) {
    const have = mappedPos(cos, coPo);
    const missing = expected.filter((n) => !have.has(`PO${n}`)), extra = [...have].filter((p) => !expected.includes(Number(p.slice(2))));
    if (missing.length || extra.length) w.push(`BAETE coverage for ${course.code} is PO${expected.join(', ')}.${missing.length ? ` Missing: PO${missing.join(', PO')}.` : ''}${extra.length ? ` Extra: ${extra.join(', ')}.` : ''}`);
  }
  return w;
}

export type FileCheck = { slot: FileSlot | 'mapping' | 'instructors' | 'resolution' | 'attainment' | 'car'; label: string; done: boolean; auto: boolean; link?: string | null };
/** The course-file artefacts of spec section 4; derived ones are ticked from the data, the rest by hand. */
export function courseFile(a: { cos: Pick<CourseOutcome, 'id'>[]; coPo: CoPo[]; attainment: ObeAttainment[]; car: Pick<CarReport, 'status'> | null; files: CourseFileItem[]; hasTeachers: boolean; hasResolution: boolean }): FileCheck[] {
  const f = (slot: FileSlot) => a.files.find((x) => x.slot === slot);
  const mapped = a.cos.length > 0 && a.cos.every((c) => a.coPo.some((m) => m.co_id === c.id));
  const coDone = a.cos.length > 0 && a.cos.every((_, i) => valueOf(a.attainment, 'CO', `CO${i + 1}`) !== null);
  return [
    { slot: 'outline', label: 'Course outline', done: !!f('outline')?.done, auto: false, link: f('outline')?.link },
    { slot: 'mapping', label: 'CO-PO mapping', done: mapped, auto: true },
    { slot: 'instructors', label: 'Instructors and schedule', done: a.hasTeachers, auto: true },
    { slot: 'resolution', label: 'BUGS resolution', done: a.hasResolution, auto: true },
    { slot: 'lecture_materials', label: 'Lecture materials', done: !!f('lecture_materials')?.done, auto: false, link: f('lecture_materials')?.link },
    { slot: 'scripts', label: 'Assessments and scripts (highest, average, lowest)', done: !!f('scripts')?.done, auto: false, link: f('scripts')?.link },
    { slot: 'attainment_workbook', label: 'CO-PO-assessment workbook', done: !!f('attainment_workbook')?.done, auto: false, link: f('attainment_workbook')?.link },
    { slot: 'attainment', label: 'CO and PO attainment', done: coDone, auto: true },
    { slot: 'car', label: 'Course Assessment Report (final)', done: a.car?.status === 'final', auto: true },
    { slot: 'bsfs_feedback', label: 'BSFS feedback report', done: !!f('bsfs_feedback')?.done, auto: false, link: f('bsfs_feedback')?.link },
  ];
}

// ---------------------------------------------------------------- assessment map (question parts and marking criteria → COs)
/** Criteria grouped by assessment, in the order they were first entered. */
export function byAssessment<T extends Pick<ObeCriterion, 'assessment' | 'sort'>>(criteria: T[]): { assessment: string; items: T[] }[] {
  const groups: { assessment: string; items: T[] }[] = [];
  for (const c of [...criteria].sort((a, b) => a.sort - b.sort)) {
    const g = groups.find((x) => x.assessment === c.assessment);
    if (g) g.items.push(c); else groups.push({ assessment: c.assessment, items: [c] });
  }
  return groups;
}

/** Marks that assess each CO (a criterion tagged to several COs counts in full for each) and its share of the course total. */
export function coCoverage(cos: Pick<CourseOutcome, 'id'>[], criteria: Pick<ObeCriterion, 'id' | 'max_marks'>[], links: CriterionCo[]) {
  const total = criteria.reduce((n, c) => n + Number(c.max_marks), 0);
  return cos.map((co) => {
    const mine = criteria.filter((c) => links.some((l) => l.criterion_id === c.id && l.co_id === co.id));
    const marks = mine.reduce((n, c) => n + Number(c.max_marks), 0);
    return { co_id: co.id, marks, items: mine.length, share: total ? (marks / total) * 100 : 0 };
  });
}

/** Checks for the assessment map: every CO assessed and every question or criterion tagged to a CO. */
export function criteriaWarnings(cos: Pick<CourseOutcome, 'id'>[], criteria: Pick<ObeCriterion, 'id' | 'assessment' | 'label' | 'max_marks'>[], links: CriterionCo[]): string[] {
  const w: string[] = [];
  if (!criteria.length) return w;
  coCoverage(cos, criteria, links).forEach((c, i) => { if (!c.items) w.push(`CO${i + 1} is not assessed by any question or criterion.`); });
  for (const c of criteria) {
    const name = `${c.assessment} · ${c.label}`;
    if (!links.some((l) => l.criterion_id === c.id)) w.push(`${name} is not tagged to a CO.`);
  }
  return w;
}
