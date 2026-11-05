const DAY = 86400000;
export const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
export const daysUntil = (d, now = todayISO()) => d ? Math.round((Date.parse(d + 'T12:00:00Z') - Date.parse(now + 'T12:00:00Z')) / DAY) : null;
export const fmtDate = (d, opts = { day: 'numeric', month: 'short' }) => d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' }) : '—';
export const fmtDateLong = (d) => fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
export const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);
export const pct = (x) => (x === null || x === undefined ? '—' : `${Math.round(x)}%`);
