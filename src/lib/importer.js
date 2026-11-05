// Reads the department Activity Tracker workbook and turns it into an import plan for
// import_term_plan(). Nothing is written here: the Admin reviews the plan and its report first.
import * as XLSX from 'xlsx';
import { parseSheetDate } from './dates';
// ---------------------------------------------------------------- normalizers
export const normCode = (v) => String(v ?? '').replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim().toUpperCase().replace(/^([A-Z]+)\s?(\d{3})$/, '$1 $2');
const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const SPELLING = [[/Conitnuous|Continous/gi, 'Continuous'], [/Sessinal/gi, 'Sessional'], [/Numerial/gi, 'Numerical'], [/Submissons/gi, 'Submissions']];
export const fixSpelling = (s) => SPELLING.reduce((a, [re, to]) => a.replace(re, to), s);
function lev(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++)
        d[0][j] = j;
    for (let i = 1; i <= a.length; i++)
        for (let j = 1; j <= b.length; j++)
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
}
const bare = (n) => n.toLowerCase().replace(/^(dr|mr|ms|mrs|prof)\.?\s+/, '').replace(/[^a-z ]/g, '').trim();
export function nameMatcher(canonical) {
    return (raw) => {
        const n = clean(raw);
        if (!n || n.startsWith('='))
            return { name: null, fixed: false };
        if (canonical.includes(n))
            return { name: n, fixed: false };
        const b = bare(n);
        let best = null, score = 3;
        for (const c of canonical) {
            const d = lev(b, bare(c));
            if (d < score) {
                score = d;
                best = c;
            }
        }
        return best ? { name: best, fixed: true } : { name: n, fixed: false };
    };
}
// ---------------------------------------------------------------- status maps
const MAP = {
    outline: { 'Under Preparation': 'under_preparation', Prepared: 'prepared', 'Shared with Students': 'shared' },
    feedback: { 'Students Reminded': 'students_reminded', 'Feedbacks Collected': 'collected' },
    car: { 'Under Preparation': 'under_preparation', Prepared: 'prepared', 'Uploaded in Drive': 'final' },
    qp: { 'Under Preparation': 'under_preparation', Printed: 'submitted', Submitted: 'submitted' },
    mod: { 'Under Moderation': 'under_moderation', 'Moderated - Needs Correction': 'needs_correction', Finalized: 'finalized' },
    exam: { 'Under Examination': 'under_examination', Examined: 'examined', 'Forwarded to Script Scrutinizer': 'examined' },
    scr: { 'Under Scrutiny': 'under_scrutiny', Scrutinized: 'scrutinized', 'Forwarded to Gradesheet Preparer': 'scrutinized' },
    gsPrep: { 'Under Preparation': 'under_preparation', Prepared: 'prepared', 'Uploaded in BIIS': 'uploaded_biis', 'Forwarded to Gradesheet Scrutinizer': 'uploaded_biis' },
    gsScr: { 'Under Scrutiny': 'under_scrutiny', Scrutinized: 'scrutinized', Submitted: 'scrutinized', 'Forwarded to HOD': 'scrutinized' },
    sgPrep: { 'Under Preparation': 'under_preparation', Prepared: 'prepared', 'Uploaded in BIIS': 'uploaded_biis', 'Forwarded to Gradesheet Scrutinizer': 'forwarded' },
    sgScr: { 'Under Scrutiny': 'under_scrutiny', Scrutinized: 'scrutinized', Submitted: 'scrutinized', 'Forwarded to HOD': 'forwarded_hod' },
};
const CT = {
    'CT Scheduled': ['scheduled', 'none'], 'CT Taken': ['held', 'none'], 'Scripts Under Examination': ['held', 'entering'],
    'Scripts Checked': ['held', 'verified'], 'Marks Published': ['held', 'published'],
};
const EVAL = {
    Scheduled: ['scheduled', 'none'], 'Evaluation Taken': ['held', 'none'], 'Marking Complete': ['held', 'verified'], 'Marks Uploaded in Excel': ['held', 'published'],
};
const col = (i) => XLSX.utils.encode_col(i);
export function parseWorkbook(data, term) {
    const wb = XLSX.read(data, { type: 'array' });
    const fixes = [], warnings = [], errors = [];
    const sheet = (prefix) => {
        const name = wb.SheetNames.find((n) => n.startsWith(prefix));
        return name ? XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null }) : null;
    };
    const need = (prefix) => { const s = sheet(prefix); if (!s)
        errors.push({ sheet: prefix, message: `Sheet starting with "${prefix}" is missing` }); return s ?? []; };
    // Canonical faculty list from the Lists sheet's "Faculty List" column.
    const lists = need('Lists');
    const fcol = (lists[0] ?? []).findIndex((h) => clean(h) === 'Faculty List');
    const canonical = fcol >= 0 ? lists.slice(1).map((r) => clean(r[fcol])).filter(Boolean) : [];
    const match = nameMatcher(canonical);
    const person = (sheetName, r, c, v) => {
        const m = match(v);
        if (m.fixed)
            fixes.push({ sheet: sheetName, cell: `${col(c)}${r + 1}`, message: `"${clean(v)}" matched to ${m.name}` });
        if (m.name && !canonical.includes(m.name))
            warnings.push({ sheet: sheetName, cell: `${col(c)}${r + 1}`, message: `"${m.name}" is not in the faculty list; it will be created` });
        return m.name ?? undefined;
    };
    const status = (map, sheetName, r, c, v) => {
        const t = clean(v);
        if (!t)
            return undefined;
        const out = MAP[map][t];
        if (!out)
            warnings.push({ sheet: sheetName, cell: `${col(c)}${r + 1}`, message: `Unknown status "${t}" ignored` });
        else if (t === 'Printed')
            fixes.push({ sheet: sheetName, cell: `${col(c)}${r + 1}`, message: '"Printed" under question preparation imported as Submitted; printing is now its own step' });
        return out;
    };
    const date = (sheetName, r, c, v) => {
        if (v === null || v === '')
            return null;
        const d = parseSheetDate(v);
        if (!d)
            warnings.push({ sheet: sheetName, cell: `${col(c)}${r + 1}`, message: `Could not read date "${v}"; enter it after import` });
        else if (typeof v === 'string' && !/^\d{4}-/.test(v))
            fixes.push({ sheet: sheetName, cell: `${col(c)}${r + 1}`, message: `Date "${v}" read as ${d}` });
        return d;
    };
    const codeAt = (sheetName, r, c, v) => {
        const raw = String(v ?? '').trim();
        if (!raw)
            return '';
        const code = normCode(raw);
        if (code !== raw)
            fixes.push({ sheet: sheetName, cell: `${col(c)}${r + 1}`, message: `Course code "${raw}" normalized to ${code}` });
        return code;
    };
    // Course lists put the code only on a course's first row; sub-section rows below it continue that course.
    const walk = (rows, codeCol, fn) => {
        let current = '';
        rows.forEach((row, r) => {
            if (r === 0)
                return;
            const raw = row[codeCol];
            if (raw !== null && clean(raw))
                current = String(raw);
            const code = normCode(current);
            if (code && /^[A-Z]+ \d{3}$/.test(code))
                fn(code, row, r);
        });
    };
    const plan = { term, faculty: canonical.map((d) => ({ display_name: d })), courses: [], offerings: [], exam: [],
        sessional_grades: [], records: [], milestones: [], class_tests: [], sessional_items: [] };
    const offering = (code) => {
        let o = plan.offerings.find((x) => x.code === code);
        if (!o) {
            o = { code, batch: null, sections: [] };
            plan.offerings.push(o);
        }
        return o;
    };
    const record = (code) => {
        let x = plan.records.find((y) => y.code === code);
        if (!x) {
            x = { code };
            plan.records.push(x);
        }
        return x;
    };
    const addCourse = (code, title, type, ch) => {
        if (plan.courses.some((c) => c.code === code))
            return;
        const t = fixSpelling(clean(title));
        if (t !== clean(title))
            fixes.push({ sheet: 'course lists', message: `Title "${clean(title)}" corrected to "${t}"` });
        plan.courses.push({ code, title: t, course_type: type, contact_hours: typeof ch === 'number' ? ch : null });
        offering(code); // batch is derived server-side from the curriculum level-term
    };
    // 01 Theory course list
    const s01 = need('01_');
    walk(s01, 2, (code, row, r) => {
        if (row[2] !== null)
            codeAt('01', r, 2, row[2]);
        addCourse(code, row[3], 'theory', row[4]);
        const name = clean(row[5]) || 'X';
        const teachers = [6, 7].map((c) => person('01', r, c, row[c])).filter(Boolean);
        offering(code).sections.push({ name, teachers });
    });
    // 02 Sessional course list (A1 / A2 rows)
    const s02 = need('02_');
    walk(s02, 2, (code, row, r) => {
        if (row[2] !== null)
            codeAt('02', r, 2, row[2]);
        const type = code === 'BME 400' ? 'thesis' : code === 'BME 300' || code === 'BME 350' ? 'design' : 'sessional';
        addCourse(code, row[3], type, row[4]);
        const name = clean(row[5]) || 'X';
        const teachers = [6, 7, 8, 9, 10].map((c) => person('02', r, c, row[c])).filter(Boolean);
        offering(code).sections.push({ name, teachers });
    });
    // 03 outline / 06 feedback / 09 CAR (status column K = 10, deadline L = 11, feedback deadline M = 12)
    const firstDate = (rows, c, sheetName) => {
        for (let r = 1; r < rows.length; r++)
            if (rows[r][c] !== null)
                return date(sheetName, r, c, rows[r][c]);
        return null;
    };
    const s03 = need('03_');
    walk(s03, 2, (code, row, r) => { const v = status('outline', '03', r, 10, row[10]); if (v)
        record(code).outline_status = v; });
    const od = firstDate(s03, 11, '03');
    if (od)
        plan.milestones.push({ kind: 'outline_sharing', due_on: od });
    const s06 = need('06_');
    walk(s06, 2, (code, row, r) => { const v = status('feedback', '06', r, 10, row[10]); if (v)
        record(code).feedback_status = v; });
    const fd = firstDate(s06, 12, '06');
    if (fd)
        plan.milestones.push({ kind: 'feedback_deadline', due_on: fd });
    const s09 = need('09_');
    walk(s09, 2, (code, row, r) => { const v = status('car', '09', r, 10, row[10]); if (v)
        record(code).car_status = v; });
    const cd = firstDate(s09, 11, '09');
    if (cd)
        plan.milestones.push({ kind: 'car_deadline', due_on: cd });
    // 04 class tests: CT n date at column 5 + 2(n-1), status next to it
    const s04 = need('04_');
    let undated = 0;
    walk(s04, 1, (code, row, r) => {
        for (let n = 1; n <= 5; n++) {
            const dc = 5 + 2 * (n - 1), sc = dc + 1;
            const st = clean(row[sc]);
            const d = date('04', r, dc, row[dc]);
            if (!st && !d)
                continue;
            const mapped = CT[st];
            if (st && !mapped)
                warnings.push({ sheet: '04', cell: `${col(sc)}${r + 1}`, message: `Unknown CT status "${st}"` });
            if (!d)
                undated++;
            plan.class_tests.push({ code, seq: n, held_on: d, status: mapped?.[0] ?? (d ? 'scheduled' : 'planned'), marks_status: mapped?.[1] ?? 'none' });
        }
    });
    if (undated)
        warnings.push({ sheet: '04', message: `${undated} class tests have a status but no date; they are imported and flagged on the course` });
    // 05 sessional evaluations: (type, date, status) triplets from column 6
    const s05 = need('05_');
    const a1Plans = new Map();
    walk(s05, 2, (code, row, r) => {
        const section = clean(row[5]) || 'X';
        let seq = 0;
        const found = [];
        for (let c = 6; c + 2 < row.length + 2; c += 3) {
            const t = clean(row[c]), dv = row[c + 1], st = clean(row[c + 2]);
            if (!t && (dv === null || dv === undefined) && !st)
                continue;
            seq++;
            let title = fixSpelling(t);
            if (!t) {
                title = `Untitled assessment ${seq}`;
                warnings.push({ sheet: '05', cell: `${col(c)}${r + 1}`, message: `${code} ${section}: evaluation without a type imported as "${title}"` });
            }
            const m = EVAL[st];
            found.push({ code, section, seq, title, held_on: date('05', r, c + 1, dv), status: m?.[0] ?? 'planned', marks_status: m?.[1] ?? 'none' });
        }
        if (found.length) {
            plan.sessional_items.push(...found);
            if (section === 'A1')
                a1Plans.set(code, found);
        }
        else if (section !== 'A1' && a1Plans.has(code)) {
            plan.sessional_items.push(...a1Plans.get(code).map((x) => ({ ...x, section, held_on: null, status: 'planned', marks_status: 'none' })));
            warnings.push({ sheet: '05', message: `${code} ${section} was empty; created from A1's plan with no dates` });
        }
    });
    // 07 sessional gradesheets
    const s07 = need('07_');
    walk(s07, 1, (code, row, r) => {
        if (!clean(row[5]) && !clean(row[7]))
            return;
        plan.sessional_grades.push({ code, preparer: person('07', r, 5, row[5]), prep_status: status('sgPrep', '07', r, 6, row[6]),
            scrutinizer: person('07', r, 7, row[7]), scrutiny_status: status('sgScr', '07', r, 8, row[8]) });
    });
    const sd = firstDate(s07, 9, '07');
    if (sd)
        plan.milestones.push({ kind: 'sessional_gradesheet', due_on: sd });
    // 08 theory exam chain (two header rows)
    const s08 = need('08_');
    s08.forEach((row, r) => {
        if (r < 2)
            return;
        const code = codeAt('08', r, 1, row[1]);
        if (!/^[A-Z]+ \d{3}$/.test(code))
            return;
        const st = {};
        const put = (k, map, c) => { const v = status(map, '08', r, c, row[c]); if (v)
            st[k] = v; };
        put('qp_a', 'qp', 4);
        put('qp_b', 'qp', 6);
        put('mod_1', 'mod', 9);
        put('mod_2', 'mod', 11);
        put('exam_a', 'exam', 13);
        put('exam_b', 'exam', 15);
        put('scrutiny', 'scr', 17);
        put('gs_prep', 'gsPrep', 19);
        put('gs_scrutiny', 'gsScr', 21);
        if (clean(row[21]) === 'Forwarded to HOD')
            st.hod = 'forwarded';
        if (st.mod_1 === 'needs_correction' || st.mod_2 === 'needs_correction')
            warnings.push({ sheet: '08', cell: `B${r + 1}`, message: `${code}: a moderator marked "Needs Correction"; confirm which half and update it in the app` });
        plan.exam.push({ code, qp_a: person('08', r, 3, row[3]), qp_b: person('08', r, 5, row[5]), mod_1: person('08', r, 8, row[8]),
            mod_2: person('08', r, 10, row[10]), scrutinizer: person('08', r, 16, row[16]), statuses: st });
        const gsp = clean(row[18]);
        if (gsp && !gsp.startsWith('=') && match(gsp).name !== match(row[3]).name)
            warnings.push({ sheet: '08', cell: `S${r + 1}`, message: `${code}: gradesheet preparer differs from QP-A; the app derives it from QP-A` });
    });
    const qd = firstDate(s08.slice(1), 7, '08');
    if (qd)
        plan.milestones.push({ kind: 'question_submission', due_on: qd });
    const gd = firstDate(s08.slice(1), 22, '08');
    if (gd)
        plan.milestones.push({ kind: 'theory_gradesheet', due_on: gd });
    for (const e of plan.exam) {
        const issues = [[e.qp_a, e.qp_b, 'QP-A and QP-B'], [e.mod_1, e.mod_2, 'the two moderators']];
        for (const [x, y, what] of issues)
            if (x && x === y)
                errors.push({ sheet: '08', message: `${e.code}: ${what} are the same person` });
        for (const m of [e.mod_1, e.mod_2])
            if (m && (m === e.qp_a || m === e.qp_b))
                errors.push({ sheet: '08', message: `${e.code}: ${m} moderates their own paper` });
        if (e.scrutinizer && (e.scrutinizer === e.qp_a || e.scrutinizer === e.qp_b))
            errors.push({ sheet: '08', message: `${e.code}: scrutinizer is a question preparer` });
    }
    return { plan, fixes, warnings, errors };
}
