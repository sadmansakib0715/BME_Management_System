import { useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { ErrorNote, SegTabs, Spinner } from '@/components/ui';
import { useCourseObe } from '@/lib/api';
import { useTerm } from '@/lib/TermContext';
import Attainment from './obe/Attainment';
import Car from './obe/Car';
import CoMapping from './obe/CoMapping';
import CourseFile from './obe/CourseFile';
import type { TabProps } from './shared';

type Section = 'mapping' | 'attainment' | 'file' | 'car';

/** The course's OBE workspace: COs & mapping, imported attainment, the course file and the CAR. */
export default function OutcomesTab(props: TabProps) {
  const { me, isAdmin } = useAuth();
  const { teachersOf } = useTerm();
  const [section, setSection] = useState<Section>('mapping');
  const obe = useCourseObe(props.offering, props.data.term);
  if (obe.isLoading) return <Spinner />;
  if (obe.error || !obe.data) return <ErrorNote error={obe.error} />;
  // A final CAR freezes the COs and mapping for teachers; admins can still correct them.
  const teaches = isAdmin || teachersOf(props.offering.id).includes(me?.facultyId ?? '');
  const p = { ...props, obe: obe.data, canEdit: teaches && (isAdmin || obe.data.car?.status !== 'final'), isAdmin };

  return (
    <div className="space-y-5">
      <SegTabs label="OBE section" value={section} onChange={setSection}
        options={[{ value: 'mapping', label: 'COs & mapping' }, { value: 'attainment', label: 'Attainment' }, { value: 'file', label: 'Course file' }, { value: 'car', label: 'CAR' }]} />
      {section === 'mapping' && <CoMapping {...p} />}
      {section === 'attainment' && <Attainment {...p} />}
      {section === 'file' && <CourseFile {...p} />}
      {section === 'car' && <Car {...p} />}
    </div>
  );
}
