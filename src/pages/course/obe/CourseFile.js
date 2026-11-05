import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { CheckCircle2, Circle, ExternalLink } from 'lucide-react';
import { Card, CardHeader, Input, Meter, useToast } from '@/components/ui';
import { must, useWrite } from '@/lib/api';
import { courseFile } from '@/lib/obe';
import { supabase } from '@/lib/supabase';
import { useTerm } from '@/lib/TermContext';
/** The course file of spec section 4: derived artefacts tick themselves, the rest are ticked here with a link to the file. */
export default function CourseFile({ offering, obe, canEdit }) {
    const toast = useToast();
    const { teachersOf } = useTerm();
    const items = courseFile({ ...obe, hasTeachers: teachersOf(offering.id).length > 0, hasResolution: !!offering.co_resolution_id });
    const done = items.filter((i) => i.done).length;
    const save = useWrite((a) => {
        const cur = obe.files.find((f) => f.slot === a.slot);
        return must(supabase.from('course_file_items').upsert({ offering_id: offering.id, slot: a.slot, done: a.done ?? cur?.done ?? false, link: a.link ?? cur?.link ?? null, updated_at: new Date().toISOString() }));
    });
    const err = (e) => toast('bad', e.message);
    return (_jsxs(Card, { children: [_jsx(CardHeader, { title: `Course file · ${done} of ${items.length}`, subtitle: "Items marked \u201Cfrom the data\u201D complete themselves. Add a link (OneDrive or Drive) to the others." }), _jsx("div", { className: "px-4 pt-3", children: _jsx(Meter, { value: done, max: items.length, label: "Course file completeness" }) }), _jsx("ul", { className: "divide-y divide-line mt-2", children: items.map((i) => (_jsxs("li", { className: "px-4 py-2.5 flex flex-wrap items-center gap-3", children: [i.auto ? (i.done ? _jsx(CheckCircle2, { className: "size-5 text-ok shrink-0", "aria-hidden": true }) : _jsx(Circle, { className: "size-5 text-line-strong shrink-0", "aria-hidden": true }))
                            : _jsx("input", { type: "checkbox", className: "size-5 accent-[rgb(var(--brand))] cursor-pointer disabled:cursor-default shrink-0", disabled: !canEdit, checked: i.done, "aria-label": `${i.label} done`, onChange: (e) => save.mutate({ slot: i.slot, done: e.target.checked }, { onError: err }) }), _jsxs("span", { className: "flex-1 min-w-48 text-sm", children: [i.label, i.auto && _jsx("span", { className: "text-2xs text-subtle", children: " \u00B7 from the data" }), _jsx("span", { className: "sr-only", children: i.done ? ', done' : ', not done' })] }), !i.auto && (canEdit
                            ? _jsxs(_Fragment, { children: [_jsxs("label", { htmlFor: `cf-${i.slot}`, className: "sr-only", children: ["Link for ", i.label] }), _jsx(Input, { id: `cf-${i.slot}`, className: "h-8 w-72 max-w-full", placeholder: "Link to the file", defaultValue: i.link ?? '', onBlur: (e) => e.target.value.trim() !== (i.link ?? '') && save.mutate({ slot: i.slot, link: e.target.value.trim(), done: e.target.value.trim() ? true : undefined }, { onError: err }) })] })
                            : i.link ? _jsxs("a", { href: i.link, target: "_blank", rel: "noreferrer", className: "link text-sm inline-flex items-center gap-1", children: ["Open", _jsx(ExternalLink, { className: "size-3.5", "aria-hidden": true })] }) : null)] }, i.slot))) })] }));
}
