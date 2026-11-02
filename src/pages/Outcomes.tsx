import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Card, CardHeader, ErrorNote, PageHeader, Spinner, Stat, StatusBadge } from '@/components/ui';
import { usePOs } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useTerm } from '@/lib/TermContext';
import type { CoPo, CourseOutcome } from '@/lib/types';
import type { StatusOption } from '@/lib/workflow';

/** OBE: course outcomes per course, their CO–PO mapping, program coverage, POs and PEOs. Attainment needs marks, which this site does not keep. */
const CO_STATE: StatusOption[] = [{ value: 'none', label: 'No COs yet' }, { value: 'partly', label: 'Partly mapped' }, { value: 'mapped', label: 'Mapped to POs' }];

export default function Outcomes() {
  const { data, loading, error, courseOf, teachersOf, nameOf } = useTerm();
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
  const rows = data.offerings.map((o) => {
    const cos = cov.data.cos.filter((c) => c.offering_id === o.id);
    const mapped = cos.filter((c) => cov.data.map.some((m) => m.co_id === c.id)).length;
    return { o, c: courseOf(o)!, n: cos.length, state: !cos.length ? 'none' : mapped === cos.length ? 'mapped' : 'partly' };
  }).filter((r) => r.c).sort((a, b) => a.c.code.localeCompare(b.c.code));
  const covered = (po: string) => rows.filter((r) => strongest(r.o.id, po) > 0).length;
  const shade = ['', 'bg-brand/15 text-brand-ink', 'bg-brand/35 text-brand-ink', 'bg-brand text-brand-fg'];

  return (
    <>
      <PageHeader eyebrow={data.term.name} title="Outcome-based education (OBE)" description="Each course's outcomes (COs), how they map to the program outcomes (POs), and how well the term covers PO1–PO12." />
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        <Stat label="Courses with COs" value={`${rows.filter((r) => r.n).length}/${rows.length}`} />
        <Stat label="Fully mapped to POs" value={`${rows.filter((r) => r.state === 'mapped').length}/${rows.length}`} />
        <Stat label="POs covered this term" value={`${poList.filter((p) => covered(p.code) > 0).length}/${poList.length}`} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] [&>*]:min-w-0">
        <Card className="overflow-hidden">
          <CardHeader title="Course outcomes by course" subtitle="Teachers write COs and map them on the course's OBE tab." />
          <ul className="divide-y divide-line max-h-[32rem] overflow-y-auto">{rows.map(({ o, c, n, state }) => (
            <li key={o.id}><Link to={`/courses/${o.id}/outcomes`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-sunken/60 transition-colors duration-150">
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-sm text-brand-ink">{c.code}</span>
                <span className="block text-2xs text-subtle truncate">{teachersOf(o.id).map(nameOf).join(', ') || c.title}</span>
              </span>
              <span className="text-2xs text-muted tabular">{n} CO{n === 1 ? '' : 's'}</span>
              <StatusBadge opts={CO_STATE} value={state} />
            </Link></li>))}</ul>
        </Card>
        <Card>
          <CardHeader title="CO–PO coverage matrix" subtitle="Strongest correlation of any CO in each course (1 low, 2 medium, 3 high)." />
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
      </div>

      <div className="grid gap-5 xl:grid-cols-2 mt-5">
        <Card>
          <CardHeader title="Program outcomes (POs)" />
          <dl className="divide-y divide-line">{poList.map((p) => (
            <div key={p.code} className="px-4 py-2.5 text-sm"><dt className="font-semibold">{p.code} · {p.title}</dt><dd className="text-muted mt-0.5">{p.statement}</dd></div>))}</dl>
        </Card>
        <Card>
          <CardHeader title="Program educational objectives (PEOs)" />
          <dl className="divide-y divide-line">{pos.data.peos.map((p) => <div key={p.code} className="px-4 py-2.5 text-sm"><dt className="font-semibold inline">{p.code}. </dt><dd className="inline text-muted">{p.statement}</dd></div>)}</dl>
        </Card>
      </div>
    </>
  );
}
