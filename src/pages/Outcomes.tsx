import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Card, CardHeader, ErrorNote, PageHeader, Spinner } from '@/components/ui';
import { usePOs } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useTerm } from '@/lib/TermContext';
import type { CoPo, CourseOutcome } from '@/lib/types';

/** Program-level OBE view: POs and curriculum CO–PO coverage for this term. */
export default function Outcomes() {
  const { data, loading, error, courseOf } = useTerm();
  const pos = usePOs();
  const ids = data?.offerings.map((o) => o.id) ?? [];
  const cov = useQuery({
    queryKey: ['coverage', data?.term.id], enabled: !!data,
    queryFn: async () => {
      const { data: cos, error: e1 } = await supabase.from('course_outcomes').select('id, offering_id, code').in('offering_id', ids);
      if (e1) throw e1;
      const { data: map, error: e2 } = await supabase.from('co_po_map').select('*').in('co_id', (cos ?? []).map((c) => c.id));
      if (e2) throw e2;
      return { cos: (cos ?? []) as Pick<CourseOutcome, 'id' | 'offering_id' | 'code'>[], map: (map ?? []) as CoPo[] };
    },
  });
  if (loading || pos.isLoading || cov.isLoading) return <Spinner />;
  if (error || pos.error || cov.error) return <ErrorNote error={error ?? pos.error ?? cov.error} />;
  if (!data || !pos.data || !cov.data) return null;

  const poList = pos.data.pos;
  const strongest = (offeringId: string, po: string) => Math.max(0, ...cov.data.map.filter((m) => m.po_code === po && cov.data.cos.some((c) => c.id === m.co_id && c.offering_id === offeringId)).map((m) => m.strength));
  const rows = data.offerings.map((o) => ({ o, c: courseOf(o)! })).filter((r) => r.c).sort((a, b) => a.c.code.localeCompare(b.c.code));
  const covered = (po: string) => rows.filter((r) => strongest(r.o.id, po) > 0).length;
  const shade = ['', 'bg-brand/15 text-brand-ink', 'bg-brand/35 text-brand-ink', 'bg-brand text-brand-fg'];

  return (
    <>
      <PageHeader eyebrow={data.term.name} title="Program outcomes" description="How this term's courses cover PO1–PO12 through their course outcomes." />
      <Card>
        <CardHeader title="CO–PO coverage matrix" subtitle="Strongest correlation of any CO in each course. Empty rows mean outcomes are not defined yet." />
        <div className="overflow-x-auto"><table className="table">
          <thead><tr><th>Course</th>{poList.map((p) => <th key={p.code} className="text-center" title={p.title}>{p.code.replace('PO', '')}</th>)}</tr></thead>
          <tbody>{rows.map(({ o, c }) => (
            <tr key={o.id}><td><Link to={`/courses/${o.id}/outcomes`} className="link font-mono text-sm">{c.code}</Link></td>
              {poList.map((p) => { const s = strongest(o.id, p.code);
                return <td key={p.code} className="p-1 text-center"><span className={`inline-grid place-items-center size-7 rounded text-2xs font-semibold tabular ${s ? shade[s] : 'text-line-strong'}`}>{s || '·'}</span></td>; })}
            </tr>))}</tbody>
          <tfoot><tr><td className="px-3 py-2 text-2xs text-subtle">Courses covering</td>{poList.map((p) => <td key={p.code} className={`px-1 py-2 text-center text-2xs tabular font-semibold ${covered(p.code) ? 'text-muted' : 'text-bad'}`}>{covered(p.code)}</td>)}</tr></tfoot>
        </table></div>
      </Card>
      <Card className="mt-5">
        <CardHeader title="Program educational objectives" />
        <dl className="divide-y divide-line">{pos.data.peos.map((p) => <div key={p.code} className="px-4 py-2.5 text-sm"><dt className="font-semibold inline">{p.code}. </dt><dd className="inline text-muted">{p.statement}</dd></div>)}</dl>
      </Card>
    </>
  );
}
