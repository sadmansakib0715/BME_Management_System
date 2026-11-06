import { History } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { describe, groupEntries, type LogGroup } from '@/lib/activity';
import { useActivity, type ActivityFilter } from '@/lib/api';
import { useTerm } from '@/lib/TermContext';
import { Button, Callout, Empty, ErrorNote, Spinner } from './ui';

const PAGE = 150;
const DHAKA = 'Asia/Dhaka';
const dayKey = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: DHAKA }).format(new Date(iso));
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: DHAKA });
function dayTitle(key: string) {
  const today = dayKey(new Date().toISOString()), yesterday = dayKey(new Date(Date.now() - 86400000).toISOString());
  if (key === today) return 'Today';
  if (key === yesterday) return 'Yesterday';
  return new Date(key + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
const initials = (n: string) => n.replace(/^(Dr|Mr|Ms|Mrs|Prof|Engr)\.?\s+/i, '').split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';

/** Who did what, newest first, grouped by day. Used by the Log page (whole department) and each course's Log tab. */
export function ActivityLog({ filter, showCourse = true }: { filter: ActivityFilter; showCourse?: boolean }) {
  const { nameOf } = useTerm();
  const { openAccess, me } = useAuth();
  const [limit, setLimit] = useState(PAGE);
  const q = useActivity(filter, limit);
  const coCodes = q.data?.coCodes;
  const groups = useMemo(() => groupEntries(q.data?.entries ?? []), [q.data]);
  const days = useMemo(() => {
    const m = new Map<string, LogGroup[]>();
    for (const g of groups) { const k = dayKey(g.at); m.set(k, [...(m.get(k) ?? []), g]); }
    return [...m.entries()];
  }, [groups]);
  const ctx = useMemo(() => ({ nameOf: (id: string) => nameOf(id), coCode: (id: string) => coCodes?.[id] }), [nameOf, coCodes]);

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} />;
  return (
    <div className="space-y-4">
      {q.data?.needsMigration && <Callout tone="warn" title="The log needs a database update">
        Run <span className="font-mono">supabase/update_activity_log.sql</span> once in the Supabase SQL Editor. Until then the log cannot show names or filter by course, and changes made without signing in are not attributed to anyone.</Callout>}
      {openAccess && !me?.facultyId && <Callout tone="info" title="Choose your name">Pick your name under “Viewing as” in the sidebar, so the changes you make show your name in the log.</Callout>}
      {!groups.length ? <Empty icon={<History className="size-6" aria-hidden />} title="Nothing logged yet">Scheduling an assessment, editing an outline or changing an exam step shows up here, with who did it and when.</Empty> : (
        <ol className="space-y-5">
          {days.map(([day, gs]) => (
            <li key={day}>
              <h3 className="text-2xs font-semibold uppercase tracking-wider text-subtle mb-2">{dayTitle(day)}</h3>
              <ol className="rounded-lg border border-line bg-surface divide-y divide-line">
                {gs.map((g) => {
                  const d = describe(g, ctx);
                  const who = g.actorName ?? (g.actor ? nameOf(g.actor) : null);
                  return (
                    <li key={g.key + g.entries[0].id} className="flex gap-3 px-3 py-2.5">
                      <div className={`size-8 shrink-0 rounded-full grid place-items-center text-2xs font-semibold ${who ? 'bg-brand-soft text-brand-ink' : 'bg-sunken text-subtle'}`} aria-hidden>{who ? initials(who) : '?'}</div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm leading-snug">
                          {who ? <span className="font-semibold">{who}</span>
                            : <span className="font-semibold text-muted" title="Made with sign-in off and no name chosen under “Viewing as”, or from the SQL Editor.">Someone (no name)</span>}
                          {' '}{d.text}
                          {showCourse && g.courseCode && <>{' · '}{g.offeringId ? <Link className="link font-mono text-2xs" to={`/courses/${g.offeringId}/log`}>{g.courseCode}</Link> : <span className="font-mono text-2xs">{g.courseCode}</span>}</>}
                        </p>
                        {d.details.length > 0 && <ul className="mt-1 space-y-0.5 text-2xs text-muted">{d.details.map((x, i) => <li key={i} className="break-words">{x}</li>)}</ul>}
                      </div>
                      <time dateTime={g.at} className="shrink-0 text-2xs text-subtle tabular pt-0.5" title={new Date(g.at).toLocaleString('en-GB', { timeZone: DHAKA })}>{timeOf(g.at)}</time>
                    </li>
                  );
                })}
              </ol>
            </li>
          ))}
        </ol>
      )}
      {q.data?.more && <div className="flex justify-center"><Button loading={q.isFetching} onClick={() => setLimit((n) => n + PAGE)}>Show older</Button></div>}
    </div>
  );
}
