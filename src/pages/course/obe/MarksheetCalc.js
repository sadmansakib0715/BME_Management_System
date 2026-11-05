import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { Download, FileSpreadsheet, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Callout, Card, CardHeader, Dialog, useToast } from '@/components/ui';
import { rpc, useWrite } from '@/lib/api';
import { buildResultsWorkbook, buildTemplate, computeAttainment, coPoCodes, mapFingerprint, marksheetColumns, parseMarksheet } from '@/lib/attainment';
import { criteriaWarnings, fmtPct } from '@/lib/obe';
import { supabase } from '@/lib/supabase';
import { YesNo } from './shared';
const fileSafe = (s) => s.replace(/[^\w.-]+/g, '_');
const errorsOf = (xs) => xs.filter((i) => i.level === 'error');
const warningsOf = (xs) => xs.filter((i) => i.level === 'warning');
/** Calculate CO and PO attainment from a filled marksheet. The template comes from the assessment map, so once the COs, mapping and
    assessment map are set, uploading the marks is all that is left. Marks are read here in the browser and never stored. */
export default function MarksheetCalc({ offering, course, data, obe, canEdit }) {
    const toast = useToast();
    const input = useRef(null);
    const [preview, setPreview] = useState(null);
    const [busy, setBusy] = useState(false);
    const t = { studentCo: Number(offering.co_threshold ?? 0.4), cohortCo: Number(offering.cohort_threshold ?? 0.4),
        studentPo: Number(offering.po_threshold ?? 0.4), cohortPo: Number(offering.po_threshold ?? 0.4) };
    const columns = useMemo(() => marksheetColumns(obe.cos, obe.criteria, obe.criterionCos), [obe.cos, obe.criteria, obe.criterionCos]);
    const coToPo = useMemo(() => coPoCodes(obe.cos, obe.coPo), [obe.cos, obe.coPo]);
    const coCodes = obe.cos.map((_, i) => `CO${i + 1}`);
    const mapWarnings = criteriaWarnings(obe.cos, obe.criteria, obe.criterionCos);
    const title = `${course.code} · ${course.title} · ${data.term.name}`;
    const run = obe.run;
    const stale = run && (run.map_hash !== mapFingerprint(columns, coToPo) || JSON.stringify(run.thresholds) !== JSON.stringify(t));
    const downloadTemplate = async () => {
        setBusy(true);
        try {
            const X = await import('xlsx');
            // The roster pre-fills the student rows when it has been loaded; otherwise the teacher types the IDs.
            const { data: en } = await supabase.from('enrolments').select('students(student_no, name)').eq('offering_id', offering.id);
            const roster = (en ?? [])
                .flatMap((e) => (e.students ? [{ studentNo: e.students.student_no, name: e.students.name }] : []))
                .sort((a, b) => a.studentNo.localeCompare(b.studentNo));
            X.writeFile(buildTemplate(X, { title, columns, roster }), fileSafe(`${course.code} ${data.term.name} marksheet.xlsx`));
        }
        catch (e) {
            toast('bad', e.message);
        }
        finally {
            setBusy(false);
        }
    };
    const onFile = async (f) => {
        if (!f)
            return;
        setBusy(true);
        try {
            const X = await import('xlsx');
            const wb = X.read(await f.arrayBuffer(), { type: 'array' });
            const parsed = parseMarksheet(X, wb, columns);
            const result = errorsOf(parsed.issues).length ? null : computeAttainment({ columns, students: parsed.students, coCodes, coToPo, t });
            setPreview({ fileName: f.name, issues: [...parsed.issues, ...(result?.issues ?? [])], result });
        }
        catch (e) {
            toast('bad', `Could not read ${f.name}: ${e.message}`);
        }
        finally {
            setBusy(false);
            if (input.current)
                input.current.value = '';
        }
    };
    const save = useWrite((p) => {
        const r = p.result;
        return rpc.saveComputed({
            offering: offering.id,
            cohort: [...coCodes.map((c) => ({ outcome_type: 'CO', code: c, value: r.co[c].value })),
                ...Object.entries(r.po).map(([c, v]) => ({ outcome_type: 'PO', code: c, value: v.value }))],
            students: r.students.flatMap((s) => [...Object.entries(s.co).map(([c, v]) => ({ student_no: s.studentNo, outcome_type: 'CO', code: c, value: v })),
                ...Object.entries(s.po).map(([c, v]) => ({ student_no: s.studentNo, outcome_type: 'PO', code: c, value: v }))]),
            run: { file_name: p.fileName, students: r.students.length, columns: columns.length, thresholds: t, map_hash: mapFingerprint(columns, coToPo),
                warnings: warningsOf(p.issues).map((i) => i.message), samples: r.samples },
        });
    });
    // Results workbook rebuilt from what was saved (per-student CO%/PO%), for the course file.
    const downloadResults = async () => {
        const X = await import('xlsx');
        const rt = run?.thresholds ?? t;
        const byStudent = new Map();
        for (const s of obe.students) {
            const r = byStudent.get(s.student_no) ?? { studentNo: s.student_no, name: '', co: {}, po: {} };
            (s.outcome_type === 'CO' ? r.co : r.po)[s.code] = s.value === null ? null : Number(s.value);
            byStudent.set(s.student_no, r);
        }
        const students = [...byStudent.values()];
        const cohort = (pick, st, ct) => {
            const vals = students.map(pick).filter((v) => v !== null && v !== undefined);
            const count = vals.filter((v) => v >= st * 100 - 1e-9).length;
            const value = vals.length ? (count / vals.length) * 100 : null;
            return { value, attained: value === null ? null : value >= ct * 100 - 1e-9, count, n: vals.length };
        };
        const poCodes = [...new Set(obe.students.filter((s) => s.outcome_type === 'PO').map((s) => s.code))].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
        const result = { students, issues: [], samples: run?.samples ?? [],
            co: Object.fromEntries(coCodes.map((c) => [c, cohort((s) => s.co[c], rt.studentCo, rt.cohortCo)])),
            po: Object.fromEntries(poCodes.map((p) => [p, cohort((s) => s.po[p], rt.studentPo, rt.cohortPo)])) };
        X.writeFile(buildResultsWorkbook(X, { title, result, coCodes, t: rt }), fileSafe(`${course.code} ${data.term.name} attainment.xlsx`));
    };
    const ready = obe.cos.length > 0 && columns.length > 0;
    const studentRows = useMemo(() => {
        const m = new Map();
        for (const s of obe.students)
            m.set(s.student_no, { ...(m.get(s.student_no) ?? {}), [s.code]: s.value === null ? null : Number(s.value) });
        return [...m.entries()];
    }, [obe.students]);
    const poCols = [...new Set(obe.students.filter((s) => s.outcome_type === 'PO').map((s) => s.code))].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
    return (_jsxs(_Fragment, { children: [_jsxs(Card, { children: [_jsx(CardHeader, { title: "Calculate from the marksheet", subtitle: _jsxs(_Fragment, { children: ["Download the template (one column per question part or criterion in the ", _jsx(Link, { className: "link", to: "?s=assessment", children: "assessment map" }), ", already tagged to COs), fill in the marks and upload it. CO and PO attainment are calculated at once. Marks stay on your computer; only the results are saved."] }), actions: _jsxs(_Fragment, { children: [_jsx(Button, { size: "sm", icon: _jsx(Download, { className: "size-4", "aria-hidden": true }), disabled: !ready, loading: busy && !preview, onClick: downloadTemplate, children: "Marksheet template" }), canEdit && _jsxs(_Fragment, { children: [_jsx("input", { ref: input, type: "file", accept: ".xlsx,.xls,.csv", className: "sr-only", id: "marksheet-file", onChange: (e) => onFile(e.target.files?.[0]) }), _jsx(Button, { size: "sm", variant: "primary", icon: _jsx(Upload, { className: "size-4", "aria-hidden": true }), disabled: !ready || busy, onClick: () => input.current?.click(), children: "Upload marksheet" })] })] }) }), _jsxs("div", { className: "p-4 space-y-3 text-sm", children: [!obe.cos.length && _jsx(Callout, { tone: "warn", children: "Add the COs and their PO mapping first (COs & mapping)." }), obe.cos.length > 0 && !columns.length && _jsxs(Callout, { tone: "warn", title: "The assessment map is empty", children: ["Add the question parts and rubric criteria with their marks and COs under ", _jsx(Link, { className: "link", to: "?s=assessment", children: "Assessment map" }), ". The marksheet template is built from it."] }), ready && _jsxs("p", { className: "text-muted", children: ["Template: ", columns.length, " ", columns.length === 1 ? 'column' : 'columns', " from the assessment map, CO1\u2013CO", obe.cos.length, ", student threshold ", t.studentCo * 100, "%, cohort threshold ", t.cohortCo * 100, "%."] }), ready && mapWarnings.length > 0 && _jsx(Callout, { tone: "warn", title: "Fix the assessment map first", children: _jsx("ul", { className: "list-disc pl-5", children: mapWarnings.slice(0, 6).map((w) => _jsx("li", { children: w }, w)) }) }), run && _jsxs("div", { className: "flex flex-wrap items-center gap-x-4 gap-y-2 rounded border border-line bg-sunken/50 px-3 py-2", children: [_jsx(FileSpreadsheet, { className: "size-4 text-muted", "aria-hidden": true }), _jsxs("span", { children: ["Last calculated ", new Date(run.computed_at).toLocaleString(), " from ", _jsx("span", { className: "font-medium", children: run.file_name ?? 'a marksheet' }), ": ", run.students, " students, ", run.columns, " columns."] }), studentRows.length > 0 && _jsx(Button, { size: "sm", variant: "ghost", icon: _jsx(Download, { className: "size-4", "aria-hidden": true }), onClick: downloadResults, children: "Results workbook" }), _jsx(Link, { className: "link text-sm", to: "?s=car", children: "Open the CAR" })] }), stale && _jsx(Callout, { tone: "warn", title: "Results may be out of date", children: "The assessment map, CO\u2192PO mapping or thresholds changed after the last calculation. Upload the marksheet again (download a fresh template if columns changed)." }), run && run.samples.length > 0 && _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Sample scripts for the course file" }), _jsx("th", { className: "text-right", children: "Max" }), _jsx("th", { className: "text-right", children: "Mean" }), _jsx("th", { children: "Highest" }), _jsx("th", { children: "Average" }), _jsx("th", { children: "Lowest" })] }) }), _jsx("tbody", { children: run.samples.map((s) => _jsxs("tr", { children: [_jsx("td", { className: "text-sm", children: s.assessment }), _jsx("td", { className: "text-right tabular text-sm", children: s.max }), _jsx("td", { className: "text-right tabular text-sm", children: s.mean === null ? 'NA' : s.mean.toFixed(2) }), [s.highest, s.average, s.lowest].map((x, i) => _jsx("td", { className: "text-sm tabular", children: x ? _jsxs(_Fragment, { children: [_jsx("span", { className: "font-mono", children: x.studentNo }), " ", _jsxs("span", { className: "text-muted", children: ["(", x.total, ")"] })] }) : '—' }, i))] }, s.assessment)) })] }) }), studentRows.length > 0 && _jsxs("details", { className: "rounded border border-line", children: [_jsxs("summary", { className: "cursor-pointer px-3 py-2 text-sm font-medium", children: ["Individual attainment (", studentRows.length, " students)"] }), _jsx("div", { className: "overflow-x-auto max-h-[28rem]", children: _jsxs("table", { className: "table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Student" }), coCodes.map((c) => _jsx("th", { className: "text-right", children: c }, c)), poCols.map((p) => _jsx("th", { className: "text-right", children: p }, p))] }) }), _jsx("tbody", { children: studentRows.map(([no, v]) => _jsxs("tr", { children: [_jsx("td", { className: "font-mono text-2xs", children: no }), [...coCodes, ...poCols].map((c) => {
                                                                const x = v[c] ?? null;
                                                                const low = x !== null && x < (c.startsWith('CO') ? t.studentCo : t.studentPo) * 100;
                                                                return _jsx("td", { className: `text-right tabular text-2xs ${low ? 'text-bad font-semibold' : ''}`, children: x === null ? 'NA' : x.toFixed(1) }, c);
                                                            })] }, no)) })] }) })] })] })] }), _jsx(Dialog, { open: !!preview, onClose: () => setPreview(null), title: `Check before saving · ${preview?.fileName ?? ''}`, wide: true, footer: _jsxs(_Fragment, { children: [_jsx(Button, { onClick: () => setPreview(null), children: "Cancel" }), _jsx(Button, { variant: "primary", disabled: !preview?.result || save.isPending, loading: save.isPending, onClick: () => preview && save.mutate(preview, { onSuccess: () => { toast('ok', `Attainment calculated for ${preview.result.students.length} students. Part B of the CAR is filled in.`); setPreview(null); }, onError: (e) => toast('bad', e.message) }), children: "Save results" })] }), children: preview && _jsxs("div", { className: "space-y-3", children: [errorsOf(preview.issues).length > 0 && _jsxs(Callout, { tone: "bad", title: "Fix these in the marksheet and upload again", children: [_jsx("ul", { className: "list-disc pl-5", children: errorsOf(preview.issues).slice(0, 15).map((i) => _jsx("li", { children: i.message }, i.message)) }), errorsOf(preview.issues).length > 15 && _jsxs("p", { className: "text-2xs mt-1", children: ["\u2026and ", errorsOf(preview.issues).length - 15, " more."] })] }), warningsOf(preview.issues).length > 0 && _jsx(Callout, { tone: "warn", title: "Check", children: _jsx("ul", { className: "list-disc pl-5", children: warningsOf(preview.issues).slice(0, 10).map((i) => _jsx("li", { children: i.message }, i.message)) }) }), preview.result && _jsxs(_Fragment, { children: [_jsxs("p", { className: "text-sm text-muted", children: [preview.result.students.length, " students. Saving replaces this offering's cohort CO/PO results and individual results."] }), _jsxs("div", { className: "grid gap-4 md:grid-cols-2", children: [_jsxs("table", { className: "table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "CO" }), _jsx("th", { className: "text-right", children: "% students" }), _jsx("th", { className: "text-right", children: "Attained / n" }), _jsx("th", { children: "Y/N" })] }) }), _jsx("tbody", { children: coCodes.map((c) => {
                                                        const v = preview.result.co[c];
                                                        return _jsxs("tr", { children: [_jsx("td", { className: "font-mono font-semibold", children: c }), _jsx("td", { className: "text-right tabular text-sm", children: fmtPct(v.value) }), _jsxs("td", { className: "text-right tabular text-2xs text-muted", children: [v.count, " / ", v.n] }), _jsx("td", { children: v.value === null ? _jsx("span", { className: "text-2xs text-warn font-medium", children: "Info missing" }) : _jsx(YesNo, { value: v.value, threshold: t.cohortCo }) })] }, c);
                                                    }) })] }), _jsxs("table", { className: "table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "PO" }), _jsx("th", { className: "text-right", children: "% students" }), _jsx("th", { className: "text-right", children: "Attained / n" }), _jsx("th", { children: "Y/N" })] }) }), _jsx("tbody", { children: Object.entries(preview.result.po).map(([p, v]) => _jsxs("tr", { children: [_jsx("td", { className: "font-mono font-semibold", children: p }), _jsx("td", { className: "text-right tabular text-sm", children: fmtPct(v.value) }), _jsxs("td", { className: "text-right tabular text-2xs text-muted", children: [v.count, " / ", v.n] }), _jsx("td", { children: _jsx(YesNo, { value: v.value, threshold: t.cohortPo }) })] }, p)) })] })] })] })] }) })] }));
}
