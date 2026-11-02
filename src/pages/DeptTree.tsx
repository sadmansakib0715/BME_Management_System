import TermTree from '@/components/TermTree';
import { Empty, ErrorNote, PageHeader, Spinner } from '@/components/ui';
import { useTerm } from '@/lib/TermContext';

/** Every course of the term in one tree, grouped by level and term. Open a course to see and edit its steps. */
export default function DeptTree() {
  const { data, loading, error } = useTerm();
  if (loading) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Empty title="No term set up yet">Create a term in Term setup, or import the department workbook.</Empty>;
  return (
    <>
      <PageHeader eyebrow={data.term.name} title="Department progress tree" description="Every course this term, grouped by level and term. Open a course to see each step; you can change the steps you are responsible for." />
      <TermTree data={data} offerings={data.offerings} label="BME department" hint={`${data.offerings.length} courses`} byLevel />
    </>
  );
}
