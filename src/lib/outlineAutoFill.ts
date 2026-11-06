// A first pass over the teacher's document: each heading ("Course Outcomes", "Assessment", "Weekly Schedule", …) sends the text under it
// to that part of the template, through the same rules as a manual drop. Header lines ("Course No: BME 310") fill their fields.
import { applyDrop, emptyDraft, type DraftPart, type OutlineDraft } from './outlineDraft';
import { blockText, type SourceBlock } from './sourceDoc';

const HEADINGS: [RegExp, DraftPart | null][] = [
  [/^course\s+teachers?(\s*\(s\))?|^teachers?\s*(\(s\))?\s*:|^instructors?\b/i, 'teachers'],
  [/^(course\s+)?contents?\b|^syllabus\b/i, 'contents'],
  [/^(course\s+)?objectives?\b/i, 'objectives'],
  [/^(course\s+)?(learning\s+)?outcomes?\b|^\bCLOs?\b/i, 'outcomes'],
  [/^assessment\s+strateg|^mapping\s+of\s+knowledge|^knowledge\s+required|^type\s+of\s+course|^offered\s+to|^pre-?\s*requisites?|^prepared\s+by|^approved\s+by/i, null],
  [/^(assessment|evaluation|distribution\s+of\s+marks|marks?\s+distribution|grading)\b/i, 'assessment'],
  [/^(text\s*books?|references|reading\s+list|recommended\s+books?)\b/i, 'textbooks'],
  [/^(weekly\s+schedule|(lecture|lab|class|course|weekly)\s+(plan|schedule)|course\s+schedule|schedule)\b/i, 'schedule'],
];
const FIELDS: [DraftPart, RegExp][] = [
  ['courseNo', /(?:course\s*(?:no\.?|number|code)|description\s+of\s+the\s+course)\s*[:.]?\s*([A-Za-z]{2,5}\s*-?\s*\d{3}[A-Za-z]?)/i],
  ['title', /course\s*title\s*[:.]?\s*(.+?)(?=\s+(?:credit|contact)\s*hours?|$)/i],
  ['credit', /credit\s*hours?\s*[:.]?\s*(\d+(?:\.\d+)?)/i],
  ['contact', /contact\s*hours?\s*[:.]?\s*(\d+(?:\.\d+)?)/i],
  ['levelTerm', /level\s*\/\s*term\s*[:.]?\s*(\d\s*\/\s*\d)/i],
  ['session', /(?:academic\s*)?session\s*[:.]?\s*(\d{4}\s*-\s*\d{2,4})/i],
];
const LIST_PARTS = new Set<DraftPart>(['objectives', 'outcomes', 'textbooks']);
const strip = (t: string) => t.replace(/^\s*(\d+(\.\d+)*[.)]?|[IVX]+\.)\s+/, '').trim();

export function autoFill(blocks: SourceBlock[]): OutlineDraft {
  let d = emptyDraft();
  let part: DraftPart | null = null;
  // The text of a section is gathered and dropped at once, so lines wrapped in a PDF join back into their item.
  let pending: string[] = [];
  const flush = () => { if (part && pending.length) d = applyDrop(d, part, pending.join('\n')); pending = []; };
  const fields = (text: string) => { for (const [k, rx] of FIELDS) { const m = text.match(rx); if (m && !String(d[k as keyof OutlineDraft]).trim()) d = applyDrop(d, k, m[1]); } };
  for (const b of blocks) {
    if (b.kind === 'table') {
      // The header block is often a table; a table under a heading belongs to that part (teachers, schedule).
      for (const r of b.rows) fields(r.join('  '));
      flush();
      if (part && part !== 'contents') d = applyDrop(d, part, blockText(b));
      continue;
    }
    const text = strip(b.text);
    const hit = HEADINGS.find(([rx]) => rx.test(text));
    // "Assessment report: 20%" is an assessment line, not the Assessment heading.
    const isLine = /\d\s*%/.test(text) && !/^(assessment|evaluation|distribution\s+of\s+marks|marks?\s+distribution|grading)\s*:/i.test(text);
    if (hit && !isLine && (hit[1] === null || b.bold || /:\s*$/.test(text) || text.length < 40 || /^\S[^:]{0,40}:/.test(text))) {
      flush();
      part = hit[1];
      const rest = text.replace(/^[^:]*:\s*/, '');
      if (part && rest !== text && rest.trim()) pending.push(rest);
      continue;
    }
    if (FIELDS.some(([, rx]) => rx.test(b.text))) { fields(b.text); continue; }
    // A Word paragraph in a list part is an item of its own; PDF lines are joined back by their markers.
    const marked = /^[•●○◦▪■\-–*]|^\d{1,2}[.)]/.test(b.text);
    if (!part || (/:\s*$/.test(text) && !marked && !b.list)) continue;   // "The course will enable students to:" introduces a list
    pending.push(!marked && (b.list || (!b.line && LIST_PARTS.has(part))) ? `• ${b.text}` : b.text);
  }
  flush();
  return d;
}
