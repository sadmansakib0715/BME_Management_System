import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useId } from 'react';
/** Ink-wash illustrations for the guide and sign-in page. Theme tokens only, so they follow light/dark. All decorative (aria-hidden). */
const useSafeId = () => useId().replace(/:/g, '');
/** Layered misty ridges; far ridges are blurred like ink bleeding into wet paper. */
export function InkMountains({ className }) {
    const id = useSafeId();
    return (
    // Top fades out so the ridges dissolve into the background at any crop.
    _jsxs("svg", { className: className, viewBox: "0 0 800 400", preserveAspectRatio: "xMidYMax slice", "aria-hidden": true, style: { maskImage: 'linear-gradient(to bottom, transparent, #000 45%)', WebkitMaskImage: 'linear-gradient(to bottom, transparent, #000 45%)' }, children: [_jsxs("defs", { children: [_jsx("filter", { id: `${id}-bleed`, x: "-10%", y: "-10%", width: "120%", height: "120%", children: _jsx("feGaussianBlur", { stdDeviation: "6" }) }), _jsx("filter", { id: `${id}-soft`, x: "-10%", y: "-10%", width: "120%", height: "120%", children: _jsx("feGaussianBlur", { stdDeviation: "2" }) })] }), _jsx("circle", { cx: "610", cy: "110", r: "54", className: "fill-hero-fg/15", filter: `url(#${id}-soft)` }), _jsx("path", { filter: `url(#${id}-bleed)`, className: "fill-wash/35", d: "M0 250 C60 210 90 160 140 170 C190 180 210 120 260 110 C320 100 340 190 400 180 C450 172 480 120 540 130 C600 140 630 200 690 190 C740 182 770 150 800 160 V400 H0Z" }), _jsx("path", { filter: `url(#${id}-soft)`, className: "fill-mist/25", d: "M0 300 C70 270 110 220 170 235 C230 250 250 200 310 205 C370 210 390 270 450 265 C520 258 540 215 600 222 C660 230 700 280 800 260 V400 H0Z" }), _jsx("path", { className: "fill-wash/55", d: "M0 345 C90 320 140 290 210 300 C280 310 320 340 400 330 C480 320 520 290 600 300 C680 310 730 340 800 330 V400 H0Z" }), _jsx("path", { className: "fill-hero", d: "M0 400 V375 C160 355 260 372 400 365 C540 358 640 378 800 368 V400Z" }), _jsxs("g", { className: "stroke-hero-fg/40", strokeWidth: "1.5", fill: "none", strokeLinecap: "round", children: [_jsx("path", { d: "M520 150 q8 -6 16 0 q8 -6 16 0" }), _jsx("path", { d: "M560 175 q6 -5 12 0 q6 -5 12 0" })] })] }));
}
/** Shared frame: a soft slate wash pooled behind a small paper scene. */
function Scene({ children }) {
    const id = useSafeId();
    return (_jsxs("svg", { viewBox: "0 0 240 140", className: "w-full h-auto", "aria-hidden": true, children: [_jsx("defs", { children: _jsx("filter", { id: `${id}-w`, x: "-20%", y: "-20%", width: "140%", height: "140%", children: _jsx("feGaussianBlur", { stdDeviation: "9" }) }) }), _jsx("ellipse", { cx: "150", cy: "80", rx: "95", ry: "48", className: "fill-wash/20", filter: `url(#${id}-w)` }), _jsx("ellipse", { cx: "70", cy: "50", rx: "50", ry: "26", className: "fill-mist/30", filter: `url(#${id}-w)` }), children] }));
}
const Paper = ({ x, y, w, h }) => _jsx("rect", { x: x, y: y, width: w, height: h, rx: "6", className: "fill-surface stroke-line-strong", strokeWidth: "1" });
const Line = ({ x, y, w, cls = 'fill-line-strong' }) => _jsx("rect", { x: x, y: y, width: w, height: "4", rx: "2", className: cls });
export function IllTasks() {
    const rows = [['fill-brand', 'fill-brand/15', 64], ['fill-wash', 'fill-wash/20', 50], ['fill-wash', 'fill-wash/20', 72]];
    return (_jsxs(Scene, { children: [_jsx(Paper, { x: 40, y: 18, w: 160, h: 104 }), rows.map(([tone, soft, w], i) => (_jsxs("g", { transform: `translate(0 ${i * 30})`, children: [_jsx("circle", { cx: "58", cy: "38", r: "6", className: i === 2 ? 'fill-ok stroke-ok' : 'fill-none stroke-line-strong', strokeWidth: "1.5" }), _jsx(Line, { x: 72, y: 32, w: w, cls: "fill-ink/70" }), _jsx(Line, { x: 72, y: 40, w: w - 20 }), _jsx("rect", { x: "160", y: "32", width: "28", height: "12", rx: "6", className: soft }), _jsx("rect", { x: "166", y: "36", width: "16", height: "4", rx: "2", className: tone })] }, i)))] }));
}
export function IllExamChain() {
    const xs = [30, 62, 94, 126, 158, 190, 222];
    return (_jsxs(Scene, { children: [_jsx("path", { d: `M${xs[0]} 70 H${xs[6]}`, className: "stroke-line-strong", strokeWidth: "2" }), _jsx("path", { d: `M${xs[0]} 70 H${xs[3]}`, className: "stroke-brand", strokeWidth: "3", strokeLinecap: "round" }), xs.map((x, i) => i < 3
                ? _jsxs("g", { children: [_jsx("circle", { cx: x, cy: "70", r: "10", className: "fill-brand" }), _jsx("path", { d: `M${x - 4} 70 l3 3 l5 -6`, className: "stroke-brand-fg", strokeWidth: "2", fill: "none", strokeLinecap: "round" })] }, x)
                : i === 3
                    ? _jsxs("g", { children: [_jsx("circle", { cx: x, cy: "70", r: "15", className: "fill-wash/25" }), _jsx("circle", { cx: x, cy: "70", r: "10", className: "fill-surface stroke-brand", strokeWidth: "3" })] }, x)
                    : _jsx("circle", { cx: x, cy: "70", r: "9", className: "fill-surface stroke-line-strong", strokeWidth: "1.5", strokeDasharray: "3 3" }, x)), ['QP', 'Mod', 'Print', 'Exam', 'Scrut.', 'GS', 'HOD'].map((t, i) => (_jsx("text", { x: xs[i], y: "100", textAnchor: "middle", className: "fill-subtle", fontSize: "9", fontWeight: "600", children: t }, t))), _jsx("path", { d: "M46 46 q16 -14 32 0", className: "stroke-warn", strokeWidth: "1.5", fill: "none", strokeDasharray: "3 2" }), _jsx("text", { x: "62", y: "34", textAnchor: "middle", className: "fill-warn", fontSize: "8", fontWeight: "600", children: "correction" })] }));
}
export function IllCalendar() {
    return (_jsxs(Scene, { children: [_jsx(Paper, { x: 40, y: 14, w: 160, h: 112 }), _jsx("rect", { x: "40", y: "14", width: "160", height: "18", rx: "6", className: "fill-sunken" }), _jsx(Line, { x: 52, y: 21, w: 44, cls: "fill-ink/60" }), Array.from({ length: 28 }, (_, i) => {
                const x = 48 + (i % 7) * 21.5, y = 40 + Math.floor(i / 7) * 21;
                const ct = i === 3 || i === 9 || i === 22, clash = i === 16;
                return (_jsxs("g", { children: [_jsx("rect", { x: x, y: y, width: "18", height: "17", rx: "3", className: clash ? 'fill-bad-soft stroke-bad' : ct ? 'fill-brand-soft' : 'fill-sunken/60', strokeWidth: "1" }), ct && _jsx("rect", { x: x + 3, y: y + 10, width: "12", height: "3", rx: "1.5", className: "fill-brand" }), clash && _jsx("path", { d: `M${x + 5} ${y + 4} l8 9 m0 -9 l-8 9`, className: "stroke-bad", strokeWidth: "1.8", strokeLinecap: "round" })] }, i));
            })] }));
}
export function IllSetup() {
    return (_jsxs(Scene, { children: [_jsx(Paper, { x: 34, y: 14, w: 172, h: 112 }), [0, 1, 2, 3].map((t) => _jsx("rect", { x: 44 + t * 38, y: "22", width: "32", height: "8", rx: "4", className: t === 1 ? 'fill-brand' : 'fill-sunken' }, t)), [0, 1, 2, 3].map((r) => (_jsxs("g", { transform: `translate(0 ${r * 20})`, children: [_jsx("circle", { cx: "54", cy: "50", r: "6", className: r < 3 ? 'fill-wash' : 'fill-none stroke-line-strong', strokeWidth: "1.5" }), r < 3 && _jsx("path", { d: "M51 50 l2 2 l4 -4", className: "stroke-surface", strokeWidth: "1.6", fill: "none", strokeLinecap: "round" }), _jsx("rect", { x: "68", y: "47", width: [70, 52, 84, 60][r], height: "5", rx: "2.5", className: "fill-ink/60" }), _jsx("rect", { x: "170", y: "45", width: "24", height: "10", rx: "5", className: r < 3 ? 'fill-brand/80' : 'fill-sunken' })] }, r)))] }));
}
export function IllOutcomes() {
    const dots = [[3, 0, 1, 2], [0, 2, 3, 0], [1, 0, 2, 3]];
    const bars = [62, 78, 48, 70];
    return (_jsxs(Scene, { children: [_jsx(Paper, { x: 20, y: 20, w: 96, h: 100 }), dots.map((row, r) => row.map((v, c) => v > 0 && (_jsx("circle", { cx: 40 + c * 20, cy: 46 + r * 26, r: 2 + v * 2.2, className: "fill-brand", opacity: 0.35 + v * 0.2 }, `${r}${c}`)))), _jsx(Paper, { x: 126, y: 20, w: 96, h: 100 }), bars.map((h, i) => (_jsx("rect", { x: 138 + i * 20, y: 108 - h, width: "12", height: h, rx: "2", className: h >= 60 ? 'fill-wash' : 'fill-mist' }, i))), _jsx("path", { d: "M132 48 H216", className: "stroke-ink/70", strokeWidth: "1.2", strokeDasharray: "4 3" })] }));
}
export function IllDepartment() {
    const r = 26, c = 2 * Math.PI * r;
    return (_jsxs(Scene, { children: [_jsx(Paper, { x: 20, y: 18, w: 200, h: 104 }), [150, 120, 92, 64].map((w, i) => (_jsx("rect", { x: 34 + (150 - w) / 2, y: 32 + i * 20, width: w, height: "14", rx: "3", className: i === 3 ? 'fill-brand' : 'fill-wash', opacity: 1 - i * 0.18 }, w))), _jsx("circle", { cx: "190", cy: "70", r: r, className: "fill-none stroke-line", strokeWidth: "9" }), _jsx("circle", { cx: "190", cy: "70", r: r, className: "fill-none stroke-brand", strokeWidth: "9", strokeDasharray: `${c * 0.68} ${c}`, transform: "rotate(-90 190 70)", strokeLinecap: "round" })] }));
}
export function IllImport() {
    return (_jsxs(Scene, { children: [_jsxs("g", { transform: "translate(18 26)", children: [_jsx("rect", { width: "74", height: "88", rx: "5", className: "fill-surface stroke-line-strong" }), [0, 1, 2, 3, 4].map((r) => [0, 1, 2].map((c) => _jsx("rect", { x: 8 + c * 21, y: 10 + r * 15, width: "18", height: "9", rx: "1.5", className: r === 0 ? 'fill-ok/50' : 'fill-sunken' }, `${r}${c}`)))] }), _jsx("path", { d: "M100 70 H138", className: "stroke-wash", strokeWidth: "3", strokeLinecap: "round" }), _jsx("path", { d: "M131 62 l9 8 l-9 8", className: "stroke-wash", strokeWidth: "3", fill: "none", strokeLinecap: "round", strokeLinejoin: "round" }), _jsx("g", { transform: "translate(148 26)", children: [0, 1, 2].map((i) => (_jsxs("g", { transform: `translate(0 ${i * 30})`, children: [_jsx("rect", { width: "74", height: "24", rx: "5", className: "fill-surface stroke-line-strong" }), _jsx("circle", { cx: "12", cy: "12", r: "5", className: i === 1 ? 'fill-warn' : 'fill-ok' }), _jsx("rect", { x: "22", y: "10", width: i === 1 ? 30 : 42, height: "4", rx: "2", className: "fill-ink/60" })] }, i))) })] }));
}
export function IllPlan() {
    const parts = [['CT', 'fill-wash', 40], ['Term final', 'fill-brand', 90], ['Lab', 'fill-mist', 30], ['Viva', 'fill-ok/70', 20]];
    let x = 30;
    return (_jsxs(Scene, { children: [_jsx(Paper, { x: 20, y: 22, w: 200, h: 96 }), parts.map(([t, cls, w]) => {
                const at = x;
                x += w * 0.95;
                return (_jsxs("g", { children: [_jsx("rect", { x: at, y: "40", width: w * 0.95 - 2, height: "22", rx: "3", className: cls }), _jsx("text", { x: at + (w * 0.95 - 2) / 2, y: "76", textAnchor: "middle", fontSize: "8", fontWeight: "600", className: "fill-subtle", children: t })] }, t));
            }), [0, 1, 2, 3].map((i) => _jsx("rect", { x: 36 + i * 16, y: "90", width: "12", height: "14", rx: "2", className: i === 2 ? 'fill-none stroke-line-strong' : 'fill-wash/60', strokeDasharray: i === 2 ? '2 2' : undefined }, i)), _jsx("text", { x: "104", y: "101", fontSize: "8", fontWeight: "600", className: "fill-subtle", children: "best 3 of 4" })] }));
}
/** Progress tree: a maroon course root, stage branches in their own hues, steps filled by state, one date glowing "to be set later". */
export function IllTree() {
    const c = (v, a = 1) => `rgb(var(--${v}) / ${a})`;
    const stages = [
        { y: 26, tone: 'tone-setup', leaves: [{ state: 'ok' }, { state: 'ok' }] },
        { y: 60, tone: 'tone-assess', leaves: [{ state: 'info' }, { state: 'later' }] },
        { y: 94, tone: 'tone-exam', leaves: [{ state: 'ready' }] },
        { y: 120, tone: 'tone-obe', leaves: [{ state: 'ready' }] },
    ];
    const leafFill = { ok: c('ok-soft'), info: c('info-soft'), later: c('later', 0.12), ready: c('surface') };
    const leafStroke = { ok: c('ok', 0.6), info: c('info', 0.6), later: c('later'), ready: c('line-strong') };
    return (_jsxs(Scene, { children: [stages.map((s) => _jsx("path", { d: `M64 70 H76 V${s.y} H92`, fill: "none", strokeWidth: "1.5", style: { stroke: c(s.tone, 0.6) } }, s.y)), _jsx("rect", { x: "14", y: "60", width: "50", height: "20", rx: "5", style: { fill: c('root-a') } }), _jsx("rect", { x: "22", y: "68", width: "30", height: "4", rx: "2", className: "fill-surface" }), stages.map((s) => (_jsxs("g", { children: [_jsx("rect", { x: "92", y: s.y - 8, width: "50", height: "16", rx: "4", strokeWidth: "1", style: { fill: c(`${s.tone}-soft`), stroke: c(s.tone, 0.5) } }), _jsx("rect", { x: "100", y: s.y - 2, width: "30", height: "4", rx: "2", style: { fill: c(s.tone) } }), s.leaves.map((l, i) => {
                        const ly = s.leaves.length === 1 ? s.y : s.y - 8 + i * 16;
                        return (_jsxs("g", { children: [_jsx("path", { d: `M142 ${s.y} H150 V${ly} H160`, fill: "none", strokeWidth: "1.2", style: { stroke: c(s.tone, 0.5) } }), l.state === 'later' && _jsx("rect", { x: "156", y: ly - 10, width: "66", height: "20", rx: "7", style: { fill: c('later', 0.18) } }), _jsx("rect", { x: "160", y: ly - 6, width: "58", height: "12", rx: "3", strokeWidth: l.state === 'later' ? 1.6 : 1, style: { fill: leafFill[l.state], stroke: leafStroke[l.state] } }), _jsx("circle", { cx: "168", cy: ly, r: "2.5", style: { fill: l.state === 'ready' ? 'none' : leafStroke[l.state], stroke: leafStroke[l.state] } }), _jsx("rect", { x: "175", y: ly - 1.5, width: "34", height: "3", rx: "1.5", style: { fill: l.state === 'later' ? c('later') : c('ink', 0.55) } })] }, i));
                    })] }, s.y)))] }));
}
