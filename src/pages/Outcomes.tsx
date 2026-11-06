import { clsx } from 'clsx';
import { Link, useSearchParams } from 'react-router-dom';
import { Card, CardHeader, ErrorNote, PageHeader, Spinner } from '@/components/ui';
import { useObeTerm, usePOs, type ObeTerm, type TermData } from '@/lib/api';
import { CULMINATING_POS, DOMAIN_LEVELS, KPA, mappedPos } from '@/lib/obe';
import { useTerm } from '@/lib/TermContext';
import BugsCqi from './obe/BugsCqi';
import CourseFolder from './obe/CourseFolder';
import ObeCourses from './obe/ObeCourses';
import ProgramPo from './obe/ProgramPo';

/** OBE (spec sections 2, 8, 11, 14): course dashboard, program PO per batch, CO–PO coverage, BUGS & CQI, the course folder generator, and the framework itself. */
const TABS = [
  { key: 'courses', label: 'Courses' },
  { key: 'program', label: 'Program PO' },
  { key: 'coverage', label: 'Coverage' },
  { key: 'cqi', label: 'BUGS & CQI' },
  { key: 'folder', label: 'Course folder' },
  { key: 'framework', label: 'Framework' },
];

export default function Outcomes() {
  const { data, loading, error } = useTerm();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'courses';
  const obe = useObeTerm(data?.term.id, data?.offerings.map((o) => o.id) ?? []);
  if (loading || obe.isLoading) return <Spinner />;
  if (error || obe.error) return <ErrorNote error={error ?? obe.error} />;
  if (!data || !obe.data) return null;

  return (
    <>
      <PageHeader eyebrow={data.term.name} title="Outcome-based education (OBE)" description="Course outcomes and their mapping, attainment against the 40% thresholds, CARs, the program POs per batch, and the CQI loops." />
      <nav aria-label="OBE" className="-mx-4 sm:mx-0 px-4 sm:px-0 mb-5 overflow-x-auto">
        <ul className="flex gap-1 border-b border-line min-w-max">{TABS.map((t) => (
          <li key={t.key}><button type="button" onClick={() => setParams(t.key === 'courses' ? {} : { tab: t.key })} aria-current={tab === t.key ? 'page' : undefined}
            className={clsx('inline-flex items-center h-10 px-3 -mb-px border-b-2 text-sm font-medium transition-colors duration-150 cursor-pointer',
              tab === t.key ? 'border-brand text-brand-ink' : 'border-transparent text-muted hover:text-ink')}>{t.label}</button></li>))}</ul>
      </nav>
      {tab === 'courses' && <ObeCourses data={data} obe={obe.data} />}
      {tab === 'program' && <ProgramPo />}
      {tab === 'coverage' && <Coverage data={data} obe={obe.data} />}
      {tab === 'cqi' && <BugsCqi />}
      {tab === 'folder' && <CourseFolder termName={data?.term.name} />}
      {tab === 'framework' && <Framework />}
    </>
  );
}

function Coverage({ data, obe }: { data: TermData; obe: ObeTerm }) {
  const { courseOf } = useTerm();
  const pos = usePOs();
  if (!pos.data) return <Spinner />;
  const poList = pos.data.pos;
  const rows = data.offerings.map((o) => ({ o, c: courseOf(o)!, m: mappedPos(obe.cos.filter((x) => x.offering_id === o.id), obe.coPo) })).filter((r) => r.c).sort((a, b) => a.c.code.localeCompare(b.c.code));
  return (
    <Card>
      <CardHeader title="CO–PO coverage this term" subtitle="● = at least one CO of the course maps to the PO. Empty rows: COs not mapped yet." />
      <div className="overflow-x-auto"><table className="table">
        <thead><tr><th>Course</th>{poList.map((p) => <th key={p.code} className="text-center" title={p.title}>{p.code.replace('PO', '')}</th>)}</tr></thead>
        <tbody>{rows.map(({ o, c, m }) => (
          <tr key={o.id}><td><Link to={`/courses/${o.id}/outcomes`} className="link font-mono text-sm">{c.code}</Link></td>
            {poList.map((p) => <td key={p.code} className="p-1 text-center">{m.has(p.code) ? <span className="text-brand text-base" aria-label={`${c.code} maps to ${p.code}`}>●</span> : <span className="text-line-strong" aria-hidden>·</span>}</td>)}
          </tr>))}</tbody>
        <tfoot><tr><td className="px-3 py-2 text-2xs text-subtle">Courses covering</td>{poList.map((p) => { const n = rows.filter((r) => r.m.has(p.code)).length;
          return <td key={p.code} className={`px-1 py-2 text-center text-2xs tabular font-semibold ${n ? 'text-muted' : 'text-bad'}`}>{n}</td>; })}</tr></tfoot>
      </table></div>
    </Card>
  );
}

function Framework() {
  const pos = usePOs();
  if (!pos.data) return <Spinner />;
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card>
        <CardHeader title="Program educational objectives (PEOs)" subtitle="SAR §7.2. PEO attainment target: 60%." />
        <dl className="divide-y divide-line">{pos.data.peos.map((p) => <div key={p.code} className="px-4 py-2.5 text-sm"><dt className="font-semibold inline">{p.code}. </dt><dd className="inline text-muted">{p.statement}</dd></div>)}</dl>
      </Card>
      <Card>
        <CardHeader title="Culminating courses" subtitle="Only these feed program PO attainment, averaged per batch." />
        <ul className="divide-y divide-line">{Object.entries(CULMINATING_POS).map(([c, list]) => (
          <li key={c} className="px-4 py-2.5 text-sm flex flex-wrap gap-x-3"><span className="font-mono font-semibold w-20">{c}</span><span className="text-muted">PO{list.join(', PO')}</span></li>))}</ul>
      </Card>
      <Card className="xl:col-span-2">
        <CardHeader title="Program outcomes (POs)" subtitle="BAETE PO reference, with the knowledge profile each needs." />
        <div className="overflow-x-auto"><table className="table">
          <thead><tr><th>PO</th><th>Attribute</th><th>Knowledge profile</th><th>Statement</th></tr></thead>
          <tbody>{pos.data.pos.map((p) => <tr key={p.code}><td className="font-mono font-semibold">{p.code}</td><td className="text-sm whitespace-nowrap">{p.title}</td><td className="text-sm">{p.k_profiles ?? '—'}</td><td className="text-2xs text-muted">{p.statement}</td></tr>)}</tbody>
        </table></div>
      </Card>
      {KPA.map((g) => (
        <Card key={g.group}>
          <CardHeader title={g.group} />
          <dl className="divide-y divide-line">{g.items.map(([k, label]) => <div key={k} className="px-4 py-2 text-sm flex gap-3"><dt className="font-mono font-semibold w-8">{k}</dt><dd className="text-muted">{label}</dd></div>)}</dl>
        </Card>))}
      <Card>
        <CardHeader title="Domains and taxonomy levels" />
        <dl className="divide-y divide-line">{DOMAIN_LEVELS.map((d) => <div key={d.domain} className="px-4 py-2 text-sm flex gap-3"><dt className="font-semibold w-28">{d.domain}</dt><dd className="text-muted">{d.codes.join(', ')}</dd></div>)}</dl>
      </Card>
    </div>
  );
}
