// CO / PO attainment (spec section 7). Pure functions: same inputs, same report.
//   CO%(s,c)  = marks obtained on questions tagged c / marks available on those questions
//   A(c)      = share of students with CO% >= Y
//   attained  = A(c) >= X
// Only counted items enter: a class test dropped by "best N" is excluded for that student,
// and AB / EX / blank marks are removed from both numerator and denominator.
import type { AssessmentComponent, AssessmentItem, AttainmentSettings, CoPo, CourseOutcome, Mark, Question } from './types';

export interface AttainmentInput {
  cos: CourseOutcome[];
  coPo: CoPo[];
  components: AssessmentComponent[];
  items: AssessmentItem[];
  questions: Question[];
  marks: Mark[];
  studentIds: string[];
  settings: Pick<AttainmentSettings, 'x_pct' | 'y_pct' | 'level1' | 'level2' | 'level3'>;
}

export interface CoResult {
  coId: string; code: string;
  students: number;        // N: students with at least one counted mark on this CO
  attainedStudents: number;
  attainmentPct: number | null;  // A(c)
  attained: boolean | null;
  level: 0 | 1 | 2 | 3 | null;
  averagePct: number | null;
  distribution: number[];  // 10 bands: 0-9, 10-19, ... 90-100
  marksAvailable: number;  // per student, across counted questions (coverage)
  questions: number;
}
export interface PoResult { po: string; level: number; courses?: number }
export interface AttainmentReport { cos: CoResult[]; pos: PoResult[]; studentCo: Record<string, Record<string, number | null>>; coverage: Record<string, number>; totalTagged: number; untaggedQuestions: number }

const round1 = (x: number) => Math.round(x * 10) / 10;

export function levelFor(a: number | null, s: AttainmentInput['settings']): 0 | 1 | 2 | 3 | null {
  if (a === null) return null;
  return a >= s.level3 ? 3 : a >= s.level2 ? 2 : a >= s.level1 ? 1 : 0;
}

/** Items each student keeps after best-N per component. Returns studentId -> Set(itemId). */
export function countedItems(input: AttainmentInput): Map<string, Set<string>> {
  const { components, items, questions, marks, studentIds } = input;
  const qByItem = new Map<string, Question[]>();
  for (const q of questions) qByItem.set(q.item_id, [...(qByItem.get(q.item_id) ?? []), q]);
  const mark = new Map(marks.map((m) => [m.question_id + '|' + m.student_id, m]));
  const live = items.filter((i) => i.status !== 'cancelled');
  const out = new Map<string, Set<string>>();
  for (const sid of studentIds) {
    const keep = new Set<string>();
    for (const c of components) {
      const scored: { id: string; pct: number }[] = [];
      for (const it of live.filter((i) => i.component_id === c.id)) {
        let got = 0, max = 0;
        for (const q of qByItem.get(it.id) ?? []) {
          const m = mark.get(q.id + '|' + sid);
          if (!m || m.flag || m.value === null) continue;
          got += Number(m.value); max += Number(q.max_marks);
        }
        if (max > 0) scored.push({ id: it.id, pct: got / max });
      }
      scored.sort((a, b) => b.pct - a.pct);
      const n = c.best_n ?? scored.length;
      for (const x of scored.slice(0, n)) keep.add(x.id);
    }
    out.set(sid, keep);
  }
  return out;
}

export function computeAttainment(input: AttainmentInput): AttainmentReport {
  const { cos, coPo, questions, marks, studentIds, settings } = input;
  const counted = countedItems(input);
  const mark = new Map(marks.map((m) => [m.question_id + '|' + m.student_id, m]));
  const studentCo: AttainmentReport['studentCo'] = {};
  const coverage: Record<string, number> = {};

  const results: CoResult[] = cos.map((co) => {
    const qs = questions.filter((q) => q.co_id === co.id);
    coverage[co.id] = qs.reduce((a, q) => a + Number(q.max_marks), 0);
    let n = 0, ok = 0, sum = 0;
    const dist = Array(10).fill(0);
    for (const sid of studentIds) {
      const keep = counted.get(sid)!;
      let got = 0, max = 0;
      for (const q of qs) {
        if (!keep.has(q.item_id)) continue;
        const m = mark.get(q.id + '|' + sid);
        if (!m || m.flag || m.value === null) continue;
        got += Number(m.value); max += Number(q.max_marks);
      }
      (studentCo[sid] ??= {})[co.id] = max > 0 ? round1((got / max) * 100) : null;
      if (max === 0) continue;
      const pct = (got / max) * 100;
      n++; sum += pct;
      if (pct >= settings.y_pct) ok++;
      dist[Math.min(9, Math.floor(pct / 10))]++;
    }
    const a = n ? round1((ok / n) * 100) : null;
    return {
      coId: co.id, code: co.code, students: n, attainedStudents: ok, attainmentPct: a,
      attained: a === null ? null : a >= settings.x_pct, level: levelFor(a, settings),
      averagePct: n ? round1(sum / n) : null, distribution: dist, marksAvailable: coverage[co.id], questions: qs.length,
    };
  });

  return {
    cos: results, pos: poContribution(results, coPo), studentCo, coverage,
    totalTagged: questions.filter((q) => q.co_id).length, untaggedQuestions: questions.filter((q) => !q.co_id).length,
  };
}

/** Course contribution to each PO: correlation-weighted average of the mapped COs' levels. */
export function poContribution(cos: Pick<CoResult, 'coId' | 'level'>[], coPo: CoPo[]): PoResult[] {
  const by = new Map<string, { w: number; s: number }>();
  for (const m of coPo) {
    const lvl = cos.find((c) => c.coId === m.co_id)?.level;
    if (lvl === null || lvl === undefined) continue;
    const e = by.get(m.po_code) ?? { w: 0, s: 0 };
    e.w += m.strength; e.s += m.strength * lvl;
    by.set(m.po_code, e);
  }
  return [...by.entries()].map(([po, e]) => ({ po, level: Math.round((e.s / e.w) * 100) / 100 }))
    .sort((a, b) => Number(a.po.slice(2)) - Number(b.po.slice(2)));
}

/** Program PO attainment: credit-weighted average of course contributions. */
export function programPo(courses: { credits: number; pos: PoResult[] }[]): PoResult[] {
  const by = new Map<string, { w: number; s: number; n: number }>();
  for (const c of courses) for (const p of c.pos) {
    const e = by.get(p.po) ?? { w: 0, s: 0, n: 0 };
    e.w += c.credits; e.s += c.credits * p.level; e.n++;
    by.set(p.po, e);
  }
  return [...by.entries()].map(([po, e]) => ({ po, level: Math.round((e.s / e.w) * 100) / 100, courses: e.n }))
    .sort((a, b) => Number(a.po.slice(2)) - Number(b.po.slice(2)));
}
