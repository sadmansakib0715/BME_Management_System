import { clsx } from 'clsx';
import { ArrowRight, Hourglass } from 'lucide-react';
import { Link } from 'react-router-dom';
import { fmtDate, relDays, daysUntil } from '@/lib/format';
import type { Task } from '@/lib/tasks';
import type { CourseType } from '@/lib/types';
import { Badge } from './ui';

export function TypeBadge({ type }: { type: CourseType }) {
  const label = { theory: 'Theory', sessional: 'Sessional', design: 'Design', thesis: 'Thesis', attachment: 'Attachment' }[type];
  return <Badge tone={type === 'theory' ? 'info' : 'brand'}>{label}</Badge>;
}

export function DueLabel({ date, done }: { date: string | null; done?: boolean }) {
  const n = daysUntil(date);
  const tone = done || n === null ? 'text-subtle' : n < 0 ? 'text-bad font-semibold' : n <= 3 ? 'text-warn font-semibold' : 'text-muted';
  return <span className={clsx('text-2xs tabular whitespace-nowrap', tone)} title={date ?? undefined}>{date ? `${fmtDate(date)} · ${relDays(date)}` : 'No date'}</span>;
}

export function TaskRow({ t }: { t: Task }) {
  return (
    <li>
      <Link to={t.href} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-sunken/60 transition-colors duration-150 cursor-pointer">
        <span className="font-mono text-2xs text-muted w-14 sm:w-16 shrink-0">{t.code}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium truncate">{t.title}</span>
          <span className="block text-2xs text-subtle truncate">
            {t.waitingOn ? <><Hourglass className="inline size-3 mr-1 -mt-0.5" aria-hidden />Waiting on {t.waitingOn}</> : t.detail}
          </span>
          <span className="block sm:hidden mt-0.5"><DueLabel date={t.due} /></span>
        </span>
        <span className="hidden sm:inline"><DueLabel date={t.due} /></span>
        <ArrowRight className="size-4 text-subtle opacity-0 group-hover:opacity-100 transition-opacity duration-150" aria-hidden />
      </Link>
    </li>
  );
}
