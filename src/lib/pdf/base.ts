// Shared layout for the department's OBE documents, drawn with jsPDF to match the department's own Word templates
// (Templates/: BME 211_Course outline.pdf, CO-PO Mapping.docx, CAR.pdf, Basic information.docx, Instructors and schedule.docx,
// BME OBE Info for question moderation.docx): US Letter, 2.5 cm margins, Helvetica, bold run-in labels, plain black grid tables.
import { jsPDF } from 'jspdf';
import { applyPlugin, type CellHookData, type RowInput, type UserOptions } from 'jspdf-autotable';
import { BUET_LOGO } from './logo';

// The plugin form works the same under Vite and Node (the default export differs between their module systems).
applyPlugin(jsPDF);
type WithTable = jsPDF & { autoTable: (o: UserOptions) => void; lastAutoTable: { finalY: number } };

export const TICK = '\u0000tick';                     // a table cell holding this value is drawn as a check mark
export const UNIVERSITY = 'Bangladesh University of Engineering and Technology';
export const DEPARTMENT = 'Department of Biomedical Engineering';

// The built-in PDF fonts only cover Latin-1/WinAnsi; map the few symbols the app uses and drop anything else.
const MAP: Record<string, string> = { '≥': '>=', '≤': '<=', '→': '->', '←': '<-', '✓': 'Yes', '✔': 'Yes', '×': 'x', '−': '-', ' ': ' ', '\t': '  ', '●': '•' };
const WINANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
export function clean(s: unknown): string {
  return String(s ?? '').replace(/./gsu, (ch) => {
    if (MAP[ch] !== undefined) return MAP[ch];
    const c = ch.codePointAt(0)!;
    if (ch === '\n' || (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WINANSI_EXTRA.includes(ch)) return ch;
    return '';
  });
}

type Orientation = 'portrait' | 'landscape';
type Style = 'normal' | 'bold' | 'italic' | 'bolditalic';
const PT = 0.3528; // mm per point
export const BLACK: [number, number, number] = [0, 0, 0];

/** Plain grid table as in the Word templates: thin black lines, white header with bold text. */
const GRID_STYLES: Partial<UserOptions['styles']> = { font: 'helvetica', fontSize: 10, cellPadding: { top: 1.2, bottom: 1.2, left: 1.6, right: 1.6 }, lineColor: BLACK, lineWidth: 0.2,
  textColor: BLACK, valign: 'middle', overflow: 'linebreak' };
const GRID_HEAD: Partial<UserOptions['headStyles']> = { fillColor: [255, 255, 255], textColor: BLACK, fontStyle: 'bold', halign: 'center', lineColor: BLACK, lineWidth: 0.2 };

/** A flowing Letter-size document: running y position, run-in labels, justified paragraphs, lists and tables that page-break on their own. */
export class Doc {
  doc: jsPDF;
  y: number;
  readonly m: number;
  /** Top of the text area: the margin, plus the running header's height when there is one. */
  readonly top: number;
  private header?: (d: Doc) => void;
  constructor(opts: { orientation?: Orientation; margin?: number; header?: { height: number; draw: (d: Doc) => void } } = {}) {
    this.doc = new jsPDF({ orientation: opts.orientation ?? 'portrait', unit: 'mm', format: 'letter', compress: false });
    this.doc.setFont('helvetica', 'normal');
    this.m = opts.margin ?? 25;
    this.top = this.m + (opts.header?.height ?? 0);
    this.header = opts.header?.draw;
    this.y = this.top;
  }
  get width() { return this.doc.internal.pageSize.getWidth(); }
  get height() { return this.doc.internal.pageSize.getHeight(); }
  get inner() { return this.width - 2 * this.m; }
  /** Lowest y for text: a little into the bottom margin, as Word does, with room left for the page number. */
  get bottom() { return this.height - this.m + 5; }
  lh(size: number, spacing = 1.25) { return size * PT * spacing; }

  ensure(h: number) { if (this.y + h > this.bottom) { this.doc.addPage(); this.y = this.top; } }
  gap(mm: number) { this.y += mm; }
  font(size: number, style: Style = 'normal', family = 'helvetica') { this.doc.setFont(family, style); this.doc.setFontSize(size); }

  /** The outline's letterhead: BUET crest, university, department, then the document title. */
  letterhead(title: string) {
    const d = this.doc, cx = this.width / 2, s = 17;
    d.addImage(BUET_LOGO, 'PNG', cx - s / 2, this.y, s, s);
    this.y += s + 5;
    this.font(11); d.text(clean(UNIVERSITY), cx, this.y, { align: 'center' });
    this.y += 6.5;
    this.font(14); d.text(clean(DEPARTMENT.toUpperCase()), cx, this.y, { align: 'center' });
    this.y += 9.5;
    this.font(14); d.text(clean(title), cx, this.y, { align: 'center' });
    this.y += 10;
  }

  /** Centred bold title lines (CAR, moderation form). */
  title(lines: string[], size = 13) {
    this.font(size, 'bold');
    for (const l of lines) { this.doc.text(clean(l), this.width / 2, this.y + this.lh(size) * 0.8, { align: 'center' }); this.y += this.lh(size, 1.2); }
    this.y += 4;
  }

  /** Bold heading such as "Course Contents:". */
  heading(text: string, size = 11) {
    this.ensure(this.lh(size) * 3);
    this.font(size, 'bold');
    this.doc.text(clean(text), this.m, this.y + this.lh(size) * 0.8);
    this.y += this.lh(size) + 2.5;
  }

  /** Wrapped text, justified like the templates' contents (pass justify: false for ragged). Blank lines separate paragraphs. */
  para(text: string, opts: { size?: number; style?: Style; indent?: number; width?: number; justify?: boolean; spacing?: number } = {}) {
    const size = opts.size ?? 11, x = this.m + (opts.indent ?? 0), w = opts.width ?? this.inner - (opts.indent ?? 0);
    const lh = this.lh(size, opts.spacing ?? 1.45);
    for (const block of clean(text).split('\n')) {
      if (!block.trim()) { this.y += lh * 0.5; continue; }
      this.font(size, opts.style ?? 'normal');
      const lines = this.doc.splitTextToSize(block.trim(), w) as string[];
      lines.forEach((l, i) => {
        this.ensure(lh);
        this.line(l, x, this.y + lh * 0.75, w, (opts.justify ?? true) && i < lines.length - 1);
        this.y += lh;
      });
    }
    this.y += 2;
  }

  /** One line of text, spread to the full width when `justify` (the last line of a paragraph is not). */
  private line(l: string, x: number, y: number, w: number, justify: boolean) {
    const words = l.trim().split(/\s+/);
    if (!justify || words.length < 2) { this.doc.text(l, x, y); return; }
    const used = words.reduce((n, wd) => n + this.doc.getTextWidth(wd), 0);
    const gap = (w - used) / (words.length - 1);
    if (gap > this.doc.getTextWidth(' ') * 4) { this.doc.text(l, x, y); return; } // a very short line reads better ragged
    let cx = x;
    for (const wd of words) { this.doc.text(wd, cx, y); cx += this.doc.getTextWidth(wd) + gap; }
  }

  /** Bulleted (•) or numbered (1.) list with hanging indent, as in the outline's objectives, outcomes and textbooks. */
  list(items: string[], opts: { numbered?: boolean; size?: number; indent?: number; spacing?: number; justify?: boolean; itemGap?: number } = {}) {
    const size = opts.size ?? 11, ind = opts.indent ?? 6, hang = 6.5, lh = this.lh(size, opts.spacing ?? 1.35);
    items.map((x) => x.trim()).filter(Boolean).forEach((it, n) => {
      this.font(size);
      const w = this.inner - ind - hang;
      const lines = this.doc.splitTextToSize(clean(it.replace(/^(\d+[.)]|[•●*-])\s*/, '')), w) as string[];
      lines.forEach((l, i) => {
        this.ensure(lh);
        const y = this.y + lh * 0.75;
        if (i === 0) this.doc.text(opts.numbered ? `${n + 1}.` : '•', this.m + ind, y);
        this.line(l, this.m + ind + hang, y, w, (opts.justify ?? false) && i < lines.length - 1);
        this.y += lh;
      });
      this.y += opts.itemGap ?? 0.6;
    });
    this.y += 2;
  }

  /** Bold label, value at a tab stop: the "Course No:   BME 211" block. A row can hold a second label/value pair on the right. */
  fields(rows: ([string, string] | [string, string, string, string])[], opts: { tab?: number; size?: number; tab2?: number; tab3?: number } = {}) {
    const size = opts.size ?? 11, tab = opts.tab ?? 52, tab2 = opts.tab2 ?? 104, tab3 = opts.tab3 ?? 143, lh = this.lh(size, 1.3);
    for (const r of rows) {
      this.font(size);
      const lines = this.doc.splitTextToSize(clean(r[1] || ''), (r.length === 4 ? tab2 : this.inner) - tab - 2) as string[];
      this.ensure(lh * Math.max(1, lines.length));
      const y = this.y + lh * 0.75;
      this.font(size, 'bold'); this.doc.text(clean(r[0]), this.m, y);
      this.font(size); lines.forEach((l, i) => this.doc.text(l, this.m + tab, y + i * lh));
      if (r.length === 4) { this.font(size, 'bold'); this.doc.text(clean(r[2]), this.m + tab2, y); this.font(size); this.doc.text(clean(r[3] || ''), this.m + tab3, y); }
      this.y += lh * Math.max(1, lines.length);
    }
    this.y += 4;
  }

  /** Label and value on one line at a tab stop, indented: the Assessment block ("Class participation/Attendance:   10%"). */
  tabbed(rows: [string, string][], opts: { indent?: number; tab?: number; size?: number } = {}) {
    const size = opts.size ?? 11, ind = opts.indent ?? 12, lh = this.lh(size, 1.3);
    this.font(size);
    const tab = opts.tab ?? Math.max(60, ...rows.map(([k]) => this.doc.getTextWidth(clean(k)) + 8));
    for (const [k, v] of rows) {
      this.ensure(lh);
      const y = this.y + lh * 0.75;
      this.doc.text(clean(k), this.m + ind, y); this.doc.text(clean(v), this.m + ind + tab, y);
      this.y += lh;
    }
    this.y += 3;
  }

  table(head: RowInput[], body: RowInput[], opts: Partial<UserOptions> = {}) {
    const ticks = new Set<string>();
    (this.doc as WithTable).autoTable({
      theme: 'grid', startY: this.y, head, body, margin: { left: this.m, right: this.m, top: this.top, bottom: this.height - this.bottom },
      ...opts,
      styles: { ...GRID_STYLES, ...opts.styles },
      headStyles: { ...GRID_HEAD, ...opts.headStyles },
      didParseCell: (h: CellHookData) => {
        if (h.cell.raw === TICK) { ticks.add(`${h.section}:${h.row.index}:${h.column.index}`); h.cell.text = ['']; }
        else h.cell.text = h.cell.text.map(clean);
        opts.didParseCell?.(h);
      },
      didDrawCell: (h: CellHookData) => {
        if (ticks.has(`${h.section}:${h.row.index}:${h.column.index}`)) {
          const cx = h.cell.x + h.cell.width / 2, cy = h.cell.y + h.cell.height / 2, d = this.doc;
          d.setLineWidth(0.45); d.setDrawColor(0, 0, 0);
          d.line(cx - 1.6, cy, cx - 0.4, cy + 1.3); d.line(cx - 0.4, cy + 1.3, cx + 1.8, cy - 1.5);
        }
        opts.didDrawCell?.(h);
      },
    });
    this.y = (this.doc as WithTable).lastAutoTable.finalY + 5;
  }

  /** Running header on every page (CAR) and page numbers bottom right (outline, mapping). */
  finish(opts: { pageNumbers?: boolean } = {}): jsPDF {
    const d = this.doc, n = d.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      d.setPage(i);
      if (this.header) { const y = this.y; this.y = this.m; this.header(this); this.y = y; }
      if (opts.pageNumbers ?? true) { this.font(10, 'normal', 'times'); d.text(String(i), this.width - this.m, this.height - 12, { align: 'right' }); }
    }
    return d;
  }
}

/** "CO1".."CO12" order helper. */
export const byNum = (a: string, b: string) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, ''));
export const pct = (v: number | null | undefined) => (v === null || v === undefined ? 'NA' : (Math.round(v * 100) / 100).toFixed(2));
export const fileName = (s: string) => s.replace(/[^\w.-]+/g, '_');
/** Lines of a multi-line field, without empty ones. */
export const linesOf = (s: string | null | undefined) => (s ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
