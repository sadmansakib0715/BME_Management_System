import { Link } from 'react-router-dom';
import { TypeBadge } from '@/components/bits';
import { Card, CardHeader, Meter, Stat, StatusBadge } from '@/components/ui';
import type { ObeTerm, TermData } from '@/lib/api';
import { attained, courseFile, mappedPos, valueOf } from '@/lib/obe';
import { useTerm } from '@/lib/TermContext';
import type { StatusOption } from '@/lib/workflow';

const MAP_STATE: StatusOption[] = [{ value: 'none', label: 'No COs yet' }, { value: 'partly', label: 'Partly mapped' }, { value: 'mapped', label: 'Mapped' }];
const CAR_STATE: StatusOption[] = [{ value: 'draft', label: 'Draft' }, { value: 'submitted', label: 'Submitted' }, { value: 'reviewed', label: 'Reviewed' }, { value: 'final', label: 'Final' }];

/** OBE dashboard (spec section 14): every offering of the term with mapping, attainment, CAR and course-file progress. */
export default function ObeCourses({ data, obe }: { data: TermData; obe: ObeTerm }) {
  const { courseOf, teachersOf, nameOf } = useTerm();
  const rows = data.offerings.map((o) => {
    const c = courseOf(o);
    const cos = obe.cos.filter((x) => x.offering_id === o.id).sort((a, b) => Number(a.code.slice(2)) - Number(b.code.slice(2)));
    const coPo = obe.coPo.filter((m) => cos.some((x) => x.id === m.co_id));
    const att = obe.attainment.filter((a) => a.offering_id === o.id);
    const car = obe.cars.find((x) => x.offering_id === o.id) ?? null;
    const mapped = cos.filter((x) => coPo.some((m) => m.co_id === x.id)).length;
    const coT = Number(o.cohort_threshold ?? 0.4), poT = Number(o.po_threshold ?? 0.4);
    const coRes = cos.map((_, i) => attained(valueOf(att, 'CO', `CO${i + 1}`), coT));
    const notMet = [...cos.map((_, i) => `CO${i + 1}`).filter((_, i) => coRes[i] === false),
      ...[...mappedPos(cos, coPo)].filter((p) => attained(valueOf(att, 'PO', p), poT) === false)];
    const file = courseFile({ cos, coPo, attainment: att, car, files: obe.files.filter((f) => f.offering_id === o.id), hasTeachers: teachersOf(o.id).length > 0, hasResolution: !!o.co_resolution_id });
    return { o, c, cos, mapState: !cos.length ? 'none' : mapped === cos.length ? 'mapped' : 'partly', measured: coRes.filter((x) => x !== null).length, met: coRes.filter((x) => x).length,
      notMet, car: car?.status ?? 'draft', fileDone: file.filter((f) => f.done).length, fileTotal: file.length };
  }).filter((r) => r.c).sort((a, b) => a.c!.code.localeCompare(b.c!.code));

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Stat label="COs mapped" value={`${rows.filter((r) => r.mapState === 'mapped').length}/${rows.length}`} sub="courses" />
        <Stat label="Attainment entered" value={`${rows.filter((r) => r.cos.length && r.measured === r.cos.length).length}/${rows.length}`} sub="courses with every CO" />
        <Stat label="CARs final" value={`${rows.filter((r) => r.car === 'final').length}/${rows.length}`} />
        <Stat label="Outcomes not attained" value={rows.reduce((n, r) => n + r.notMet.length, 0)} sub="COs and POs below threshold" />
      </div>
      <Card className="overflow-hidden">
        <CardHeader title="Courses this term" subtitle="Open a course to edit its COs, attainment, course file and CAR." />
        <div className="overflow-x-auto"><table className="table">
          <thead><tr><th>Course</th><th>COs</th><th>Attainment</th><th>Not attained</th><th>CAR</th><th className="min-w-40">Course file</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.o.id}>
              <td><Link to={`/courses/${r.o.id}/outcomes`} className="link font-mono text-sm">{r.c!.code}</Link> <TypeBadge type={r.c!.course_type} />
                <div className="text-2xs text-muted max-w-64 truncate">{teachersOf(r.o.id).map(nameOf).join(', ') || r.c!.title}</div></td>
              <td><div className="flex items-center gap-2"><span className="text-2xs tabular text-muted">{r.cos.length}</span><StatusBadge opts={MAP_STATE} value={r.mapState} /></div></td>
              <td className="text-2xs tabular">{r.cos.length ? <>{r.met} of {r.measured} attained{r.measured < r.cos.length && <span className="text-warn"> · {r.cos.length - r.measured} missing</span>}</> : <span className="text-subtle">—</span>}</td>
              <td className="text-2xs">{r.notMet.length ? <span className="text-bad font-medium">{r.notMet.join(', ')}</span> : <span className="text-subtle">—</span>}</td>
              <td><StatusBadge opts={CAR_STATE} value={r.car} /></td>
              <td><div className="flex items-center gap-2"><Meter value={r.fileDone} max={r.fileTotal} label={`${r.c!.code} course file`} /><span className="text-2xs tabular text-muted">{r.fileDone}/{r.fileTotal}</span></div></td>
            </tr>))}</tbody>
        </table></div>
      </Card>
    </>
  );
}
