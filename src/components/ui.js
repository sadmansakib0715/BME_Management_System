import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { clsx } from 'clsx';
import { AlertTriangle, CheckCircle2, CircleDashed, Clock3, Loader2, Lock, X, XCircle } from 'lucide-react';
import { labelOf, progressTone } from '@/lib/workflow';
import { createContext, forwardRef, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
export const Button = forwardRef(function Button({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) {
    return (_jsxs("button", { ref: ref, disabled: disabled || loading, "aria-busy": loading || undefined, className: clsx('inline-flex items-center justify-center gap-1.5 rounded font-medium whitespace-nowrap cursor-pointer select-none', 'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-55', size === 'sm' ? 'h-8 px-2.5 text-sm min-w-8' : 'h-9 px-3.5 text-sm min-w-9', variant === 'primary' && 'bg-brand text-brand-fg hover:bg-brand-ink', variant === 'secondary' && 'bg-surface text-ink border border-line-strong hover:bg-sunken', variant === 'ghost' && 'text-muted hover:text-ink hover:bg-sunken', variant === 'danger' && 'bg-bad text-bad-fg hover:opacity-90', className), ...rest, children: [loading ? _jsx(Loader2, { className: "size-4 animate-spin", "aria-hidden": true }) : icon, children] }));
});
// ---------------------------------------------------------------- Form controls
export function Field({ label, hint, error, children, className, htmlFor }) {
    return (_jsxs("div", { className: clsx('flex flex-col gap-1', className), children: [_jsx("label", { htmlFor: htmlFor, className: "text-sm font-medium text-ink", children: label }), children, error ? _jsxs("p", { role: "alert", className: "text-2xs text-bad flex items-center gap-1", children: [_jsx(XCircle, { className: "size-3.5", "aria-hidden": true }), error] })
                : hint ? _jsx("p", { className: "text-2xs text-subtle", children: hint }) : null] }));
}
export const Input = forwardRef(function Input({ className, ...p }, ref) {
    return _jsx("input", { ref: ref, className: clsx('input', className), ...p });
});
export const Select = forwardRef(function Select({ className, children, ...p }, ref) {
    return _jsx("select", { ref: ref, className: clsx('input pr-7 cursor-pointer', className), ...p, children: children });
});
export const Textarea = forwardRef(function Textarea({ className, ...p }, ref) {
    return _jsx("textarea", { ref: ref, className: clsx('input h-auto min-h-20 py-2', className), ...p });
});
const toneCls = {
    neutral: 'bg-sunken text-muted border-line', brand: 'bg-brand-soft text-brand-ink border-brand/25', ok: 'bg-ok-soft text-ok border-ok/25',
    warn: 'bg-warn-soft text-warn border-warn/30', bad: 'bg-bad-soft text-bad border-bad/25', info: 'bg-info-soft text-info border-info/25',
};
export function Badge({ tone = 'neutral', children, icon, className }) {
    return _jsxs("span", { className: clsx('inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-2xs font-semibold whitespace-nowrap', toneCls[tone], className), children: [icon, children] });
}
/** Status as a coloured select: mild red at the first step through green when done. */
export function StatusSelect({ opts, scale = opts, done, value, className, ...p }) {
    return (_jsx("select", { className: clsx('input pr-7 cursor-pointer font-medium', `prog-${progressTone(scale, value, done)}`, className), value: value, ...p, children: opts.map((o) => _jsx("option", { value: o.value, children: o.label }, o.value)) }));
}
/** Read-only status in the same colours. */
export function StatusBadge({ opts, done, value, icon }) {
    return _jsxs("span", { className: clsx('inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-2xs font-semibold whitespace-nowrap', `prog-${progressTone(opts, value, done)}`), children: [icon, labelOf(opts, value)] });
}
export function StatePill({ state, children }) {
    const map = {
        done: ['ok', _jsx(CheckCircle2, { className: "size-3", "aria-hidden": true }, "i")], active: ['info', _jsx(Clock3, { className: "size-3", "aria-hidden": true }, "i")],
        ready: ['brand', _jsx(CircleDashed, { className: "size-3", "aria-hidden": true }, "i")], locked: ['neutral', _jsx(Lock, { className: "size-3", "aria-hidden": true }, "i")],
        returned: ['warn', _jsx(AlertTriangle, { className: "size-3", "aria-hidden": true }, "i")],
    };
    const [tone, icon] = map[state];
    return _jsx(Badge, { tone: tone, icon: icon, children: children });
}
// ---------------------------------------------------------------- Layout bits
export function Card({ children, className, ...rest }) {
    return _jsx("section", { className: clsx('card', className), ...rest, children: children });
}
export function CardHeader({ title, subtitle, actions }) {
    return (_jsxs("header", { className: "flex flex-wrap items-start justify-between gap-2 px-4 pt-3.5 pb-3 border-b border-line", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("h2", { className: "text-sm font-semibold text-ink", children: title }), subtitle && _jsx("p", { className: "text-2xs text-subtle mt-0.5", children: subtitle })] }), actions && _jsx("div", { className: "flex items-center gap-2", children: actions })] }));
}
export function PageHeader({ title, eyebrow, description, actions }) {
    return (_jsxs("div", { className: "flex flex-wrap items-end justify-between gap-3 mb-5", children: [_jsxs("div", { className: "min-w-0", children: [eyebrow && _jsx("div", { className: "text-2xs font-semibold uppercase tracking-wider text-subtle mb-1", children: eyebrow }), _jsx("h1", { className: "text-xl font-semibold tracking-tight text-ink", children: title }), description && _jsx("p", { className: "text-sm text-muted mt-1 max-w-3xl", children: description })] }), actions && _jsx("div", { className: "flex flex-wrap items-center gap-2", children: actions })] }));
}
export function Stat({ label, value, sub, tone }) {
    return (_jsxs("div", { className: "card px-4 py-3", children: [_jsx("div", { className: "text-2xs font-semibold uppercase tracking-wide text-subtle", children: label }), _jsx("div", { className: clsx('text-2xl font-semibold tabular mt-1', tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : tone === 'ok' ? 'text-ok' : 'text-ink'), children: value }), sub && _jsx("div", { className: "text-2xs text-subtle mt-0.5", children: sub })] }));
}
export function Empty({ icon, title, children, action }) {
    return (_jsxs("div", { className: "flex flex-col items-center text-center px-6 py-10", children: [icon && _jsx("div", { className: "text-subtle mb-2", "aria-hidden": true, children: icon }), _jsx("p", { className: "text-sm font-semibold text-ink", children: title }), children && _jsx("p", { className: "text-sm text-muted mt-1 max-w-md", children: children }), action && _jsx("div", { className: "mt-4", children: action })] }));
}
export function Spinner({ label = 'Loading' }) {
    return _jsxs("div", { role: "status", className: "flex items-center gap-2 text-sm text-muted p-6", children: [_jsx(Loader2, { className: "size-4 animate-spin", "aria-hidden": true }), label, "\u2026"] });
}
export function ErrorNote({ error }) {
    if (!error)
        return null;
    return _jsxs("div", { role: "alert", className: "flex items-start gap-2 rounded border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad", children: [_jsx(XCircle, { className: "size-4 mt-0.5 shrink-0", "aria-hidden": true }), error.message ?? String(error)] });
}
export function Callout({ tone = 'info', title, children }) {
    return (_jsxs("div", { className: clsx('rounded border px-3 py-2.5 text-sm', toneCls[tone]), children: [title && _jsx("p", { className: "font-semibold mb-0.5", children: title }), _jsx("div", { className: "text-ink/85", children: children })] }));
}
export function Meter({ value, max = 100, label }) {
    const w = Math.max(0, Math.min(100, (value / max) * 100));
    return (_jsx("div", { role: "meter", "aria-valuenow": value, "aria-valuemin": 0, "aria-valuemax": max, "aria-label": label, className: "h-1.5 w-full rounded-full bg-sunken overflow-hidden", children: _jsx("div", { className: "h-full bg-brand transition-[width] duration-300", style: { width: `${w}%` } }) }));
}
// ---------------------------------------------------------------- Dialog (native, focus-trapped by the browser)
export function Dialog({ open, onClose, title, children, footer, wide }) {
    const ref = useRef(null);
    const id = useId();
    useEffect(() => { const d = ref.current; if (!d)
        return; if (open && !d.open)
        d.showModal(); if (!open && d.open)
        d.close(); }, [open]);
    return (_jsx("dialog", { ref: ref, "aria-labelledby": id, onClose: onClose, onCancel: (e) => { e.preventDefault(); onClose(); }, className: clsx('rounded-lg border border-line bg-surface text-ink shadow-pop p-0 backdrop:bg-hero/50 backdrop:backdrop-blur-[2px] w-[calc(100%-2rem)]', wide ? 'max-w-3xl' : 'max-w-lg'), children: open && _jsxs(_Fragment, { children: [_jsxs("div", { className: "flex items-center justify-between px-5 py-3.5 border-b border-line", children: [_jsx("h2", { id: id, className: "text-base font-semibold", children: title }), _jsx(Button, { variant: "ghost", size: "sm", onClick: onClose, "aria-label": "Close dialog", children: _jsx(X, { className: "size-4", "aria-hidden": true }) })] }), _jsx("div", { className: "px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto", children: children }), footer && _jsx("div", { className: "flex justify-end gap-2 px-5 py-3 border-t border-line bg-sunken/40", children: footer })] }) }));
}
const ToastCtx = createContext(() => { });
export function ToastProvider({ children }) {
    const [list, setList] = useState([]);
    const push = useCallback((tone, text) => {
        const id = Date.now() + Math.random();
        setList((l) => [...l, { id, tone, text }]);
        setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), tone === 'bad' ? 7000 : 3500);
    }, []);
    return (_jsxs(ToastCtx.Provider, { value: push, children: [children, _jsx("div", { className: "fixed z-50 bottom-4 right-4 left-4 sm:left-auto flex flex-col gap-2 items-end pointer-events-none", role: "status", "aria-live": "polite", children: list.map((t) => (_jsxs("div", { className: clsx('pointer-events-auto max-w-sm w-full sm:w-auto flex items-start gap-2 rounded-lg border px-3.5 py-2.5 text-sm shadow-pop bg-surface', t.tone === 'ok' ? 'border-ok/30' : 'border-bad/40'), children: [t.tone === 'ok' ? _jsx(CheckCircle2, { className: "size-4 text-ok mt-0.5 shrink-0", "aria-hidden": true }) : _jsx(XCircle, { className: "size-4 text-bad mt-0.5 shrink-0", "aria-hidden": true }), _jsx("span", { children: t.text })] }, t.id))) })] }));
}
export const useToast = () => useContext(ToastCtx);
// ---------------------------------------------------------------- Tabs (link-based for deep linking)
export function SegTabs({ value, onChange, options, label }) {
    // Sliding thumb: measured from the selected tab so labels of any width work.
    const wrap = useRef(null);
    const [thumb, setThumb] = useState(null);
    useLayoutEffect(() => {
        const el = wrap.current?.querySelector('[aria-selected="true"]');
        if (el)
            setThumb({ x: el.offsetLeft, w: el.offsetWidth });
    }, [value, options.length]);
    return (_jsxs("div", { ref: wrap, role: "tablist", "aria-label": label, className: "relative inline-flex rounded border border-line bg-sunken p-0.5", children: [thumb && _jsx("span", { "aria-hidden": true, className: "absolute top-0.5 bottom-0.5 left-0 rounded bg-surface shadow-card transition-[transform,width] duration-300 ease-[cubic-bezier(.34,1.56,.64,1)]", style: { width: thumb.w, transform: `translateX(${thumb.x}px)` } }), options.map((o) => (_jsx("button", { role: "tab", "aria-selected": value === o.value, onClick: () => onChange(o.value), className: clsx('relative h-7 px-3 rounded text-sm font-medium cursor-pointer transition-colors duration-150', value === o.value ? clsx('text-ink', !thumb && 'bg-surface shadow-card') : 'text-muted hover:text-ink'), children: o.label }, o.value)))] }));
}
