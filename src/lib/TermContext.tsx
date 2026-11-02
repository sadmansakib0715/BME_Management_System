import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useCourses, useFaculty, useTermData, useTerms, type TermData } from './api';
import type { Course, Faculty, Offering, Term } from './types';

interface TermCtx {
  terms: Term[]; termId: string | undefined; setTermId: (id: string) => void;
  data: TermData | undefined; loading: boolean; error: Error | null;
  courses: Course[]; faculty: Faculty[];
  courseOf: (o: Offering | string) => Course | undefined;
  offeringByCode: (code: string) => Offering | undefined;
  nameOf: (facultyId: string | null | undefined) => string;
  teachersOf: (offeringId: string, sectionId?: string) => string[];
}
const Ctx = createContext<TermCtx | null>(null);
const KEY = 'bme.term';

export function TermProvider({ children }: { children: ReactNode }) {
  const terms = useTerms();
  const courses = useCourses();
  const faculty = useFaculty();
  const [termId, setTermIdState] = useState<string | undefined>(() => {
    try { return localStorage.getItem(KEY) ?? undefined; } catch { return undefined; }
  });
  useEffect(() => {
    const list = terms.data ?? [];
    if (!list.length) return;
    if (!termId || !list.some((t) => t.id === termId)) setTermIdState((list.find((t) => t.is_current) ?? list[0]).id);
  }, [terms.data, termId]);
  const setTermId = (id: string) => { setTermIdState(id); try { localStorage.setItem(KEY, id); } catch { /* private mode */ } };
  const td = useTermData(termId);

  const value = useMemo<TermCtx>(() => {
    const cmap = new Map((courses.data ?? []).map((c) => [c.id, c]));
    const fmap = new Map((faculty.data ?? []).map((f) => [f.id, f]));
    const offs = td.data?.offerings ?? [];
    const offById = new Map(offs.map((o) => [o.id, o]));
    return {
      terms: terms.data ?? [], termId, setTermId, data: td.data, loading: terms.isLoading || td.isLoading || courses.isLoading,
      error: (terms.error ?? td.error ?? courses.error ?? null) as Error | null,
      courses: courses.data ?? [], faculty: faculty.data ?? [],
      courseOf: (o) => cmap.get(typeof o === 'string' ? offById.get(o)?.course_id ?? '' : o.course_id),
      offeringByCode: (code) => offs.find((o) => cmap.get(o.course_id)?.code === code),
      nameOf: (id) => (id ? fmap.get(id)?.display_name ?? 'Unknown' : 'Unassigned'),
      teachersOf: (offeringId, sectionId) => {
        const secs = (td.data?.sections ?? []).filter((s) => s.offering_id === offeringId && (!sectionId || s.id === sectionId)).map((s) => s.id);
        const ids = (td.data?.teachers ?? []).filter((t) => secs.includes(t.section_id)).sort((a, b) => a.position - b.position).map((t) => t.faculty_id);
        return [...new Set(ids)];
      },
    };
  }, [terms.data, terms.isLoading, terms.error, termId, td.data, td.isLoading, td.error, courses.data, courses.isLoading, courses.error, faculty.data]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTerm() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTerm outside TermProvider');
  return v;
}
