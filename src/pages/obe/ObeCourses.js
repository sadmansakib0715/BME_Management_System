import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Link } from 'react-router-dom';
import { TypeBadge } from '@/components/bits';
import { Card, CardHeader, Meter, Stat, StatusBadge } from '@/components/ui';
import { attained, courseFile, mappedPos, valueOf } from '@/lib/obe';
import { useTerm } from '@/lib/TermContext';
const MAP_STATE = [{ value: 'none', label: 'No COs yet' }, { value: 'partly', label: 'Partly mapped' }, { value: 'mapped', label: 'Mapped' }];
const CAR_STATE = [{ value: 'draft', label: 'Draft' }, { value: 'submitted', label: 'Submitted' }, { value: 'reviewed', label: 'Reviewed' }, { value: 'final', label: 'Final' }];
/** OBE dashboard (spec section 14): every offering of the term with mapping, attainment, CAR and course-file progress. */
export default function ObeCourses({ data, obe }) {
    const { courseOf, teachersOf, nameOf } = useTerm();
    const rows = data.offerings.map((o) => {
        const c = courseOf(o);
        const cos = obe.cos.filter((x) => x.offering_id === o.id).sort((a, b) => Number(a.code.slice(2)) - Number(b.code.slice(2)));
        const coPo = obe.coPo.filter((m) => cos.some((x) => x.id === m.co_id));
        const att = obe.attainment.filter((a) => a.offering_id === o.id);
        const car = obe.cars.find((x) => x.offering_id === o.id) ?? null;
        const mapped = cos.filter((x) => coPo.some((m) => m.co_id === x.id)).length;
        const coT = Number(o.cohort_threshold ?? 0.4), poT = Number(o.po_threshold ?? 0.4);
        const coRes = cos.map((_, i) => attained(valueOf(att, 'CO', `CO${i + 1}`), coT));
        const notMet = [...cos.map((_, i) => `CO${i + 1}`).filter((_, i) => coRes[i] === false),
            ...[...mappedPos(cos, coPo)].filter((p) => attained(valueOf(att, 'PO', p), poT) === false)];
        const file = courseFile({ cos, coPo, attainment: att, car, files: obe.files.filter((f) => f.offering_id === o.id), hasTeachers: teachersOf(o.id).length > 0, hasResolution: !!o.co_resolution_id });
        return { o, c, cos, mapState: !cos.length ? 'none' : mapped === cos.length ? 'mapped' : 'partly', measured: coRes.filter((x) => x !== null).length, met: coRes.filter((x) => x).length,
            notMet, car: car?.status ?? 'draft', fileDone: file.filter((f) => f.done).length, fileTotal: file.length };
    }).filter((r) => r.c).sort((a, b) => a.c.code.localeCompare(b.c.code));
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: "grid grid-cols-2 md:grid-cols-4 gap-3 mb-5", children: [_jsx(Stat, { label: "COs mapped", value: `${rows.filter((r) => r.mapState === 'mapped').length}/${rows.length}`, sub: "courses" }), _jsx(Stat, { label: "Attainment entered", value: `${rows.filter((r) => r.cos.length && r.measured === r.cos.length).length}/${rows.length}`, sub: "courses with every CO" }), _jsx(Stat, { label: "CARs final", value: `${rows.filter((r) => r.car === 'final').length}/${rows.length}` }), _jsx(Stat, { label: "Outcomes not attained", value: rows.reduce((n, r) => n + r.notMet.length, 0), sub: "COs and POs below threshold" })] }), _jsxs(Card, { className: "overflow-hidden", children: [_jsx(CardHeader, { title: "Courses this term", subtitle: "Open a course to edit its COs, attainment, course file and CAR." }), _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Course" }), _jsx("th", { children: "COs" }), _jsx("th", { children: "Attainment" }), _jsx("th", { children: "Not attained" }), _jsx("th", { children: "CAR" }), _jsx("th", { className: "min-w-40", children: "Course file" })] }) }), _jsx("tbody", { children: rows.map((r) => (_jsxs("tr", { children: [_jsxs("td", { children: [_jsx(Link, { to: `/courses/${r.o.id}/outcomes`, className: "link font-mono text-sm", children: r.c.code }), " ", _jsx(TypeBadge, { type: r.c.course_type }), _jsx("div", { className: "text-2xs text-muted max-w-64 truncate", children: teachersOf(r.o.id).map(nameOf).join(', ') || r.c.title })] }), _jsx("td", { children: _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "text-2xs tabular text-muted", children: r.cos.length }), _jsx(StatusBadge, { opts: MAP_STATE, value: r.mapState })] }) }), _jsx("td", { className: "text-2xs tabular", children: r.cos.length ? _jsxs(_Fragment, { children: [r.met, " of ", r.measured, " attained", r.measured < r.cos.length && _jsxs("span", { className: "text-warn", children: [" \u00B7 ", r.cos.length - r.measured, " missing"] })] }) : _jsx("span", { className: "text-subtle", children: "\u2014" }) }), _jsx("td", { className: "text-2xs", children: r.notMet.length ? _jsx("span", { className: "text-bad font-medium", children: r.notMet.join(', ') }) : _jsx("span", { className: "text-subtle", children: "\u2014" }) }), _jsx("td", { children: _jsx(StatusBadge, { opts: CAR_STATE, value: r.car }) }), _jsx("td", { children: _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Meter, { value: r.fileDone, max: r.fileTotal, label: `${r.c.code} course file` }), _jsxs("span", { className: "text-2xs tabular text-muted", children: [r.fileDone, "/", r.fileTotal] })] }) })] }, r.o.id))) })] }) })] })] }));
}
