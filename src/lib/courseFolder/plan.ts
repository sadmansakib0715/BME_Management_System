// The assessment tree: what the course outline says the course is assessed by (its "Assessment" / Distribution of Marks
// lines), each assessment's weight and the COs it assesses (from the CO table's Assessment Tool(s)). The faculty checks and
// edits it on the page; the marks sheet is then built from it.
import { fmtNum, isSessional, norm, type CourseInfo, type Item, type Outline, Warnings } from './model';

export type AssessmentKind = 'attendance' | 'ct' | 'final' | 'other';
/** One assessment = one column of the marks sheet: its weight, its marks and every CO it assesses. An assessment that covers
    two COs stays one column; its marks count towards each of those COs. */
export interface PlanItem { name: string; pct: number; kind: AssessmentKind; cos: number[]; marks: number;
  /** How many were taken (e.g. 3 lab tests). Marks are unaffected; the course folder gets that many folders: Lab Test 01, 02, 03. */
  count?: number }
/** `theory` = the department's theory workbook (attendance, best-of class tests, term final by question);
    `columns` = one column per assessment. */
export interface Plan { total: number; layout: 'theory' | 'columns'; items: PlanItem[] }

const round2 = (x: number) => Math.round(x * 100) / 100;

export function kindOf(name: string): AssessmentKind {
  const n = name.toLowerCase();
  if (/class\s*tests?|\bct\b|continuous/.test(n)) return 'ct';
  if (/final|term\s*exam/.test(n)) return 'final';
  if (/attend|participation/.test(n)) return 'attendance';
  return 'other';
}

// Different words for the same assessment in the outline's "Assessment:" lines and the CO table's "Assessment Tool(s)".
const SAME: string[][] = [
  ['classtest', 'ct', 'continuousassessment'],
  ['termfinal', 'finalexam', 'finalexamination', 'writtenexam', 'termfinalexamination'],
  ['labtest', 'labexam', 'practicaltest'],
  ['viva', 'vivavoce'],
];
const tools = (s: string) => s.split(/[,;/]|\band\b|\n/i).map((x) => norm(x)).filter(Boolean);
/** Whole word-run match; short codes such as "ct" must match exactly (so "Project" is not a class test). */
const has = (hay: string, x: string) => hay === x || (x.length >= 4 && hay.includes(x));
function matches(assessment: string, tool: string): boolean {
  const a = norm(assessment);
  if (!a || !tool) return false;
  if (has(a, tool) || has(tool, a)) return true;
  return SAME.some((g) => g.some((x) => has(a, x)) && g.some((x) => has(tool, x)));
}

/** COs whose Assessment Tool(s) name this assessment. */
export function cosFor(o: Outline, assessment: string): number[] {
  return o.cos.filter((c) => tools(c.tools).some((t) => matches(assessment, t))).map((c) => c.no);
}

/** The tree read from the outline. Marks total = credit hours × 100. */
export function planFromOutline(info: CourseInfo, o: Outline, w: Warnings = new Warnings()): Plan {
  const total = round2(info.credit * 100);
  if (!o.distribution.length) w.add("the outline has no 'Assessment' / 'Distribution of Marks' lines; add the assessments below");
  const items: PlanItem[] = o.distribution.map(({ name, pct, count }) => {
    const kind = kindOf(name);
    const cos = cosFor(o, name);
    return { name, pct, kind, cos, marks: round2((total * pct) / 100), count: count ?? 1 };
  });
  return { total, items, layout: defaultLayout(info, items) };
}

/** The department theory workbook only fits attendance + class tests + term final; anything else gets one column per assessment. */
export function defaultLayout(info: CourseInfo, items: PlanItem[]): Plan['layout'] {
  return !isSessional(info) && canUseTheory(items) ? 'theory' : 'columns';
}
export const canUseTheory = (items: PlanItem[]) => items.some((i) => i.kind === 'final') && items.some((i) => i.kind === 'ct') && items.every((i) => i.kind !== 'other');

/** Problems to fix before downloading (errors) and things to look at (warnings). */
export function checkPlan(p: Plan, o: Outline): { errors: string[]; warnings: string[] } {
  const errors: string[] = [], warnings: string[] = [];
  if (!p.items.length) errors.push('Add at least one assessment.');
  p.items.forEach((it, k) => {
    if (!it.name.trim()) errors.push(`Assessment ${k + 1} has no name.`);
    if (!(it.marks > 0)) errors.push(`${it.name || `Assessment ${k + 1}`} needs marks above 0 (give it a weight).`);
    if (!it.cos.length && it.kind !== 'attendance') warnings.push(`${it.name || `Assessment ${k + 1}`} has no CO (no CO's Assessment Tool(s) names it), so it does not count towards attainment: pick its CO.`);
  });
  const pct = p.items.reduce((a, i) => a + i.pct, 0), marks = round2(p.items.reduce((a, i) => a + i.marks, 0));
  if (p.items.length && Math.abs(pct - 100) > 0.01) warnings.push(`Weights add up to ${fmtNum(pct)}%, not 100%.`);
  if (p.items.length && Math.abs(marks - p.total) > 0.01) warnings.push(`Marks add up to ${fmtNum(marks)}, not ${fmtNum(p.total)} (credit hours × 100).`);
  for (const c of o.cos) if (!p.items.some((i) => i.cos.includes(c.no))) warnings.push(`CO${c.no} is not assessed.`);
  if (p.layout === 'theory' && !canUseTheory(p.items)) errors.push('The theory workbook needs class tests and a term final, and nothing other than attendance; choose "One column per assessment".');
  return { errors, warnings };
}

/** Marks-sheet columns for the `columns` layout: one per assessment, with all its COs. */
export function planColumns(p: Plan): Item[] {
  return p.items.map((it) => ({ name: it.name, cos: [...it.cos].sort((a, b) => a - b), max: it.marks }));
}

/** Assessment name → how many were taken, for the assessment folders. */
export const planCounts = (p: Plan): Record<string, number> => Object.fromEntries(p.items.filter((i) => i.name.trim()).map((i) => [i.name.trim(), Math.max(1, Math.floor(i.count ?? 1))]));

/** Folder names for an assessment taken `count` times: "Lab Test" once, else "Lab Test 01", "Lab Test 02", … */
export const numberedFolders = (name: string, count = 1): string[] =>
  count > 1 ? Array.from({ length: count }, (_, i) => `${name} ${String(i + 1).padStart(2, '0')}`) : [name];

/** Weights for the theory workbook: attendance %, class-test %, term-final %, and the COs the class tests assess. */
export function theoryWeights(p: Plan): { att: number; ca: number; tf: number; ctCos: number[] } {
  const sum = (k: AssessmentKind) => p.items.filter((i) => i.kind === k).reduce((a, i) => a + i.pct, 0);
  const ctCos = [...new Set(p.items.filter((i) => i.kind === 'ct').flatMap((i) => i.cos))].sort((a, b) => a - b);
  return { att: sum('attendance'), ca: sum('ct'), tf: sum('final'), ctCos };
}
