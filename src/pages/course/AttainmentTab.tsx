import { Download, Lock, Save } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { Badge, Button, Callout, Card, CardHeader, Empty, ErrorNote, Spinner, Stat, useToast } from '@/components/ui';
import { must, useCourseObe, useWrite } from '@/lib/api';
import { computeAttainment } from '@/lib/attainment';
import { pct } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import type { TabProps } from './shared';

export const DEFAULT_SETTINGS = { x_pct: 60, y_pct: 50, level1: 50, level2: 60, level3: 70 };

export default function AttainmentTab({ offering, course, data }: TabProps) {
  const { me } = useAuth();
  const toast = useToast();
  const items = data.items.filter((i) => i.offering_id === offering.id);
  const obe = useCourseObe(offering.id, items.map((i) => i.id));
  const settings = data.settings ?? { term_id: data.term.id, ...DEFAULT_SETTINGS };
  const counted = items.filter((i) => ['published', 'locked'].includes(i.marks_status));

  const report = useMemo(() => obe.data && computeAttainment({
    cos: obe.data.cos, coPo: obe.data.coPo, components: data.components.filter((c) => c.offering_id === offering.id),
    items: counted, questions: obe.data.questions, marks: obe.data.marks, studentIds: obe.data.students.map((s) => s.id), settings,
  }), [obe.data, data.components, counted, offering.id, settings]);

  const snap = useWrite(() => must(supabase.from('attainment_snapshots').insert({ offering_id: offering.id, payload: report, settings, computed_by: me?.facultyId })));

  if (obe.isLoading) return <Spinner />;
  if (obe.error) return <ErrorNote error={obe.error} />;
  if (!obe.data?.canSeeMarks) return <Card><Empty icon={<Lock className="size-6" />} title="Attainment is computed from student marks">Only this course's teachers, exam-role holders and admins can open it.</Empty></Card>;
  if (!obe.data.cos.length) return <Card><Empty title="Define course outcomes first" action={<Link className="link" to={`/courses/${offering.id}/outcomes`}>Go to course outcomes</Link>} /></Card>;
  const r = report!;
  const attained = r.cos.filter((c) => c.attained).length;

  const exportCsv = () => {
    const head = ['Student ID', 'Name', ...obe.data!.cos.map((c) => `${c.code} %`)];
    const lines = obe.data!.students.map((s) => [s.student_no, `"${s.name.replace(/"/g, '""')}"`, ...obe.data!.cos.map((c) => r.studentCo[s.id]?.[c.id] ?? '')].join(','));
    const url = URL.createObjectURL(new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `${course.code.replace(' ', '')}-${data.term.code}-co-attainment.csv` });
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <Callout tone="info">A CO is attained when at least <b>{settings.x_pct}%</b> of students score at least <b>{settings.y_pct}%</b> on the questions tagged to it.
        Only items with published or locked marks are counted ({counted.length} of {items.filter((i) => i.status !== 'cancelled').length}); best-N rules drop each student's weakest items.</Callout>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="COs attained" value={`${attained}/${r.cos.length}`} tone={attained === r.cos.length ? 'ok' : 'warn'} />
        <Stat label="Students" value={obe.data.students.length} />
        <Stat label="Questions tagged" value={r.totalTagged} sub={r.untaggedQuestions ? `${r.untaggedQuestions} untagged` : 'All tagged'} tone={r.untaggedQuestions ? 'warn' : undefined} />
        <Stat label="Items counted" value={counted.length} />
      </div>
      <Card>
        <CardHeader title="Course outcome attainment" actions={<>
          <Button size="sm" icon={<Download className="size-4" aria-hidden />} onClick={exportCsv}>Student CO scores (CSV)</Button>
          <Button size="sm" variant="primary" icon={<Save className="size-4" aria-hidden />} loading={snap.isPending}
            onClick={() => snap.mutate(undefined, { onSuccess: () => toast('ok', 'Snapshot saved for the CAR'), onError: (e) => toast('bad', e.message) })}>Save snapshot</Button></>} />
        <div className="overflow-x-auto"><table className="table">
          <thead><tr><th>CO</th><th className="text-right">Marks assessed</th><th className="text-right">Students</th><th className="text-right">Reached {settings.y_pct}%</th><th className="text-right">Attainment</th><th>Result</th><th className="text-right">Level</th><th className="text-right">Class avg</th><th className="min-w-28">Distribution</th></tr></thead>
          <tbody>{r.cos.map((c) => {
            const co = obe.data!.cos.find((x) => x.id === c.coId)!;
            const peak = Math.max(1, ...c.distribution);
            return (
              <tr key={c.coId}>
                <td title={co.statement}><span className="font-mono font-semibold">{c.code}</span><div className="text-2xs text-muted max-w-56 truncate">{co.statement}</div></td>
                <td className="text-right tabular">{c.marksAvailable || <span className="text-warn">0</span>}</td>
                <td className="text-right tabular">{c.students}</td>
                <td className="text-right tabular">{c.attainedStudents}</td>
                <td className="text-right tabular font-semibold">{pct(c.attainmentPct)}</td>
                <td>{c.attained === null ? <Badge>No data</Badge> : c.attained ? <Badge tone="ok">Attained</Badge> : <Badge tone="bad">Not attained</Badge>}</td>
                <td className="text-right tabular">{c.level ?? '—'}</td>
                <td className="text-right tabular">{pct(c.averagePct)}</td>
                <td><div className="flex items-end gap-px h-6" role="img" aria-label={`Score distribution for ${c.code}: ${c.distribution.join(', ')} students per 10% band`}>
                  {c.distribution.map((n, i) => <span key={i} className={`flex-1 rounded-sm ${i * 10 >= settings.y_pct ? 'bg-brand' : 'bg-line-strong'}`} style={{ height: `${Math.max(6, (n / peak) * 100)}%`, opacity: n ? 1 : 0.35 }} />)}
                </div></td>
              </tr>);
          })}</tbody>
        </table></div>
      </Card>
      <Card>
        <CardHeader title="Contribution to program outcomes" subtitle="Correlation-weighted average of CO levels (0–3) for each PO this course maps to." />
        {r.pos.length ? <div className="flex flex-wrap gap-3 p-4">{r.pos.map((p) => (
          <div key={p.po} className="rounded border border-line px-3 py-2 min-w-24 text-center">
            <div className="text-2xs font-semibold text-subtle">{p.po}</div><div className="text-lg font-semibold tabular">{p.level.toFixed(2)}</div>
          </div>))}</div> : <p className="px-4 py-4 text-sm text-muted">Map outcomes to POs to see the course's contribution.</p>}
      </Card>
    </div>
  );
}
