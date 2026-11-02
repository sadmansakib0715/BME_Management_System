import { clsx } from 'clsx';
import { CalendarDays, Check, ChevronRight, ExternalLink, Loader2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { fmtDate } from '@/lib/format';
import { nextActions, type EditTarget, type NodeState, type RolledNode, type Tone } from '@/lib/progressTree';

const STATE_TEXT: Record<NodeState, string> = {
  done: 'Done', active: 'In progress', returned: 'Needs a fix', ready: 'Ready to start', locked: 'Waiting', na: 'Not used',
};

export interface ProgressTreeProps {
  root: RolledNode;
  /** Writes a status picked in a dropdown. Reject to keep the dropdown open; the caller shows the error. */
  onPick: (target: EditTarget, value: string) => Promise<unknown>;
  /** Whether the person may change this field. */
  canEdit: (target: EditTarget) => boolean;
  /** Opens the date picker for an assessment. Picking “Scheduled” for an undated one opens it too. */
  onSetDate?: (itemId: string) => void;
  /** Shown at the right of the header, e.g. an Add assessment button. */
  actions?: ReactNode;
  /** Branches at this depth start folded (1 = each course in a multi-course tree). Without it, only finished branches fold. */
  foldAt?: number;
}

// Class names are written out in full so Tailwind keeps them in the build.
const DOT: Record<NodeState, string> = {
  done: 'ptree-dot ptree-dot-done', active: 'ptree-dot ptree-dot-active', returned: 'ptree-dot ptree-dot-returned',
  ready: 'ptree-dot ptree-dot-ready', locked: 'ptree-dot ptree-dot-locked', na: 'ptree-dot ptree-dot-na',
};
const STEP: Record<NodeState, string> = {
  done: 'ptree-s-done', active: 'ptree-s-active', returned: 'ptree-s-returned', ready: 'ptree-s-ready', locked: 'ptree-s-locked', na: 'ptree-s-na',
};
const FILL: Partial<Record<NodeState, string>> = {
  done: 'ptree-fill-done', active: 'ptree-fill-active', returned: 'ptree-fill-returned', ready: 'ptree-fill-ready', locked: 'ptree-fill-locked',
};
const TONE: Record<Tone, string> = {
  setup: 'tone-setup', assess: 'tone-assess', exam: 'tone-exam', results: 'tone-results', obe: 'tone-obe', close: 'tone-close', group: 'tone-group', course: 'tone-course',
};

/** Dot per state. Shape differs as well as colour, so the tree reads without colour. */
function Dot({ state }: { state: NodeState }) {
  return <span aria-hidden className={DOT[state]} />;
}

/** Leaf counts per state, for the header bar. */
function countLeaves(n: RolledNode, out: Partial<Record<NodeState, number>> = {}) {
  if (!n.children) out[n.state] = (out[n.state] ?? 0) + 1;
  else n.children.forEach((c) => countLeaves(c, out));
  return out;
}

// ---------------------------------------------------------------- dropdown

function StatusMenu({ node, anchor, onClose, onPick, canEdit, onSetDate }: { node: RolledNode; anchor: HTMLElement; onClose: () => void } & Pick<ProgressTreeProps, 'onPick' | 'canEdit' | 'onSetDate'>) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: -9999, left: -9999 });
  const [busy, setBusy] = useState<string | null>(null);
  const locked = node.state === 'locked';

  // Sit under the step, flip above it near the bottom edge, stay inside the window.
  useLayoutEffect(() => {
    const a = anchor.getBoundingClientRect(), m = ref.current!.getBoundingClientRect();
    const below = a.bottom + 6 + m.height < window.innerHeight;
    setPos({ top: below ? a.bottom + 6 : Math.max(8, a.top - 6 - m.height), left: Math.min(Math.max(8, a.left), window.innerWidth - m.width - 8) });
    ref.current!.querySelector<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])')?.focus();
  }, [anchor]);

  useEffect(() => {
    const out = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose(); };
    const away = () => onClose();
    document.addEventListener('mousedown', out);
    window.addEventListener('resize', away);
    window.addEventListener('scroll', away, true);
    return () => { document.removeEventListener('mousedown', out); window.removeEventListener('resize', away); window.removeEventListener('scroll', away, true); };
  }, [anchor, onClose]);

  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); anchor.focus(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const all = [...ref.current!.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
    const i = all.indexOf(document.activeElement as HTMLElement);
    all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
  };

  const dated = node.dated && onSetDate && node.edits?.some((g) => canEdit(g.target)) ? node.dated : null;
  const setDate = () => { onClose(); onSetDate!(dated!.itemId); };
  const pick = async (target: EditTarget, value: string) => {
    // A scheduled test needs a date: open the date picker, which marks it scheduled when saved.
    if (dated && !dated.date && target.kind === 'item' && target.field === 'status' && value === 'scheduled') return setDate();
    const key = JSON.stringify(target) + value;
    setBusy(key);
    try { await onPick(target, value); onClose(); anchor.focus(); } catch { /* caller reports */ } finally { setBusy(null); }
  };

  return createPortal(
    <div ref={ref} role="menu" aria-label={`${node.label} status`} onKeyDown={keys} style={{ top: pos.top, left: pos.left }}
      className="fixed z-50 w-64 rounded-lg border border-line bg-surface shadow-pop py-1.5 text-sm">
      <div className="px-3 pt-1 pb-2 border-b border-line">
        <div className="font-semibold truncate">{node.label}</div>
        <div className="flex items-center gap-1.5 text-2xs text-muted mt-0.5"><Dot state={node.state} />{STATE_TEXT[node.state]}{node.hint && node.hint !== STATE_TEXT[node.state] ? `, ${node.hint}` : ''}</div>
        {locked && node.waitingOn && <div className="text-2xs text-subtle mt-1">Opens when {node.waitingOn} {node.waitingOn.includes(',') ? 'are' : 'is'} done.</div>}
      </div>
      {dated && !locked && (
        <button type="button" role="menuitem" onClick={setDate}
          className="mx-2 mt-2 flex w-[calc(100%-1rem)] items-center gap-2 rounded-md border border-brand/40 bg-brand-soft px-2.5 py-1.5 text-left font-semibold text-brand-ink hover:border-brand focus:border-brand focus:outline-none cursor-pointer">
          <CalendarDays className="size-4" aria-hidden />
          <span className="flex-1">{dated.date ? 'Change the date' : 'Set the date'}</span>
          {dated.date && <span className="text-2xs font-medium">{fmtDate(dated.date, { weekday: 'short', day: 'numeric', month: 'short' })}</span>}
        </button>)}
      {node.edits?.length ? node.edits.map((g) => {
        const allowed = canEdit(g.target) && !locked;
        return (
          <div key={JSON.stringify(g.target)} role="group" aria-label={g.label} className="pt-1.5">
            {node.edits!.length > 1 && <div className="px-3 pb-0.5 text-2xs text-subtle">{g.label}</div>}
            {g.options.map((o) => {
              const current = o.value === g.value;
              const elsewhere = g.elsewhere?.includes(o.value);
              const key = JSON.stringify(g.target) + o.value;
              if (elsewhere && node.to) return (
                <Link key={o.value} role="menuitem" to={node.to} onClick={onClose}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-muted hover:bg-sunken focus:bg-sunken focus:outline-none">
                  <span className="size-3.5" /><span className="flex-1">{o.label}</span><span className="text-2xs text-subtle">on {node.toLabel}</span>
                </Link>);
              return (
                <button key={o.value} type="button" role="menuitemradio" aria-checked={current} aria-disabled={!allowed || current}
                  onClick={() => allowed && !current && !busy && pick(g.target, o.value)}
                  className={clsx('flex w-full items-center gap-2 px-3 py-1.5 text-left focus:outline-none', allowed && !current ? 'hover:bg-sunken focus:bg-sunken cursor-pointer' : 'cursor-default focus:bg-sunken',
                    !allowed && !current && 'text-subtle', current && 'font-medium')}>
                  {busy === key ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check aria-hidden className={clsx('size-3.5', current ? 'text-ok' : 'invisible')} />}
                  <span className="flex-1">{o.label}</span>
                </button>);
            })}
          </div>);
      }) : <p className="px-3 pt-2 text-2xs text-muted">This step follows what is entered on the {node.toLabel ?? 'course'} page.</p>}
      {node.edits?.some((g) => !canEdit(g.target)) && <p className="px-3 pt-1.5 text-2xs text-subtle">Only the person responsible or an admin can change this.</p>}
      {node.to && <div className="mt-1.5 pt-1.5 border-t border-line">
        <Link role="menuitem" to={node.to} onClick={onClose} className="flex items-center gap-2 px-3 py-1.5 text-muted hover:bg-sunken hover:text-ink focus:bg-sunken focus:outline-none">
          <ExternalLink className="size-3.5" aria-hidden />Open {node.toLabel ?? 'page'}
        </Link>
      </div>}
    </div>, document.body);
}

// ---------------------------------------------------------------- tree

interface Ctx { nextId?: string; foldAt?: number; openMap: Record<string, boolean>; setOpen: (id: string, v: boolean) => void; menuId?: string; openMenu: (n: RolledNode, el: HTMLElement) => void }

function NodeChip({ n, isRoot, open, ctx }: { n: RolledNode; isRoot?: boolean; open: boolean; ctx: Ctx }) {
  const parent = !!n.children;
  const showHint = !parent && (n.state === 'active' || n.state === 'returned') && n.hint;
  const pct = n.total ? Math.round((n.done / n.total) * 100) : 0;
  const cls = clsx('ptree-node', isRoot ? 'ptree-root' : parent ? (n.tone === 'course' ? 'ptree-course' : 'ptree-branch') : STEP[n.state],
    n.id === ctx.nextId && 'ptree-next', ctx.menuId === n.id && 'ptree-node-open');
  const body = (
    <>
      <Dot state={n.state} />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{n.label}</span>
        {(isRoot || showHint) && n.hint && <span className="ptree-sub">{n.hint}</span>}
        {parent && !isRoot && <span className="ptree-bar" aria-hidden><span style={{ width: `${pct}%` }} /></span>}
      </span>
      {parent && !isRoot && <span className="ptree-count ml-1">{n.done}/{n.total}</span>}
      {parent && !isRoot && <ChevronRight aria-hidden className={clsx('size-3.5 opacity-60 transition-transform duration-150', open && 'rotate-180')} />}
    </>
  );
  const title = `${n.label}: ${STATE_TEXT[n.state]}${n.hint ? ` (${n.hint})` : ''}`;
  if (isRoot) return <div className={cls} title={title}>{body}</div>;
  if (parent) return <button type="button" className={cls} title={title} aria-expanded={open} onClick={() => ctx.setOpen(n.id, !open)}>{body}</button>;
  return <button type="button" className={cls} title={title} aria-haspopup="menu" aria-expanded={ctx.menuId === n.id}
    onClick={(e) => ctx.openMenu(n, e.currentTarget)}>{body}</button>;
}

function Branch({ n, depth, ctx }: { n: RolledNode; depth: number; ctx: Ctx }) {
  // Finished branches fold away by default, and so does the foldAt level; someone can still open them.
  const open = depth === 0 || (ctx.openMap[n.id] ?? (depth !== ctx.foldAt && n.state !== 'done'));
  return (
    <>
      <NodeChip n={n} isRoot={depth === 0} open={open} ctx={ctx} />
      {n.children && open && (
        <ul>{n.children.map((c) => <li key={c.id} className={c.tone && TONE[c.tone]}><Branch n={c} depth={depth + 1} ctx={ctx} /></li>)}</ul>
      )}
    </>
  );
}

/** Horizontal, live progress tree for one course or many. It re-renders whenever the data does. */
export default function ProgressTree({ root, onPick, canEdit, onSetDate, actions, foldAt }: ProgressTreeProps) {
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<{ id: string; el: HTMLElement } | null>(null);
  const next = nextActions(root);
  const pct = root.total ? Math.round((root.done / root.total) * 100) : 0;
  const counts = countLeaves(root);
  const leaves = Object.entries(counts).filter(([s]) => s !== 'na').reduce((a, [, v]) => a + v, 0);
  const find = (n: RolledNode, id: string): RolledNode | undefined => n.id === id ? n : n.children?.map((c) => find(c, id)).find(Boolean);
  const menuNode = menu && find(root, menu.id);   // read fresh each render, so the dropdown shows the saved status
  const openMenu = (n: RolledNode, el: HTMLElement) => setMenu((m) => (m?.id === n.id && m.el === el ? null : { id: n.id, el }));
  const ctx: Ctx = { nextId: next[0]?.node.id, foldAt, openMap, setOpen: (id, v) => setOpenMap((m) => ({ ...m, [id]: v })), menuId: menu?.id, openMenu };

  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 border-b border-line">
        <div className="flex items-center gap-3 min-w-[15rem]">
          <span className="text-2xl font-semibold tabular tracking-tight">{pct}<span className="text-sm text-muted font-medium">%</span></span>
          <div className="flex-1 min-w-[8rem]">
            <div className="ptree-seg" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress">
              {(['done', 'active', 'returned', 'ready', 'locked'] as NodeState[]).map((s) => counts[s] ? <span key={s} className={FILL[s]} style={{ width: `${(counts[s]! / leaves) * 100}%` }} /> : null)}
            </div>
            <span className="block mt-1 text-2xs tabular text-muted">{root.done} of {root.total} steps done</span>
          </div>
        </div>
        <div className="flex flex-1 flex-wrap items-center gap-2 text-sm min-w-0">
          <span className="text-muted">Next:</span>
          {next.length === 0 && <span>Nothing left to do.</span>}
          {next.map(({ node, path }) => (
            <button key={node.id} type="button" aria-haspopup="menu" onClick={(e) => openMenu(node, e.currentTarget)}
              className={clsx('inline-flex items-center gap-1.5 rounded border px-2 py-1 hover:bg-sunken transition-colors duration-150 cursor-pointer',
                node.state === 'returned' ? 'border-warn/40' : 'border-line')}>
              <Dot state={node.state} />
              <span className="text-muted font-medium">{path.join(' / ')}{path.length ? ' / ' : ''}</span><span className="font-semibold">{node.label}</span>
            </button>
          ))}
        </div>
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>
      <div className="overflow-x-auto px-4 py-5">
        <div className="ptree"><Branch n={root} depth={0} ctx={ctx} /></div>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 px-4 pb-3 text-2xs font-medium text-ink" aria-label="Legend">
        {(['done', 'active', 'returned', 'ready', 'locked'] as NodeState[]).map((s) => (
          <li key={s} className="inline-flex items-center gap-1.5"><Dot state={s} />{STATE_TEXT[s]}<span className="tabular font-bold">{counts[s] ?? 0}</span></li>
        ))}
        <li className="ml-auto text-subtle">Click a branch to open it, or a step to change its status.</li>
      </ul>
      {menu && menuNode && <StatusMenu key={menu.id} node={menuNode} anchor={menu.el} onClose={() => setMenu(null)} onPick={onPick} canEdit={canEdit} onSetDate={onSetDate} />}
    </div>
  );
}
