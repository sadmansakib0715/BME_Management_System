#!/usr/bin/env python3
"""Builds supabase/seed_obe_master.sql from the OBE master copy (obe_master.json).

Usage: python3 -I scripts/build_obe_seed.py ~/Downloads/"BME OBE Master Copy"/obe_master.json

The SQL merges into the app's own tables (terms, offerings, course_outcomes, co_po_map, obe_attainment,
car_reports, course_file_items, bugs_resolutions) plus the 0013 tables (obe_offering_docs, obe_criteria).
It never overwrites a teacher's work: an offering that already has COs, criteria, attainment or a CAR keeps them.
"""
import json
import re
import sys
from pathlib import Path

MONTHS = {'January': '01', 'July': '07'}
DOMAIN = {'C': 'cognitive', 'PS': 'psychomotor', 'AF': 'affective'}

# The department's wording varies between documents; these fold it onto one spelling per chip.
DELIVERY_CANON = {
    'discussions': 'Discussion', 'hands-on group activities': 'Hands-on Group Activities', 'hands-on group activity': 'Hands-on Group Activities',
    'hands-on activity': 'Hands-on Group Activities', 'guided instructions': 'Guided Instruction', 'audio-visual demo': 'Audio-visual demonstration',
    'audio-visual demonstration': 'Audio-visual demonstration', 'hospital visits': 'Hospital visits', 'hospital visit': 'Hospital visits',
    'home works': 'Homework', 'interactive discussion': 'Interactive discussions', 'interactive discussions': 'Interactive discussions',
    'tutorial session': 'Tutorials', 'demonstration': 'Demonstrations', 'demonstrations': 'Demonstrations', 'weekly meetings': 'Weekly meetings',
}
TOOLS_CANON = {
    'presentation': 'Presentations', 'report': 'Reports', 'report3': 'Reports', 'and/or report': 'Reports', 'lab test': 'Lab Test',
    'continuous assessments': 'Continuous Assessment', 'assignment': 'Assignments', 'peer review': 'Peer Review',
}
ASSESSMENT_CANON = {
    'term final': 'Term Final', 'ca': 'Continuous Assessment', 'continuous assessment': 'Continuous Assessment', 'lab quiz': 'Lab Quiz',
    'lab test': 'Lab Test', 'final viva': 'Final Viva', 'paper presentation': 'Paper Presentation', 'demo 2': 'Demo 02', 'demo 1': 'Demo 01',
    'presentation 1': 'Presentation 01', 'presentation 2': 'Presentation 02', 'intermediate submission': 'Intermediate Submissions', 'lab reports': 'Lab Report',
}
KPA_OK = {f'K{i}' for i in range(1, 9)} | {f'P{i}' for i in range(1, 8)} | {f'A{i}' for i in range(1, 6)}


def q(v):
    """SQL literal."""
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float)):
        return repr(round(v, 4))
    return "'" + str(v).replace("'", "''") + "'"


def arr(xs):
    return 'array[' + ','.join(q(x) for x in xs) + ']::text[]' if xs else "'{}'::text[]"


def js(v):
    return q(json.dumps(v, ensure_ascii=False)) + '::jsonb'


def term_code(name):
    m = re.match(r'^(January|July) (\d{4})$', name)
    return f'{m[2]}-{MONTHS[m[1]]}' if m else None


def split_list(text, canon):
    out = []
    for part in re.split(r',', text or ''):
        p = part.strip().strip('.')
        if not p:
            continue
        p = canon.get(p.lower(), p)
        if p not in out:
            out.append(p)
    return out


def domain_levels(co):
    out = []
    for d in co['domains']:
        d = d.replace('-', '').upper()
        d = re.sub(r'^P(\d)$', r'PS\1', d)
        d = re.sub(r'^A(\d)$', r'AF\1', d)
        if re.match(r'^(C[1-6]|PS[1-7]|AF[1-5])$', d) and d not in out:
            out.append(d)
    return out


def fold_pct(values):
    """History files mix fractions (0.902) and percentages (74); a record whose values are all ≤ 1 is in fractions."""
    nums = [v for v in values if v is not None]
    scale = 100 if nums and max(nums) <= 1 else 1
    return {k: (None if v is None else round(v * scale, 4)) for k, v in zip(range(len(values)), values)}, scale


# ---------------------------------------------------------------- CAR text: parts C–E and Part B fallback values
def car_parts(text):
    if not text:
        return None
    lines = [l.strip() for l in text.split('\n')]
    idx = lambda pat: next((i for i, l in enumerate(lines) if re.match(pat, l, re.I)), None)
    c = idx(r'^Part C\b') or idx(r'^Teachers.? comments? on attainment')
    d, e, s = idx(r'^Part D\b'), idx(r'^Part E\b'), idx(r'^Signature')
    if c is None and d is None and e is None:
        return None
    end = lambda *xs: min([x for x in xs if x is not None] + [len(lines)])
    body = lambda a, b, skip: '\n'.join(lines[a + skip:b]).strip() if a is not None else ''
    pc = body(c, end(d, e, s), 1 if c is not None and re.match(r'^Part C\b', lines[c], re.I) else 0)
    pd = body(d, end(e, s), 1)
    pe = body(e, end(s), 1)
    # Empty form labels ("Major issues:" with nothing after it) are not content.
    clean = lambda t: '' if re.sub(r'(Teachers.? comments? on [a-z ]+|Interpretation of student feedback|Major issues|Plan for future actions for further improvement):?|N/?A|None|-|\s', '', t, flags=re.I) == '' else t
    return {'c': clean(pc), 'd': clean(pd), 'e': clean(pe)}


def car_values(text, term):
    """CO/PO cohort % for `term` from CAR Part B tables, used only when the workbook and history files have none."""
    if not text:
        return {}
    b = text.split('Part B', 1)[-1].split('Part C', 1)[0]
    lines = [l.strip() for l in b.split('\n') if l.strip()]
    blocks, label = [], ''
    i = 0
    while i < len(lines):
        cells = [x.strip() for x in lines[i].split('|')]
        heads = [x for x in cells if re.match(r'^(CO\d{1,2}|PO\d{1,2}|PO\([a-l]\))$', x)]
        if len(heads) >= 1 and len(heads) >= len([x for x in cells if x]) - 1 and i + 1 < len(lines):
            vals = [x.strip() for x in lines[i + 1].split('|')]
            if len(vals) == len(cells) + 0 or len(vals) >= len(heads):
                off = len(vals) - len(heads) if len(vals) > len(heads) else 0
                got = {}
                for j, h in enumerate([x for x in cells if x]):
                    if not re.match(r'^(CO|PO)', h) or h.endswith('Attainment'):
                        continue
                    pos = [k for k, x in enumerate(cells) if x == h][0]
                    v = vals[pos] if pos < len(vals) else ''
                    m = re.match(r'^(\d+(\.\d+)?)%?$', v)
                    if m:
                        got[h] = float(m[1])
                if got:
                    blocks.append((label, got))
            i += 2
            continue
        # Vertical PO table (BME 404): "PO5 | 98.00% | Y"
        m = re.match(r'^(PO\d{1,2}) \| (\d+(\.\d+)?)% \| [YN]$', lines[i])
        if m:
            blocks.append((label, {m[1]: float(m[2])}))
        elif '|' not in lines[i] and not re.match(r'^\(?From the excel', lines[i], re.I):
            label = lines[i]
        i += 1
    if not blocks:
        return {}
    month, year = term.split()
    wanted = lambda lab: (month.lower() in lab.lower() and year in lab) or 'current' in lab.lower()
    other = lambda lab: 'previous' in lab.lower() or (re.search(r'(January|July) \d{4}', lab) and not wanted(lab))
    out = {}
    for lab, got in blocks:
        if wanted(lab):
            for k, v in got.items():
                out.setdefault(k, v)
    if not out:
        for lab, got in blocks:
            if not other(lab):
                for k, v in got.items():
                    out.setdefault(k, v)
    # "PO(a)" columns in old templates → PO1…
    fixed = {}
    for k, v in out.items():
        m = re.match(r'^PO\(([a-l])\)$', k)
        fixed[f"PO{ord(m[1]) - 96}" if m else k] = v
    return {k: v for k, v in fixed.items() if re.match(r'^(CO|PO)([1-9]|1[0-2])$', k) and 0 <= v <= 100}


def marks_distribution(md):
    """BME 300 lists the old and new schemes back to back; keep the last set that sums to 100%."""
    out, total = [], 0.0
    for m in reversed(md):
        out.insert(0, m)
        total += m['percent']
        if abs(total - 100) < 0.01:
            return out
    return md


def bugs_meta(fname):
    m = re.search(r'(\d{1,2})\.(\d{2})\.(\d{2})', fname)
    if not m:
        return fname, None
    dd, mm, yy = int(m[1]), int(m[2]), int(m[3])
    label = f'BUGS {m[1]}.{m[2]}.{m[3]}'
    if 1 <= mm <= 12 and yy >= 20:
        return label, f'20{yy:02d}-{mm:02d}-{dd:02d}'
    return label, None  # e.g. "20.08.04": the date in the file name is not a valid meeting date


def main(src, dst):
    d = json.loads(Path(src).read_text())
    out = []
    w = out.append
    w('-- BME Workflow · OBE master data (generated by scripts/build_obe_seed.py — do not edit by hand)')
    w(f"-- Source: {d['meta']['source']}; built {d['meta']['built_at']}.")
    w('-- Run AFTER migrations/0013_obe_master.sql. Safe to run again: nothing a teacher has entered is overwritten.')
    w('begin;')
    w('create temp table stg_off (term_code text, term_name text, course_code text, student_batch text, contents text, objectives text, outline_text text,'
      ' instructors jsonb, marks_distribution jsonb, components jsonb, source jsonb, issues text[], has_outline boolean, has_workbook boolean) on commit drop;')
    w('create temp table stg_co (term_code text, course_code text, no int, statement text, domain_levels text[], delivery text[], tools text[], kpa text[], pos text[]) on commit drop;')
    w('create temp table stg_crit (term_code text, course_code text, sort int, assessment text, label text, max_marks numeric, cos text[]) on commit drop;')
    w('create temp table stg_att (term_code text, course_code text, outcome_type text, code text, value numeric, src text) on commit drop;')
    w('create temp table stg_car (term_code text, course_code text, part_c text, part_d text, part_e text) on commit drop;')
    w('create temp table stg_bugs (meeting_no text, held_on date, link text, term_code text, course_code text) on commit drop;')

    terms = {}
    stats = {'offerings': 0, 'cos': 0, 'criteria': 0, 'att': 0, 'att_car': 0, 'cars': 0}
    for c in d['courses']:
        md = marks_distribution(c.get('marks_distribution') or [])
        hist = {}
        for h in c.get('attainment_history', []):
            key = (h['type'], h['term'])
            if h['term'] == 'Session' or key in hist:
                continue  # template rows; and a second record for the same term is a mislabelled copy
            codes = list(h['values'].keys())
            folded, _ = fold_pct([h['values'][k]['percent'] for k in codes])
            hist[key] = {codes[i]: v for i, v in folded.items() if v is not None}
        latest = c['latest_term']
        for o in c['offerings']:
            tc = term_code(o['term'])
            if not tc:
                continue
            terms[tc] = o['term']
            stats['offerings'] += 1
            wb = (o['source_files'] or {}).get('assessment_workbook') or ''
            bm = re.search(r'\(BME ?(\d{2})\)', wb)
            batch = f'BME {bm[1]}' if bm else ('BME 19' if c['code'] == 'BME 400' and o['term'] == 'January 2024' else None)
            outline = o.get('outline') or {}
            issues = list(dict.fromkeys(o.get('issues', []) + (c.get('issues', []) if o['term'] == latest else [])))
            w('insert into stg_off values (' + ','.join([
                q(tc), q(o['term']), q(c['code']), q(batch), q(outline.get('contents')), q(outline.get('objectives')), q(o.get('outline_text') or None),
                js(o.get('instructors', [])), js(md if o['term'] == latest else []), js(o.get('assessment_components', [])),
                js({'folder': o['source_files'].get('folder'), 'files': {k: v for k, v in o['source_files'].items() if k != 'folder' and v}, 'car_text': o.get('car_text') or None}),
                arr(issues), q(bool(o.get('outline_text'))), q(bool(wb))]) + ');')
            for co in o['cos']:
                stats['cos'] += 1
                w('insert into stg_co values (' + ','.join([q(tc), q(c['code']), q(co['number']), q(co['statement'].strip()), arr(domain_levels(co)),
                    arr(split_list(co['delivery'], DELIVERY_CANON)), arr(split_list(co['assessment_tools'], TOOLS_CANON)),
                    arr([k for k in co['kpa'] if k in KPA_OK]), arr(co['pos'])]) + ');')
            for i, it in enumerate(o['assessment_items']):
                if not it.get('max_marks') or it['max_marks'] <= 0:
                    continue
                stats['criteria'] += 1
                a = ASSESSMENT_CANON.get(it['assessment'].strip().lower(), it['assessment'].strip())
                w('insert into stg_crit values (' + ','.join([q(tc), q(c['code']), q(i), q(a), q(it['item'].strip()), q(it['max_marks']), arr(it['cos'])]) + ');')
            # Attainment: course workbook first, then the attainment summary file, then the CAR's own Part B table.
            seen = set()
            for typ in ('CO', 'PO'):
                for code, v in (o.get('cohort_attainment_workbook') or {}).get(typ, {}).items():
                    if v.get('percent_students') is not None:
                        seen.add(code)
                        stats['att'] += 1
                        w(f"insert into stg_att values ({q(tc)},{q(c['code'])},{q(typ)},{q(code)},{q(v['percent_students'])},'workbook');")
            for typ in ('CO', 'PO'):
                for code, v in hist.get((typ, o['term']), {}).items():
                    if code not in seen:
                        seen.add(code)
                        stats['att'] += 1
                        w(f"insert into stg_att values ({q(tc)},{q(c['code'])},{q(typ)},{q(code)},{q(v)},'summary');")
            n_co, mapped = len(o['cos']), {p for co in o['cos'] for p in co['pos']}
            for code, v in car_values(o.get('car_text'), o['term']).items():
                fits = int(code[2:]) <= n_co if code.startswith('CO') else code in mapped
                if code not in seen and fits:
                    seen.add(code)
                    stats['att_car'] += 1
                    w(f"insert into stg_att values ({q(tc)},{q(c['code'])},{q(code[:2])},{q(code)},{q(v)},'car');")
            p = car_parts(o.get('car_text'))
            if p and (p['c'] or p['d'] or p['e']):
                stats['cars'] += 1
                w(f"insert into stg_car values ({q(tc)},{q(c['code'])},{q(p['c'])},{q(p['d'])},{q(p['e'])});")
            for b in o.get('bugs_resolutions', []):
                label, held = bugs_meta(b['file'])
                w(f"insert into stg_bugs values ({q(label)},{q(held)},{q(b['url'])},{q(tc)},{q(c['code'])});")

    for tc, name in sorted(terms.items()):
        w(f"insert into public.terms (code, name) values ({q(tc)}, {q(name)}) on conflict (code) do nothing;")
    w(MERGE)
    w('commit;')
    Path(dst).write_text('\n'.join(out) + '\n')
    # One file to paste into the SQL Editor of an existing project: the 0013 migration, then this data.
    root = Path(__file__).resolve().parent.parent
    migs = sorted((root / 'supabase' / 'migrations').glob('001[3-9]_*.sql'))  # the OBE master data migrations (0013 on)
    mig = '\n'.join(f'-- ===== migrations/{m.name} =====\n' + m.read_text() for m in migs)
    (root / 'supabase' / 'update_obe_master.sql').write_text(
        '-- BME Workflow · OBE master data update for an EXISTING project (generated). Paste into Supabase → SQL Editor and run once.\n'
        f"-- = migrations {', '.join(m.name for m in migs)} + seed_obe_master.sql. Safe to run again.\n\n" + mig + '\n' + '\n'.join(out) + '\n')
    print(f"wrote {dst}: {len(terms)} terms, " + ', '.join(f'{k} {v}' for k, v in stats.items()))


MERGE = r"""
-- ---------------------------------------------------------------- merge
update public.courses set is_culminating = true where code in ('BME 300', 'BME 350', 'BME 400') and not is_culminating;
-- Offerings: an existing offering (e.g. a term imported from the workbook) is reused as it is.
insert into public.offerings (term_id, course_id, status)
select t.id, c.id, 'archived' from stg_off s join public.terms t on t.code = s.term_code join public.courses c on c.code = s.course_code
on conflict (term_id, course_id) do nothing;

create or replace temp view v_stg_off as
  select s.*, o.id as offering_id from stg_off s join public.terms t on t.code = s.term_code join public.courses c on c.code = s.course_code
    join public.offerings o on o.term_id = t.id and o.course_id = c.id;

update public.offerings o set student_batch = v.student_batch from v_stg_off v where o.id = v.offering_id and v.student_batch is not null and o.student_batch is null;

-- Outline and documents.
insert into public.obe_offering_docs (offering_id, contents, objectives, outline_text, instructors, marks_distribution, components, source, issues)
select offering_id, contents, objectives, outline_text, instructors, marks_distribution, components, source, issues from v_stg_off
on conflict (offering_id) do update set outline_text = excluded.outline_text, instructors = excluded.instructors, source = excluded.source, issues = excluded.issues,
  contents = coalesce(public.obe_offering_docs.contents, excluded.contents), objectives = coalesce(public.obe_offering_docs.objectives, excluded.objectives),
  marks_distribution = case when public.obe_offering_docs.marks_distribution = '[]' then excluded.marks_distribution else public.obe_offering_docs.marks_distribution end,
  components = case when public.obe_offering_docs.components = '[]' then excluded.components else public.obe_offering_docs.components end;

-- COs and their mapping, only into offerings that have none yet.
create temp table stg_fresh on commit drop as
  select v.offering_id from v_stg_off v where not exists (select 1 from public.course_outcomes x where x.offering_id = v.offering_id);
insert into public.course_outcomes (offering_id, code, statement, domain, level, sort, domain_levels, delivery, tools, kpa)
select v.offering_id, 'CO' || s.no, s.statement,
  case substring(coalesce(s.domain_levels[1], 'C3') from '^(C|PS|AF)') when 'PS' then 'psychomotor' when 'AF' then 'affective' else 'cognitive' end,
  least(6, greatest(1, coalesce(substring(s.domain_levels[1] from '(\d)$')::int, 3))), s.no, s.domain_levels, s.delivery, s.tools, s.kpa
from stg_co s join v_stg_off v on v.term_code = s.term_code and v.course_code = s.course_code
where v.offering_id in (select offering_id from stg_fresh);
insert into public.co_po_map (co_id, po_code, strength)
select co.id, p, 1 from stg_co s join v_stg_off v on v.term_code = s.term_code and v.course_code = s.course_code
  join public.course_outcomes co on co.offering_id = v.offering_id and co.code = 'CO' || s.no
  cross join unnest(s.pos) p
where v.offering_id in (select offering_id from stg_fresh) and p in (select code from public.pos)
on conflict do nothing;

-- Assessment map (question parts and rubric criteria with CO tags), only where the teachers have none yet.
-- (Only where the COs came from the master copy too, so the CO tags line up.)
create temp table stg_nocrit on commit drop as
  select v.offering_id from v_stg_off v where v.offering_id in (select offering_id from stg_fresh)
     and not exists (select 1 from public.obe_criteria x where x.offering_id = v.offering_id);
insert into public.obe_criteria (offering_id, assessment, label, max_marks, sort)
select v.offering_id, s.assessment, s.label, s.max_marks, s.sort from stg_crit s join v_stg_off v on v.term_code = s.term_code and v.course_code = s.course_code
where v.offering_id in (select offering_id from stg_nocrit);
insert into public.obe_criterion_cos (criterion_id, co_id)
select cr.id, co.id from stg_crit s join v_stg_off v on v.term_code = s.term_code and v.course_code = s.course_code
  join public.obe_criteria cr on cr.offering_id = v.offering_id and cr.sort = s.sort
  cross join unnest(s.cos) k join public.course_outcomes co on co.offering_id = v.offering_id and co.code = k
where v.offering_id in (select offering_id from stg_nocrit)
on conflict do nothing;

-- Imported attainment: never replaces a value already in the system.
insert into public.obe_attainment (offering_id, outcome_type, code, value, source)
select v.offering_id, s.outcome_type, s.code, s.value, 'import' from stg_att s join v_stg_off v on v.term_code = s.term_code and v.course_code = s.course_code
on conflict (offering_id, outcome_type, code) do nothing;

-- Past CARs, parts C–E as written by the course teachers. The CAR guard is paused so they can be stored as final.
alter table public.car_reports disable trigger car_guard;
insert into public.car_reports (offering_id, part_c, part_d, part_e, status, review_note)
select v.offering_id, s.part_c, s.part_d, s.part_e, 'final', 'Imported from the department OBE folder.'
from stg_car s join v_stg_off v on v.term_code = s.term_code and v.course_code = s.course_code
on conflict (offering_id) do nothing;
alter table public.car_reports enable trigger car_guard;

-- Course file: what the department folder already holds.
insert into public.course_file_items (offering_id, slot, done)
select offering_id, 'outline', true from v_stg_off where has_outline
union all select offering_id, 'attainment_workbook', true from v_stg_off where has_workbook
on conflict (offering_id, slot) do nothing;

-- BUGS resolutions (one per meeting) and each offering's approving resolution (the latest it cites).
insert into public.bugs_resolutions (meeting_no, held_on, title, agenda_tags, link)
select distinct on (meeting_no) meeting_no, held_on, 'BUGS meeting resolution', array['CO'], link from stg_bugs b
where not exists (select 1 from public.bugs_resolutions r where r.meeting_no = b.meeting_no)
order by meeting_no;
update public.offerings o set co_resolution_id = x.id
from (select distinct on (v.offering_id) v.offering_id, r.id from stg_bugs b
        join v_stg_off v on v.term_code = b.term_code and v.course_code = b.course_code
        join public.bugs_resolutions r on r.meeting_no = b.meeting_no
       order by v.offering_id, r.held_on desc nulls last) x
where o.id = x.offering_id and o.co_resolution_id is null;

-- Offerings of later terms that are still empty start from the newest offering above.
select public.obe_copy_forward_internal(o.id)
from public.offerings o join public.terms t on t.id = o.term_id
where public.obe_term_key(t) > (select max(term_code) from stg_off)
  and not exists (select 1 from public.course_outcomes x where x.offering_id = o.id);
"""

if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit('usage: build_obe_seed.py obe_master.json [out.sql]')
    root = Path(__file__).resolve().parent.parent
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else root / 'supabase' / 'seed_obe_master.sql')
