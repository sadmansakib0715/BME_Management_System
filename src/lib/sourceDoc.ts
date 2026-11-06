// The teacher's own outline as readable blocks for the converter's left pane: paragraphs (lists marked) and tables.
// .docx is read with the course-folder Word helpers; .pdf with pdf.js, line by line.
import { cellText, DocxPackage, kid, kids, paraText } from './courseFolder/xml';

export type SourceBlock =
  | { kind: 'p'; text: string; list?: boolean; bold?: boolean; /** a PDF line with column gaps (a table row) */ row?: boolean; /** a PDF line (a paragraph may wrap over several) */ line?: boolean }
  | { kind: 'table'; rows: string[][] };

export async function docxBlocks(data: ArrayBuffer | Uint8Array): Promise<SourceBlock[]> {
  const pkg = await DocxPackage.open(data);
  const out: SourceBlock[] = [];
  for (const el of pkg.blocks()) {
    if (el.localName === 'p') {
      const text = paraText(el).replace(/\t+/g, '  ').trim();
      if (!text) continue;
      const ppr = kid(el, 'pPr');
      const runs = kids(el, 'r').filter((r) => (r.textContent ?? '').trim());
      const bold = runs.length > 0 && runs.every((r) => { const rpr = kid(r, 'rPr'); return !!rpr && !!kid(rpr, 'b'); });
      out.push({ kind: 'p', text, list: !!(ppr && kid(ppr, 'numPr')), bold });
    } else {
      const rows = kids(el, 'tr').map((tr) => kids(tr, 'tc').map((tc) => cellText(tc).trim()));
      if (rows.some((r) => r.some(Boolean))) out.push({ kind: 'table', rows });
    }
  }
  return out;
}

export interface PdfItem { s: string; x: number; y: number; w?: number }

/** Text pieces of each page → lines (pieces on about the same baseline, left to right) → paragraph blocks. */
export function pdfLinesToBlocks(pages: PdfItem[][]): SourceBlock[] {
  const out: SourceBlock[] = [];
  for (const items of pages) {
    const lines: { y: number; parts: PdfItem[] }[] = [];
    for (const it of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
      const l = lines.find((x) => Math.abs(x.y - it.y) < 3);
      if (l) l.parts.push(it); else lines.push({ y: it.y, parts: [it] });
    }
    for (const l of lines) {
      // Pieces are joined where they sit: touching pieces ("e" + "ff" + "ective", split at a ligature) without a space, a word gap with
      // one, and a wide gap (the next table column) with a tab.
      let text = '', end = -Infinity;
      for (const x of l.parts.sort((a, b) => a.x - b.x)) {
        const gap = x.x - end;
        if (text && gap > 15) text = `${text.trimEnd()}\t`;
        else if (text && gap > 1.5 && !/\s$/.test(text) && !/^\s/.test(x.s)) text += ' ';
        text += x.s;
        end = Math.max(end, x.x + (x.w ?? x.s.length * 5));
      }
      text = text.replace(/[ \u00a0]+/g, ' ').replace(/ *\t */g, '\t').trim();
      if (text && !/^\d{1,3}$/.test(text)) out.push({ kind: 'p', text, list: /^[•●○◦▪■]|^\d{1,2}[.)]\s/.test(text), ...(text.includes('\t') ? { row: true } : {}), line: true });   // bare page numbers dropped
    }
  }
  return out;
}

export async function pdfBlocks(data: ArrayBuffer): Promise<SourceBlock[]> {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const pages: PdfItem[][] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const items = (await (await doc.getPage(n)).getTextContent()).items;
    pages.push(items.flatMap((it) => ('str' in it && it.str !== '' ? [{ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width }] : [])));
  }
  return pdfLinesToBlocks(pages);
}

/** A block as plain text, for dragging it whole: a table row per line, cells separated by tabs. */
export const blockText = (b: SourceBlock) => (b.kind === 'p' ? b.text : b.rows.map((r) => r.map((c) => c.replace(/\n/g, ' ')).join('\t')).join('\n'));
