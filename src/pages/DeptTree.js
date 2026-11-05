import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import TermTree from '@/components/TermTree';
import { Empty, ErrorNote, PageHeader, Spinner } from '@/components/ui';
import { useTerm } from '@/lib/TermContext';
/** Every course of the term in one tree, grouped by level and term. Open a course to see and edit its steps. */
export default function DeptTree() {
    const { data, loading, error } = useTerm();
    if (loading)
        return _jsx(Spinner, {});
    if (error)
        return _jsx(ErrorNote, { error: error });
    if (!data)
        return _jsx(Empty, { title: "No term set up yet", children: "Create a term in Term setup, or import the department workbook." });
    return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { eyebrow: data.term.name, title: "Department progress tree", description: "Every course this term, grouped by level and term. Open a course to see each step; you can change the steps you are responsible for." }), _jsx(TermTree, { data: data, offerings: data.offerings, label: "BME department", hint: `${data.offerings.length} courses`, byLevel: true })] }));
}
