import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Card, CardHeader, Callout, Empty, ErrorNote, SegTabs, Spinner } from '@/components/ui';
import { usePOs, useProgramPo } from '@/lib/api';
import { attained, CULMINATING_POS, fmtPct } from '@/lib/obe';
import { PctBar, YesNo } from '../course/obe/shared';
/** Program PO per batch: the mean of BME 300, 350 and 400 cohort PO% (BAETE PO reference, level 4). */
export default function ProgramPo() {
    const prog = useProgramPo();
    const pos = usePOs();
    const batches = [...new Set((prog.data ?? []).map((r) => r.batch))].sort().reverse();
    const [pick, setPick] = useState(null);
    if (prog.isLoading || pos.isLoading)
        return _jsx(Spinner, {});
    if (prog.error)
        return _jsx(ErrorNote, { error: prog.error });
    if (!batches.length)
        return _jsx(Card, { children: _jsx(Empty, { title: "No program PO results yet", children: "They appear once BME 300, 350 or 400 have PO attainment and a student batch (set both on the course's OBE tab, under Attainment)." }) });
    const batch = pick ?? batches[0];
    const rows = (prog.data ?? []).filter((r) => r.batch === batch);
    const done = new Set(rows.flatMap((r) => r.course_codes));
    const provisional = Object.keys(CULMINATING_POS).filter((c) => !done.has(c));
    return (_jsxs("div", { className: "space-y-4", children: [batches.length > 1 && _jsx(SegTabs, { label: "Batch", value: batch, onChange: setPick, options: batches.map((b) => ({ value: b, label: b })) }), provisional.length > 0 && _jsxs(Callout, { tone: "info", title: "Provisional", children: [batch, " has no PO results yet for ", provisional.join(', '), ". Program PO stays provisional until all three culminating courses are in."] }), _jsxs(Card, { className: "overflow-hidden", children: [_jsx(CardHeader, { title: `Program PO attainment · ${batch}`, subtitle: "Mean of the culminating courses' cohort PO%. Attained at \u2265 40%." }), _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "PO" }), _jsx("th", { className: "min-w-40", children: "Attribute" }), _jsx("th", { className: "text-right", children: "Program %" }), _jsx("th", { className: "min-w-40", children: "Against 40%" }), _jsx("th", { children: "Y/N" }), _jsx("th", { children: "From" })] }) }), _jsx("tbody", { children: (pos.data?.pos ?? []).map((p) => {
                                        const r = rows.find((x) => x.po_code === p.code);
                                        const v = r ? Number(r.value) : null;
                                        return (_jsxs("tr", { children: [_jsx("td", { className: "font-mono font-semibold", children: p.code }), _jsx("td", { className: "text-2xs text-muted", children: p.title }), _jsx("td", { className: "text-right tabular text-sm", children: fmtPct(v) }), _jsx("td", { children: v !== null && _jsx(PctBar, { value: v, label: p.code }) }), _jsx("td", { children: _jsx(YesNo, { value: v }) }), _jsxs("td", { className: "text-2xs text-muted", children: [r ? r.course_codes.join(', ') : '—', r && attained(v) === false && _jsx("span", { className: "text-bad", children: " \u00B7 CQI needed" })] })] }, p.code));
                                    }) })] }) })] })] }));
}
