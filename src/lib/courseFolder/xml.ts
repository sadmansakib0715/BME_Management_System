// Small WordprocessingML helpers on top of @xmldom/xmldom (the same code runs in the browser and in the tests).
import { DOMParser, XMLSerializer, type Document, type Element, type Node } from '@xmldom/xmldom';
import JSZip from 'jszip';

export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const HYPERLINK = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

export type El = Element;

export const isW = (n: Node | null | undefined, name?: string): n is Element =>
  !!n && n.nodeType === 1 && (n as Element).namespaceURI === W && (!name || (n as Element).localName === name);

/** Direct children in the w: namespace (optionally with that local name). */
export function kids(el: Element, name?: string): Element[] {
  const out: Element[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) if (isW(n, name)) out.push(n);
  return out;
}

/** All descendants with that w: local name, in document order. */
export function desc(el: Element | Document, name: string): Element[] {
  return Array.from(el.getElementsByTagNameNS(W, name) as unknown as ArrayLike<Element>);
}

export const kid = (el: Element, name: string): Element | null => kids(el, name)[0] ?? null;

export function wEl(doc: Document, name: string, attrs: Record<string, string> = {}): Element {
  const e = doc.createElementNS(W, `w:${name}`);
  for (const [k, v] of Object.entries(attrs)) e.setAttributeNS(W, `w:${k}`, v);
  return e;
}

export const getW = (el: Element, attr: string) => el.getAttributeNS(W, attr);
export const setW = (el: Element, attr: string, v: string) => el.setAttributeNS(W, `w:${attr}`, v);

export function remove(n: Node) { n.parentNode?.removeChild(n); }

export const clone = <T extends Node>(n: T): T => n.cloneNode(true) as T;

export function insertAfter(ref: Node, n: Node) {
  const p = ref.parentNode!;
  if (ref.nextSibling) p.insertBefore(n, ref.nextSibling); else p.appendChild(n);
}

/** Paragraph text as Word shows it: w:t text, w:tab as \t and w:br as \n (tab stops in w:pPr are ignored). */
export function paraText(p: Element): string {
  let s = '';
  for (const r of desc(p, 'r')) {
    for (const c of kids(r)) {
      if (c.localName === 't') s += c.textContent ?? '';
      else if (c.localName === 'tab') s += '\t';
      else if (c.localName === 'br' || c.localName === 'cr') s += '\n';
    }
  }
  return s;
}

export const cellText = (tc: Element) => kids(tc, 'p').map(paraText).join('\n');

function firstRpr(p: Element): Element | null {
  const r = kid(p, 'r') ?? desc(p, 'r')[0];
  const rpr = r ? kid(r, 'rPr') : null;
  if (rpr) return clone(rpr);
  const ppr = kid(p, 'pPr');
  const pr = ppr ? kid(ppr, 'rPr') : null;
  return pr ? clone(pr) : null;
}

function stripPara(p: Element) {
  // everything but the paragraph properties goes (runs, hyperlinks, bookmarks, proofErr)
  for (let n = p.firstChild; n;) { const nx = n.nextSibling; if (!(isW(n, 'pPr'))) p.removeChild(n); n = nx; }
}

export function makeRun(doc: Document, text: string, rpr: Element | null, highlight = false): Element {
  const r = wEl(doc, 'r');
  let pr = rpr ? clone(rpr) : null;
  if (pr) { for (const s of kids(pr, 'rStyle')) remove(s); }
  if (highlight) {
    if (!pr) pr = wEl(doc, 'rPr');
    for (const h of kids(pr, 'highlight')) remove(h);
    pr.appendChild(wEl(doc, 'highlight', { val: 'yellow' }));
  }
  if (pr) r.appendChild(pr);
  const t = wEl(doc, 't');
  t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
  t.appendChild(doc.createTextNode(text));
  r.appendChild(t);
  return r;
}

/** Replace a cell's content with one paragraph per line, keeping the first paragraph's formatting (lists stay lists). */
export function setCellLines(tc: Element, lines: string[], highlight = false) {
  const doc = tc.ownerDocument!;
  const ps = kids(tc, 'p');
  const proto = clone(ps[0] ?? wEl(doc, 'p'));
  const rpr = firstRpr(proto);
  for (const p of ps) remove(p);
  for (const line of lines.length ? lines : ['']) {
    const p = clone(proto);
    stripPara(p);
    p.appendChild(makeRun(doc, line, rpr, highlight));
    tc.appendChild(p);
  }
}

export function setParaText(p: Element, text: string, highlight = false) {
  const rpr = firstRpr(p);
  stripPara(p);
  p.appendChild(makeRun(p.ownerDocument!, text, rpr, highlight));
}

/** Keep the runs up to and including the label (e.g. "Major issues:"), replace the rest with text. */
export function setParaAfterLabel(p: Element, label: RegExp, text: string, highlight = false) {
  const rpr = firstRpr(p);
  const keep = new Set<Node>();
  let acc = '';
  for (const r of kids(p, 'r')) {
    keep.add(r);
    acc += desc(r, 't').map((t) => t.textContent ?? '').join('');
    if (label.test(acc)) break;
  }
  for (let n = p.firstChild; n;) { const nx = n.nextSibling; if (!isW(n, 'pPr') && !keep.has(n)) p.removeChild(n); n = nx; }
  p.appendChild(makeRun(p.ownerDocument!, ` ${text}`, rpr, highlight));
}

/** A .docx opened for editing: document.xml and its relationships. */
export class DocxPackage {
  private constructor(readonly zip: JSZip, readonly doc: Document, private rels: Document) {}

  static async open(data: ArrayBuffer | Uint8Array): Promise<DocxPackage> {
    const zip = await JSZip.loadAsync(data);
    const parse = async (p: string) => new DOMParser().parseFromString((await zip.file(p)!.async('string')).replace(/^\uFEFF/, '').trimStart(), 'text/xml');
    return new DocxPackage(zip, await parse('word/document.xml'), await parse('word/_rels/document.xml.rels'));
  }

  get body(): Element { return desc(this.doc, 'body')[0]; }
  /** Top-level paragraphs and tables, in order. */
  blocks(): Element[] { return kids(this.body).filter((e) => e.localName === 'p' || e.localName === 'tbl'); }
  tables(): Element[] { return kids(this.body, 'tbl'); }
  paragraphs(): Element[] { return kids(this.body, 'p'); }

  addHyperlink(target: string): string {
    const root = this.rels.documentElement!;
    const ids = Array.from(root.getElementsByTagNameNS(PKG_REL, 'Relationship') as unknown as ArrayLike<Element>).map((e) => e.getAttribute('Id') ?? '');
    let n = ids.length + 1;
    while (ids.includes(`rId${n}`)) n++;
    const rel = this.rels.createElementNS(PKG_REL, 'Relationship');
    rel.setAttribute('Id', `rId${n}`);
    rel.setAttribute('Type', HYPERLINK);
    rel.setAttribute('Target', target);
    rel.setAttribute('TargetMode', 'External');
    root.appendChild(rel);
    return `rId${n}`;
  }

  static setRid(el: Element, rid: string) { el.setAttributeNS(R_NS, 'r:id', rid); }

  async save(): Promise<Uint8Array> {
    const ser = new XMLSerializer();
    this.zip.file('word/document.xml', ser.serializeToString(this.doc));
    this.zip.file('word/_rels/document.xml.rels', ser.serializeToString(this.rels));
    return this.zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  }
}

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
