// Course-folder generator: shared types, the department's attainment rules and small helpers.
// Rules (dept OBE policy, SAR ch. 8):
//   student CO% = marks on CO-mapped items / max marks of those items, attained at >= 40%
//   cohort CO%  = students attaining / students assessed, attained at >= 40%
//   student PO% = mean of the student's CO% over the COs mapped to that PO; cohort PO% as for COs
//   Abs: a student absent in every item of a CO is left out of that CO; a partial Abs counts as 0.

export const STUDENT_THRESHOLD = 0.4;
export const COHORT_THRESHOLD = 0.4;
export const MAX_CO = 12;
export const MAX_PO = 12;
export const DEFAULT_DEPT_CODE = '18';
export const PLACEHOLDER = '[To be filled by the course teacher]';
const ABSENT = new Set(['abs', 'absent', 'a', 'ab']);

export type Rec = Record<string, string>;

export interface CourseInfo {
  courseNo: string;
  credit: number;
  contactHours: string;
  level: string;
  term: string;
  semester: string;
  session: string;
  extra: Rec;
  faculties: Rec[];
  routine: Rec[];
  sections: Rec[];
}

export interface CO { no: number; statement: string; pos: number[]; domain: string; delivery: string; tools: string }

export interface Outline {
  courseNo: string;
  title: string;
  cos: CO[];
  coTable: unknown | null;   // the outline's CO table element (kept for reference)
  kpaTable: unknown | null;  // the K/P/A matrix element, copied into CO-PO Mapping.docx
  planHeader: string[];
  plan: string[][];
  /** Assessment lines: "Lab test (x2): 40%" → { name: 'Lab test', pct: 40, count: 2 }. */
  distribution: { name: string; pct: number; count?: number }[];
  textbooks: string[];
  /** The department outline's header block: Course No, Title, Credit / Contact hours, Level/Term, Academic Session. */
  header: { courseNo?: string; title?: string; credit?: string; contact?: string; level?: string; term?: string; session?: string };
  /** Course Contents paragraphs and Course Objectives items, as written. */
  contents: string[];
  objectives: string[];
  /** Course Teacher(s) table. */
  teachers: { name: string; room: string; email: string; phone: string }[];
  /** Class routine from the teachers table (section, day, start_time, end_time). */
  routine: Rec[];
}

export interface Item { name: string; cos: number[]; max: number }

export interface Marks {
  items: Item[];
  ids: number[];
  /** `${sid}:${itemIndex}` → mark, or null when absent */
  values: Map<string, number | null>;
}
export const key = (sid: number, k: number) => `${sid}:${k}`;

export interface Cohort { assessed: number; attained: number; pct: number | null; ok: boolean | null }

export interface Attainment {
  coUsed: number[];
  poUsed: number[];
  studentCo: Map<string, number | null>;   // `${sid}:${co}` → % (0–100) or null (excluded)
  studentPo: Map<string, number | null>;
  co: Map<number, Cohort>;
  po: Map<number, Cohort>;
  poCos: Map<number, number[]>;
  absentees: Map<number, number[]>;
}

export interface Sample { highest: [number, number] | null; average: [number, number] | null; lowest: [number, number] | null; mean: number | null }

export class Warnings {
  list: string[] = [];
  add(m: string) { this.list.push(m); }
}

// ------------------------------------------------------------------ text helpers
export const clean = (s: unknown) => (s === null || s === undefined ? '' : String(s).replace(/\s+/g, ' ').trim());

/** lower-case alphanumerics, plural 's' dropped per word: "Daily Reports" and "Daily report" compare equal. */
export function norm(s: string): string {
  return (String(s).toLowerCase().match(/[a-z0-9]+/g) ?? []).map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)).join('');
}

/** "PO-6" → [6]; "CO1, CO-2" → [1, 2]; "3" → [3] */
export function parseNums(s: unknown, prefix: string): number[] {
  const str = String(s ?? '');
  let found = [...str.matchAll(new RegExp(`${prefix}\\s*-?\\s*(\\d+)`, 'gi'))].map((m) => Number(m[1]));
  if (!found.length) found = [...str.matchAll(/\b(\d+)\b/g)].map((m) => Number(m[1]));
  return [...new Set(found)];
}

export const fmtPct = (x: number | null | undefined) => (x === null || x === undefined ? 'NA' : x.toFixed(2));
export const fmtNum = (x: number) => String(Math.round(x * 100) / 100);

export function isAbsentToken(v: unknown) { return ABSENT.has(clean(v).toLowerCase()); }

export function toMark(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = clean(v);
  if (!s || ABSENT.has(s.toLowerCase())) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function toId(v: unknown): number | null {
  const s = clean(v).split('.')[0];
  return /^\d+$/.test(s) ? Number(s) : null;
}

export const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').trim();

export function initials(name: string) {
  const words = (name.match(/[A-Za-z]+/g) ?? []).filter((w) => !['dr', 'prof', 'engr', 'mr', 'ms', 'mrs'].includes(w.toLowerCase()));
  return words.map((w) => w[0].toUpperCase()).join('') || 'Teacher';
}

// ------------------------------------------------------------------ course facts
/** BUET convention: an even course number is sessional, an odd one theory; `course_type` overrides. */
export function isSessional(info: CourseInfo): boolean {
  const o = (info.extra.course_type ?? '').trim().toLowerCase();
  if (/^(sess|lab|prac)/.test(o)) return true;
  if (o.startsWith('theo')) return false;
  const d = info.courseNo.match(/\d+/g);
  return !!d && Number(d[d.length - 1]) % 2 === 0;
}

export const levelTerm = (info: CourseInfo) => `${info.level}/${info.term}`;

export function batchOf(info: CourseInfo): number {
  if (info.extra.batch) return Number(info.extra.batch.trim().slice(-2));
  const m = info.session.match(/(\d{4})/);
  if (!m || !/^\d+$/.test(info.level)) throw new Error("course information: needs 'session' (e.g. 2023-2024) and 'level', or a 'batch' column");
  return (Number(m[1]) % 100) - (Number(info.level) - 1);
}

/** IDs = batch + dept code + 3-digit roll, from the sections sheet (plus extra_ids, minus exclude_ids). */
export function studentIds(info: CourseInfo): number[] {
  if (!info.sections.length) throw new Error("course information: add a 'sections' sheet (section, first_roll, last_roll, extra_ids, exclude_ids)");
  const b = String(batchOf(info)).padStart(2, '0');
  const dept = info.extra.dept_code || DEFAULT_DEPT_CODE;
  const ids: number[] = [];
  const excl = new Set<number>();
  for (const s of info.sections) {
    if (s.first_roll && s.last_roll) for (let r = Number(s.first_roll); r <= Number(s.last_roll); r++) ids.push(Number(`${b}${dept}${String(r).padStart(3, '0')}`));
    for (const x of (s.extra_ids ?? '').match(/\d{5,}/g) ?? []) ids.push(Number(x));
    for (const x of (s.exclude_ids ?? '').match(/\d{5,}/g) ?? []) excl.add(Number(x));
  }
  return [...new Set(ids)].filter((i) => !excl.has(i)).sort((a, c) => a - c);
}

// ------------------------------------------------------------------ attainment
export function computeAttainment(o: Outline, m: Marks, w: Warnings, sThr = STUDENT_THRESHOLD, cThr = COHORT_THRESHOLD): Attainment {
  const coItems = new Map<number, number[]>();
  m.items.forEach((it, k) => it.cos.forEach((c) => coItems.set(c, [...(coItems.get(c) ?? []), k])));
  const coOf = (n: number) => o.cos.find((c) => c.no === n);
  const coUsed = [...coItems.keys()].filter((c) => coOf(c)).sort((a, b) => a - b);
  for (const c of o.cos) if (!coItems.has(c.no)) w.add(`CO${c.no} has no assessment in the marks sheet; reported as NA`);
  const studentCo = new Map<string, number | null>();
  const absentees = new Map<number, number[]>();
  for (const sid of m.ids) for (const c of coUsed) {
    const ks = coItems.get(c)!;
    const vals = ks.map((k) => m.values.get(key(sid, k)) ?? null);
    if (vals.every((v) => v === null)) { studentCo.set(key(sid, c), null); absentees.set(sid, [...(absentees.get(sid) ?? []), c]); }
    else studentCo.set(key(sid, c), (100 * vals.reduce<number>((a, v) => a + (v ?? 0), 0)) / ks.reduce((a, k) => a + m.items[k].max, 0));
  }
  const cohort = (pcts: (number | null)[]): Cohort => {
    const assessed = pcts.filter((p): p is number => p !== null);
    const att = assessed.filter((p) => p >= sThr * 100 - 1e-9);
    const pct = assessed.length ? (100 * att.length) / assessed.length : null;
    return { assessed: assessed.length, attained: att.length, pct, ok: pct === null ? null : pct >= cThr * 100 - 1e-9 };
  };
  const co = new Map(coUsed.map((c) => [c, cohort(m.ids.map((s) => studentCo.get(key(s, c)) ?? null))]));
  const poCos = new Map<number, number[]>();
  for (const c of coUsed) for (const p of coOf(c)!.pos) poCos.set(p, [...(poCos.get(p) ?? []), c]);
  const poUsed = [...poCos.keys()].sort((a, b) => a - b);
  const studentPo = new Map<string, number | null>();
  for (const sid of m.ids) for (const p of poUsed) {
    const v = poCos.get(p)!.map((c) => studentCo.get(key(sid, c))).filter((x): x is number => x !== null && x !== undefined);
    studentPo.set(key(sid, p), v.length ? v.reduce((a, x) => a + x, 0) / v.length : null);
  }
  const po = new Map(poUsed.map((p) => [p, cohort(m.ids.map((s) => studentPo.get(key(s, p)) ?? null))]));
  return { coUsed, poUsed, studentCo, studentPo, co, po, poCos, absentees };
}

/** Highest, lowest and "average" (closest to the class mean) script for one assessment. */
export function sampleStats(values: Map<number, number | null>): Sample {
  const present = [...values].filter((e): e is [number, number] => e[1] !== null);
  if (!present.length) return { highest: null, average: null, lowest: null, mean: null };
  const mean = present.reduce((a, [, v]) => a + v, 0) / present.length;
  const pick = (better: (a: [number, number], b: [number, number]) => boolean) => present.reduce((a, b) => (better(b, a) ? b : a));
  return {
    highest: pick((b, a) => b[1] > a[1] || (b[1] === a[1] && b[0] < a[0])),
    lowest: pick((b, a) => b[1] < a[1] || (b[1] === a[1] && b[0] < a[0])),
    average: pick((b, a) => Math.abs(b[1] - mean) < Math.abs(a[1] - mean) || (Math.abs(b[1] - mean) === Math.abs(a[1] - mean) && b[0] < a[0])),
    mean,
  };
}

export function draftAttainmentComment(att: Attainment): string {
  const notOk = att.coUsed.filter((c) => att.co.get(c)!.ok === false);
  if (notOk.length) return `CO${notOk.join(', CO')} not attained (below the ${COHORT_THRESHOLD * 100}% cohort threshold); remedial action required.`;
  const ranked = att.coUsed.filter((c) => att.co.get(c)!.pct !== null).sort((a, b) => att.co.get(a)!.pct! - att.co.get(b)!.pct!);
  if (!ranked.length || att.co.get(ranked[0])!.pct === att.co.get(ranked[ranked.length - 1])!.pct)
    return `All COs attained${ranked.length ? ` (${fmtPct(att.co.get(ranked[0])!.pct)}% each)` : ''}.`;
  const low = ranked.slice(0, ranked.length > 2 ? 2 : 1);
  return `All COs attained. Lowest attainment: ${low.map((c) => `CO${c} (${fmtPct(att.co.get(c)!.pct)}%)`).join(', ')}.`;
}
