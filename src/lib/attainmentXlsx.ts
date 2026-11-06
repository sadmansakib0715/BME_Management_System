// "CO and PO Attainment for <course>.xlsx" in the department's layout (Templates/CO and PO Attainment for BME 210.xlsx):
// two sheets, CO Attainment and PO Attainment, each with a merged title row, a header
// (Session | Course Teacher (1)… | CO1…CO12) and per session one row of percentages and one of Y / N, "N/A" where not applicable.
import type * as XLSX from 'xlsx';
import type { CarBlock } from './pdf/obeDocs';

export interface SummarySession { block: CarBlock; teachers: string[] }

export function attainmentSummaryWorkbook(X: typeof XLSX, a: { code: string; title: string; sessions: SummarySession[] }): XLSX.WorkBook {
  const wb = X.utils.book_new();
  const nT = Math.max(1, ...a.sessions.map((s) => s.teachers.length));
  for (const kind of ['CO', 'PO'] as const) {
    const codes = Array.from({ length: 12 }, (_, i) => `${kind}${i + 1}`);
    const aoa: (string | number)[][] = [
      [`${kind} Attainment of ${a.code} (${a.title})`],
      ['Session', ...Array.from({ length: nT }, (_, i) => `Course Teacher (${i + 1})`), ...codes],
    ];
    const merges: XLSX.Range[] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: nT + 12 } }];
    const pctCells: string[] = [];
    a.sessions.forEach((s, k) => {
      const r = 2 + k * 2, map = kind === 'CO' ? s.block.co : s.block.po;
      const pad = Array.from({ length: nT }, (_, i) => s.teachers[i] ?? '');
      aoa.push([s.block.term, ...pad, ...codes.map((c, j) => {
        const x = map[c];
        if (!x || x.yn === 'NA' || x.value === null) return 'N/A';
        pctCells.push(X.utils.encode_cell({ r, c: 1 + nT + j }));
        return Math.round(x.value * 100) / 10000; // 79.59 → 0.7959, shown as 79.59%
      })]);
      aoa.push(['', ...pad.map(() => ''), ...codes.map((c) => (map[c] && map[c].yn !== 'NA' ? map[c].yn : 'N/A'))]);
      for (let col = 0; col <= nT; col++) merges.push({ s: { r, c: col }, e: { r: r + 1, c: col } });
    });
    const ws = X.utils.aoa_to_sheet(aoa);
    for (const ref of pctCells) ws[ref].z = '0.00%';
    ws['!merges'] = merges;
    ws['!cols'] = [{ wch: 12 }, ...Array.from({ length: nT }, () => ({ wch: 28 })), ...codes.map(() => ({ wch: 8 }))];
    X.utils.book_append_sheet(wb, ws, `${kind} Attainment`);
  }
  return wb;
}
