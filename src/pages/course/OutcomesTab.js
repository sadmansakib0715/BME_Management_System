import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
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
const SECTIONS = ['mapping', 'assessment', 'rubrics', 'attainment', 'outline', 'file', 'car'];
/** The course's OBE workspace: COs & mapping, the assessment map, rubrics, imported attainment, the outline, the course file and the CAR. */
export default function OutcomesTab(props) {
    const { me, isAdmin } = useAuth();
    const { teachersOf } = useTerm();
    // The section lives in ?s= so other pages (and the assessment map) can link straight to it.
    const [params, setParams] = useSearchParams();
    const section = SECTIONS.includes(params.get('s')) ? params.get('s') : 'mapping';
    const setSection = (s) => setParams(s === 'mapping' ? {} : { s }, { replace: true });
    const obe = useCourseObe(props.offering, props.data.term);
    const toast = useToast();
    const reviewed = useWrite(() => must(supabase.from('obe_offering_docs').update({ copied_from: null }).eq('offering_id', props.offering.id)));
    if (obe.isLoading)
        return _jsx(Spinner, {});
    if (obe.error || !obe.data)
        return _jsx(ErrorNote, { error: obe.error });
    // A final CAR freezes the COs and mapping for teachers; admins can still correct them.
    const teaches = isAdmin || teachersOf(props.offering.id).includes(me?.facultyId ?? '');
    const p = { ...props, obe: obe.data, canEdit: teaches && (isAdmin || obe.data.car?.status !== 'final'), isAdmin };
    const carried = obe.data.docs?.copied_from && obe.data.prev?.id === obe.data.docs.copied_from ? obe.data.prev.termName : obe.data.docs?.copied_from ? 'the last offering' : null;
    return (_jsxs("div", { className: "space-y-5", children: [_jsx(SegTabs, { label: "OBE section", value: section, onChange: setSection, options: [{ value: 'mapping', label: 'COs & mapping' }, { value: 'assessment', label: 'Assessment map' }, { value: 'rubrics', label: 'Rubrics' }, { value: 'attainment', label: 'Attainment' },
                    { value: 'outline', label: 'Outline' }, { value: 'file', label: 'Course file' }, { value: 'car', label: 'CAR' }] }), obe.data.missing.length > 0 && _jsxs(Callout, { tone: "warn", title: "The database needs the OBE update", children: ["This project's database has no ", obe.data.missing.join(', '), " table yet, so the assessment map, rubrics and outline cannot be shown or saved.", isAdmin ? _jsxs(_Fragment, { children: [" In Supabase \u2192 SQL Editor, run ", _jsx("span", { className: "font-mono", children: "supabase/update_obe_master.sql" }), " (or only ", _jsx("span", { className: "font-mono", children: "supabase/update_obe_schema.sql" }), " for the tables), then reload this page."] }) : ' Ask the department admin to run the OBE update.'] }), carried && _jsx(Callout, { tone: "info", title: `Carried forward from ${carried}`, children: _jsxs("div", { className: "flex flex-wrap items-center gap-3", children: [_jsxs("span", { children: ["The COs, mapping, assessment map, rubrics and outline start from ", carried, ". Revise what changed this term, then mark them reviewed."] }), p.canEdit && _jsx(Button, { size: "sm", loading: reviewed.isPending, onClick: () => reviewed.mutate(undefined, { onSuccess: () => toast('ok', 'Marked reviewed'), onError: (e) => toast('bad', e.message) }), children: "Mark reviewed" })] }) }), section === 'mapping' && _jsx(CoMapping, { ...p }), section === 'assessment' && _jsx(AssessmentMap, { ...p }), section === 'rubrics' && _jsx(Rubrics, { ...p }), section === 'outline' && _jsx(Outline, { ...p }), section === 'attainment' && _jsx(Attainment, { ...p }), section === 'file' && _jsx(CourseFile, { ...p }), section === 'car' && _jsx(Car, { ...p })] }));
}
