import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { clsx } from 'clsx';
import { CalendarDays, Check, ChevronRight, ExternalLink, Loader2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { fmtDate } from '@/lib/format';
import { nextActions } from '@/lib/progressTree';
const STATE_TEXT = {
    done: 'Done', active: 'In progress', returned: 'Needs a fix', ready: 'Ready to start', locked: 'Waiting', na: 'Not used',
};
// Class names are written out in full so Tailwind keeps them in the build.
const DOT = {
    done: 'ptree-dot ptree-dot-done', active: 'ptree-dot ptree-dot-active', returned: 'ptree-dot ptree-dot-returned',
    ready: 'ptree-dot ptree-dot-ready', locked: 'ptree-dot ptree-dot-locked', na: 'ptree-dot ptree-dot-na',
};
const STEP = {
    done: 'ptree-s-done', active: 'ptree-s-active', returned: 'ptree-s-returned', ready: 'ptree-s-ready', locked: 'ptree-s-locked', na: 'ptree-s-na',
};
const FILL = {
    done: 'ptree-fill-done', active: 'ptree-fill-active', returned: 'ptree-fill-returned', ready: 'ptree-fill-ready', locked: 'ptree-fill-locked',
};
const TONE = {
    setup: 'tone-setup', assess: 'tone-assess', exam: 'tone-exam', results: 'tone-results', obe: 'tone-obe', close: 'tone-close', group: 'tone-group', course: 'tone-course',
};
/** Dot per state. Shape differs as well as colour, so the tree reads without colour. */
function Dot({ state }) {
    return _jsx("span", { "aria-hidden": true, className: DOT[state] });
}
/** Leaf counts per state, for the header bar. */
function countLeaves(n, out = {}) {
    if (!n.children)
        out[n.state] = (out[n.state] ?? 0) + 1;
    else
        n.children.forEach((c) => countLeaves(c, out));
    return out;
}
// ---------------------------------------------------------------- dropdown
function StatusMenu({ node, anchor, onClose, onPick, canEdit, onSetDate }) {
    const ref = useRef(null);
    const [pos, setPos] = useState({ top: -9999, left: -9999 });
    const [busy, setBusy] = useState(null);
    const locked = node.state === 'locked';
    // Sit under the step, flip above it near the bottom edge, stay inside the window.
    useLayoutEffect(() => {
        const a = anchor.getBoundingClientRect(), m = ref.current.getBoundingClientRect();
        const below = a.bottom + 6 + m.height < window.innerHeight;
        setPos({ top: below ? a.bottom + 6 : Math.max(8, a.top - 6 - m.height), left: Math.min(Math.max(8, a.left), window.innerWidth - m.width - 8) });
        ref.current.querySelector('[role^="menuitem"]:not([aria-disabled="true"])')?.focus();
    }, [anchor]);
    useEffect(() => {
        const out = (e) => { if (!ref.current?.contains(e.target) && !anchor.contains(e.target))
            onClose(); };
        const away = () => onClose();
        document.addEventListener('mousedown', out);
        window.addEventListener('resize', away);
        window.addEventListener('scroll', away, true);
        return () => { document.removeEventListener('mousedown', out); window.removeEventListener('resize', away); window.removeEventListener('scroll', away, true); };
    }, [anchor, onClose]);
    const keys = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
            anchor.focus();
            return;
        }
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')
            return;
        e.preventDefault();
        const all = [...ref.current.querySelectorAll('[role^="menuitem"]')];
        const i = all.indexOf(document.activeElement);
        all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
    };
    const dated = node.dated && onSetDate && node.edits?.some((g) => canEdit(g.target)) ? node.dated : null;
    const setDate = () => { onClose(); onSetDate(dated.itemId); };
    const pick = async (target, value) => {
        // A scheduled test needs a date: open the date picker, which marks it scheduled when saved.
        if (dated && !dated.date && target.kind === 'item' && target.field === 'status' && value === 'scheduled')
            return setDate();
        const key = JSON.stringify(target) + value;
        setBusy(key);
        try {
            await onPick(target, value);
            onClose();
            anchor.focus();
        }
        catch { /* caller reports */ }
        finally {
            setBusy(null);
        }
    };
    return createPortal(_jsxs("div", { ref: ref, role: "menu", "aria-label": `${node.label} status`, onKeyDown: keys, style: { top: pos.top, left: pos.left }, className: "fixed z-50 w-64 rounded-lg border border-line bg-surface shadow-pop py-1.5 text-sm", children: [_jsxs("div", { className: "px-3 pt-1 pb-2 border-b border-line", children: [_jsx("div", { className: "font-semibold truncate", children: node.label }), _jsxs("div", { className: "flex items-center gap-1.5 text-2xs text-muted mt-0.5", children: [_jsx(Dot, { state: node.state }), STATE_TEXT[node.state], node.hint && node.hint !== STATE_TEXT[node.state] ? `, ${node.hint}` : ''] }), locked && node.waitingOn && _jsxs("div", { className: "text-2xs text-subtle mt-1", children: ["Opens when ", node.waitingOn, " ", node.waitingOn.includes(',') ? 'are' : 'is', " done."] })] }), dated && !locked && (_jsxs("button", { type: "button", role: "menuitem", onClick: setDate, className: "mx-2 mt-2 flex w-[calc(100%-1rem)] items-center gap-2 rounded-md border border-brand/40 bg-brand-soft px-2.5 py-1.5 text-left font-semibold text-brand-ink hover:border-brand focus:border-brand focus:outline-none cursor-pointer", children: [_jsx(CalendarDays, { className: "size-4", "aria-hidden": true }), _jsx("span", { className: "flex-1", children: dated.date ? 'Change the date' : 'Set the date' }), dated.later && _jsx("span", { className: "date-later px-1 text-2xs", children: "later" }), dated.date && _jsx("span", { className: "text-2xs font-medium", children: fmtDate(dated.date, { weekday: 'short', day: 'numeric', month: 'short' }) })] })), node.edits?.length ? node.edits.map((g) => {
                const allowed = canEdit(g.target) && !locked;
                return (_jsxs("div", { role: "group", "aria-label": g.label, className: "pt-1.5", children: [node.edits.length > 1 && _jsx("div", { className: "px-3 pb-0.5 text-2xs text-subtle", children: g.label }), g.options.map((o) => {
                            const current = o.value === g.value;
                            const elsewhere = g.elsewhere?.includes(o.value);
                            const key = JSON.stringify(g.target) + o.value;
                            if (elsewhere && node.to)
                                return (_jsxs(Link, { role: "menuitem", to: node.to, onClick: onClose, className: "flex w-full items-center gap-2 px-3 py-1.5 text-left text-muted hover:bg-sunken focus:bg-sunken focus:outline-none", children: [_jsx("span", { className: "size-3.5" }), _jsx("span", { className: "flex-1", children: o.label }), _jsxs("span", { className: "text-2xs text-subtle", children: ["on ", node.toLabel] })] }, o.value));
                            return (_jsxs("button", { type: "button", role: "menuitemradio", "aria-checked": current, "aria-disabled": !allowed || current, onClick: () => allowed && !current && !busy && pick(g.target, o.value), className: clsx('flex w-full items-center gap-2 px-3 py-1.5 text-left focus:outline-none', allowed && !current ? 'hover:bg-sunken focus:bg-sunken cursor-pointer' : 'cursor-default focus:bg-sunken', !allowed && !current && 'text-subtle', current && 'font-medium'), children: [busy === key ? _jsx(Loader2, { className: "size-3.5 animate-spin", "aria-hidden": true }) : _jsx(Check, { "aria-hidden": true, className: clsx('size-3.5', current ? 'text-ok' : 'invisible') }), _jsx("span", { className: "flex-1", children: o.label })] }, o.value));
                        })] }, JSON.stringify(g.target)));
            }) : _jsxs("p", { className: "px-3 pt-2 text-2xs text-muted", children: ["This step follows what is entered on the ", node.toLabel ?? 'course', " page."] }), node.edits?.some((g) => !canEdit(g.target)) && _jsx("p", { className: "px-3 pt-1.5 text-2xs text-subtle", children: "Only the person responsible or an admin can change this." }), node.to && _jsx("div", { className: "mt-1.5 pt-1.5 border-t border-line", children: _jsxs(Link, { role: "menuitem", to: node.to, onClick: onClose, className: "flex items-center gap-2 px-3 py-1.5 text-muted hover:bg-sunken hover:text-ink focus:bg-sunken focus:outline-none", children: [_jsx(ExternalLink, { className: "size-3.5", "aria-hidden": true }), "Open ", node.toLabel ?? 'page'] }) })] }), document.body);
}
function NodeChip({ n, isRoot, open, ctx }) {
    const parent = !!n.children;
    const showHint = !parent && (n.state === 'active' || n.state === 'returned' || n.dated?.later) && n.hint;
    const pct = n.total ? Math.round((n.done / n.total) * 100) : 0;
    const cls = clsx('ptree-node', isRoot ? 'ptree-root' : parent ? (n.tone === 'course' ? 'ptree-course' : 'ptree-branch') : STEP[n.state], n.id === ctx.nextId && 'ptree-next', ctx.menuId === n.id && 'ptree-node-open', n.dated?.later && 'ptree-later');
    const body = (_jsxs(_Fragment, { children: [_jsx(Dot, { state: n.state }), _jsxs("span", { className: "min-w-0 flex-1", children: [_jsx("span", { className: "block truncate", children: n.label }), (isRoot || showHint) && n.hint && _jsx("span", { className: "ptree-sub", children: n.hint }), parent && !isRoot && _jsx("span", { className: "ptree-bar", "aria-hidden": true, children: _jsx("span", { style: { width: `${pct}%` } }) })] }), parent && !isRoot && _jsxs("span", { className: "ptree-count ml-1", children: [n.done, "/", n.total] }), parent && !isRoot && _jsx(ChevronRight, { "aria-hidden": true, className: clsx('size-3.5 opacity-60 transition-transform duration-150', open && 'rotate-180') })] }));
    const title = `${n.label}: ${STATE_TEXT[n.state]}${n.hint ? ` (${n.hint})` : ''}`;
    if (isRoot)
        return _jsx("div", { className: cls, title: title, children: body });
    if (parent)
        return _jsx("button", { type: "button", className: cls, title: title, "aria-expanded": open, onClick: () => ctx.setOpen(n.id, !open), children: body });
    return _jsx("button", { type: "button", className: cls, title: title, "aria-haspopup": "menu", "aria-expanded": ctx.menuId === n.id, onClick: (e) => ctx.openMenu(n, e.currentTarget), children: body });
}
function Branch({ n, depth, ctx }) {
    // Finished branches fold away by default, and so does the foldAt level; someone can still open them.
    const open = depth === 0 || (ctx.openMap[n.id] ?? (depth !== ctx.foldAt && n.state !== 'done'));
    return (_jsxs(_Fragment, { children: [_jsx(NodeChip, { n: n, isRoot: depth === 0, open: open, ctx: ctx }), n.children && open && (_jsx("ul", { children: n.children.map((c) => _jsx("li", { className: c.tone && TONE[c.tone], children: _jsx(Branch, { n: c, depth: depth + 1, ctx: ctx }) }, c.id)) }))] }));
}
/** Horizontal, live progress tree for one course or many. It re-renders whenever the data does. */
export default function ProgressTree({ root, onPick, canEdit, onSetDate, actions, foldAt }) {
    const [openMap, setOpenMap] = useState({});
    const [menu, setMenu] = useState(null);
    const next = nextActions(root);
    const pct = root.total ? Math.round((root.done / root.total) * 100) : 0;
    const counts = countLeaves(root);
    const leaves = Object.entries(counts).filter(([s]) => s !== 'na').reduce((a, [, v]) => a + v, 0);
    const find = (n, id) => n.id === id ? n : n.children?.map((c) => find(c, id)).find(Boolean);
    const menuNode = menu && find(root, menu.id); // read fresh each render, so the dropdown shows the saved status
    const openMenu = (n, el) => setMenu((m) => (m?.id === n.id && m.el === el ? null : { id: n.id, el }));
    const ctx = { nextId: next[0]?.node.id, foldAt, openMap, setOpen: (id, v) => setOpenMap((m) => ({ ...m, [id]: v })), menuId: menu?.id, openMenu };
    return (_jsxs("div", { className: "card", children: [_jsxs("div", { className: "flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 border-b border-line", children: [_jsxs("div", { className: "flex items-center gap-3 min-w-[15rem]", children: [_jsxs("span", { className: "text-2xl font-semibold tabular tracking-tight", children: [pct, _jsx("span", { className: "text-sm text-muted font-medium", children: "%" })] }), _jsxs("div", { className: "flex-1 min-w-[8rem]", children: [_jsx("div", { className: "ptree-seg", role: "progressbar", "aria-valuenow": pct, "aria-valuemin": 0, "aria-valuemax": 100, "aria-label": "Progress", children: ['done', 'active', 'returned', 'ready', 'locked'].map((s) => counts[s] ? _jsx("span", { className: FILL[s], style: { width: `${(counts[s] / leaves) * 100}%` } }, s) : null) }), _jsxs("span", { className: "block mt-1 text-2xs tabular text-muted", children: [root.done, " of ", root.total, " steps done"] })] })] }), _jsxs("div", { className: "flex flex-1 flex-wrap items-center gap-2 text-sm min-w-0", children: [_jsx("span", { className: "text-muted", children: "Next:" }), next.length === 0 && _jsx("span", { children: "Nothing left to do." }), next.map(({ node, path }) => (_jsxs("button", { type: "button", "aria-haspopup": "menu", onClick: (e) => openMenu(node, e.currentTarget), className: clsx('inline-flex items-center gap-1.5 rounded border px-2 py-1 hover:bg-sunken transition-colors duration-150 cursor-pointer', node.state === 'returned' ? 'border-warn/40' : 'border-line'), children: [_jsx(Dot, { state: node.state }), _jsxs("span", { className: "text-muted font-medium", children: [path.join(' / '), path.length ? ' / ' : ''] }), _jsx("span", { className: "font-semibold", children: node.label })] }, node.id)))] }), actions && _jsx("div", { className: "ml-auto flex items-center gap-2", children: actions })] }), _jsx("div", { className: "overflow-x-auto px-4 py-5", children: _jsx("div", { className: "ptree", children: _jsx(Branch, { n: root, depth: 0, ctx: ctx }) }) }), _jsxs("ul", { className: "flex flex-wrap gap-x-4 gap-y-1 px-4 pb-3 text-2xs font-medium text-ink", "aria-label": "Legend", children: [['done', 'active', 'returned', 'ready', 'locked'].map((s) => (_jsxs("li", { className: "inline-flex items-center gap-1.5", children: [_jsx(Dot, { state: s }), STATE_TEXT[s], _jsx("span", { className: "tabular font-bold", children: counts[s] ?? 0 })] }, s))), _jsx("li", { className: "ml-auto text-subtle", children: "Click a branch to open it, or a step to change its status." })] }), menu && menuNode && _jsx(StatusMenu, { node: menuNode, anchor: menu.el, onClose: () => setMenu(null), onPick: onPick, canEdit: canEdit, onSetDate: onSetDate }, menu.id)] }));
}
