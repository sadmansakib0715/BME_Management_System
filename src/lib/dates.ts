// Parses every date format found in the department workbook into ISO yyyy-mm-dd.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const TYPOS: Record<string, string> = { auguest: 'aug', agust: 'aug', septmber: 'sep', febuary: 'feb', ocotber: 'oct' };

const iso = (y: number, m: number, d: number): string | null => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

const month = (word: string): number => {
  const w = word.toLowerCase();
  const key = TYPOS[w] ?? w.slice(0, 3);
  return MONTHS.indexOf(key) + 1;
};

/** Excel serial day (1900 system) to ISO. 46200 -> 2026-06-27. */
export function fromExcelSerial(n: number): string {
  const ms = Math.round((n - 25569) * 86400000);
  return new Date(ms).toISOString().slice(0, 10);
}

export function parseSheetDate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return v > 20000 && v < 80000 ? fromExcelSerial(v) : null;
  let s = String(v).trim();
  if (/^\d{5}(\.\d+)?$/.test(s)) return fromExcelSerial(Number(s));
  s = s.replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s*/i, '');
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return iso(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) return iso(+m[3], +m[2], +m[1]); // dd/mm/yyyy (BD convention)
  if ((m = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})$/))) { const mo = month(m[1]); return mo ? iso(+m[3], mo, +m[2]) : null; }
  if ((m = s.match(/^(\d{1,2})[\s-]+([A-Za-z]+)[\s,-]+(\d{4})$/))) { const mo = month(m[2]); return mo ? iso(+m[3], mo, +m[1]) : null; }
  return null;
}
