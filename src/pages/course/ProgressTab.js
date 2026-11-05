import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import ProgressTree from '@/components/ProgressTree';
import { useTreeEdits } from '@/components/TermTree';
import { Button, ErrorNote, Spinner, useToast } from '@/components/ui';
import { useCourseObe } from '@/lib/api';
import { buildCourseTree } from '@/lib/progressTree';
import { useTerm } from '@/lib/TermContext';
import { ComponentDialog, newComponentDraft, useSaveComponent } from './AssessmentsTab';
/** The live progress tree for one offering: every step of the course, editable in place like the lists on the other tabs. */
export default function ProgressTab({ offering, course, data }) {
    const { me, isAdmin } = useAuth();
    const { teachersOf } = useTerm();
    const toast = useToast();
    const obe = useCourseObe(offering, data.term);
    const { canEdit, onPick, onSetDate, dateDialog } = useTreeEdits(data);
    const comps = data.components.filter((c) => c.offering_id === offering.id);
    const sections = course.course_type === 'theory' ? [] : data.sections.filter((s) => s.offering_id === offering.id);
    const [draft, setDraft] = useState(null);
    const saveComp = useSaveComponent(offering.id, comps.length, course.course_type === 'theory');
    const teaches = isAdmin || teachersOf(offering.id).includes(me?.facultyId ?? '');
    if (obe.isLoading)
        return _jsx(Spinner, { label: "Loading progress" });
    if (obe.error)
        return _jsx(ErrorNote, { error: obe.error });
    return (_jsxs(_Fragment, { children: [_jsx(ProgressTree, { root: buildCourseTree(offering, course, data, obe.data), onPick: onPick, canEdit: canEdit, onSetDate: onSetDate, actions: teaches && _jsx(Button, { size: "sm", icon: _jsx(Plus, { className: "size-4", "aria-hidden": true }), onClick: () => setDraft(newComponentDraft(course)), children: "Add assessment" }) }), dateDialog, _jsx(ComponentDialog, { draft: draft, onClose: () => setDraft(null), busy: saveComp.isPending, hasSections: sections.length > 1, onSave: (d) => saveComp.mutate(d, { onSuccess: () => { toast('ok', `${d.name.trim()} added`); setDraft(null); }, onError: (e) => toast('bad', e.message) }) }, draft ? 'open' : 'closed')] }));
}
