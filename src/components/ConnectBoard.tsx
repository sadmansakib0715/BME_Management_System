import { clsx } from 'clsx';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';

export interface LeftItem { key: string; code: string; label: string; badge?: string; links: string[] }
export interface RightItem { key: string; code: string; label: string; title?: string; meta?: string; tag?: ReactNode; tagTitle?: string }
interface Props {
  left: LeftItem[];
  right: RightItem[];
  /** Nouns for help text and screen readers, e.g. { left: 'CO', right: 'PO' }. */
  nouns: { left: string; right: string };
  disabled?: boolean;
  /** New list of right keys for the left item at this index. */
  onChange: (index: number, links: string[]) => void;
  empty?: ReactNode;
}
type Pt = { x: number; y: number };
type Line = { li: number; rk: string; a: Pt; b: Pt };
type Drag = { li: number; moving?: string; from: Pt; start: Pt; to: Pt; over: string | null };

// One muted hue per left item so several lines into one target stay readable; labels and counts carry the meaning too.
const HUES = [352, 210, 150, 32, 270, 190, 85, 320, 0, 230, 120, 50];
export const hue = (i: number) => `hsl(${HUES[i % HUES.length]} 55% 45%)`;
const curve = (a: Pt, b: Pt) => { const dx = Math.max(40, (b.x - a.x) * 0.5); return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`; };
const far = (d: Drag) => Math.hypot(d.to.x - d.start.x, d.to.y - d.start.y) > 6;

/**
 * Items on the left, targets on the right, a line per link.
 * Drag a left item onto a target to link it. Drag a line's end to another target to move it, or off every target to remove it;
 * a plain click on a line removes it. Without a mouse: pick a left item, then pick targets to link or unlink.
 */
export default function ConnectBoard({ left, right, nouns, disabled, onChange, empty }: Props) {
  const board = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [hover, setHover] = useState<{ li?: number; rk?: string; line?: string } | null>(null);
  const [say, setSay] = useState('');

  const centre = useCallback((sel: string): Pt | null => {
    const el = board.current, r = el?.querySelector(sel)?.getBoundingClientRect(), o = el?.getBoundingClientRect();
    return r && o ? { x: r.left + r.width / 2 - o.left, y: r.top + r.height / 2 - o.top } : null;
  }, []);
  const measure = useCallback(() => {
    const el = board.current; if (!el) return;
    const o = el.getBoundingClientRect();
    setSize({ w: o.width, h: o.height });
    setLines(left.flatMap((l, i) => l.links.map((rk) => ({ li: i, rk, a: centre(`[data-l-handle="${i}"]`), b: centre(`[data-r-socket="${CSS.escape(rk)}"]`) })))
      .filter((l): l is Line => !!l.a && !!l.b));
  }, [left, centre]);
  useLayoutEffect(measure, [measure, right]);
  useEffect(() => {
    const ro = new ResizeObserver(measure);
    if (board.current) ro.observe(board.current);
    return () => ro.disconnect();
  }, [measure]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPicked(null); setDrag(null); } };
    window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc);
  }, []);

  const name = (rk: string) => right.find((r) => r.key === rk)?.code ?? rk;
  const point = (e: { clientX: number; clientY: number }): Pt => { const o = board.current!.getBoundingClientRect(); return { x: e.clientX - o.left, y: e.clientY - o.top }; };
  const targetAt = (e: { clientX: number; clientY: number }) => (document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-r]') as HTMLElement | null)?.dataset.r ?? null;

  const link = (i: number, rk: string) => {
    if (left[i].links.includes(rk)) { setSay(`${left[i].code} is already linked to ${name(rk)}`); return; }
    onChange(i, [...left[i].links, rk]); setSay(`${left[i].code} linked to ${name(rk)}`);
  };
  const unlink = (i: number, rk: string) => { onChange(i, left[i].links.filter((x) => x !== rk)); setSay(`${left[i].code} unlinked from ${name(rk)}`); setHover(null); };
  const move = (i: number, fromKey: string, toKey: string) => {
    if (fromKey === toKey) return;
    const links = left[i].links;
    // Moving onto a target it already has just drops the old line; otherwise the new target takes the old one's place.
    onChange(i, links.includes(toKey) ? links.filter((x) => x !== fromKey) : links.map((x) => (x === fromKey ? toKey : x)));
    setSay(`${left[i].code} moved from ${name(fromKey)} to ${name(toKey)}`);
  };

  const begin = (d: Omit<Drag, 'to' | 'over'>, e: RPointerEvent) => {
    setDrag({ ...d, to: d.start, over: null });
    board.current!.setPointerCapture(e.pointerId);
  };
  const startNew = (i: number, e: RPointerEvent) => {
    if (disabled || e.button !== 0) return;
    begin({ li: i, from: centre(`[data-l-handle="${i}"]`)!, start: point(e) }, e);
  };
  const startMove = (l: Line, e: RPointerEvent) => {
    if (disabled || e.button !== 0) return;
    e.stopPropagation();
    begin({ li: l.li, moving: l.rk, from: l.a, start: point(e) }, e);
  };
  const onMove = (e: RPointerEvent) => { if (drag) setDrag({ ...drag, to: point(e), over: targetAt(e) }); };
  const onUp = (e: RPointerEvent) => {
    if (!drag) return;
    const over = targetAt(e), moved = far({ ...drag, to: point(e) });
    if (drag.moving) {
      if (!moved) unlink(drag.li, drag.moving);                 // a click on a line removes it
      else if (over) move(drag.li, drag.moving, over);
      else unlink(drag.li, drag.moving);                        // dropped away from every target
    } else if (over && moved) link(drag.li, over);
    else if (!moved) setPicked((p) => (p === drag.li ? null : drag.li));
    setDrag(null); setHover(null);
  };
  const pickTarget = (rk: string) => {
    if (disabled || picked === null) return;
    if (left[picked].links.includes(rk)) unlink(picked, rk); else link(picked, rk);
  };

  const active = drag && far(drag);
  const tip = drag && ((drag.over && centre(`[data-r-socket="${CSS.escape(drag.over)}"]`)) || drag.to);
  const focusLi = drag?.li ?? picked ?? hover?.li;
  const usedBy = (rk: string) => left.filter((l) => l.links.includes(rk)).map((l) => l.code);
  const hovered = lines.find((l) => hover?.line === `${l.li}|${l.rk}`);

  if (!left.length) return <>{empty}</>;
  return (
    <div>
      <p className="px-4 pt-3 text-2xs text-muted">
        {disabled ? 'Read-only.' : picked !== null
          ? <><b className="text-ink">{left[picked].code}</b> is selected. Click a {nouns.right} to link or unlink it; press Esc when done.</>
          : `Drag a ${nouns.left} onto a ${nouns.right} to link them; one ${nouns.left} can link to several. Drag a line's end to another ${nouns.right} to move it, or off to remove it.`}
      </p>
      <div ref={board} className={clsx('relative grid grid-cols-[minmax(0,1fr)_minmax(3rem,9rem)_minmax(0,1fr)] p-4 select-none', drag && 'cursor-grabbing')}
        onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => setDrag(null)}>
        <svg className="absolute inset-0 pointer-events-none overflow-visible" width={size.w} height={size.h} aria-hidden>
          {lines.map((l) => {
            const id = `${l.li}|${l.rk}`;
            const beingMoved = active && drag!.moving === l.rk && drag!.li === l.li;
            const lit = hover?.line === id || l.li === focusLi || hover?.rk === l.rk;
            const dim = focusLi !== undefined || hover?.rk !== undefined;
            return (
              <g key={id}>
                <path d={curve(l.a, l.b)} fill="none" stroke={hover?.line === id && !drag ? 'rgb(var(--bad))' : hue(l.li)} strokeWidth={lit ? 2.5 : 1.5}
                  strokeOpacity={beingMoved ? 0.2 : lit ? 1 : dim ? 0.15 : 0.75} strokeDasharray={beingMoved || (hover?.line === id && !drag) ? '5 4' : undefined} />
                {!disabled && !drag && <path d={curve(l.a, l.b)} fill="none" stroke="transparent" strokeWidth={14} className="pointer-events-auto cursor-grab"
                  onPointerEnter={() => setHover({ line: id })} onPointerLeave={() => setHover(null)} onPointerDown={(e) => startMove(l, e)} />}
                {/* Grip at the target end: the part people grab to move a line. */}
                {!disabled && hover?.line === id && !drag && <circle cx={l.b.x - 14} cy={l.b.y} r={5} fill="rgb(var(--surface))" stroke="rgb(var(--bad))" strokeWidth={2} />}
              </g>);
          })}
          {active && tip && <path d={curve(drag!.from, tip)} fill="none" stroke={hue(drag!.li)} strokeWidth={2} strokeDasharray="6 5" />}
          {active && tip && <circle cx={tip.x} cy={tip.y} r={4} fill={hue(drag!.li)} />}
        </svg>
        {hovered && !drag && <span className="absolute z-10 -translate-x-1/2 -translate-y-[140%] pointer-events-none whitespace-nowrap rounded bg-ink text-surface text-2xs font-medium px-1.5 py-0.5"
          style={{ left: (hovered.a.x + hovered.b.x) / 2, top: (hovered.a.y + hovered.b.y) / 2 }}>{left[hovered.li].code}–{name(hovered.rk)}: drag the end to move, click to remove</span>}

        <ul className="col-start-1 row-start-1 space-y-2 self-center" aria-label={`${nouns.left}s`}>
          {left.map((l, i) => {
            const on = picked === i || drag?.li === i;
            return (
              <li key={l.key}>
                <button type="button" disabled={disabled} aria-pressed={picked === i}
                  aria-label={`${l.code}: ${l.label || 'no text'}. Linked to ${l.links.length ? l.links.map(name).join(', ') : 'nothing'}.${disabled ? '' : ` Select to link ${nouns.right}s.`}`}
                  onPointerDown={(e) => startNew(i, e)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPicked((p) => (p === i ? null : i)); } }}
                  onPointerEnter={() => !drag && setHover({ li: i })} onPointerLeave={() => setHover(null)}
                  className={clsx('relative w-full flex items-center gap-3 rounded border bg-surface pl-3 pr-5 py-2 text-left transition-colors duration-150 touch-none',
                    disabled ? 'cursor-default' : 'cursor-grab hover:border-line-strong', on ? 'border-transparent ring-2' : 'border-line')}
                  style={on ? { ['--tw-ring-color' as string]: hue(i) } : undefined}>
                  <span className="font-mono text-sm font-semibold shrink-0" style={{ color: hue(i) }}>{l.code}</span>
                  <span className="min-w-0 flex-1 text-sm text-muted truncate" title={l.label}>{l.label || 'No text yet'}</span>
                  {l.badge && <span className="text-2xs text-subtle shrink-0 tabular">{l.badge}</span>}
                  <span className="tabular text-2xs text-subtle shrink-0 w-3 text-right">{l.links.length || ''}</span>
                  <span data-l-handle={i} aria-hidden className="absolute -right-1.5 top-1/2 -translate-y-1/2 size-3 rounded-full border-2 bg-surface" style={{ borderColor: hue(i) }} />
                </button>
              </li>);
          })}
        </ul>

        <ul className="col-start-3 row-start-1 space-y-1.5 self-center" aria-label={`${nouns.right}s`}>
          {right.map((r) => {
            const by = usedBy(r.key);
            const target = drag?.over === r.key && active;
            const linked = focusLi !== undefined && left[focusLi]?.links.includes(r.key);
            return (
              <li key={r.key}>
                <button type="button" data-r={r.key} aria-disabled={disabled || picked === null}
                  aria-label={`${r.code} ${r.label}. ${by.length ? `Linked from ${by.join(', ')}` : 'Not linked'}.${picked !== null ? ` ${left[picked].links.includes(r.key) ? 'Unlink from' : 'Link to'} ${left[picked].code}.` : ''}`}
                  onClick={() => pickTarget(r.key)} onPointerEnter={() => !drag && setHover({ rk: r.key })} onPointerLeave={() => setHover(null)}
                  className={clsx('relative w-full flex items-center gap-2 rounded border pl-4 pr-3 py-1.5 text-left transition-colors duration-150',
                    target ? 'border-brand bg-brand-soft' : linked ? 'border-line-strong bg-sunken' : 'border-line bg-surface',
                    picked !== null && !disabled ? 'cursor-pointer hover:border-line-strong' : 'cursor-default', !by.length && 'text-subtle')}>
                  <span data-r-socket={r.key} aria-hidden className={clsx('absolute -left-1.5 top-1/2 -translate-y-1/2 size-3 rounded-full border-2 bg-surface', by.length ? 'border-ink/60' : 'border-line-strong')} />
                  <span className="font-mono text-sm font-semibold min-w-11 shrink-0">{r.code}</span>
                  <span className="min-w-0 flex-1 text-sm truncate" title={r.title ?? r.label}>{r.label}</span>
                  {r.meta && <span className="hidden sm:inline text-2xs text-subtle shrink-0">{r.meta}</span>}
                  {r.tag && <span className="text-2xs rounded border border-line px-1 text-muted shrink-0" title={r.tagTitle}>{r.tag}</span>}
                  <span className="tabular text-2xs text-subtle w-4 text-right shrink-0">{by.length || ''}</span>
                </button>
              </li>);
          })}
        </ul>
      </div>
      <p className="sr-only" aria-live="polite">{say}</p>
    </div>
  );
}
