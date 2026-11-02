const DAY = 86400000;
export const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
export const daysUntil = (d: string | null | undefined, now = todayISO()) =>
  d ? Math.round((Date.parse(d + 'T12:00:00Z') - Date.parse(now + 'T12:00:00Z')) / DAY) : null;
export const fmtDate = (d: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) =>
  d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' }) : '—';
export const fmtDateLong = (d: string | null | undefined) => fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
export function relDays(d: string | null | undefined): string {
  const n = daysUntil(d);
  if (n === null) return 'No date';
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  return n > 0 ? `In ${n} days` : `${-n} days overdue`;
}
export const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);
export const pct = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${Math.round(x)}%`);
