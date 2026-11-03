import ConnectBoard from '@/components/ConnectBoard';
import type { PO } from '@/lib/types';

export interface BoardCo { key: string; code: string; statement: string; pos: string[] }

/** COs on the left, POs on the right: drag to link, drag a line's end to move it, click a line to remove it. */
export default function CoPoBoard({ cos, pos, expected, disabled, onChange }: {
  cos: BoardCo[]; pos: PO[]; expected?: number[]; disabled?: boolean; onChange: (index: number, pos: string[]) => void;
}) {
  return (
    <ConnectBoard nouns={{ left: 'CO', right: 'PO' }} disabled={disabled} onChange={onChange}
      left={cos.map((c) => ({ key: c.key, code: c.code, label: c.statement, links: c.pos }))}
      right={pos.map((p) => ({ key: p.code, code: p.code, label: p.title, title: p.statement, meta: p.k_profiles ?? undefined,
        tag: expected?.includes(p.no) ? 'BAETE' : undefined, tagTitle: 'BAETE expects this PO for this course' }))} />
  );
}
