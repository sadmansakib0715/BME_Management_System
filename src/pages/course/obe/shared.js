import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { clsx } from 'clsx';
import { attained } from '@/lib/obe';
/** A set of small on/off chips (taxonomy levels, delivery, tools). Values outside the list (as worded in an imported document) show too. */
export function Chips({ options, value, onChange, disabled, label }) {
    return (_jsx("div", { role: "group", "aria-label": label, className: "flex flex-wrap gap-1", children: [...options, ...value.filter((v) => !options.includes(v))].map((o) => {
            const on = value.includes(o);
            return (_jsx("button", { type: "button", "aria-pressed": on, disabled: disabled, onClick: () => onChange(on ? value.filter((x) => x !== o) : [...value, o]), className: clsx('h-7 px-2 rounded border text-2xs font-medium transition-colors duration-150 cursor-pointer disabled:cursor-default', on ? 'bg-brand-soft border-brand/40 text-brand-ink' : 'bg-surface border-line text-muted hover:text-ink disabled:hover:text-muted'), children: o }, o));
        }) }));
}
/** Y / N / NA in the progress colours; the text always says it. */
export function YesNo({ value, threshold }) {
    const a = attained(value, threshold);
    return _jsx("span", { className: clsx('inline-flex justify-center min-w-8 rounded border px-1.5 py-0.5 text-2xs font-semibold', a === null ? 'prog-n' : a ? 'prog-3' : 'prog-0'), children: a === null ? 'NA' : a ? 'Y' : 'N' });
}
/** A horizontal bar for a percentage with the threshold line drawn on it. */
export function PctBar({ value, threshold = 0.4, label }) {
    const a = attained(value, threshold);
    return (_jsxs("div", { className: "relative h-2.5 w-full rounded-full bg-sunken", role: "img", "aria-label": `${label}: ${value === null ? 'no value' : `${value.toFixed(2)}%`}, threshold ${threshold * 100}%`, children: [value !== null && _jsx("div", { className: clsx('h-full rounded-full', a ? 'bg-ok' : 'bg-bad'), style: { width: `${Math.min(100, value)}%` } }), _jsx("div", { className: "absolute -top-0.5 -bottom-0.5 w-0.5 bg-ink/70", style: { left: `${threshold * 100}%` }, "aria-hidden": true })] }));
}
