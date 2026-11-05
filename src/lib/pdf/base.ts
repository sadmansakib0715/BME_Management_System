// Shared layout for the department's OBE documents (Course Outline, CO-PO Mapping, Rubric, CAR), drawn with jsPDF.
// The layouts follow the department's own documents as filed in the BME BUET OBE folder and submitted with the SAR (BAETE).
import { jsPDF } from 'jspdf';
import { applyPlugin, type CellHookData, type RowInput, type UserOptions } from 'jspdf-autotable';

// The plugin form works the same under Vite and Node (the default export differs between their module systems).
applyPlugin(jsPDF);
type WithTable = jsPDF & { autoTable: (o: UserOptions) => void; lastAutoTable: { finalY: number } };

export const TICK = '\u0000tick';                     // a table cell holding this value is drawn as a check mark
export const UNIVERSITY = 'Bangladesh University of Engineering and Technology';
export const DEPARTMENT = 'Department of Biomedical Engineering';

// The built-in PDF fonts only cover Latin-1/WinAnsi; map the few symbols the app uses and drop anything else.
const MAP: Record<string, string> = { '≥': '>=', '≤': '<=', '→': '->', '←': '<-', '✓': 'Yes', '✔': 'Yes', '×': 'x', '−': '-', ' ': ' ', '\t': '  ' };
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

/** A simple flowing A4 document: running y position, headings, paragraphs and tables that page-break on their own. */
export class Doc {
  doc: jsPDF;
  y: number;
  readonly m = 15;
  constructor(orientation: Orientation = 'portrait') {
    this.doc = new jsPDF({ orientation, unit: 'mm', format: 'a4', compress: false });
    this.doc.setFont('helvetica', 'normal');
    this.y = this.m;
  }
  get width() { return this.doc.internal.pageSize.getWidth(); }
  get height() { return this.doc.internal.pageSize.getHeight(); }
  get inner() { return this.width - 2 * this.m; }

  ensure(h: number) { if (this.y + h > this.height - this.m - 6) { this.doc.addPage(); this.y = this.m; } }

  /** University and department heading, then the document title (e.g. "Course Outline"). */
  letterhead(title: string, sub?: string) {
    const d = this.doc, cx = this.width / 2;
    d.setFont('helvetica', 'bold'); d.setFontSize(13); d.text(clean(UNIVERSITY), cx, this.y + 4, { align: 'center' });
    d.setFontSize(11.5); d.text(clean(DEPARTMENT.toUpperCase()), cx, this.y + 10, { align: 'center' });
    d.setLineWidth(0.4); d.line(this.m, this.y + 13, this.width - this.m, this.y + 13);
    d.setFontSize(13); d.text(clean(title), cx, this.y + 20, { align: 'center' });
    this.y += 23;
    if (sub) { d.setFont('helvetica', 'normal'); d.setFontSize(9.5); d.text(clean(sub), cx, this.y + 1, { align: 'center' }); this.y += 5; }
    this.y += 2;
  }

  heading(text: string) {
    this.ensure(12);
    this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(11);
    this.doc.text(clean(text), this.m, this.y + 4);
    this.y += 7;
  }

  para(text: string, opts: { size?: number; bold?: boolean; indent?: number } = {}) {
    const d = this.doc, size = opts.size ?? 10, x = this.m + (opts.indent ?? 0);
    d.setFont('helvetica', opts.bold ? 'bold' : 'normal'); d.setFontSize(size);
    const lh = size * 0.42;
    for (const block of clean(text).split('\n')) {
      const lines = d.splitTextToSize(block || ' ', this.inner - (opts.indent ?? 0)) as string[];
      for (const l of lines) { this.ensure(lh + 1); d.text(l, x, this.y + lh); this.y += lh; }
    }
    this.y += 2;
  }

  bullets(items: string[], size = 10) {
    for (const it of items.filter((x) => x.trim())) {
      const d = this.doc; d.setFont('helvetica', 'normal'); d.setFontSize(size);
      const lh = size * 0.42;
      const lines = d.splitTextToSize(clean(it.trim()), this.inner - 6) as string[];
      lines.forEach((l, i) => { this.ensure(lh + 1); if (i === 0) d.text('•', this.m + 1.5, this.y + lh); d.text(l, this.m + 6, this.y + lh); this.y += lh; });
      this.y += 0.8;
    }
    this.y += 1.5;
  }

  /** Label: value lines in two columns, as at the top of the department's outlines. */
  fields(rows: [string, string][], labelWidth = 38) {
    const d = this.doc;
    for (const [k, v] of rows) {
      d.setFontSize(10);
      const lines = d.splitTextToSize(clean(v || '-'), this.inner - labelWidth) as string[];
      this.ensure(lines.length * 4.5 + 1);
      d.setFont('helvetica', 'bold'); d.text(clean(k), this.m, this.y + 4);
      d.setFont('helvetica', 'normal'); lines.forEach((l, i) => d.text(l, this.m + labelWidth, this.y + 4 + i * 4.3));
      this.y += Math.max(1, lines.length) * 4.3 + 1.2;
    }
    this.y += 1.5;
  }

  table(head: RowInput[], body: RowInput[], opts: Partial<UserOptions> = {}) {
    const ticks = new Set<string>();
    (this.doc as WithTable).autoTable({
      startY: this.y, head, body, theme: 'grid', margin: { left: this.m, right: this.m, bottom: this.m + 6 },
      styles: { font: 'helvetica', fontSize: 8.6, cellPadding: 1.4, lineColor: [120, 120, 120], lineWidth: 0.15, textColor: [20, 20, 20], valign: 'middle', overflow: 'linebreak' },
      headStyles: { fillColor: [232, 236, 241], textColor: [20, 20, 20], fontStyle: 'bold', halign: 'center' },
      ...opts,
      didParseCell: (h: CellHookData) => {
        if (typeof h.cell.raw === 'string') {
          if (h.cell.raw === TICK) { ticks.add(`${h.section}:${h.row.index}:${h.column.index}`); h.cell.text = ['']; }
          else h.cell.text = h.cell.text.map(clean);
        }
        opts.didParseCell?.(h);
      },
      didDrawCell: (h: CellHookData) => {
        if (ticks.has(`${h.section}:${h.row.index}:${h.column.index}`)) {
          const cx = h.cell.x + h.cell.width / 2, cy = h.cell.y + h.cell.height / 2, d = this.doc;
          d.setLineWidth(0.45); d.setDrawColor(20, 20, 20);
          d.line(cx - 1.6, cy, cx - 0.4, cy + 1.3); d.line(cx - 0.4, cy + 1.3, cx + 1.8, cy - 1.5);
        }
        opts.didDrawCell?.(h);
      },
    });
    this.y = (this.doc as WithTable).lastAutoTable.finalY + 4;
  }

  /** Signature blocks: a line, then the name and an optional caption. */
  signatures(names: string[], caption = 'Signature') {
    if (!names.length) return;
    const per = this.inner / Math.min(3, names.length);
    this.ensure(26);
    this.y += 10;
    names.forEach((n, i) => {
      const col = i % 3, row = Math.floor(i / 3);
      if (col === 0 && row > 0) { this.y += 22; this.ensure(22); }
      const x = this.m + col * per;
      this.doc.setLineWidth(0.25); this.doc.line(x, this.y, x + per - 8, this.y);
      this.doc.setFont('helvetica', 'normal'); this.doc.setFontSize(9);
      this.doc.text(clean(n), x, this.y + 4.5); this.doc.setFontSize(8); this.doc.setTextColor(90);
      this.doc.text(clean(caption), x, this.y + 8.5); this.doc.setTextColor(0);
    });
    this.y += 14;
  }

  /** Footer on every page: document name, generation date and "Page n of N". */
  finish(footer: string): jsPDF {
    const d = this.doc, n = d.getNumberOfPages(), when = new Date().toISOString().slice(0, 10);
    for (let i = 1; i <= n; i++) {
      d.setPage(i); d.setFont('helvetica', 'normal'); d.setFontSize(7.5); d.setTextColor(110);
      d.text(clean(`${footer} · generated ${when}`), this.m, this.height - 8);
      d.text(`Page ${i} of ${n}`, this.width - this.m, this.height - 8, { align: 'right' });
      d.setTextColor(0);
    }
    return d;
  }
}

/** "CO1".."CO12" order helper. */
export const byNum = (a: string, b: string) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, ''));
export const pct = (v: number | null | undefined) => (v === null || v === undefined ? 'NA' : (Math.round(v * 100) / 100).toFixed(2));
export const fileName = (s: string) => s.replace(/[^\w.-]+/g, '_');
