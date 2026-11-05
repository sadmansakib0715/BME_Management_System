// Turns the OBE page data into the plain inputs of the PDF documents (src/lib/pdf/obeDocs.ts) and saves the file.
import type { jsPDF } from 'jspdf';
import type { CourseObe } from '@/lib/api';
import type { Course, Instructor, Offering, PO } from '@/lib/types';
import type { CoRow, CourseInfo, PoRef } from '@/lib/pdf/obeDocs';

const bare = (n: string) => n.toLowerCase().replace(/^(dr|mr|ms|mrs|prof|engr)\.?\s+/g, '').replace(/[^a-z]/g, '');

/** Teachers: those assigned this term, with room and email from the outline when the names match; else the outline's list. */
export function teacherList(assigned: string[], outline: Instructor[] = [], emailOf: (name: string) => string | null = () => null): CourseInfo['teachers'] {
  if (!assigned.length) return outline.map((i) => ({ name: i.name, room: i.room ?? null, email: i.email ?? null }));
  return assigned.map((name) => {
    const hit = outline.find((i) => bare(i.name) === bare(name) || bare(i.name).includes(bare(name)) || bare(name).includes(bare(i.name)));
    return { name, room: hit?.room ?? null, email: hit?.email ?? emailOf(name) };
  });
}

export function courseInfo(course: Course, offering: Offering, termName: string, teachers: CourseInfo['teachers']): CourseInfo {
  return { code: course.code, title: course.title, creditHours: course.credits ?? null, contactHours: course.contact_hours ?? null,
    levelTerm: course.level ? `Level ${course.level}${course.term_no ? `, Term ${course.term_no}` : ''}${offering.batch ? ` (Cohort ${offering.batch})` : ''}` : null,
    term: termName, teachers };
}

export function coRows(obe: Pick<CourseObe, 'cos' | 'coPo'>): CoRow[] {
  return obe.cos.map((c, i) => ({ code: `CO${i + 1}`, statement: c.statement, pos: obe.coPo.filter((m) => m.co_id === c.id).map((m) => m.po_code),
    domains: c.domain_levels ?? [], delivery: c.delivery ?? [], tools: c.tools ?? [], kpa: c.kpa ?? [] }));
}

export const poRefs = (pos: PO[]): PoRef[] => pos.map((p) => ({ code: p.code, title: p.title }));

export function save(doc: jsPDF, name: string) { doc.save(name.replace(/[^\w.-]+/g, '_')); }
