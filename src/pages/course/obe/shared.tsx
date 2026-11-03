import { clsx } from 'clsx';
import type { CourseObe } from '@/lib/api';
import { attained } from '@/lib/obe';
import type { TabProps } from '../shared';

export interface ObeProps extends TabProps { obe: CourseObe; canEdit: boolean; isAdmin: boolean }

/** A set of small on/off chips (taxonomy levels, delivery, tools). Values outside the list (as worded in an imported document) show too. */
export function Chips({ options, value, onChange, disabled, label }: { options: string[]; value: string[]; onChange: (v: string[]) => void; disabled?: boolean; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {[...options, ...value.filter((v) => !options.includes(v))].map((o) => {
        const on = value.includes(o);
        return (
          <button key={o} type="button" aria-pressed={on} disabled={disabled} onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
            className={clsx('h-7 px-2 rounded border text-2xs font-medium transition-colors duration-150 cursor-pointer disabled:cursor-default',
              on ? 'bg-brand-soft border-brand/40 text-brand-ink' : 'bg-surface border-line text-muted hover:text-ink disabled:hover:text-muted')}>{o}</button>
        );
      })}
    </div>
  );
}

/** Y / N / NA in the progress colours; the text always says it. */
export function YesNo({ value, threshold }: { value: number | null; threshold?: number }) {
  const a = attained(value, threshold);
  return <span className={clsx('inline-flex justify-center min-w-8 rounded border px-1.5 py-0.5 text-2xs font-semibold', a === null ? 'prog-n' : a ? 'prog-3' : 'prog-0')}>{a === null ? 'NA' : a ? 'Y' : 'N'}</span>;
}

/** A horizontal bar for a percentage with the threshold line drawn on it. */
export function PctBar({ value, threshold = 0.4, label }: { value: number | null; threshold?: number; label: string }) {
  const a = attained(value, threshold);
  return (
    <div className="relative h-2.5 w-full rounded-full bg-sunken" role="img" aria-label={`${label}: ${value === null ? 'no value' : `${value.toFixed(2)}%`}, threshold ${threshold * 100}%`}>
      {value !== null && <div className={clsx('h-full rounded-full', a ? 'bg-ok' : 'bg-bad')} style={{ width: `${Math.min(100, value)}%` }} />}
      <div className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-ink/70" style={{ left: `${threshold * 100}%` }} aria-hidden />
    </div>
  );
}
