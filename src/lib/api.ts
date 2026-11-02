// Data access. Department-readable data for a term loads as one bundle (a department has tens of
// courses, not thousands). Student-level OBE data loads per course and only for permitted users (RLS).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { humanError, supabase } from './supabase';
import type {
  AssessmentComponent, AssessmentItem, AttainmentSettings, CoPo, Course, CourseOutcome, CourseRecord, Enrolment, ExamAssignment,
  ExamTask, Faculty, ItemDateHistory, Mark, Milestone, ModerationRound, Offering, PEO, PO, Question, Section, SectionTeacher,
  SessionalGradesheet, Student, Term, AllowedUser,
} from './types';

async function rows<T>(q: PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw new Error(humanError(error));
  return data ?? [];
}

const chunk = <T,>(xs: T[], n = 150) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
/** `in` filter split into URL-safe chunks. */
async function rowsIn<T>(table: string, col: string, ids: string[], select = '*'): Promise<T[]> {
  if (!ids.length) return [];
  const parts = await Promise.all(chunk(ids).map((c) => rows<T>(supabase.from(table).select(select).in(col, c) as never)));
  return parts.flat();
}

// ---------------------------------------------------------------- reference
export const useTerms = () => useQuery({ queryKey: ['terms'], queryFn: () => rows<Term>(supabase.from('terms').select('*').order('starts_on', { ascending: false, nullsFirst: false })) });
export const useFaculty = () => useQuery({ queryKey: ['faculty'], queryFn: () => rows<Faculty>(supabase.from('faculty').select('*').order('display_name')) });
export const useCourses = () => useQuery({ queryKey: ['courses'], queryFn: () => rows<Course>(supabase.from('courses').select('*').order('code')), staleTime: 3600_000 });
export const usePOs = () => useQuery({ queryKey: ['pos'], staleTime: 3600_000, queryFn: async () => ({
  pos: await rows<PO>(supabase.from('pos').select('*').order('no')), peos: await rows<PEO>(supabase.from('peos').select('*').order('code')),
  map: await rows<{ peo_code: string; po_code: string }>(supabase.from('peo_po_map').select('*')) }) });
export const useAllowedUsers = (enabled: boolean) => useQuery({ queryKey: ['allowed'], enabled, queryFn: () => rows<AllowedUser>(supabase.from('allowed_users').select('*').order('email')) });

// ---------------------------------------------------------------- term bundle
export interface TermData {
  term: Term; offerings: Offering[]; sections: Section[]; teachers: SectionTeacher[];
  exam: ExamAssignment[]; tasks: ExamTask[]; rounds: ModerationRound[]; gradesheets: SessionalGradesheet[]; records: CourseRecord[];
  components: AssessmentComponent[]; items: AssessmentItem[]; milestones: Milestone[]; settings: AttainmentSettings | null;
}

export function useTermData(termId: string | undefined) {
  return useQuery({
    queryKey: ['term', termId], enabled: !!termId,
    queryFn: async (): Promise<TermData> => {
      const [term] = await rows<Term>(supabase.from('terms').select('*').eq('id', termId!));
      const offerings = await rows<Offering>(supabase.from('offerings').select('*').eq('term_id', termId!));
      const ids = offerings.map((o) => o.id);
      const [sections, exam, tasks, rounds, gradesheets, records, components, items, milestones, settings] = await Promise.all([
        rowsIn<Section>('sections', 'offering_id', ids), rowsIn<ExamAssignment>('exam_assignments', 'offering_id', ids),
        rowsIn<ExamTask>('exam_tasks', 'offering_id', ids), rowsIn<ModerationRound>('moderation_rounds', 'offering_id', ids),
        rowsIn<SessionalGradesheet>('sessional_gradesheets', 'offering_id', ids), rowsIn<CourseRecord>('course_records', 'offering_id', ids),
        rowsIn<AssessmentComponent>('assessment_components', 'offering_id', ids), rowsIn<AssessmentItem>('assessment_items', 'offering_id', ids),
        rows<Milestone>(supabase.from('term_milestones').select('*').eq('term_id', termId!)),
        rows<AttainmentSettings>(supabase.from('attainment_settings').select('*').eq('term_id', termId!)),
      ]);
      const teachers = await rowsIn<SectionTeacher>('section_teachers', 'section_id', sections.map((s) => s.id));
      return { term, offerings, sections, teachers, exam, tasks, rounds, gradesheets, records, components, items, milestones, settings: settings[0] ?? null };
    },
  });
}

// ---------------------------------------------------------------- course OBE bundle
export interface CourseObe { cos: CourseOutcome[]; coPo: CoPo[]; questions: Question[]; marks: Mark[]; enrolments: Enrolment[]; students: Student[]; canSeeMarks: boolean }

export function useCourseObe(offeringId: string | undefined, itemIds: string[]) {
  return useQuery({
    queryKey: ['obe', offeringId, itemIds.length], enabled: !!offeringId,
    queryFn: async (): Promise<CourseObe> => {
      const cos = await rows<CourseOutcome>(supabase.from('course_outcomes').select('*').eq('offering_id', offeringId!).order('sort'));
      const [coPo, questions, enrolments] = await Promise.all([
        rowsIn<CoPo>('co_po_map', 'co_id', cos.map((c) => c.id)),
        rowsIn<Question>('assessment_questions', 'item_id', itemIds),
        rows<Enrolment>(supabase.from('enrolments').select('*').eq('offering_id', offeringId!)),
      ]);
      const [marks, students] = await Promise.all([
        rowsIn<Mark>('marks', 'question_id', questions.map((q) => q.id)),
        rowsIn<Student>('students', 'id', enrolments.map((e) => e.student_id)),
      ]);
      students.sort((a, b) => a.student_no.localeCompare(b.student_no));
      questions.sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label));
      // RLS returns zero enrolments to people who may not see students; that is the permission signal.
      return { cos, coPo, questions, marks, enrolments, students, canSeeMarks: enrolments.length > 0 };
    },
  });
}

export const useItemHistory = (itemId: string | undefined) => useQuery({
  queryKey: ['history', itemId], enabled: !!itemId,
  queryFn: () => rows<ItemDateHistory>(supabase.from('item_date_history').select('*').eq('item_id', itemId!).order('changed_at', { ascending: false })),
});

// ---------------------------------------------------------------- mutations
/** Wraps any async write: throws readable errors and refreshes term + course data afterwards. */
export function useWrite<A, R = unknown>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation<R, Error, A>({
    mutationFn: async (a: A) => { try { return await fn(a); } catch (e) { throw new Error(humanError(e)); } },
    // Writes are rare and the department dataset is small, so refreshing every cached view is cheap and never stale.
    onSuccess: () => { for (const k of ['term', 'terms', 'obe', 'history', 'faculty', 'courses', 'allowed', 'coverage']) qc.invalidateQueries({ queryKey: [k] }); },
  });
}

export async function must<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data;
}

export const rpc = {
  setExamTask: (a: { offering: string; step: string; status: string; note?: string; half?: 'A' | 'B' }) =>
    must(supabase.rpc('set_exam_task', { p_offering: a.offering, p_step: a.step, p_status: a.status, p_note: a.note ?? null, p_half: a.half ?? null })),
  setGradesheet: (a: { offering: string; part: 'prep' | 'scrutiny'; status: string }) =>
    must(supabase.rpc('set_sessional_gradesheet', { p_offering: a.offering, p_part: a.part, p_status: a.status })),
  generateItems: (component: string) => must(supabase.rpc('generate_items', { p_component: component })),
  reschedule: (a: { item: string; date: string | null; reason?: string; force?: boolean }) =>
    must(supabase.rpc('reschedule_item', { p_item: a.item, p_date: a.date, p_reason: a.reason ?? null, p_force: a.force ?? false })) as Promise<{ ok: boolean; conflicts: { course: string; title: string }[] }>,
  importPlan: (plan: unknown) => must(supabase.rpc('import_term_plan', { p: plan })) as Promise<{ offerings: number; items: number; term_id: string }>,
};

export const rosterRpc = {
  enrol: (a: { offering: string; rows: { student_no: string; name: string; section?: string; batch?: string }[] }) =>
    must(supabase.rpc('enrol_students', { p_offering: a.offering, p_rows: a.rows })) as Promise<{ added: number; enrolled: number; rejected: { student_no: string; reason: string }[] }>,
  copy: (a: { from: string; to: string }) => must(supabase.rpc('copy_roster', { p_from: a.from, p_to: a.to })) as Promise<number>,
};
