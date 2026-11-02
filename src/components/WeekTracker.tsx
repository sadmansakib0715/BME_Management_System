import { clsx } from 'clsx';
import type { Term } from '@/lib/types';

/** Term progress: completed weeks filled, the current week outlined. */
export function WeekTracker({ term }: { term: Term }) {
  const n = term.total_weeks, done = term.latest_completed_week;
  const paused = term.calendar_status === 'paused';
  return (
    <div className="card px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <div className="text-sm font-semibold">{paused ? 'Classes paused' : done >= n ? 'Teaching weeks complete' : `Week ${done + 1} of ${n}`}</div>
        <div className="text-2xs text-subtle">{paused ? term.pause_reason || 'Paused by the department' : `${done} of ${n} weeks completed`}</div>
      </div>
      <ol className="grid gap-1" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }} aria-label={`${done} of ${n} weeks completed`}>
        {Array.from({ length: n }, (_, i) => (
          <li key={i} title={`Week ${i + 1}`} className={clsx('h-2 rounded-sm',
            i < done ? 'bg-brand' : i === done && !paused ? 'bg-brand/25 ring-1 ring-brand' : 'bg-sunken', paused && i < done && 'opacity-60')}>
            <span className="sr-only">Week {i + 1}: {i < done ? 'completed' : i === done ? 'current' : 'upcoming'}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
