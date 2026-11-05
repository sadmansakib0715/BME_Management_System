import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { clsx } from 'clsx';
/** Term progress: completed weeks filled, the current week outlined. */
export function WeekTracker({ term }) {
    const n = term.total_weeks, done = term.latest_completed_week;
    const paused = term.calendar_status === 'paused';
    return (_jsxs("div", { className: "card px-4 py-3", children: [_jsxs("div", { className: "flex flex-wrap items-baseline justify-between gap-2 mb-2", children: [_jsx("div", { className: "text-sm font-semibold", children: paused ? 'Classes paused' : done >= n ? 'Teaching weeks complete' : `Week ${done + 1} of ${n}` }), _jsx("div", { className: "text-2xs text-subtle", children: paused ? term.pause_reason || 'Paused by the department' : `${done} of ${n} weeks completed` })] }), _jsx("ol", { className: "grid gap-1", style: { gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }, "aria-label": `${done} of ${n} weeks completed`, children: Array.from({ length: n }, (_, i) => (_jsx("li", { title: `Week ${i + 1}`, className: clsx('h-2 rounded-sm', i < done ? 'bg-brand' : i === done && !paused ? 'bg-brand/25 ring-1 ring-brand' : 'bg-sunken', paused && i < done && 'opacity-60'), children: _jsxs("span", { className: "sr-only", children: ["Week ", i + 1, ": ", i < done ? 'completed' : i === done ? 'current' : 'upcoming'] }) }, i))) })] }));
}
