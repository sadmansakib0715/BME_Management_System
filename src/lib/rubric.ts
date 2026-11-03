// Teacher-made rubrics: criteria with marks and performance bands, each criterion linked to one or more COs.
import type { Rubric, RubricCriterion, RubricLevel } from './types';

export const DEFAULT_LEVELS = ['Excellent', 'Good', 'Satisfactory', 'Needs Improvement', 'Poor'];
const uid = () => (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));

export type RubricDraft = Omit<Rubric, 'id' | 'offering_id' | 'sort' | 'updated_at'> & { id?: string };

export const total = (r: Pick<Rubric, 'criteria'>) => r.criteria.reduce((s, c) => s + (Number(c.max) || 0), 0);

/** Even bands from the top mark down to 0, one per level. */
export function bands(max: number, n: number): Pick<RubricLevel, 'min' | 'max'>[] {
  const out: Pick<RubricLevel, 'min' | 'max'>[] = [];
  let hi = max;
  for (let i = 0; i < n; i++) {
    const left = n - i;
    const lo = i === n - 1 ? 0 : Math.max(0, Math.round(hi - (hi + 1) / left + 1));
    out.push({ min: Math.min(lo, hi), max: hi });
    hi = Math.max(0, lo - 1);
  }
  return out;
}
export function blankCriterion(levels: string[], max = 10): RubricCriterion {
  return { id: uid(), name: '', max, cos: [], levels: bands(max, levels.length).map((b, i) => ({ label: levels[i], ...b, text: '' })) };
}
export const blankRubric = (levels = DEFAULT_LEVELS): RubricDraft =>
  ({ title: '', component_id: null, note: '', levels, criteria: [blankCriterion(levels)] });

/** Problems a teacher should fix before relying on the rubric. Bands should run from the criterion's marks down to 0 without gaps. */
export function rubricChecks(r: Pick<Rubric, 'title' | 'criteria'>): string[] {
  const w: string[] = [];
  if (!r.title.trim()) w.push('Give the rubric a title.');
  if (!r.criteria.length) w.push('Add at least one criterion.');
  r.criteria.forEach((c, i) => {
    const n = c.name.trim() || `Criterion ${i + 1}`;
    if (!c.name.trim()) w.push(`Criterion ${i + 1} has no name.`);
    if (!(c.max > 0)) w.push(`${n}: set the marks.`);
    const set = c.levels.filter((l) => l.min !== null && l.max !== null).sort((a, b) => b.max! - a.max!);
    if (set.some((l) => l.min! > l.max!)) w.push(`${n}: a band's lower mark is above its upper mark.`);
    else if (set.length) {
      if (set[0].max !== c.max) w.push(`${n}: the top band ends at ${set[0].max}, not ${c.max}.`);
      if (set[set.length - 1].min !== 0) w.push(`${n}: the lowest band starts at ${set[set.length - 1].min}, not 0.`);
      for (let k = 1; k < set.length; k++) {
        if (set[k].max! >= set[k - 1].min!) { w.push(`${n}: ${set[k - 1].label} and ${set[k].label} overlap.`); break; }
        if (set[k].max! < set[k - 1].min! - 1) { w.push(`${n}: no band covers ${set[k].max! + 1}${set[k - 1].min! - 1 > set[k].max! + 1 ? `–${set[k - 1].min! - 1}` : ''}.`); break; }
      }
    }
    if (!c.cos.length) w.push(`${n} is not linked to a CO.`);
  });
  return w;
}

/** Marks each CO is assessed on by this rubric (a criterion linked to several COs counts for each). */
export function marksPerCo(r: Pick<Rubric, 'criteria'>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of r.criteria) for (const co of c.cos) out[co] = (out[co] ?? 0) + (Number(c.max) || 0);
  return out;
}

// ---------------------------------------------------------------- paste from Excel / Google Sheets

/** Tab-separated text as copied from a spreadsheet; cells with line breaks arrive in double quotes. */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === '\t') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.replace(/\s+/g, ' ').trim()));
}

const BAND = /^\s*(\d+(?:\.\d+)?)\s*(?:[–—-]\s*(\d+(?:\.\d+)?))?\s*:\s*([\s\S]*)$/;
/** "7–8: Problem is clear" → { min: 7, max: 8, text }; a single mark "2: …" is a one-mark band. */
export function parseBand(cell: string): { min: number | null; max: number | null; text: string } {
  const m = cell.match(BAND);
  if (!m) return { min: null, max: null, text: cell.trim() };
  const a = Number(m[1]), b = m[2] !== undefined ? Number(m[2]) : a;
  return { min: Math.min(a, b), max: Math.max(a, b), text: m[3].trim() };
}

/** Reads a rubric laid out like the department sheets: optional title row, a header row (Criterion | Max Marks | level names…), one row per criterion, optional "Note:" row. */
export function rubricFromSheet(text: string): RubricDraft | null {
  const rows = parseTsv(text).filter((r) => r.some((c) => c));
  const h = rows.findIndex((r) => /criteri/i.test(r[0] ?? '') || /max/i.test(r[1] ?? ''));
  if (h < 0) return null;
  const head = rows[h];
  const levelCols = head.map((c, i) => ({ c, i })).filter(({ c, i }) => i >= 2 && c);
  if (!levelCols.length) return null;
  const titleRow = rows.slice(0, h).reverse().find((r) => r.filter(Boolean).length === 1);
  const title = (titleRow?.find(Boolean) ?? '').replace(/\s*[—–-]\s*total\b.*$/i, '').trim();
  const noteRow = rows.slice(h + 1).find((r) => /^note\b/i.test(r.find(Boolean) ?? ''));
  const criteria: RubricCriterion[] = rows.slice(h + 1)
    .filter((r) => r !== noteRow && (r[0] ?? '').trim() && Number(r[1]) > 0)
    .map((r) => ({ id: uid(), name: r[0], max: Number(r[1]), cos: [],
      levels: levelCols.map(({ c, i }) => ({ label: c, ...parseBand(r[i] ?? '') })) }));
  if (!criteria.length) return null;
  return { title, component_id: null, levels: levelCols.map(({ c }) => c), criteria,
    note: (noteRow?.find(Boolean) ?? '').replace(/^note\s*:\s*/i, '') };
}

// ---------------------------------------------------------------- the department's sample (ML project presentation, 50 marks)

const L = DEFAULT_LEVELS;
const crit = (name: string, max: number, bandsText: [number, number, string][]): RubricCriterion =>
  ({ id: uid(), name, max, cos: [], levels: bandsText.map(([min, hi, text], i) => ({ label: L[i], min, max: hi, text })) });
export const SAMPLE_RUBRIC = (): RubricDraft => ({
  title: 'Machine Learning Project Presentation', component_id: null, levels: L,
  note: 'Please follow the specified time limit, include slide numbers, and have a clear understanding of the functions, filters, algorithms, and processing steps used in the project.',
  criteria: [
    crit('Problem Definition & Objective', 8, [
      [7, 8, 'Problem, motivation and objectives are very clear; ML relevance is well established.'],
      [5, 6, 'Problem and objectives are clear with minor gaps in motivation or relevance.'],
      [3, 4, 'Basic problem and objectives are stated but lack clarity or justification.'],
      [2, 2, 'Problem/objective is vague or incomplete.'],
      [0, 1, 'Problem and objectives are largely unclear or missing.']]),
    crit('Methodology & Technical Understanding', 12, [
      [10, 12, 'Dataset, preprocessing, workflow, model and training/testing strategy are clearly explained; strong understanding of functions, filters and algorithms; choices are justified.'],
      [7, 9, 'Methodology is mostly clear and technically sound; good understanding with minor omissions.'],
      [4, 6, 'Basic workflow is explained but important technical details or justification are missing.'],
      [2, 3, 'Methodology is incomplete; limited understanding of tools/algorithms used.'],
      [0, 1, 'Methodology is largely unclear or student cannot explain the technical process.']]),
    crit('Results, Discussion & Benchmark Comparison', 10, [
      [9, 10, 'Appropriate metrics/plots are presented and correctly interpreted; meaningful discussion, limitations and clear comparison with the paper/benchmark.'],
      [7, 8, 'Results and benchmark comparison are clear with reasonable interpretation; minor gaps remain.'],
      [5, 6, 'Results are shown but discussion or benchmark comparison is limited.'],
      [3, 4, 'Results are incomplete, weakly interpreted or comparison is unclear.'],
      [0, 2, 'Results are largely missing, incorrect or not meaningfully discussed.']]),
    crit('Project Demonstration', 12, [
      [10, 12, 'Project runs successfully; input → processing → output is clearly demonstrated; student explains the output and system functionality confidently.'],
      [7, 9, 'Demonstration works with minor issues; overall workflow and output are understandable.'],
      [4, 6, 'Partial demonstration; some functions work but important parts are unclear or incomplete.'],
      [2, 3, 'Major execution problems; very limited evidence that the system works.'],
      [0, 1, 'No meaningful working demonstration.']]),
    crit('Presentation & Q&A', 8, [
      [7, 8, 'Clear, well-organized slides; slide numbers included; time limit followed; confident delivery and strong answers to technical questions.'],
      [5, 6, 'Good presentation and Q&A with minor issues in organization, timing or technical explanation.'],
      [3, 4, 'Understandable presentation but noticeable issues in clarity, timing, slide organization or Q&A.'],
      [2, 2, 'Weak delivery and limited ability to answer questions.'],
      [0, 1, 'Presentation is poorly organized or technical understanding is not demonstrated.']]),
  ],
});
