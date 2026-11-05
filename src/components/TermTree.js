import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import ProgressTree from '@/components/ProgressTree';
import { ErrorNote, Spinner, useToast } from '@/components/ui';
import { must, rpc, useObeTerm, useWrite } from '@/lib/api';
import { buildForest, courseNode, obeSlice } from '@/lib/progressTree';
import { supabase } from '@/lib/supabase';
import { useTerm } from '@/lib/TermContext';
import { stepOwner } from '@/lib/workflow';
import { RescheduleDialog } from '@/pages/course/AssessmentsTab';
/**
 * Status writes from a progress tree. Each goes through the same write the course's own tabs use, with the same
 * permissions, and every write refreshes 'term' and 'obe', so the tree redraws by itself.
 * Dates go through the course page's date dialog (clash check, change history); render `dateDialog` beside the tree.
 */
export function useTreeEdits(data) {
    const { me, isAdmin, isHod } = useAuth();
    const { teachersOf } = useTerm();
    const toast = useToast();
    const [dating, setDating] = useState(null);
    const datingItem = data.items.find((i) => i.id === dating) ?? null;
    const canEdit = (t) => {
        if (isAdmin)
            return true;
        const mine = (who) => !!who && who === me?.facultyId;
        switch (t.kind) {
            case 'exam': {
                const exam = data.exam.find((a) => a.offering_id === t.offering);
                return t.step === 'printing' ? false : t.step === 'hod' ? isHod || mine(stepOwner(exam, t.step)) : mine(stepOwner(exam, t.step));
            }
            case 'gradesheet': {
                const gs = data.gradesheets.find((g) => g.offering_id === t.offering);
                return mine(t.part === 'prep' ? gs?.preparer : gs?.scrutinizer);
            }
            default: return teachersOf(t.offering).includes(me?.facultyId ?? '');
        }
    };
    const write = useWrite(async ({ t, v }) => {
        switch (t.kind) {
            case 'exam': return rpc.setExamTask({ offering: t.offering, step: t.step, status: v });
            case 'gradesheet': return rpc.setGradesheet({ offering: t.offering, part: t.part, status: v });
            case 'record': return must(supabase.from('course_records').update({ [t.field]: v, updated_at: new Date().toISOString() }).eq('offering_id', t.offering));
            case 'item': return must(supabase.from('assessment_items').update({ [t.field]: v }).eq('id', t.itemId));
        }
    });
    const onPick = (t, v) => write.mutateAsync({ t, v }).then((r) => { toast('ok', 'Status updated'); return r; }, (e) => { toast('bad', e.message); throw e; });
    const dateDialog = _jsx(RescheduleDialog, { item: datingItem, onClose: () => setDating(null), admin: isAdmin });
    return { canEdit, onPick, onSetDate: setDating, dateDialog };
}
const levelTerm = (c) => (c.level ? `Level ${c.level}${c.term_no ? `, Term ${c.term_no}` : ''}` : 'Other');
/** Several courses in one tree. Each course starts folded; open one to see its branches and edit its steps. */
export default function TermTree({ data, offerings, label, hint, byLevel }) {
    const { courseOf } = useTerm();
    const obe = useObeTerm(data.term.id, data.offerings.map((o) => o.id));
    const { canEdit, onPick, onSetDate, dateDialog } = useTreeEdits(data);
    if (obe.isLoading)
        return _jsx(Spinner, { label: "Loading progress" });
    if (obe.error)
        return _jsx(ErrorNote, { error: obe.error });
    const rows = offerings.map((o) => ({ o, c: courseOf(o) })).filter((r) => !!r.c)
        .sort((a, b) => (a.c.level ?? 9) - (b.c.level ?? 9) || (a.c.term_no ?? 9) - (b.c.term_no ?? 9) || a.c.code.localeCompare(b.c.code));
    const root = buildForest(label, hint, rows.map(({ o, c }) => ({
        node: courseNode(o, c, data, obe.data && obeSlice(obe.data, o.id)), group: byLevel ? levelTerm(c) : undefined
    })));
    return _jsxs(_Fragment, { children: [_jsx(ProgressTree, { root: root, onPick: onPick, canEdit: canEdit, onSetDate: onSetDate, foldAt: byLevel ? 2 : 1 }), dateDialog] });
}
