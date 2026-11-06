// The outline converter: a teacher's own outline (any layout) → the department's Course Outline (BME 310 layout).
// A draft holds every part of the template; text dragged from the teacher's document is shaped to the part it is dropped on.
import { splitCount } from './courseFolder/inputs';
import type { Outline } from './courseFolder/model';

export interface DraftTeacher { name: string; room: string; email: string; phone: string }
export interface DraftAssessment { name: string; pct: string; count: number }
export interface DraftWeek { week: string; topic: string; basis: string }
export interface OutlineDraft {
  courseNo: string; title: string; credit: string; contact: string; levelTerm: string; session: string;
  teachers: DraftTeacher[]; routine: string;
  contents: string; objectives: string[]; outcomes: string[];
  assessment: DraftAssessment[]; textbooks: string[]; schedule: DraftWeek[];
}

/** The parts of the template a piece of text can be dropped on. */
export type DraftPart = 'courseNo' | 'title' | 'credit' | 'contact' | 'levelTerm' | 'session' | 'teachers' | 'routine'
  | 'contents' | 'objectives' | 'outcomes' | 'assessment' | 'textbooks' | 'schedule';

export const emptyDraft = (): OutlineDraft => ({
  courseNo: '', title: '', credit: '', contact: '', levelTerm: '', session: '', teachers: [{ name: '', room: '', email: '', phone: '' }], routine: '',
  contents: '', objectives: [''], outcomes: [''], assessment: [{ name: '', pct: '', count: 1 }], textbooks: [''], schedule: [{ week: '', topic: '', basis: '' }],
});

/** What the outline reader could already find, as a starting draft. */
export function draftFromOutline(o: Outline): OutlineDraft {
  const d = emptyDraft();
  const h = o.header;
  const routine = o.routine.map((r) => `${r.day}${r.section ? ` (${r.section})` : ''}: ${r.start_time} - ${r.end_time}`).join('\n');
  const col = (name: RegExp) => o.planHeader.findIndex((x) => name.test(x));
  const wk = Math.max(0, col(/week|lecture|lab|class|no/i)), tp = col(/topic|content|experiment/i), ev = col(/evaluat|assess/i);
  return {
    ...d,
    courseNo: o.courseNo || h.courseNo || '', title: o.title || h.title || '', credit: h.credit ?? '', contact: h.contact ?? '',
    levelTerm: h.level ? `${h.level}/${h.term ?? ''}` : '', session: h.session ?? '',
    teachers: o.teachers.length ? o.teachers.map((t) => ({ ...t })) : d.teachers, routine,
    contents: o.contents.join(' '), objectives: o.objectives.length ? [...o.objectives] : d.objectives,
    outcomes: o.cos.length ? o.cos.map((c) => c.statement) : d.outcomes,
    assessment: o.distribution.length ? o.distribution.map((x) => ({ name: x.name, pct: String(x.pct), count: x.count ?? 1 })) : d.assessment,
    textbooks: o.textbooks.length ? o.textbooks.map(stripMarker) : d.textbooks,
    schedule: o.plan.length ? o.plan.map((r) => ({ week: r[wk] ?? '', topic: tp >= 0 ? r[tp] ?? '' : r.filter((_, i) => i !== wk).join(' '), basis: ev >= 0 ? r[ev] ?? '' : '' })) : d.schedule,
  };
}

// ---------------------------------------------------------------- shaping dropped text
const MARKER = /^\s*(?:[•●○◦▪■\-–*]|\(?\d{1,2}[.)]|\(?[a-z][.)]|\(?[ivx]{1,4}[.)]|CO\s*-?\s*\d+\s*[:.)-]?)\s+/i;
/** "● Item", "1. Item", "a) Item", "CO2: Item" → "Item". */
export const stripMarker = (s: string) => s.replace(MARKER, '').trim();
const lines = (text: string) => text.replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
/** "Course Title: Biomaterials" → "Biomaterials" (a label copied along with the value). */
const dropLabel = (s: string) => s.replace(/^(course\s*(no\.?|number|title|code)|credit\s*hours?|contact\s*hours?|level\s*\/\s*term|academic\s*session|session)\s*[:.]?\s*/i, '').trim();

/** List items from a selection: bullets / numbers start items (wrapped lines are joined back); without them, one item per line. */
export function toItems(text: string): string[] {
  const raw = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (raw.some((l) => l.includes('\t'))) {
    const rows = raw.map((l) => l.split('\t').map((c) => c.replace(/\s+/g, ' ').trim()));
    // The header row of a table (CO No. | CO Statement | …) is left out; each row gives its longest cell (the statement).
    return rows.filter((r) => !r.some((c) => /^(co\s*no\.?|co\s*statements?|statements?|sl\.?\s*no\.?|topics?)$/i.test(c)))
      .map((r) => [...r].sort((a, b) => b.length - a.length)[0] ?? '').filter(Boolean).map(stripMarker);
  }
  const ls = lines(text);
  if (!ls.some((l) => MARKER.test(l))) return ls;
  const out: string[] = [];
  for (const l of ls) if (MARKER.test(l) || !out.length) out.push(stripMarker(l)); else out[out.length - 1] += ` ${l}`;
  return out.filter(Boolean);
}

/** "Class participation: 10%", "Lab test (x2) 40 %" → assessment rows. */
export function toAssessments(text: string): DraftAssessment[] {
  return lines(text).flatMap((l) => {
    const m = l.match(/^(.*?)[\s:–-]+(\d+(?:\.\d+)?)\s*%/);
    if (!m || !m[1].trim() || /^total\b/i.test(m[1].trim())) return [];
    const { name, count } = splitCount(stripMarker(m[1]).replace(/[:–-]+$/, '').trim());
    return [{ name, pct: m[2], count }];
  });
}

/** "1 Introduction …", "Week 2: Filters" → schedule rows; a line without a number continues the topic above. */
export function toWeeks(text: string): DraftWeek[] {
  const out: DraftWeek[] = [];
  const table = text.includes('\t');
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const cells = raw.split('\t').map((c) => c.replace(/\s+/g, ' ').trim());
    if (cells.length > 1 && /^(week|lecture|lab|class|sl|no)\.?#?\s*(no\.?)?$/i.test(cells[0])) continue;   // the table's header row
    // In a table, a row with one cell is a break or exam row spanning the table ("Mid Break and Eid Vacation").
    const only = cells.filter(Boolean);
    if (table && only.length === 1 && /break|vacation|holiday|recess|eid|exam/i.test(only[0]) && !/^\d{1,2}\s/.test(only[0])) { out.push({ week: '', topic: only[0], basis: '' }); continue; }
    // A row copied from a table: Week | Topic | Evaluation basis.
    if (cells.length > 1 && /^\d{1,2}$/.test(cells[0])) { out.push({ week: cells[0], topic: cells[1] ?? '', basis: cells.slice(2).filter(Boolean).join(', ') }); continue; }
    if (cells.length > 1 && !cells[0] && out.length) { out[out.length - 1].topic += ` ${cells.filter(Boolean).join(' ')}`; continue; }
    const l = cells.filter(Boolean).join(' ');
    if (!l) continue;
    const m = l.match(/^(?:week|lecture|lab|class)?\s*(\d{1,2})\s*[:.)-]?\s+(.*)$/i);
    if (m) out.push({ week: m[1], topic: m[2], basis: '' });
    else if (out.length) out[out.length - 1].topic += ` ${l}`;
    else out.push({ week: '', topic: l, basis: '' });
  }
  return out;
}

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const PHONE = /\+?\d[\d\s-]{8,}\d/;
const ROOM = /\b(?:ECE|EME|OAB|CE|ME|Room)[\s-]*\d{2,4}[A-Z]?\b/i;
const ROUTINE = /\b(sat|sun|mon|tue|wed|thu|fri)[a-z]*day\b|\d{1,2}[:.]\d{2}\s*[ap]\.?m/i;
/** A block copied from a teachers table: names, rooms, emails, phones in order, paired up; routine lines kept apart. */
export function toTeachers(text: string): { teachers: DraftTeacher[]; routine: string } {
  const rows = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (rows.some((l) => l.includes('\t'))) {
    const routine: string[] = [];
    const teachers: DraftTeacher[] = [];
    for (const row of rows) {
      const cells = row.split('\t').map((c) => c.replace(/\s+/g, ' ').trim()).filter(Boolean);
      if (cells.every((c) => /^(name|office\/?\s*(room)?|room|email( & telephone)?|telephone|class routine|routine)$/i.test(c))) continue;   // header row (also wrapped)
      const all = cells.join(' ');
      for (const c of cells) {
        const r = c.replace(ROOM, '').trim();
        if (ROUTINE.test(c) && !EMAIL.test(c) && r && !routine.includes(r)) routine.push(r);
      }
      const rest = cells.filter((c) => !EMAIL.test(c) && !ROUTINE.test(c) && !PHONE.test(c) && !(ROOM.test(c) && !c.replace(ROOM, '').trim()));
      const phone = all.replace(EMAIL, ' ').match(PHONE)?.[0]?.trim() ?? '';
      const t = { name: rest[0] ?? '', room: all.match(ROOM)?.[0] ?? '', email: all.match(EMAIL)?.[0] ?? '', phone };
      const last = teachers[teachers.length - 1];
      // A row without an email continues the teacher above: a name, room, phone or routine wrapped onto the next line in a PDF.
      if (last && !t.email && (!t.room || !last.room)) { if (t.name) last.name = `${last.name} ${t.name}`.trim(); last.room ||= t.room; last.phone ||= t.phone; continue; }
      if (t.email || (t.name && !/^(name|office\/?|room)$/i.test(t.name))) teachers.push(t);
    }
    // One line per class: "Saturday (A1): 02:00 PM-05:00 PM" / "Tuesday (A2): …".
    return { teachers, routine: routine.join('\n').replace(/\s+(?=(sat|sun|mon|tue|wed|thu|fri)[a-z]*day\b)/gi, '\n') };
  }
  const names: string[] = [], rooms: string[] = [], emails: string[] = [], phones: string[] = [], routine: string[] = [];
  let sinceName = true;   // an email / phone / room has been seen since the last name
  for (const l of lines(text)) {
    if (/^(name|office|room|email|telephone|class routine)\b/i.test(l) && !EMAIL.test(l)) continue;   // header cells
    if (ROUTINE.test(l) && !EMAIL.test(l)) { if (!routine.includes(l)) routine.push(l); continue; }
    let rest = l;
    const take = (rx: RegExp, into: string[]) => { const m = rest.match(rx); if (m) { into.push(m[0].trim()); rest = rest.replace(m[0], ' '); } };
    const before = emails.length + phones.length + rooms.length;
    take(EMAIL, emails); take(PHONE, phones); take(ROOM, rooms);
    if (emails.length + phones.length + rooms.length > before) sinceName = true;
    rest = rest.replace(/\s+/g, ' ').trim();
    if (rest && /[A-Za-z]/.test(rest) && !/\d{3}/.test(rest)) {
      // A name split over two lines ("Mr. Shoyad Ibn" / "Sabur Khan Nuhash") is joined back.
      if (!sinceName && names.length && !/^(dr|mr|ms|mrs|md|prof|engr)\.?\s/i.test(rest)) { names[names.length - 1] += ` ${rest}`; continue; }
      names.push(rest); sinceName = false;
    }
  }
  const n = Math.max(names.length, emails.length, phones.length, rooms.length);
  return { teachers: Array.from({ length: n }, (_, i) => ({ name: names[i] ?? '', room: rooms[i] ?? '', email: emails[i] ?? '', phone: phones[i] ?? '' })), routine: routine.join('\n') };
}

const isBlank = (xs: unknown[]) => xs.every((x) => (typeof x === 'string' ? !x.trim() : Object.values(x as object).every((v) => typeof v === 'number' || !String(v).trim())));

/** The draft after `text` is dropped on `part`: lists append (or replace when still empty), single fields are replaced. */
export function applyDrop(d: OutlineDraft, part: DraftPart, text: string): OutlineDraft {
  const one = dropLabel(lines(text).join(' '));
  const add = <T,>(cur: T[], items: T[]) => (items.length ? (isBlank(cur) ? items : [...cur, ...items]) : cur);
  switch (part) {
    case 'contents': return { ...d, contents: [d.contents, lines(text).join(' ')].filter((x) => x.trim()).join(' ') };
    case 'objectives': case 'outcomes': case 'textbooks': return { ...d, [part]: add(d[part], toItems(text)) };
    case 'assessment': return { ...d, assessment: add(d.assessment, toAssessments(text)) };
    case 'schedule': return { ...d, schedule: add(d.schedule, toWeeks(text)) };
    case 'teachers': { const t = toTeachers(text); return { ...d, teachers: add(d.teachers, t.teachers), routine: t.routine ? [d.routine, t.routine].filter(Boolean).join('\n') : d.routine }; }
    case 'routine': return { ...d, routine: [d.routine, lines(text).join('\n')].filter(Boolean).join('\n') };
    case 'credit': case 'contact': return { ...d, [part]: one.match(/\d+(?:\.\d+)?/)?.[0] ?? one };
    case 'levelTerm': return { ...d, levelTerm: one.match(/\d\s*\/\s*\d/)?.[0].replace(/\s/g, '') ?? one };
    case 'session': return { ...d, session: one.match(/\d{4}\s*-\s*\d{2,4}/)?.[0].replace(/\s/g, '') ?? one };
    case 'courseNo': return { ...d, courseNo: one.match(/[A-Za-z]{2,5}\s*-?\s*\d{3}[A-Za-z]?/)?.[0].toUpperCase().replace(/^([A-Z]+)\s*-?\s*/, '$1 ') ?? one };
    default: return { ...d, [part]: one };
  }
}

/** Gaps to fill before downloading (none block the download; the outline can be finished in Word). */
export function draftGaps(d: OutlineDraft): string[] {
  const g: string[] = [];
  if (!/^[A-Z]+ \d{3}/.test(d.courseNo)) g.push('Course No (e.g. BME 310)');
  if (!d.title.trim()) g.push('Course Title');
  if (!Number(d.credit)) g.push('Credit hours');
  if (!d.outcomes.some((x) => x.trim())) g.push('Course Outcomes');
  const pct = d.assessment.reduce((a, x) => a + (Number(x.pct) || 0), 0);
  if (!d.assessment.some((x) => x.name.trim())) g.push('Assessment');
  else if (Math.abs(pct - 100) > 0.01) g.push(`Assessment weights add up to ${pct}%, not 100%`);
  return g;
}
