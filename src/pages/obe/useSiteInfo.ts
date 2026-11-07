// What the website knows about a course this term, for the course folder: course details, its teachers (names from the assignment,
// rooms / emails / phones from the course's Outline page), the class routine and session from that page, and the term.
import { useQuery } from '@tanstack/react-query';
import type { SiteInfo } from '@/lib/courseFolder/model';
import { supabase } from '@/lib/supabase';
import { useTerm } from '@/lib/TermContext';
import type { ObeDocs } from '@/lib/types';
import { sameName } from '../course/obe/docData';

export function useSiteInfo(offeringId: string | undefined): { site: SiteInfo | null; loading: boolean } {
  const { data, courseOf, teachersOf, nameOf, faculty } = useTerm();
  const offering = data?.offerings.find((o) => o.id === offeringId);
  const docs = useQuery({
    queryKey: ['siteDocs', offeringId], enabled: !!offering,
    queryFn: async () => {
      const { data: d, error } = await supabase.from('obe_offering_docs').select('*').eq('offering_id', offeringId!).maybeSingle();
      if (error) return null;   // the outline page's table may not exist yet: course details and teachers still come through
      return d as ObeDocs | null;
    },
  });
  const course = offering && courseOf(offering);
  if (!offering || !course || !data) return { site: null, loading: false };
  const outlineTeachers = docs.data?.instructors ?? [];
  const assigned = teachersOf(offering.id);
  const faculties = (assigned.length ? assigned.map((id) => {
    const name = nameOf(id), hit = outlineTeachers.find((i) => sameName(i.name, name));
    return { name, section: '', office_room: hit?.room ?? '', email: hit?.email || (faculty.find((f) => f.id === id)?.email ?? ''), telephone: hit?.phone ?? '', consultation: '' };
  }) : outlineTeachers.map((i) => ({ name: i.name, section: '', office_room: i.room ?? '', email: i.email ?? '', telephone: i.phone ?? '', consultation: '' })));
  return {
    loading: docs.isLoading,
    site: {
      courseNo: course.code, title: course.title, credit: course.credits, contactHours: course.contact_hours == null ? '' : String(course.contact_hours),
      level: course.level == null ? '' : String(course.level), term: course.term_no == null ? '' : String(course.term_no),
      session: docs.data?.academic_session ?? '', semester: data.term.name, courseType: course.course_type === 'theory' ? 'theory' : 'sessional',
      faculties, routine: [], routineText: docs.data?.class_routine ?? '',
    },
  };
}
