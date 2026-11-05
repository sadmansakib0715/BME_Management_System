import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { FileSpreadsheet, Upload } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Callout, Card, CardHeader, Field, Input, Stat, useToast } from '@/components/ui';
import { rpc, useWrite } from '@/lib/api';
import { useTerm } from '@/lib/TermContext';
export default function ImportPage() {
    const toast = useToast();
    const { setTermId } = useTerm();
    const [file, setFile] = useState(null);
    const [term, setTerm] = useState({ code: '', name: '', total_weeks: 14, latest_completed_week: 0 });
    const [res, setRes] = useState(null);
    const [busy, setBusy] = useState(false);
    const run = useWrite(() => rpc.importPlan({ ...res.plan, term }));
    async function read(f) {
        setFile(f);
        setBusy(true);
        setRes(null);
        const guess = f.name.match(/(jan|jul)[a-z]*[\s_-]*(\d{2,4})/i);
        if (guess && !term.code) {
            const y = guess[2].length === 2 ? `20${guess[2]}` : guess[2];
            const mon = guess[1].toLowerCase() === 'jan' ? 'January' : 'July';
            setTerm((t) => ({ ...t, code: `${y}-${mon === 'January' ? '01' : '07'}`, name: `${mon} ${y}` }));
        }
        try {
            const { parseWorkbook } = await import('@/lib/importer');
            setRes(parseWorkbook(await f.arrayBuffer(), term));
        }
        catch (e) {
            toast('bad', `Could not read the workbook: ${e.message}`);
        }
        setBusy(false);
    }
    return (_jsxs(_Fragment, { children: [_jsx("p", { className: "text-sm text-muted max-w-3xl mb-4", children: "Fills in the whole term from the Activity Tracker spreadsheet: courses, sections, teachers, exam roles, gradesheet roles, class-test dates and department dates. It is read in your browser, every correction is shown, and nothing is written until you confirm. Re-importing the same term updates it in place." }), _jsxs("div", { className: "grid gap-5 xl:grid-cols-[380px_1fr]", children: [_jsxs(Card, { children: [_jsx(CardHeader, { title: "1. Choose the file and term" }), _jsxs("div", { className: "p-4 space-y-3", children: [_jsxs("label", { className: "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-line-strong px-4 py-8 text-center cursor-pointer hover:bg-sunken/60 transition-colors duration-150", children: [_jsx(FileSpreadsheet, { className: "size-7 text-subtle", "aria-hidden": true }), _jsx("span", { className: "text-sm font-medium", children: file ? file.name : 'Choose the .xlsx workbook' }), _jsx("span", { className: "text-2xs text-subtle", children: "The file stays on this computer." }), _jsx("input", { type: "file", accept: ".xlsx", className: "sr-only", onChange: (e) => e.target.files?.[0] && read(e.target.files[0]) })] }), _jsxs("div", { className: "grid grid-cols-2 gap-3", children: [_jsx(Field, { label: "Term code", htmlFor: "i-code", children: _jsx(Input, { id: "i-code", value: term.code, onChange: (e) => setTerm({ ...term, code: e.target.value }), placeholder: "2026-01" }) }), _jsx(Field, { label: "Term name", htmlFor: "i-name", children: _jsx(Input, { id: "i-name", value: term.name, onChange: (e) => setTerm({ ...term, name: e.target.value }), placeholder: "January 2026" }) }), _jsx(Field, { label: "Teaching weeks", htmlFor: "i-w", children: _jsx(Input, { id: "i-w", type: "number", value: term.total_weeks, onChange: (e) => setTerm({ ...term, total_weeks: Number(e.target.value) }) }) }), _jsx(Field, { label: "Weeks completed", htmlFor: "i-c", children: _jsx(Input, { id: "i-c", type: "number", value: term.latest_completed_week, onChange: (e) => setTerm({ ...term, latest_completed_week: Number(e.target.value) }) }) })] }), _jsxs(Button, { variant: "primary", className: "w-full", icon: _jsx(Upload, { className: "size-4", "aria-hidden": true }), loading: run.isPending || busy, disabled: !res || res.errors.length > 0 || !term.code.trim() || !term.name.trim(), onClick: () => run.mutate(undefined, { onSuccess: (r) => { toast('ok', `Imported ${r.offerings} courses and ${r.items} assessment items`); setTermId(r.term_id); }, onError: (e) => toast('bad', e.message) }), children: ["Import into ", term.name || 'term'] }), _jsx("p", { className: "text-2xs text-subtle", children: "Course outcomes are not in the workbook; teachers add them on each course page. Anything can be adjusted afterwards in the other Term setup tabs." })] })] }), _jsx("div", { className: "space-y-5", children: !res ? _jsx(Card, { className: "p-6 text-sm text-muted", children: "The preview appears here after you choose a file." }) : _jsxs(_Fragment, { children: [_jsxs("div", { className: "grid grid-cols-2 md:grid-cols-4 gap-3", children: [_jsx(Stat, { label: "Courses", value: res.plan.offerings.length, sub: `${res.plan.exam.length} with exam chains` }), _jsx(Stat, { label: "Faculty", value: res.plan.faculty.length }), _jsx(Stat, { label: "Assessment items", value: res.plan.class_tests.length + res.plan.sessional_items.length }), _jsx(Stat, { label: "Deadlines", value: res.plan.milestones.length })] }), res.errors.length > 0 && _jsx(Callout, { tone: "bad", title: `${res.errors.length} problem${res.errors.length > 1 ? 's' : ''} must be fixed in the workbook first`, children: _jsx("ul", { className: "list-disc pl-5", children: res.errors.map((e, i) => _jsxs("li", { children: ["Sheet ", e.sheet, ": ", e.message] }, i)) }) }), _jsx(IssueList, { title: "Needs your review", tone: "warn", list: res.warnings }), _jsx(IssueList, { title: "Fixed automatically", tone: "ok", list: res.fixes })] }) })] })] }));
}
function IssueList({ title, tone, list }) {
    if (!list.length)
        return null;
    return (_jsxs(Card, { children: [_jsx(CardHeader, { title: _jsxs("span", { className: "flex items-center gap-2", children: [title, _jsx(Badge, { tone: tone, children: list.length })] }) }), _jsx("ul", { className: "divide-y divide-line max-h-80 overflow-y-auto", children: list.map((f, i) => (_jsxs("li", { className: "px-4 py-2 text-sm flex gap-3", children: [_jsxs("span", { className: "font-mono text-2xs text-subtle w-16 shrink-0 pt-0.5", children: [f.sheet, f.cell ? ` ${f.cell}` : ''] }), _jsx("span", { children: f.message })] }, i))) })] }));
}
