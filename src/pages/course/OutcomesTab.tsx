import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { Button, Callout, ErrorNote, SegTabs, Spinner, useToast } from '@/components/ui';
import { must, useCourseObe, useWrite } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useTerm } from '@/lib/TermContext';
import AssessmentMap from './obe/AssessmentMap';
import Attainment from './obe/Attainment';
import Car from './obe/Car';
import CoMapping from './obe/CoMapping';
import CourseFile from './obe/CourseFile';
import Outline from './obe/Outline';
import Rubrics from './obe/Rubrics';
import type { TabProps } from './shared';

type Section = 'mapping' | 'assessment' | 'rubrics' | 'attainment' | 'outline' | 'file' | 'car';
const SECTIONS: Section[] = ['mapping', 'assessment', 'rubrics', 'attainment', 'outline', 'file', 'car'];

/** The course's OBE workspace: COs & mapping, the assessment map, rubrics, imported attainment, the outline, the course file and the CAR. */
export default function OutcomesTab(props: TabProps) {
  const { me, isAdmin } = useAuth();
  const { teachersOf } = useTerm();
  // The section lives in ?s= so other pages (and the assessment map) can link straight to it.
  const [params, setParams] = useSearchParams();
  const section: Section = SECTIONS.includes(params.get('s') as Section) ? (params.get('s') as Section) : 'mapping';
  const setSection = (s: Section) => setParams(s === 'mapping' ? {} : { s }, { replace: true });
  const obe = useCourseObe(props.offering, props.data.term);
  const toast = useToast();
  const reviewed = useWrite(() => must(supabase.from('obe_offering_docs').update({ copied_from: null }).eq('offering_id', props.offering.id)));
  if (obe.isLoading) return <Spinner />;
  if (obe.error || !obe.data) return <ErrorNote error={obe.error} />;
  // A final CAR freezes the COs and mapping for teachers; admins can still correct them.
  const teaches = isAdmin || teachersOf(props.offering.id).includes(me?.facultyId ?? '');
  const p = { ...props, obe: obe.data, canEdit: teaches && (isAdmin || obe.data.car?.status !== 'final'), isAdmin };
  const carried = obe.data.docs?.copied_from && obe.data.prev?.id === obe.data.docs.copied_from ? obe.data.prev.termName : obe.data.docs?.copied_from ? 'the last offering' : null;

  return (
    <div className="space-y-5">
      <SegTabs label="OBE section" value={section} onChange={setSection}
        options={[{ value: 'mapping', label: 'COs & mapping' }, { value: 'assessment', label: 'Assessment map' }, { value: 'rubrics', label: 'Rubrics' }, { value: 'attainment', label: 'Attainment' },
          { value: 'outline', label: 'Outline' }, { value: 'file', label: 'Course file' }, { value: 'car', label: 'CAR' }]} />
      {carried && <Callout tone="info" title={`Carried forward from ${carried}`}>
        <div className="flex flex-wrap items-center gap-3"><span>The COs, mapping, assessment map, rubrics and outline start from {carried}. Revise what changed this term, then mark them reviewed.</span>
          {p.canEdit && <Button size="sm" loading={reviewed.isPending} onClick={() => reviewed.mutate(undefined, { onSuccess: () => toast('ok', 'Marked reviewed'), onError: (e) => toast('bad', e.message) })}>Mark reviewed</Button>}</div>
      </Callout>}
      {section === 'mapping' && <CoMapping {...p} />}
      {section === 'assessment' && <AssessmentMap {...p} />}
      {section === 'rubrics' && <Rubrics {...p} />}
      {section === 'outline' && <Outline {...p} />}
      {section === 'attainment' && <Attainment {...p} />}
      {section === 'file' && <CourseFile {...p} />}
      {section === 'car' && <Car {...p} />}
    </div>
  );
}
