import { useFaculty } from '@/lib/api';
import { useTerm } from '@/lib/TermContext';
import { courseInfo, teacherList } from './docData';
import type { ObeProps } from './shared';

/** Course header data shared by the outline, mapping, rubric and CAR PDFs. */
export function useCourseInfo({ offering, course, data, obe }: Pick<ObeProps, 'offering' | 'course' | 'data' | 'obe'>) {
  const { teachersOf, nameOf } = useTerm();
  const faculty = useFaculty();
  const emailOf = (name: string) => faculty.data?.find((f) => f.display_name === name || f.full_name === name)?.email ?? null;
  const teachers = teacherList(teachersOf(offering.id).map(nameOf), obe.docs?.instructors ?? [], emailOf);
  return courseInfo(course, offering, data.term.name, teachers);
}
