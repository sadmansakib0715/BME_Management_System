import { clsx } from 'clsx';
import { AlertTriangle, CheckCircle2, CircleDashed, Clock3, Loader2, Lock, X, XCircle } from 'lucide-react';
import { createContext, forwardRef, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

// ---------------------------------------------------------------- Button
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: BtnVariant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode }
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) {
  return (
    <button ref={ref} disabled={disabled || loading} aria-busy={loading || undefined}
      className={clsx('inline-flex items-center justify-center gap-1.5 rounded font-medium whitespace-nowrap cursor-pointer select-none',
        'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-55',
        size === 'sm' ? 'h-8 px-2.5 text-sm min-w-8' : 'h-9 px-3.5 text-sm min-w-9',
        variant === 'primary' && 'bg-brand text-brand-fg hover:bg-brand-ink',
        variant === 'secondary' && 'bg-surface text-ink border border-line-strong hover:bg-sunken',
        variant === 'ghost' && 'text-muted hover:text-ink hover:bg-sunken',
        variant === 'danger' && 'bg-bad text-bad-fg hover:opacity-90', className)} {...rest}>
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

// ---------------------------------------------------------------- Form controls
export function Field({ label, hint, error, children, className, htmlFor }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink">{label}</label>
      {children}
      {error ? <p role="alert" className="text-2xs text-bad flex items-center gap-1"><XCircle className="size-3.5" aria-hidden />{error}</p>
        : hint ? <p className="text-2xs text-subtle">{hint}</p> : null}
    </div>
  );
}
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={clsx('input', className)} {...p} />;
});
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...p }, ref) {
  return <select ref={ref} className={clsx('input pr-7 cursor-pointer', className)} {...p}>{children}</select>;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={clsx('input h-auto min-h-20 py-2', className)} {...p} />;
});

// ---------------------------------------------------------------- Badges (text + icon, never colour alone)
export type Tone = 'neutral' | 'brand' | 'ok' | 'warn' | 'bad' | 'info';
const toneCls: Record<Tone, string> = {
  neutral: 'bg-sunken text-muted border-line', brand: 'bg-brand-soft text-brand-ink border-brand/25', ok: 'bg-ok-soft text-ok border-ok/25',
  warn: 'bg-warn-soft text-warn border-warn/30', bad: 'bg-bad-soft text-bad border-bad/25', info: 'bg-info-soft text-info border-info/25',
};
export function Badge({ tone = 'neutral', children, icon, className }: { tone?: Tone; children: ReactNode; icon?: ReactNode; className?: string }) {
  return <span className={clsx('inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-2xs font-semibold whitespace-nowrap', toneCls[tone], className)}>{icon}{children}</span>;
}
export type StepTone = 'done' | 'active' | 'ready' | 'locked' | 'returned';
export function StatePill({ state, children }: { state: StepTone; children: ReactNode }) {
  const map: Record<StepTone, [Tone, ReactNode]> = {
    done: ['ok', <CheckCircle2 key="i" className="size-3" aria-hidden />], active: ['info', <Clock3 key="i" className="size-3" aria-hidden />],
    ready: ['brand', <CircleDashed key="i" className="size-3" aria-hidden />], locked: ['neutral', <Lock key="i" className="size-3" aria-hidden />],
    returned: ['warn', <AlertTriangle key="i" className="size-3" aria-hidden />],
  };
  const [tone, icon] = map[state];
  return <Badge tone={tone} icon={icon}>{children}</Badge>;
}

// ---------------------------------------------------------------- Layout bits
export function Card({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return <section className={clsx('card', className)} {...rest}>{children}</section>;
}
export function CardHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-2 px-4 pt-3.5 pb-3 border-b border-line">
      <div className="min-w-0"><h2 className="text-sm font-semibold text-ink">{title}</h2>{subtitle && <p className="text-2xs text-subtle mt-0.5">{subtitle}</p>}</div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
export function PageHeader({ title, eyebrow, description, actions }: { title: ReactNode; eyebrow?: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
      <div className="min-w-0">
        {eyebrow && <div className="text-2xs font-semibold uppercase tracking-wider text-subtle mb-1">{eyebrow}</div>}
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="text-sm text-muted mt-1 max-w-3xl">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-2xs font-semibold uppercase tracking-wide text-subtle">{label}</div>
      <div className={clsx('text-2xl font-semibold tabular mt-1', tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : tone === 'ok' ? 'text-ok' : 'text-ink')}>{value}</div>
      {sub && <div className="text-2xs text-subtle mt-0.5">{sub}</div>}
    </div>
  );
}
export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center px-6 py-10">
      {icon && <div className="text-subtle mb-2" aria-hidden>{icon}</div>}
      <p className="text-sm font-semibold text-ink">{title}</p>
      {children && <p className="text-sm text-muted mt-1 max-w-md">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <div role="status" className="flex items-center gap-2 text-sm text-muted p-6"><Loader2 className="size-4 animate-spin" aria-hidden />{label}…</div>;
}
export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return <div role="alert" className="flex items-start gap-2 rounded border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad"><XCircle className="size-4 mt-0.5 shrink-0" aria-hidden />{(error as Error).message ?? String(error)}</div>;
}
export function Callout({ tone = 'info', title, children }: { tone?: Tone; title?: string; children: ReactNode }) {
  return (
    <div className={clsx('rounded border px-3 py-2.5 text-sm', toneCls[tone])}>
      {title && <p className="font-semibold mb-0.5">{title}</p>}<div className="text-ink/85">{children}</div>
    </div>
  );
}
export function Meter({ value, max = 100, label }: { value: number; max?: number; label: string }) {
  const w = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label} className="h-1.5 w-full rounded-full bg-sunken overflow-hidden">
      <div className="h-full bg-brand transition-[width] duration-300" style={{ width: `${w}%` }} />
    </div>
  );
}

// ---------------------------------------------------------------- Dialog (native, focus-trapped by the browser)
export function Dialog({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }, [open]);
  return (
    <dialog ref={ref} aria-labelledby={id} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}
      className={clsx('rounded-lg border border-line bg-surface text-ink shadow-pop p-0 backdrop:bg-hero/50 backdrop:backdrop-blur-[2px] w-[calc(100%-2rem)]', wide ? 'max-w-3xl' : 'max-w-lg')}>
      {open && <>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
          <h2 id={id} className="text-base font-semibold">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close dialog"><X className="size-4" aria-hidden /></Button>
        </div>
        <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">{children}</div>
        {footer && <div className="flex justify-end gap-2 px-5 py-3 border-t border-line bg-sunken/40">{footer}</div>}
      </>}
    </dialog>
  );
}

// ---------------------------------------------------------------- Toasts
interface ToastMsg { id: number; tone: 'ok' | 'bad'; text: string }
const ToastCtx = createContext<(tone: 'ok' | 'bad', text: string) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<ToastMsg[]>([]);
  const push = useCallback((tone: 'ok' | 'bad', text: string) => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { id, tone, text }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), tone === 'bad' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed z-50 bottom-4 right-4 left-4 sm:left-auto flex flex-col gap-2 items-end pointer-events-none" role="status" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className={clsx('pointer-events-auto max-w-sm w-full sm:w-auto flex items-start gap-2 rounded-lg border px-3.5 py-2.5 text-sm shadow-pop bg-surface',
            t.tone === 'ok' ? 'border-ok/30' : 'border-bad/40')}>
            {t.tone === 'ok' ? <CheckCircle2 className="size-4 text-ok mt-0.5 shrink-0" aria-hidden /> : <XCircle className="size-4 text-bad mt-0.5 shrink-0" aria-hidden />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------------------------------------------------------------- Tabs (link-based for deep linking)
export function SegTabs<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label: string }) {
  // Sliding thumb: measured from the selected tab so labels of any width work.
  const wrap = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const el = wrap.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (el) setThumb({ x: el.offsetLeft, w: el.offsetWidth });
  }, [value, options.length]);
  return (
    <div ref={wrap} role="tablist" aria-label={label} className="relative inline-flex rounded border border-line bg-sunken p-0.5">
      {thumb && <span aria-hidden className="absolute top-0.5 bottom-0.5 left-0 rounded bg-surface shadow-card transition-[transform,width] duration-300 ease-[cubic-bezier(.34,1.56,.64,1)]"
        style={{ width: thumb.w, transform: `translateX(${thumb.x}px)` }} />}
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}
          className={clsx('relative h-7 px-3 rounded text-sm font-medium cursor-pointer transition-colors duration-150',
            value === o.value ? clsx('text-ink', !thumb && 'bg-surface shadow-card') : 'text-muted hover:text-ink')}>{o.label}</button>
      ))}
    </div>
  );
}
