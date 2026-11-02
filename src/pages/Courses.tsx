import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { TypeBadge } from '@/components/bits';
import { Card, Empty, ErrorNote, Input, Meter, PageHeader, SegTabs, Spinner } from '@/components/ui';
import { useTerm } from '@/lib/TermContext';
import { examProgress, labelOf, OUTLINE_STATUS } from '@/lib/workflow';

type Filter = 'all' | 'mine' | 'theory' | 'sessional';

export default function Courses() {
  const { me } = useAuth();
  const { data, loading, error, courseOf, teachersOf, nameOf } = useTerm();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    if (!data) return [];
    return data.offerings.map((o) => ({ o, c: courseOf(o)! })).filter(({ c }) => !!c)
      .filter(({ o, c }) => filter === 'all' || (filter === 'mine' ? teachersOf(o.id).includes(me?.facultyId ?? '') : filter === 'theory' ? c.course_type === 'theory' : c.course_type !== 'theory'))
      .filter(({ o, c }) => !q || `${c.code} ${c.title} ${teachersOf(o.id).map(nameOf).join(' ')}`.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => a.c.code.localeCompare(b.c.code));
  }, [data, filter, q, courseOf, teachersOf, nameOf, me]);

  if (loading) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;

  return (
    <>
      <PageHeader eyebrow={data.term.name} title="All courses" description={`${data.offerings.length} courses this term.`} />
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <SegTabs label="Filter courses" value={filter} onChange={setFilter}
          options={[{ value: 'all', label: 'All' }, { value: 'mine', label: 'Mine' }, { value: 'theory', label: 'Theory' }, { value: 'sessional', label: 'Sessional' }]} />
        <div className="relative w-full sm:w-72">
          <Search className="size-4 absolute left-2.5 top-2.5 text-subtle" aria-hidden />
          <label htmlFor="course-search" className="sr-only">Search courses</label>
          <Input id="course-search" className="pl-8" placeholder="Code, title or teacher" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <Card className="overflow-hidden">
        {rows.length === 0 ? <Empty title="No courses match">Try another filter or search term.</Empty> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Course</th><th>Type</th><th>Teachers</th><th>Outline</th><th className="min-w-44">Progress</th></tr></thead>
              <tbody>
                {rows.map(({ o, c }) => {
                  const hasExam = data.exam.some((x) => x.offering_id === o.id);
                  const p = examProgress(data.tasks.filter((t) => t.offering_id === o.id));
                  const items = data.items.filter((i) => i.offering_id === o.id && i.status !== 'cancelled');
                  const held = items.filter((i) => i.status === 'held').length;
                  const rec = data.records.find((r) => r.offering_id === o.id);
                  return (
                    <tr key={o.id}>
                      <td><Link to={`/courses/${o.id}`} className="link font-mono text-sm">{c.code}</Link><div className="text-2xs text-muted max-w-64 truncate">{c.title}</div></td>
                      <td><TypeBadge type={c.course_type} /></td>
                      <td className="text-sm text-muted max-w-64"><span className="line-clamp-2">{teachersOf(o.id).map(nameOf).join(', ') || '—'}</span></td>
                      <td className="text-2xs text-muted">{rec ? labelOf(OUTLINE_STATUS, rec.outline_status) : '—'}</td>
                      <td>
                        {hasExam ? <><div className="text-2xs text-muted mb-1">Exam: {p.current ? p.current.short : 'Complete'} · {p.done}/{p.total}</div><Meter value={p.done} max={p.total} label={`${c.code} exam progress`} /></>
                          : items.length ? <><div className="text-2xs text-muted mb-1">Assessments held {held}/{items.length}</div><Meter value={held} max={items.length} label={`${c.code} assessments held`} /></>
                          : <span className="text-2xs text-subtle">No assessments yet</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
