// Data access. Department-readable data for a term loads as one bundle (a department has tens of
// courses, not thousands). Course outcomes load per course. Marks and rosters are not kept in this system.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { humanError, supabase } from './supabase';
async function rows(q) {
    const { data, error } = await q;
    if (error)
        throw new Error(humanError(error));
    return data ?? [];
}
/** A table from a migration the project may not have run yet (PostgREST: "Could not find the table … in the schema cache"). */
const isMissingTable = (e) => { const x = e; return x?.code === 'PGRST205' || x?.code === '42P01' || /schema cache|does not exist/i.test(x?.message ?? ''); };
/** Like rows(), but a missing table gives [] and is recorded in `missing`, so the page still loads and can say what to run. */
async function optionalRows(table, missing, q) {
    const { data, error } = await q;
    if (error) {
        if (isMissingTable(error)) {
            missing.push(table);
            return [];
        }
        throw new Error(humanError(error));
    }
    return data ?? [];
}
const chunk = (xs, n = 150) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
/** `in` filter split into URL-safe chunks. */
async function rowsIn(table, col, ids, select = '*') {
    if (!ids.length)
        return [];
    const parts = await Promise.all(chunk(ids).map((c) => rows(supabase.from(table).select(select).in(col, c))));
    return parts.flat();
}
// ---------------------------------------------------------------- reference
export const useTerms = () => useQuery({ queryKey: ['terms'], queryFn: () => rows(supabase.from('terms').select('*').order('starts_on', { ascending: false, nullsFirst: false })) });
export const useFaculty = () => useQuery({ queryKey: ['faculty'], queryFn: () => rows(supabase.from('faculty').select('*').order('display_name')) });
export const useCourses = () => useQuery({ queryKey: ['courses'], queryFn: () => rows(supabase.from('courses').select('*').order('code')), staleTime: 3600_000 });
export const usePOs = () => useQuery({ queryKey: ['pos'], staleTime: 3600_000, queryFn: async () => ({
        pos: await rows(supabase.from('pos').select('*').order('no')), peos: await rows(supabase.from('peos').select('*').order('code')),
        map: await rows(supabase.from('peo_po_map').select('*'))
    }) });
export const useAllowedUsers = (enabled) => useQuery({ queryKey: ['allowed'], enabled, queryFn: () => rows(supabase.from('allowed_users').select('*').order('email')) });
export function useTermData(termId) {
    return useQuery({
        queryKey: ['term', termId], enabled: !!termId,
        queryFn: async () => {
            const [term] = await rows(supabase.from('terms').select('*').eq('id', termId));
            const offerings = await rows(supabase.from('offerings').select('*').eq('term_id', termId));
            const ids = offerings.map((o) => o.id);
            const [sections, exam, tasks, rounds, gradesheets, records, components, items, milestones] = await Promise.all([
                rowsIn('sections', 'offering_id', ids), rowsIn('exam_assignments', 'offering_id', ids),
                rowsIn('exam_tasks', 'offering_id', ids), rowsIn('moderation_rounds', 'offering_id', ids),
                rowsIn('sessional_gradesheets', 'offering_id', ids), rowsIn('course_records', 'offering_id', ids),
                rowsIn('assessment_components', 'offering_id', ids), rowsIn('assessment_items', 'offering_id', ids),
                rows(supabase.from('term_milestones').select('*').eq('term_id', termId)),
            ]);
            const teachers = await rowsIn('section_teachers', 'section_id', sections.map((s) => s.id));
            return { term, offerings, sections, teachers, exam, tasks, rounds, gradesheets, records, components, items, milestones };
        },
    });
}
/** The same course's most recent earlier offering: CAR Part B compares with it and Part D carries its Part E forward. */
async function previousOffering(offering, term) {
    const list = await rows(supabase.from('offerings').select('id, terms(code, name, starts_on)').eq('course_id', offering.course_id).neq('id', offering.id));
    const key = (t) => t.starts_on ?? t.code;
    const earlier = list.filter((x) => x.terms && key(x.terms) < key(term)).sort((a, b) => key(b.terms).localeCompare(key(a.terms)))[0];
    if (!earlier)
        return null;
    const cos = await rows(supabase.from('course_outcomes').select('*').eq('offering_id', earlier.id).order('sort'));
    const [coPo, attainment, car] = await Promise.all([
        rowsIn('co_po_map', 'co_id', cos.map((c) => c.id)),
        rows(supabase.from('obe_attainment').select('*').eq('offering_id', earlier.id)),
        rows(supabase.from('car_reports').select('*').eq('offering_id', earlier.id)),
    ]);
    return { id: earlier.id, termName: earlier.terms.name, cos, coPo, attainment, car: car[0] ?? null };
}
export function useCourseObe(offering, term) {
    return useQuery({
        queryKey: ['obe', offering?.id], enabled: !!offering && !!term,
        queryFn: async () => {
            const id = offering.id;
            const cos = await rows(supabase.from('course_outcomes').select('*').eq('offering_id', id).order('sort'));
            const missing = [];
            const [coPo, attainment, car, files, prev, docs, criteria, rubrics, runs, students] = await Promise.all([
                rowsIn('co_po_map', 'co_id', cos.map((c) => c.id)),
                rows(supabase.from('obe_attainment').select('*').eq('offering_id', id)),
                rows(supabase.from('car_reports').select('*').eq('offering_id', id)),
                rows(supabase.from('course_file_items').select('*').eq('offering_id', id)),
                previousOffering(offering, term),
                optionalRows('obe_offering_docs', missing, supabase.from('obe_offering_docs').select('*').eq('offering_id', id)),
                optionalRows('obe_criteria', missing, supabase.from('obe_criteria').select('*').eq('offering_id', id).order('sort')),
                optionalRows('rubrics', missing, supabase.from('rubrics').select('*').eq('offering_id', id).order('sort')),
                optionalRows('obe_attainment_runs', missing, supabase.from('obe_attainment_runs').select('*').eq('offering_id', id)),
                optionalRows('obe_student_attainment', missing, supabase.from('obe_student_attainment').select('*').eq('offering_id', id).order('student_no')),
            ]);
            const criterionCos = await rowsIn('obe_criterion_cos', 'criterion_id', criteria.map((c) => c.id));
            return { cos, coPo, attainment, car: car[0] ?? null, files, prev, docs: docs[0] ?? null, criteria, criterionCos, rubrics, run: runs[0] ?? null, students, missing };
        },
    });
}
export function useObeTerm(termId, offeringIds) {
    return useQuery({
        queryKey: ['obeTerm', termId, offeringIds.length], enabled: !!termId,
        queryFn: async () => {
            const cos = await rowsIn('course_outcomes', 'offering_id', offeringIds, 'id, offering_id, code');
            const [coPo, attainment, cars, files] = await Promise.all([
                rowsIn('co_po_map', 'co_id', cos.map((c) => c.id)),
                rowsIn('obe_attainment', 'offering_id', offeringIds),
                rowsIn('car_reports', 'offering_id', offeringIds, 'offering_id, status'),
                rowsIn('course_file_items', 'offering_id', offeringIds),
            ]);
            return { cos, coPo, attainment, cars, files };
        },
    });
}
export const useProgramPo = () => useQuery({ queryKey: ['programPo'], queryFn: () => rows(supabase.from('v_program_po').select('*')) });
export const useBugs = () => useQuery({ queryKey: ['bugs'], queryFn: () => rows(supabase.from('bugs_resolutions').select('*').order('held_on', { ascending: false, nullsFirst: false })) });
export const useCqi = () => useQuery({ queryKey: ['cqi'], queryFn: () => rows(supabase.from('cqi_items').select('*').order('created_at', { ascending: false })) });
export const useItemHistory = (itemId) => useQuery({
    queryKey: ['history', itemId], enabled: !!itemId,
    queryFn: () => rows(supabase.from('item_date_history').select('*').eq('item_id', itemId).order('changed_at', { ascending: false })),
});
// ---------------------------------------------------------------- mutations
/** Wraps any async write: throws readable errors and refreshes term + course data afterwards. */
export function useWrite(fn) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (a) => { try {
            return await fn(a);
        }
        catch (e) {
            throw new Error(humanError(e));
        } },
        // Writes are rare and the department dataset is small, so refreshing every cached view is cheap and never stale.
        onSuccess: () => { for (const k of ['term', 'terms', 'obe', 'obeTerm', 'programPo', 'bugs', 'cqi', 'history', 'faculty', 'courses', 'allowed', 'coverage'])
            qc.invalidateQueries({ queryKey: [k] }); },
    });
}
export async function must(p) {
    const { data, error } = await p;
    if (error)
        throw error;
    return data;
}
export const rpc = {
    setExamTask: (a) => must(supabase.rpc('set_exam_task', { p_offering: a.offering, p_step: a.step, p_status: a.status, p_note: a.note ?? null, p_half: a.half ?? null })),
    setGradesheet: (a) => must(supabase.rpc('set_sessional_gradesheet', { p_offering: a.offering, p_part: a.part, p_status: a.status })),
    generateItems: (component) => must(supabase.rpc('generate_items', { p_component: component })),
    reschedule: (a) => must(supabase.rpc('reschedule_item', { p_item: a.item, p_date: a.date, p_reason: a.reason ?? null, p_force: a.force ?? false })),
    /** Fills this offering's empty COs + mapping, assessment map and outline from the newest earlier offering. */
    copyForward: (offering) => must(supabase.rpc('obe_copy_forward', { p_offering: offering })),
    /** Saves a marksheet calculation (0015): per-student CO%/PO%, cohort CO%/PO% (source 'computed') and the run record, atomically. */
    saveComputed: (a) => must(supabase.rpc('obe_save_computed', { p_offering: a.offering, p_cohort: a.cohort, p_students: a.students, p_run: a.run })),
    importPlan: (plan) => must(supabase.rpc('import_term_plan', { p: plan })),
};
