// The assessment tree: what the course outline says the course is assessed by (its "Assessment" / Distribution of Marks
// lines), each assessment's weight and the COs it assesses (from the CO table's Assessment Tool(s)). The faculty checks and
// edits it on the page; the marks sheet is then built from it.
import { fmtNum, isSessional, norm, type CourseInfo, type Item, type Outline, Warnings } from './model';

export type AssessmentKind = 'attendance' | 'ct' | 'final' | 'other';
/** One column of the marks sheet: the CO it counts towards and its marks. */
export interface PlanPart { co: number | null; marks: number }
export interface PlanItem { name: string; pct: number; kind: AssessmentKind; parts: PlanPart[] }
/** `theory` = the department's theory workbook (attendance, best-of class tests, term final by question);
    `columns` = one column per assessment (per CO when an assessment covers several COs). */
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

/** Splits `marks` over the COs, two decimals, the last taking the remainder. */
export function splitParts(cos: (number | null)[], marks: number): PlanPart[] {
  if (!cos.length) return [{ co: null, marks: round2(marks) }];
  const share = round2(marks / cos.length);
  return cos.map((co, j) => ({ co, marks: j < cos.length - 1 ? share : round2(marks - share * (cos.length - 1)) }));
}

export const itemMarks = (it: PlanItem) => round2(it.parts.reduce((a, p) => a + p.marks, 0));

/** The tree read from the outline. Marks total = credit hours × 100. */
export function planFromOutline(info: CourseInfo, o: Outline, w: Warnings = new Warnings()): Plan {
  const total = round2(info.credit * 100);
  if (!o.distribution.length) w.add("the outline has no 'Assessment' / 'Distribution of Marks' lines; add the assessments below");
  const items: PlanItem[] = o.distribution.map(({ name, pct }) => {
    const kind = kindOf(name);
    const cos = cosFor(o, name);
    return { name, pct, kind, parts: splitParts(cos, (total * pct) / 100) };
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
    if (it.parts.some((x) => !(x.marks > 0))) errors.push(`${it.name || `Assessment ${k + 1}`}: every column needs marks above 0.`);
    const cos = it.parts.map((x) => x.co).filter((c): c is number => c !== null);
    if (new Set(cos).size !== cos.length) errors.push(`${it.name}: the same CO appears twice.`);
    if (!cos.length && it.kind !== 'attendance') warnings.push(`${it.name || `Assessment ${k + 1}`} has no CO (no CO's Assessment Tool(s) names it), so it does not count towards attainment: pick its CO.`);
  });
  const pct = p.items.reduce((a, i) => a + i.pct, 0), marks = round2(p.items.reduce((a, i) => a + itemMarks(i), 0));
  if (p.items.length && Math.abs(pct - 100) > 0.01) warnings.push(`Weights add up to ${fmtNum(pct)}%, not 100%.`);
  if (p.items.length && Math.abs(marks - p.total) > 0.01) warnings.push(`Marks add up to ${fmtNum(marks)}, not ${fmtNum(p.total)} (credit hours × 100).`);
  for (const c of o.cos) if (!p.items.some((i) => i.parts.some((x) => x.co === c.no))) warnings.push(`CO${c.no} is not assessed.`);
  if (p.layout === 'theory' && !canUseTheory(p.items)) errors.push('The theory workbook needs class tests and a term final, and nothing other than attendance; choose "One column per assessment".');
  return { errors, warnings };
}

/** Marks-sheet columns for the `columns` layout: one per part, named "Assessment (COn)" when an assessment is split by CO. */
export function planColumns(p: Plan): Item[] {
  return p.items.flatMap((it) => it.parts.map((x) => ({ name: it.parts.length > 1 && x.co !== null ? `${it.name} (CO${x.co})` : it.name, cos: x.co === null ? [] : [x.co], max: x.marks })));
}

/** Weights for the theory workbook: attendance %, class-test %, term-final %, and the class tests' CO when they assess one. */
export function theoryWeights(p: Plan): { att: number; ca: number; tf: number; ctCo: number | null } {
  const sum = (k: AssessmentKind) => p.items.filter((i) => i.kind === k).reduce((a, i) => a + i.pct, 0);
  const ctCos = [...new Set(p.items.filter((i) => i.kind === 'ct').flatMap((i) => i.parts.map((x) => x.co)).filter((c): c is number => c !== null))];
  return { att: sum('attendance'), ca: sum('ct'), tf: sum('final'), ctCo: ctCos.length === 1 ? ctCos[0] : null };
}
