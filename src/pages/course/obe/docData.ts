// Turns the OBE page data into the plain inputs of the PDF documents (src/lib/pdf/obeDocs.ts) and saves the file.
import type { jsPDF } from 'jspdf';
import type { CourseObe } from '@/lib/api';
import { attained, coCodes, mappedPos, PO_CODES, valueOf } from '@/lib/obe';
import type { CarBlock, CoRow, CourseInfo, ModerationSection, PoRef } from '@/lib/pdf/obeDocs';
import type { CoPo, Course, CourseOutcome, Instructor, ObeAttainment, PO } from '@/lib/types';

const bare = (n: string) => n.toLowerCase().replace(/^(dr|mr|ms|mrs|prof|engr)\.?\s+/g, '').replace(/[^a-z]/g, '');
export const sameName = (a: string, b: string) => { const x = bare(a), y = bare(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); };

/** Teachers: those assigned this term, with room, email and phone from the outline when the names match; else the outline's list. */
export function teacherList(assigned: string[], outline: Instructor[] = [], emailOf: (name: string) => string | null = () => null): CourseInfo['teachers'] {
  if (!assigned.length) return outline.map((i) => ({ name: i.name, room: i.room ?? null, email: i.email ?? null, phone: i.phone ?? null }));
  return assigned.map((name) => {
    const hit = outline.find((i) => sameName(i.name, name));
    return { name, room: hit?.room ?? null, email: hit?.email ?? emailOf(name), phone: hit?.phone ?? null };
  });
}

export function courseInfo(course: Course, termName: string, teachers: CourseInfo['teachers'], extra: { session?: string | null; routine?: string | null } = {}): CourseInfo {
  return { code: course.code, title: course.title, creditHours: course.credits ?? null, contactHours: course.contact_hours ?? null,
    levelTerm: course.level ? `${course.level}/${course.term_no ?? ''}` : null, term: termName, teachers, session: extra.session ?? null, routine: extra.routine ?? null };
}

export function coRows(obe: Pick<CourseObe, 'cos' | 'coPo'>): CoRow[] {
  return obe.cos.map((c, i) => ({ code: `CO${i + 1}`, statement: c.statement, pos: obe.coPo.filter((m) => m.co_id === c.id).map((m) => m.po_code),
    domains: c.domain_levels ?? [], delivery: c.delivery ?? [], tools: c.tools ?? [], kpa: c.kpa ?? [] }));
}

export const poRefs = (pos: PO[]): PoRef[] => pos.map((p) => ({ code: p.code, title: p.title }));

/** One term's CO1–CO12 and PO1–PO12 for the CAR and the attainment workbook: value and Y/N, NA when not assessed or not mapped. */
export function carBlock(term: string, att: ObeAttainment[], cos: CourseOutcome[], coPo: CoPo[], coT: number, poT: number): CarBlock {
  const m = mappedPos(cos, coPo);
  const cell = (type: 'CO' | 'PO', code: string, used: boolean, t: number) => {
    const v = used ? valueOf(att, type, code) : null; const a = attained(v, t);
    return { value: v, yn: (!used || a === null ? 'NA' : a ? 'Y' : 'N') as 'Y' | 'N' | 'NA' };
  };
  return { term, co: Object.fromEntries(coCodes().map((c, i) => [c, cell('CO', c, i < cos.length, coT)])), po: Object.fromEntries(PO_CODES.map((p) => [p, cell('PO', p, m.has(p), poT)])) };
}

export function save(doc: jsPDF, name: string) { doc.save(name.replace(/[^\w.-]+/g, '_')); }

const DOMAIN_NAME: Record<string, string> = { C: 'Cognitive', PS: 'Psychomotor', AF: 'Affective' };
/** "Q01 (a)" → "1(a)", as the moderation form writes question numbers. */
export const questionNo = (label: string) => label.trim().replace(/^Q(uestion)?\s*\.?\s*0*/i, '').replace(/\s+(?=\()/g, '');

/** Term-final rows of the assessment map as Question Moderation Form sections: Section A (questions 1–4) and Section B (5–8) when the
    numbers allow, else one section; each question's COs with their Bloom's domain and level from the CO's taxonomy levels. */
export function moderationSections(rows: { assessment: string; label: string; cos: string[] }[], cos: Pick<CourseOutcome, 'id' | 'domain_levels'>[],
  teacher: { A: string; B: string; all: string }): ModerationSection[] {
  const finals = rows.filter((r) => /final/i.test(r.assessment)).map((r) => {
    const idx = r.cos.map((id) => cos.findIndex((c) => c.id === id)).filter((i) => i >= 0).sort((a, b) => a - b);
    const levels = [...new Set(idx.flatMap((i) => cos[i].domain_levels ?? []))];
    const q = questionNo(r.label);
    return { n: Number(q.match(/\d+/)?.[0] ?? NaN), row: { question: q, cos: idx.map((i) => `CO${i + 1}`), levels,
      domains: [...new Set(levels.map((l) => DOMAIN_NAME[l.replace(/\d+$/, '')]).filter(Boolean))] } };
  });
  const a = finals.filter((f) => f.n <= 4), b = finals.filter((f) => f.n >= 5);
  if (a.length && b.length && a.length + b.length === finals.length)
    return [{ section: 'A', teacher: teacher.A, rows: a.map((f) => f.row) }, { section: 'B', teacher: teacher.B, rows: b.map((f) => f.row) }];
  return [{ section: '', teacher: teacher.all, rows: finals.map((f) => f.row) }];
}
