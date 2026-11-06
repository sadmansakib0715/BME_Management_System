-- BME Workflow · OBE master data update for an EXISTING project (generated). Paste into Supabase → SQL Editor and run once.
-- = migrations 0013_obe_master.sql, 0014_rubrics.sql, 0015_obe_computed.sql, 0016_outline_fields.sql + seed_obe_master.sql. Safe to run again.

-- ===== migrations/0013_obe_master.sql =====
-- BME Workflow · 0013 OBE master data: course outline & documents per offering, the assessment map with
-- teacher-built rubric criteria, and carry-forward so a new offering starts from the last one.
-- Data from the OBE master copy is loaded separately by supabase/seed_obe_master.sql.

-- ---------------------------------------------------------------- outline and documents of an offering
create table if not exists public.obe_offering_docs (
  offering_id         uuid primary key references public.offerings(id) on delete cascade,
  contents            text,                                   -- course contents (as approved by the Academic Council)
  objectives          text,                                   -- one objective per line
  outline_text        text,                                   -- full text of the outline document, for reference
  instructors         jsonb not null default '[]',            -- [{name, room, email}] as written in the outline
  marks_distribution  jsonb not null default '[]',            -- [{component, percent}]
  components          jsonb not null default '[]',            -- workbook component weights [{component, weight, marks}]
  source              jsonb not null default '{}',            -- {folder, files{}, car_text} from the department folder
  issues              text[] not null default '{}',           -- gaps found when the folder was read
  copied_from         uuid references public.offerings(id) on delete set null, -- set while carried-forward content awaits review
  updated_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------- assessment map: question parts and rubric criteria
-- Each row is one question part (e.g. "Q01 (a)") or one rubric criterion (e.g. "Clinical Need Identification"),
-- grouped by assessment (Term Final, Presentation 01…), with its marks and the COs it assesses.
-- levels holds the rubric the teachers write: [{label, marks, descriptor}], empty for an exam question.
create table if not exists public.obe_criteria (
  id           uuid primary key default gen_random_uuid(),
  offering_id  uuid not null references public.offerings(id) on delete cascade,
  assessment   text not null check (length(trim(assessment)) > 0),
  label        text not null check (length(trim(label)) > 0),
  max_marks    numeric(7,3) not null check (max_marks > 0),
  levels       jsonb not null default '[]',
  sort         integer not null default 0
);
create index if not exists obe_criteria_offering on public.obe_criteria (offering_id, sort);

create table if not exists public.obe_criterion_cos (
  criterion_id  uuid not null references public.obe_criteria(id) on delete cascade,
  co_id         uuid not null references public.course_outcomes(id) on delete cascade,
  primary key (criterion_id, co_id)
);

-- ---------------------------------------------------------------- carry-forward
/** Order key of a term: its start month, else its code (codes are YYYY-MM). */
create or replace function public.obe_term_key(t public.terms) returns text
language sql immutable as $$ select coalesce(to_char(t.starts_on, 'YYYY-MM'), t.code) $$;

/** Fills an offering's empty parts (COs + mapping, assessment map, outline) from the same course's newest earlier
    offering that has COs. Attainment and the CAR are never copied. Returns what was copied. */
create or replace function public.obe_copy_forward_internal(p_offering uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  tgt record; src uuid; n_co int := 0; n_cr int := 0; docs boolean := false;
begin
  select o.id, o.course_id, public.obe_term_key(t) as k into tgt from offerings o join terms t on t.id = o.term_id where o.id = p_offering;
  if tgt.id is null then return null; end if;
  select o.id into src from offerings o join terms t on t.id = o.term_id
   where o.course_id = tgt.course_id and o.id <> p_offering and public.obe_term_key(t) < tgt.k
     and exists (select 1 from course_outcomes c where c.offering_id = o.id)
   order by public.obe_term_key(t) desc limit 1;
  if src is null then return jsonb_build_object('from', null); end if;

  if not exists (select 1 from course_outcomes where offering_id = p_offering) then
    insert into course_outcomes (offering_id, code, statement, domain, level, sort, domain_levels, delivery, tools, kpa)
    select p_offering, code, statement, domain, level, sort, domain_levels, delivery, tools, kpa from course_outcomes where offering_id = src;
    get diagnostics n_co = row_count;
    insert into co_po_map (co_id, po_code, strength)
    select n.id, m.po_code, m.strength from co_po_map m join course_outcomes s on s.id = m.co_id and s.offering_id = src
      join course_outcomes n on n.offering_id = p_offering and n.code = s.code;
  end if;

  if not exists (select 1 from obe_criteria where offering_id = p_offering) then
    with ins as (
      insert into obe_criteria (offering_id, assessment, label, max_marks, levels, sort)
      select p_offering, assessment, label, max_marks, levels, sort from obe_criteria where offering_id = src
      returning id, sort, label)
    select count(*) into n_cr from ins;
    insert into obe_criterion_cos (criterion_id, co_id)
    select nc.id, nco.id from obe_criteria sc
      join obe_criterion_cos l on l.criterion_id = sc.id
      join course_outcomes sco on sco.id = l.co_id
      join obe_criteria nc on nc.offering_id = p_offering and nc.sort = sc.sort and nc.label = sc.label
      join course_outcomes nco on nco.offering_id = p_offering and nco.code = sco.code
     where sc.offering_id = src
    on conflict do nothing;
  end if;

  if not exists (select 1 from obe_offering_docs where offering_id = p_offering) then
    insert into obe_offering_docs (offering_id, contents, objectives, marks_distribution, components, copied_from)
    select p_offering, contents, objectives,
      case when marks_distribution = '[]' then coalesce((select d.marks_distribution from obe_offering_docs d join offerings o on o.id = d.offering_id
        where o.course_id = tgt.course_id and d.marks_distribution <> '[]' limit 1), '[]') else marks_distribution end,
      components, src
    from obe_offering_docs where offering_id = src;
    docs := found;
  end if;
  if n_co > 0 or n_cr > 0 then
    insert into obe_offering_docs (offering_id, copied_from) values (p_offering, src)
    on conflict (offering_id) do update set copied_from = src;
  end if;
  return jsonb_build_object('from', src, 'cos', n_co, 'criteria', n_cr, 'outline', docs);
end $$;

/** The same, for a teacher of the offering (the "Fill from last term" buttons). */
create or replace function public.obe_copy_forward(p_offering uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.fn_can_manage(p_offering) then raise exception 'Only this course''s teachers or an admin can do this' using errcode = '42501'; end if;
  return public.obe_copy_forward_internal(p_offering);
end $$;
grant execute on function public.obe_copy_forward(uuid) to anon, authenticated;

-- A new offering (term import or manual setup) starts with last offering's COs, mapping, assessment map and outline.
create or replace function public.tg_offering_copy_forward() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform public.obe_copy_forward_internal(new.id); return new; end $$;
drop trigger if exists offering_copy_forward on public.offerings;
create trigger offering_copy_forward after insert on public.offerings for each row execute function public.tg_offering_copy_forward();

-- ---------------------------------------------------------------- row-level security and audit
alter table public.obe_offering_docs enable row level security;
alter table public.obe_criteria enable row level security;
alter table public.obe_criterion_cos enable row level security;
do $$ declare t text; begin
  foreach t in array array['obe_offering_docs','obe_criteria','obe_criterion_cos'] loop
    execute format('drop policy if exists dept_read on public.%I', t);
    execute format('create policy dept_read on public.%I for select to anon, authenticated using (public.fn_is_active())', t);
    execute format('drop policy if exists teacher_write on public.%I', t);
  end loop;
end $$;
create policy teacher_write on public.obe_offering_docs for all to anon, authenticated using (public.fn_can_manage(offering_id)) with check (public.fn_can_manage(offering_id));
create policy teacher_write on public.obe_criteria for all to anon, authenticated using (public.fn_can_manage(offering_id)) with check (public.fn_can_manage(offering_id));
create policy teacher_write on public.obe_criterion_cos for all to anon, authenticated
  using (public.fn_can_manage((select offering_id from public.obe_criteria where id = criterion_id)))
  with check (public.fn_can_manage((select offering_id from public.obe_criteria where id = criterion_id)));
grant select, insert, update, delete on public.obe_offering_docs, public.obe_criteria, public.obe_criterion_cos to anon, authenticated;

drop trigger if exists audit on public.obe_criteria;
create trigger audit after insert or update or delete on public.obe_criteria for each row execute function public.tg_audit();
drop trigger if exists audit on public.obe_offering_docs;
create trigger audit after insert or update or delete on public.obe_offering_docs for each row execute function public.tg_audit('offering_id');

-- Let the API see the new tables and functions now, not after its next restart.
notify pgrst, 'reload schema';

-- ===== migrations/0014_rubrics.sql =====
-- BME Workflow · 0014 rubrics a teacher sets for an offering (presentations, demonstrations, projects, reports).
-- Criteria, their bands and their CO links live in one jsonb document per rubric:
--   criteria: [{ id, name, max, levels: [{ label, min, max, text }], cos: [course_outcomes.id, …] }]
-- CO links are by id, so renumbering COs keeps them; links to deleted COs are ignored by the app.
-- Carry-forward (0013) is extended so a new offering also starts with the last offering's rubrics.
create table if not exists public.rubrics (
  id            uuid primary key default gen_random_uuid(),
  offering_id   uuid not null references public.offerings(id) on delete cascade,
  component_id  uuid references public.assessment_components(id) on delete set null,
  title         text not null default '',
  levels        text[] not null default array['Excellent','Good','Satisfactory','Needs Improvement','Poor'],
  criteria      jsonb not null default '[]'::jsonb check (jsonb_typeof(criteria) = 'array'),
  note          text not null default '',
  sort          int not null default 0,
  updated_at    timestamptz not null default now()
);
create index if not exists rubrics_offering on public.rubrics(offering_id);

alter table public.rubrics enable row level security;
drop policy if exists dept_read on public.rubrics;
create policy dept_read on public.rubrics for select to anon, authenticated using (public.fn_is_active());
drop policy if exists teacher_write on public.rubrics;
create policy teacher_write on public.rubrics for all to anon, authenticated
  using (public.fn_can_manage(offering_id)) with check (public.fn_can_manage(offering_id));
grant select, insert, update, delete on public.rubrics to anon, authenticated;

drop trigger if exists audit on public.rubrics;
create trigger audit after insert or update or delete on public.rubrics for each row execute function public.tg_audit();

-- ---------------------------------------------------------------- carry-forward, now with rubrics
/** As in 0013, plus rubrics: copied when the target has none, with each criterion's CO ids re-pointed to the
    target's CO of the same code (CO1 → CO1). The assessment link is dropped because components belong to a term. */
create or replace function public.obe_copy_forward_internal(p_offering uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  tgt record; src uuid; n_co int := 0; n_cr int := 0; n_rb int := 0; docs boolean := false;
begin
  select o.id, o.course_id, public.obe_term_key(t) as k into tgt from offerings o join terms t on t.id = o.term_id where o.id = p_offering;
  if tgt.id is null then return null; end if;
  select o.id into src from offerings o join terms t on t.id = o.term_id
   where o.course_id = tgt.course_id and o.id <> p_offering and public.obe_term_key(t) < tgt.k
     and exists (select 1 from course_outcomes c where c.offering_id = o.id)
   order by public.obe_term_key(t) desc limit 1;
  if src is null then return jsonb_build_object('from', null); end if;

  if not exists (select 1 from course_outcomes where offering_id = p_offering) then
    insert into course_outcomes (offering_id, code, statement, domain, level, sort, domain_levels, delivery, tools, kpa)
    select p_offering, code, statement, domain, level, sort, domain_levels, delivery, tools, kpa from course_outcomes where offering_id = src;
    get diagnostics n_co = row_count;
    insert into co_po_map (co_id, po_code, strength)
    select n.id, m.po_code, m.strength from co_po_map m join course_outcomes s on s.id = m.co_id and s.offering_id = src
      join course_outcomes n on n.offering_id = p_offering and n.code = s.code;
  end if;

  if not exists (select 1 from obe_criteria where offering_id = p_offering) then
    with ins as (
      insert into obe_criteria (offering_id, assessment, label, max_marks, levels, sort)
      select p_offering, assessment, label, max_marks, levels, sort from obe_criteria where offering_id = src
      returning id)
    select count(*) into n_cr from ins;
    insert into obe_criterion_cos (criterion_id, co_id)
    select nc.id, nco.id from obe_criteria sc
      join obe_criterion_cos l on l.criterion_id = sc.id
      join course_outcomes sco on sco.id = l.co_id
      join obe_criteria nc on nc.offering_id = p_offering and nc.sort = sc.sort and nc.label = sc.label
      join course_outcomes nco on nco.offering_id = p_offering and nco.code = sco.code
     where sc.offering_id = src
    on conflict do nothing;
  end if;

  if not exists (select 1 from rubrics where offering_id = p_offering) then
    insert into rubrics (offering_id, title, levels, note, sort, criteria)
    select p_offering, r.title, r.levels, r.note, r.sort,
      coalesce((select jsonb_agg(c || jsonb_build_object('cos', coalesce((
          select jsonb_agg(n.id) from jsonb_array_elements_text(c->'cos') x
            join course_outcomes s on s.id::text = x.value and s.offering_id = src
            join course_outcomes n on n.offering_id = p_offering and n.code = s.code), '[]'::jsonb)) order by ord)
        from jsonb_array_elements(r.criteria) with ordinality e(c, ord)), '[]'::jsonb)
    from rubrics r where r.offering_id = src;
    get diagnostics n_rb = row_count;
  end if;

  if not exists (select 1 from obe_offering_docs where offering_id = p_offering) then
    insert into obe_offering_docs (offering_id, contents, objectives, marks_distribution, components, copied_from)
    select p_offering, contents, objectives,
      case when marks_distribution = '[]' then coalesce((select d.marks_distribution from obe_offering_docs d join offerings o on o.id = d.offering_id
        where o.course_id = tgt.course_id and d.marks_distribution <> '[]' limit 1), '[]') else marks_distribution end,
      components, src
    from obe_offering_docs where offering_id = src;
    docs := found;
  end if;
  if n_co > 0 or n_cr > 0 or n_rb > 0 then
    insert into obe_offering_docs (offering_id, copied_from) values (p_offering, src)
    on conflict (offering_id) do update set copied_from = src;
  end if;
  return jsonb_build_object('from', src, 'cos', n_co, 'criteria', n_cr, 'rubrics', n_rb, 'outline', docs);
end $$;

-- Let the API see the new tables and functions now, not after its next restart.
notify pgrst, 'reload schema';

-- ===== migrations/0015_obe_computed.sql =====
-- BME Workflow · 0015 attainment computed from an uploaded marksheet, and the extra outline fields the outline PDF needs.
-- The marksheet is read in the browser; raw marks are never stored. What is kept:
--   obe_attainment (source 'computed')  cohort CO% / PO% of the offering, as before
--   obe_student_attainment             each student's CO% and PO% (needed for student-level and program PO)
--   obe_attainment_runs                 when, from which file, with which thresholds, and a fingerprint of the assessment map used

alter table public.obe_attainment drop constraint if exists obe_attainment_source_check;
alter table public.obe_attainment add constraint obe_attainment_source_check check (source in ('manual','import','computed'));

create table if not exists public.obe_attainment_runs (
  offering_id   uuid primary key references public.offerings(id) on delete cascade,
  file_name     text,
  students      integer not null default 0,
  columns       integer not null default 0,
  thresholds    jsonb not null default '{}',     -- {studentCo, cohortCo, studentPo, cohortPo} as fractions
  map_hash      text,                            -- fingerprint of the assessment map + CO→PO mapping used
  warnings      text[] not null default '{}',
  samples       jsonb not null default '[]',     -- highest / average / lowest script per assessment (student IDs and totals)
  computed_at   timestamptz not null default now()
);

create table if not exists public.obe_student_attainment (
  offering_id   uuid not null references public.offerings(id) on delete cascade,
  student_no    text not null check (length(trim(student_no)) > 0),   -- student ID or exam code as written in the marksheet
  outcome_type  text not null check (outcome_type in ('CO','PO')),
  code          text not null check (code ~ '^(CO|PO)([1-9]|1[0-2])$'),
  value         numeric(7,4) check (value between 0 and 100),         -- null = no marks for this outcome
  primary key (offering_id, student_no, outcome_type, code)
);
create index if not exists obe_student_attainment_student on public.obe_student_attainment (student_no);

-- Runs are department-readable like the cohort results; per-student results only by the course's teachers and admins.
alter table public.obe_attainment_runs enable row level security;
drop policy if exists dept_read on public.obe_attainment_runs;
create policy dept_read on public.obe_attainment_runs for select to anon, authenticated using (public.fn_is_active());
drop policy if exists teacher_write on public.obe_attainment_runs;
create policy teacher_write on public.obe_attainment_runs for all to anon, authenticated
  using (public.fn_can_manage(offering_id)) with check (public.fn_can_manage(offering_id));

alter table public.obe_student_attainment enable row level security;
drop policy if exists teacher_read on public.obe_student_attainment;
create policy teacher_read on public.obe_student_attainment for select to anon, authenticated using (public.fn_can_manage(offering_id));
drop policy if exists teacher_write on public.obe_student_attainment;
create policy teacher_write on public.obe_student_attainment for all to anon, authenticated
  using (public.fn_can_manage(offering_id)) with check (public.fn_can_manage(offering_id));

grant select, insert, update, delete on public.obe_attainment_runs, public.obe_student_attainment to anon, authenticated;

drop trigger if exists audit on public.obe_attainment_runs;
create trigger audit after insert or update or delete on public.obe_attainment_runs for each row execute function public.tg_audit('offering_id');

-- Student-level program PO (BAETE PO reference, step 2.2): mean of a student's course PO% across the culminating courses of the batch.
-- Documented by the department but not yet approved by BUGS; shown with that label.
create or replace view public.v_student_program_po with (security_invoker = true) as
  select o.student_batch as batch, s.student_no, s.code as po_code, avg(s.value) as value, count(*)::int as courses,
         array_agg(c.code order by c.code) as course_codes
    from public.obe_student_attainment s
    join public.offerings o on o.id = s.offering_id
    join public.courses c on c.id = o.course_id
   where s.outcome_type = 'PO' and s.value is not null and c.is_culminating and o.student_batch is not null
   group by o.student_batch, s.student_no, s.code;
grant select on public.v_student_program_po to anon, authenticated;

-- Saves one calculation atomically: replaces the offering's per-student results, its cohort results and the run record.
-- p_cohort: [{outcome_type, code, value}], p_students: [{student_no, outcome_type, code, value}], p_run: {file_name, students, columns, thresholds, map_hash, warnings, samples}
create or replace function public.obe_save_computed(p_offering uuid, p_cohort jsonb, p_students jsonb, p_run jsonb) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare n_c int; n_s int;
begin
  if not public.fn_can_manage(p_offering) then raise exception 'Only this course''s teachers or an admin can save its attainment' using errcode = '42501'; end if;
  delete from obe_student_attainment where offering_id = p_offering;
  insert into obe_student_attainment (offering_id, student_no, outcome_type, code, value)
  select p_offering, trim(x->>'student_no'), x->>'outcome_type', x->>'code', nullif(x->>'value', '')::numeric
    from jsonb_array_elements(p_students) x;
  get diagnostics n_s = row_count;
  -- Cohort results: computed values replace earlier ones; outcomes no longer computed (e.g. a PO now unmapped) are removed.
  delete from obe_attainment a where a.offering_id = p_offering
     and not exists (select 1 from jsonb_array_elements(p_cohort) x where x->>'outcome_type' = a.outcome_type and x->>'code' = a.code);
  insert into obe_attainment (offering_id, outcome_type, code, value, source, updated_at)
  select p_offering, x->>'outcome_type', x->>'code', nullif(x->>'value', '')::numeric, 'computed', now()
    from jsonb_array_elements(p_cohort) x
  on conflict (offering_id, outcome_type, code) do update set value = excluded.value, source = 'computed', updated_at = now();
  get diagnostics n_c = row_count;
  insert into obe_attainment_runs (offering_id, file_name, students, columns, thresholds, map_hash, warnings, samples, computed_at)
  values (p_offering, p_run->>'file_name', coalesce((p_run->>'students')::int, 0), coalesce((p_run->>'columns')::int, 0),
          coalesce(p_run->'thresholds', '{}'), p_run->>'map_hash',
          coalesce(array(select jsonb_array_elements_text(p_run->'warnings')), '{}'), coalesce(p_run->'samples', '[]'), now())
  on conflict (offering_id) do update set file_name = excluded.file_name, students = excluded.students, columns = excluded.columns,
     thresholds = excluded.thresholds, map_hash = excluded.map_hash, warnings = excluded.warnings, samples = excluded.samples, computed_at = now();
  return jsonb_build_object('cohort', n_c, 'student_rows', n_s);
end $$;
grant execute on function public.obe_save_computed(uuid, jsonb, jsonb, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------- course outline fields for the outline PDF (department format)
alter table public.obe_offering_docs
  add column if not exists assessment_strategy text,                       -- "Assessment Strategy" paragraph of the outline
  add column if not exists textbooks           text,                       -- one textbook / reference per line
  add column if not exists lecture_plan        jsonb not null default '[]'; -- [{lectures: '1–3', topic, cos: 'CO1, CO2'}]

-- Carry-forward (0013/0014) now also copies the new outline fields into the next offering.
create or replace function public.obe_copy_forward_internal(p_offering uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  tgt record; src uuid; n_co int := 0; n_cr int := 0; n_rb int := 0; docs boolean := false;
begin
  select o.id, o.course_id, public.obe_term_key(t) as k into tgt from offerings o join terms t on t.id = o.term_id where o.id = p_offering;
  if tgt.id is null then return null; end if;
  select o.id into src from offerings o join terms t on t.id = o.term_id
   where o.course_id = tgt.course_id and o.id <> p_offering and public.obe_term_key(t) < tgt.k
     and exists (select 1 from course_outcomes c where c.offering_id = o.id)
   order by public.obe_term_key(t) desc limit 1;
  if src is null then return jsonb_build_object('from', null); end if;

  if not exists (select 1 from course_outcomes where offering_id = p_offering) then
    insert into course_outcomes (offering_id, code, statement, domain, level, sort, domain_levels, delivery, tools, kpa)
    select p_offering, code, statement, domain, level, sort, domain_levels, delivery, tools, kpa from course_outcomes where offering_id = src;
    get diagnostics n_co = row_count;
    insert into co_po_map (co_id, po_code, strength)
    select n.id, m.po_code, m.strength from co_po_map m join course_outcomes s on s.id = m.co_id and s.offering_id = src
      join course_outcomes n on n.offering_id = p_offering and n.code = s.code;
  end if;

  if not exists (select 1 from obe_criteria where offering_id = p_offering) then
    with ins as (
      insert into obe_criteria (offering_id, assessment, label, max_marks, levels, sort)
      select p_offering, assessment, label, max_marks, levels, sort from obe_criteria where offering_id = src
      returning id)
    select count(*) into n_cr from ins;
    insert into obe_criterion_cos (criterion_id, co_id)
    select nc.id, nco.id from obe_criteria sc
      join obe_criterion_cos l on l.criterion_id = sc.id
      join course_outcomes sco on sco.id = l.co_id
      join obe_criteria nc on nc.offering_id = p_offering and nc.sort = sc.sort and nc.label = sc.label
      join course_outcomes nco on nco.offering_id = p_offering and nco.code = sco.code
     where sc.offering_id = src
    on conflict do nothing;
  end if;

  if not exists (select 1 from rubrics where offering_id = p_offering) then
    insert into rubrics (offering_id, title, levels, note, sort, criteria)
    select p_offering, r.title, r.levels, r.note, r.sort,
      coalesce((select jsonb_agg(c || jsonb_build_object('cos', coalesce((
          select jsonb_agg(n.id) from jsonb_array_elements_text(c->'cos') x
            join course_outcomes s on s.id::text = x.value and s.offering_id = src
            join course_outcomes n on n.offering_id = p_offering and n.code = s.code), '[]'::jsonb)) order by ord)
        from jsonb_array_elements(r.criteria) with ordinality e(c, ord)), '[]'::jsonb)
    from rubrics r where r.offering_id = src;
    get diagnostics n_rb = row_count;
  end if;

  if not exists (select 1 from obe_offering_docs where offering_id = p_offering) then
    insert into obe_offering_docs (offering_id, contents, objectives, assessment_strategy, textbooks, lecture_plan, marks_distribution, components, copied_from)
    select p_offering, contents, objectives, assessment_strategy, textbooks, lecture_plan,
      case when marks_distribution = '[]' then coalesce((select d.marks_distribution from obe_offering_docs d join offerings o on o.id = d.offering_id
        where o.course_id = tgt.course_id and d.marks_distribution <> '[]' limit 1), '[]') else marks_distribution end,
      components, src
    from obe_offering_docs where offering_id = src;
    docs := found;
  end if;
  if n_co > 0 or n_cr > 0 or n_rb > 0 then
    insert into obe_offering_docs (offering_id, copied_from) values (p_offering, src)
    on conflict (offering_id) do update set copied_from = src;
  end if;
  return jsonb_build_object('from', src, 'cos', n_co, 'criteria', n_cr, 'rubrics', n_rb, 'outline', docs);
end $$;

-- Make the new tables visible to the API straight away.
notify pgrst, 'reload schema';

-- ===== migrations/0016_outline_fields.sql =====
-- BME Workflow · 0016 the last fields of the department's Course Outline template: the academic session and the class routine.
-- Teachers' phone numbers go in obe_offering_docs.instructors ([{name, room, email, phone}]), which is jsonb already.
alter table public.obe_offering_docs
  add column if not exists academic_session text,   -- e.g. "2023-2024", as printed under Level/Term
  add column if not exists class_routine    text;   -- e.g. "Sunday: 09:00 AM-09:50 AM", one slot per line

-- Carry-forward keeps the session and routine empty on purpose: both change every term.
notify pgrst, 'reload schema';

-- BME Workflow · OBE master data (generated by scripts/build_obe_seed.py — do not edit by hand)
-- Source: SharePoint folder 'BME BUET OBE Documents' (read-only extraction, 2026-11-03T05:39:01.157Z); built 2026-11-03T05:45:39.327519+00:00.
-- Run AFTER migrations/0013_obe_master.sql. Safe to run again: nothing a teacher has entered is overwritten.
begin;
drop view if exists public.v_stg_off;
drop table if exists public.stg_off, public.stg_co, public.stg_crit, public.stg_att, public.stg_car, public.stg_bugs, public.stg_fresh, public.stg_nocrit cascade;
create table public.stg_off (term_code text, term_name text, course_code text, student_batch text, contents text, objectives text, outline_text text, instructors jsonb, marks_distribution jsonb, components jsonb, source jsonb, issues text[], has_outline boolean, has_workbook boolean);
create table public.stg_co (term_code text, course_code text, no int, statement text, domain_levels text[], delivery text[], tools text[], kpa text[], pos text[]);
create table public.stg_crit (term_code text, course_code text, sort int, assessment text, label text, max_marks numeric, cos text[]);
create table public.stg_att (term_code text, course_code text, outcome_type text, code text, value numeric, src text);
create table public.stg_car (term_code text, course_code text, part_c text, part_d text, part_e text);
create table public.stg_bugs (meeting_no text, held_on date, link text, term_code text, course_code text);
insert into stg_off values ('2025-01','January 2025','BME 101',null,'Introduction to Biomedical Engineering and Careers in Biomedical Engineering; Human Biology: The central dogma of molecular biology, Brief introduction to cell biology, Introduction to human anatomy and physiology; Biomechanics: Introduction to biomechanics, Force, moments and couples system, Musculoskeletal systems, Methods of joints; Biomaterials and their interaction with tissue; Bioinstrumentation: Basic control system, Introduction to present-day medical instrumentations and measurements, Biosensors; Medical Imaging: X-ray, CT, Ultrasound, MRI, Nuclear imaging, Microscopy.','Understand the basic principles of engineering in medicine
Demonstrate basic knowledge of human biology
Analyze problems related to basic biomechanics, biomaterials, bioinstrumentation and medical imaging, and biosensors.','Bangladesh University of Engineering and Technology
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No:			BME 101
Course Title:		Introduction to Biomedical Engineering
Credit hours:		3				Contact hours:	3
Level/Term:			1/1
Academic Session: 	2023-2024
Course Teacher(s):
Name | Office/Room | Email | Class routine
Dr. Muhammad Tarik Arafat | ECE 1023 | tarikarafat@bme.buet.ac.bd
+8801911764467 | Saturday:
09:00 AM-09:50 AM
Sunday:
09:00 AM-09:50 AM
Wednesday:
09:00 AM-09:50 AM
Dr. Jahid Ferdous | ECE 1019 | ferdousj@bme.buet.ac.bd
+8801708528993 | 
Course Contents:
Introduction to Biomedical Engineering and Careers in Biomedical Engineering; Human Biology: The central dogma of molecular biology, Brief introduction to cell biology, Introduction to human anatomy and physiology; Biomechanics: Introduction to biomechanics, Force, moments and couples system, Musculoskeletal systems, Methods of joints; Biomaterials and their interaction with tissue; Bioinstrumentation: Basic control system, Introduction to present-day medical instrumentations and measurements, Biosensors; Medical Imaging: X-ray, CT, Ultrasound, MRI, Nuclear imaging, Microscopy.
Course Objectives:
Understand the basic principles of engineering in medicine
Demonstrate basic knowledge of human biology
Analyze problems related to basic biomechanics, biomaterials, bioinstrumentation and medical imaging, and biosensors.
Course Outcomes:
Understand the principles and basic applications of molecular and cell biology.
Discuss the anatomy and physiology of the important tissue and organ systems of the human body.
Solve fundamental problems of mechanics related to human physiology
Understand the principles and applications of biomaterial
Apply the instrumentation techniques to biomedical applications
Understand the principles of basic imaging techniques
Assessment:
Class Participation                  10%
Continuous Assessment         20%
Final Examination                    70%
Total                                       100%
Textbooks and References:
Saltzman, W. M. (2015). Biomedical Engineering: Bridging Medicine and Technology. 2nd Edition. Cambridge University Press.
Endrele, J. & Bronzino, J. (2012). Introduction to Biomedical Engineering. 3rd Edition. Academic Press.
Silverthorn, D. U. (2015). Human Physiology: An Integrated Approach. 7th Edition. Pearson.
Truskey, G. A., Yuan, F., & Katz, D. F. (2010). Transport phenomena in biological systems. 2nd Edition. New Jersey: Pearson.
Weekly Schedule:
Week | Topics
1 | Introduction to biomedical engineering, Molecular biology: The central dogma of molecular biology, Recombinant DNA technology
2 | Cell biology: Cell structure, function, different types of tissue, The structure of cell membrane.
3 | Cell biology: Transport across the cell membrane.
4 | Human anatomy and physiology: Circulation system, Respiratory system, Renal system.
- Class test # 1 (CO-1) (BCI)
5 | Human anatomy and physiology: Communication system, Immunology.
Mid-term break
6 | Biomechanics: Movement, Force, Friction, Pressure, Tension, Compression, Torque, Gravity.
- Class test # 2 (CO-2)
7 | Biomechanics: Deformable body, skeletons, Bone modeling and remodeling, Gait analysis.
8 | Biofluid mechanics: Properties of fluids, Laminar and turbulent flow, Blood as a fluid.
- Class test # 3 (CO-3)
9 | Biomaterials: Polymer, metals, ceramics, ECM, Biomimicking
10 | Biomaterials: Biomanufacturing, Characterization tools, Regulatory process and approval
11 | Instrumentation and measurement: Communication systems in the body, different types of sensors and their working principles
12 | Instrumentation and measurement: Biosensor, ECG signal
13 | Medical imaging: X-ray, CT, SPECT, PET, Ultrasound, Image processing
- Class test # 4 (CO-5)
14 | Medical imaging: MRI, Optical imaging and microscopy, confocal imaging
Prepared by: | 
Name:
Signature:
Date: | Dr. Muhammad Tarik Arafat
Name:
Signature:
Date: | Dr. Jahid Ferdous','[{"name": "Dr. Muhammad Tarik Arafat", "room": "ECE 1023", "email": "tarikarafat@bme.buet.ac.bd"}, {"name": "Dr. Jahid Ferdous", "room": "ECE 1019", "email": "ferdousj@bme.buet.ac.bd"}]'::jsonb,'[{"component": "Class Participation", "percent": 10.0}, {"component": "Continuous Assessment", "percent": 20.0}, {"component": "Final Examination", "percent": 70.0}]'::jsonb,'[]'::jsonb,'{"folder": "1 - Course Files/L1T1/BME 101/January 2025", "files": {"co_po_mapping": "January 2025/CO-PO Mapping.docx", "outline": "January 2025/BME 101_ Course outline_January 2025.docx", "assessment_workbook": "January 2025/Assessments and scripts/BME 101-CO-PO-Assessment Marks.xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 101\nCourse Title: | Introduction to Biomedical Engineering\nLevel, Term and Section | 1/1\nAcademic Term | January 2025\nTextbooks used: | Saltzman, W. M. (2015). Biomedical Engineering: Bridging Medicine and Technology. 2nd Edition. Cambridge University Press.\nEndrele, J.  Bronzino, J. (2012). Introduction to Biomedical Engineering. 3rd Edition. Academic Press.\nSilverthorn, D. U. (2015). Human Physiology: An Integrated Approach. 7th Edition. Pearson.\nTruskey, G. A., Yuan, F.,  Katz, D. F. (2010). Transport phenomena in biological systems. 2nd Edition. New Jersey: Pearson.\nLast term when the course was offered | N/A\nPart B. Attainment for current and previous terms\nJanuary 2025\nCO1 | CO2 | CO3 | CO4 | CO5 | CO6\n96.00% | 82.00% | 96.00% | 76.00% | 74.00% | 80.00%\nY | Y | Y | Y | Y | Y\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\n90.00% | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A\nY | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A\nPart C. Analysis\nTeachers’ comment on attainment: Satisfactory, the percentage threshold being 40%, but not 100%\nInterpretation of student feedback: N/A\nTeachers’ comment on teaching learning: N/A\nPart D. Comments on CQI implemented based on last assessment\nN/A\nPart E. Recommendation\nMajor issues: N/A\nPlan for future actions for further improvement:N/A\nSignature(s):\nName: Dr. Muhammad Tarik Arafat | Name: Dr. Jahid Ferdous\nSignature: | Signature:"}'::jsonb,array['No K/P/A matrix in CO-PO mapping doc']::text[],true,true);
insert into stg_co values ('2025-01','BME 101',1,'Understand the principles and basic applications of molecular and cell biology',array['C2']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-01','BME 101',2,'Discuss the anatomy and physiology of the important tissue and organ systems of the human body',array['C2']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-01','BME 101',3,'Solve fundamental problems of mechanics related to human physiology',array['C3']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-01','BME 101',4,'Understand the principles and applications of biomaterial',array['C2']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-01','BME 101',5,'Apply the instrumentation techniques to biomedical applications',array['C3']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-01','BME 101',6,'Understand the principles of basic imaging techniques',array['C2']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_crit values ('2025-01','BME 101',0,'Term Final','Q01 (a)',20,array['CO1']::text[]);
insert into stg_crit values ('2025-01','BME 101',1,'Term Final','Q01 (b)',15,array['CO6']::text[]);
insert into stg_crit values ('2025-01','BME 101',2,'Term Final','Q01 (c)',10,array['CO2']::text[]);
insert into stg_crit values ('2025-01','BME 101',3,'Term Final','Q05 (a)',15,array['CO3']::text[]);
insert into stg_crit values ('2025-01','BME 101',4,'Term Final','Q05 (b)',15,array['CO4']::text[]);
insert into stg_crit values ('2025-01','BME 101',5,'Term Final','Q05 (c)',15,array['CO5']::text[]);
insert into stg_att values ('2025-01','BME 101','CO','CO1',96.0,'workbook');
insert into stg_att values ('2025-01','BME 101','CO','CO2',82.0,'workbook');
insert into stg_att values ('2025-01','BME 101','CO','CO3',96.0,'workbook');
insert into stg_att values ('2025-01','BME 101','CO','CO4',76.0,'workbook');
insert into stg_att values ('2025-01','BME 101','CO','CO5',74.0,'workbook');
insert into stg_att values ('2025-01','BME 101','CO','CO6',80.0,'workbook');
insert into stg_att values ('2025-01','BME 101','PO','PO1',90.0,'workbook');
insert into stg_car values ('2025-01','BME 101','Teachers’ comment on attainment: Satisfactory, the percentage threshold being 40%, but not 100%
Interpretation of student feedback: N/A
Teachers’ comment on teaching learning: N/A','','');
insert into stg_bugs values ('BUGS 09.04.25','2025-04-09','https://buetedu-my.sharepoint.com/:b:/g/personal/shoyadsabur_bme_buet_ac_bd/IQCjIvypYsjBQLUopsrX7yx3AZtJDMIoD-etVNDs3LN3IwY?e=2OdeOt','2025-01','BME 101');
insert into stg_off values ('2025-01','January 2025','BME 103',null,'Structure of the Cells; prokaryote vs. eukaryote, their function; Sub-cellular organelles and their structures; Different cell types and their roles in physiology; Cell’s response to their environment; Function of cell organelles and cell membrane. Lower limb: Bones of lower limb; thigh; leg; Sole of foot Joints; Venous and lymphatic drainage; Arches of foot. Abdomen: Introduction to abdomen; Abdominal part : stomach; Small and large intestine; Large blood vessel of gut; Extrahepatic billiary apparatus; Spleen, Pancrease and liver; Kidney and ureter; Diaphragm; Posterior abdominal wall; Suprarenal gland and chromaffin system; Perineum; Urinary bladder and urethra; Boundary and contents of pelvis; Female and Male reproductive organ; Rectum and anal canal; Wall of pelvis. Upper limb: Bones of upper limb; Pectoral region; Axilla; Back; Cutaneous nerves, superficial veins and lymphatic drainage; Scapular region; Arm; Forearm and hand; Joints of upper limb. Thorax: Bones and joints of thorax, wall of thorax, thoracic cavity and pleurae; Lungs; 11 Mediastinum; Pericardium and heart; Superior vena cava, aorta and pulmonary trunk; Trachea, esophagus and thoracic duct. Head and neck: Osteology head and neck; Scalp, temple and face; Side of neck; Back of neck; Contents of vertebral canal; Cranial cavity; Contents of orbit; Anterior triangle of neck; Parotid region; Temporal and infratemporal region; Submandibular region; Deep structure in neck; Prevertebral region; Mouth and pharynx; Nose and paranasal sinuses; Larynx; Ear; Eye ball. Brain: Introduction; Meaning of the brain and spinal cord; Spinal cord; Cranial nerves; Brainstem; Cerebellum; ventricle and limbic system; Neural pathways and reticular formation.','The course will cover the structure and function of the different components of a cell.
The course will enable students to get an in-depth understanding of the human anatomy, and the relationship of different human systems, such as cardiovascular system (heart and blood vessel), pulmonary system (lung), renal system, digestive system, nervous system, muscular system and skeletal system.
The course will extend students'' understanding of anatomical concepts and terms.','Bangladesh University of Engineering and Technology
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No:			BME 103
Course Title:		Introduction to Living Cells and Human Anatomy
Credit hours:		3				Contact hours:	3
Level/Term:			1/2
Academic Session: 	2023-2024
Course Teacher(s):
Name | Office/Room | Email | Class routine
Samina Nishat Binte Akram | ECE-1125 | nishatakram1414@gmail.com
+880 1973 730183 | Saturday: 
10:00 AM-10:50 AM
Monday: 
10:00 AM-10:50 AM
Wednesday: 
10:00 AM-10:50 AM
Srija Sarkar Anannya | ECE-1013 | srija@bme.buet.ac.bd
+8801787151545 | 
Course Contents:
Structure of the Cells; prokaryote vs. eukaryote, their function; Sub-cellular organelles and their structures; Different cell types and their roles in physiology; Cell’s response to their environment; Function of cell organelles and cell membrane. Lower limb: Bones of lower limb; thigh; leg; Sole of foot Joints; Venous and lymphatic drainage; Arches of foot. Abdomen: Introduction to abdomen; Abdominal part : stomach; Small and large intestine; Large blood vessel of gut; Extrahepatic billiary apparatus; Spleen, Pancrease and liver; Kidney and ureter; Diaphragm; Posterior abdominal wall; Suprarenal gland and chromaffin system; Perineum; Urinary bladder and urethra; Boundary and contents of pelvis; Female and Male reproductive organ; Rectum and anal canal; Wall of pelvis. Upper limb: Bones of upper limb; Pectoral region; Axilla; Back; Cutaneous nerves, superficial veins and lymphatic drainage; Scapular region; Arm; Forearm and hand; Joints of upper limb. Thorax: Bones and joints of thorax, wall of thorax, thoracic cavity and pleurae; Lungs; 11 Mediastinum; Pericardium and heart; Superior vena cava, aorta and pulmonary trunk; Trachea, esophagus and thoracic duct. Head and neck: Osteology head and neck; Scalp, temple and face; Side of neck; Back of neck; Contents of vertebral canal; Cranial cavity; Contents of orbit; Anterior triangle of neck; Parotid region; Temporal and infratemporal region; Submandibular region; Deep structure in neck; Prevertebral region; Mouth and pharynx; Nose and paranasal sinuses; Larynx; Ear; Eye ball. Brain: Introduction; Meaning of the brain and spinal cord; Spinal cord; Cranial nerves; Brainstem; Cerebellum; ventricle and limbic system; Neural pathways and reticular formation.
Course Objectives:
The course will cover the structure and function of the different components of a cell.
The course will enable students to get an in-depth understanding of the human anatomy, and the relationship of different human systems, such as cardiovascular system (heart and blood vessel), pulmonary system (lung), renal system, digestive system, nervous system, muscular system and skeletal system.
The course will extend students'' understanding of anatomical concepts and terms.
Course Outcomes:
Discuss the structure and function of different cellular components.
Describe fundamental knowledge on different systems of the human body.
Compare different anatomical structures and anomalies.
Apply the knowledge of human anatomy for designing and constructing medical devices.
Assessment:
Class participation/Attendance:                     10%
Homework Assignment and Quizzes:             20%
Term Final Exam:                                            70%
Textbooks and References:
Anthony Mescher-Junqueira''s Basic Histology Text and Atlas-McGraw-Hill   Medical (2013)
Netter F.H. - Atlas of Human Anatomy (2003)
Weekly Schedule:
Week | Topics
1 | Cell and Tissues:
- Structure of the Cells
- Prokaryote vs. eukaryote,their function
- Sub-cellular organelles and their structures
- Different cell types and their roles in physiology
- Cell’s response to their environment
- Function of cell organelles and cell membrane
- Types of tissues with their functions
2 | Skeletal system:
- Components\
- Exoskeleton /endoskeleton
- Bones of axial and appendicular skeleton
- Organic and inorganic composition of bone
- Function of each composition of bone
- Effect of loss of organic and inorganic compositions
- Classification of bones with example
- Bones of different region of the body
- Function of bone, skeleton
- Types of cartilage with examples and functions.
- Applied anatomy and related medical devices
- Class test # 1 (CO-1,CO-2, CO-3, CO-4)
3 | Joints:
- Definition
- Classification of joints
- Characteristic features of each type with example
- Joints of thorax, upper limb, lower limb, head-neck
- Vertebral column with types
- Line of gravity, weight transmission through the body.
- Applied anatomy and related medical devices
4 | Muscle:
- Characteristic features and functions of different types of muscle
- Classification of skeletal muscles with example
- Characteristic features and action of important muscles
- Applied anatomy and related medical devices
5 | Nervous system:
- Brain: different parts of the brain and their functions
- Spinal cord: beginning, termination and support.
- Cranial nerves: motor, sensory and mixed cranial nerves,
- Meninges: different parts of meninges with their contents
- Applied anatomy and related medical devices
- Class test # 2 (CO-2, CO-3, CO-4)
Mid-term break
6 | Circulatory, Cardiovascular and Lymphatic system:
- Types and characteristic features of each type of circulation.
- Parts and functions of the cardiovascular system
- Gross feature of pericardium, pericardial sac, and heart, conducting
system of heart: location and functions
- Applied anatomy and related medical devices
- Parts and function of the lymphatic system.
7 | Respiratory system:
- Parts of different zones of respiratory tract
- Gross features and functions of pleura and lungs
- Differences between right and left principal bronchus
- Structure and functions of respiratory membrane
- Muscle of respiration
- Applied anatomy and related medical devices
- Class test # 3 (CO-2, CO-3, CO-4)
8 | Digestive system:
- Parts of digestive system, extension, termination and constriction of
esophagus
- Gross features and functions of different parts of the digestive system
- Gross features of liver and pancreas
- Parts of extrahepatic biliary apparatus
- Applied anatomy and related medical devices
9 | Urinary system and Reproductive system:
- Parts of urinary system
- Gross features, and functions of different parts of the urinary system
- Parts of male and female reproductive system and their functions
- Applied anatomy and related medical devices
10 | Mediastinum, Cavities/ canals and Eye:
- Definition, division, contents of mediastinum
- Contents of thoracic cavity, abdominal cavity, pelvic cavity, pelvic cavity,
cranial cavity, orbit, vertebral canal
- Parts and functions of different layers of eyeball
- Refractive media of the eyeball.
11 | Endocrine System, Skin and Ear:
- Parts and functions of skin and skin appendages.
- Definition, location, secretion and function of endocrine glands, difference
between exocrine and endocrine glands
- Different parts of the ear with their functions
- Class test # 4 (CO-2, CO-3, CO-4)
Prepared by: | 
Name:
Signature:
Date: | Samina Nishat Binte Akram
Name:
Signature:
Date: | Srija Sarkar Anannya','[{"name": "Samina Nishat Binte Akram", "room": "ECE-1125", "email": "nishatakram1414@gmail.com"}, {"name": "Srija Sarkar Ananya", "room": "ECE- 1013", "email": "srija@bme.buet.ac.bd"}]'::jsonb,'[]'::jsonb,'[]'::jsonb,'{"folder": "1 - Course Files/L1T2/BME 103/January 2025", "files": {"co_po_mapping": "January 2025/CO PO Mapping.docx", "outline": "January 2025/BME 103 _Course outline_Jan 2025.docx", "assessment_workbook": "January 2025/Assessments and scripts/BME 103-CO-PO-Assessment Marks.xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 103\nCourse Title: | Introduction to Living Cells and Human Anatomy\nLevel, Term and Section | 1/2\nAcademic Term | January 2025\nTextbooks used: | Anthony Mescher-Junqueira''s Basic Histology Text and Atlas-McGraw-Hill Medical (2013)\nNetter F.H. - Atlas of Human Anatomy (2003)\nLast term when the course was offered | January 2024\nPart B. Attainment for current and previous terms\nJanuary 2025\nCO1 | CO2 | CO3 | CO4 | CO5 | CO6 | CO7 | CO8 | CO9 | CO10 | CO11 | CO12\n94.12 | 96.08 | 72.55 | 92.16 | NA | NA | NA | NA | NA | NA | NA | NA\nY | Y | Y | Y | NA | NA | NA | NA | NA | NA | NA | NA\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\n92.16 | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA\nY | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA\nPart C. Analysis\nTeachers’ comment on attainment: Satisfactory\nInterpretation of student feedback: Satisfactory\nTeachers’ comment on teaching learning:\nPart D. Comments on CQI implemented based on last assessment\nN/A\nPart E. Recommendation\nMajor issues: None\nPlan for future actions for further improvement:\nCan restructure this course and integrate into human physiology for a more holistic approach\nDuring the review of the course outcomes, it was observed that CO 4  was not adequately aligned with the course content, teaching activities, and assessment methods of BME 103. The course primarily focuses on foundational concepts of cell biology, human anatomy, and physiological systems, while medical device design constitutes a more advanced competency addressed in later courses of the curriculum\nSignature(s):\nName: Samina Nishat Binte Akram | Name: Srija Sarker Anannya\nSignature: | Signature:"}'::jsonb,array['No item-to-CO mapping found (no CO-PO assessment workbook, or an unrecognised layout)']::text[],true,true);
insert into stg_co values ('2025-01','BME 103',1,'Discuss the structure and function of different cellular components.',array['C2']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],array['K1']::text[],array['PO1']::text[]);
insert into stg_co values ('2025-01','BME 103',2,'Describe fundamental knowledge on different systems of the human body.',array['C1']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],array['K1']::text[],array['PO1']::text[]);
insert into stg_co values ('2025-01','BME 103',3,'Compare different anatomical structures and anomalies.',array['C2']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],array['K1']::text[],array['PO1']::text[]);
insert into stg_co values ('2025-01','BME 103',4,'Apply the knowledge of human anatomy for designing and constructing medical devices.',array['C3']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],array['K1']::text[],array['PO1']::text[]);
insert into stg_att values ('2025-01','BME 103','CO','CO1',94.12,'car');
insert into stg_att values ('2025-01','BME 103','CO','CO2',96.08,'car');
insert into stg_att values ('2025-01','BME 103','CO','CO3',72.55,'car');
insert into stg_att values ('2025-01','BME 103','CO','CO4',92.16,'car');
insert into stg_att values ('2025-01','BME 103','PO','PO1',92.16,'car');
insert into stg_car values ('2025-01','BME 103','Teachers’ comment on attainment: Satisfactory
Interpretation of student feedback: Satisfactory
Teachers’ comment on teaching learning:','','Major issues: None
Plan for future actions for further improvement:
Can restructure this course and integrate into human physiology for a more holistic approach
During the review of the course outcomes, it was observed that CO 4  was not adequately aligned with the course content, teaching activities, and assessment methods of BME 103. The course primarily focuses on foundational concepts of cell biology, human anatomy, and physiological systems, while medical device design constitutes a more advanced competency addressed in later courses of the curriculum');
insert into stg_off values ('2025-07','July 2025','BME 103',null,'Structure of the Cells; prokaryote vs. eukaryote, their function; Sub-cellular organelles and their structures; Different cell types and their roles in physiology; Cell’s response to their environment; Function of cell organelles and cell membrane. Lower limb: Bones of lower limb; thigh; leg; Sole of foot Joints; Venous and lymphatic drainage; Arches of foot. Abdomen: Introduction to abdomen; Abdominal part : stomach; Small and large intestine; Large blood vessel of gut; Extrahepatic billiary apparatus; Spleen, Pancrease and liver; Kidney and ureter; Diaphragm; Posterior abdominal wall; Suprarenal gland and chromaffin system; Perineum; Urinary bladder and urethra; Boundary and contents of pelvis; Female and Male reproductive organ; Rectum and anal canal; Wall of pelvis. Upper limb: Bones of upper limb; Pectoral region; Axilla; Back; Cutaneous nerves, superficial veins and lymphatic drainage; Scapular region; Arm; Forearm and hand; Joints of upper limb. Thorax: Bones and joints of thorax, wall of thorax, thoracic cavity and pleurae; Lungs; 11 Mediastinum; Pericardium and heart; Superior vena cava, aorta and pulmonary trunk; Trachea, esophagus and thoracic duct. Head and neck: Osteology head and neck; Scalp, temple and face; Side of neck; Back of neck; Contents of vertebral canal; Cranial cavity; Contents of orbit; Anterior triangle of neck; Parotid region; Temporal and infratemporal region; Submandibular region; Deep structure in neck; Prevertebral region; Mouth and pharynx; Nose and paranasal sinuses; Larynx; Ear; Eye ball. Brain: Introduction; Meaning of the brain and spinal cord; Spinal cord; Cranial nerves; Brainstem; Cerebellum; ventricle and limbic system; Neural pathways and reticular formation.','The course will cover the structure and function of the different components of a cell.
The course will enable students to get an in-depth understanding of the human anatomy, and the relationship of different human systems, such as cardiovascular system (heart and blood vessel), pulmonary system (lung), renal system, digestive system, nervous system, muscular system and skeletal system.
The course will extend students'' understanding of anatomical concepts and terms.','Bangladesh University of Engineering and Technology
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No:			BME 103
Course Title:		Introduction to Living Cells and Human Anatomy
Credit hours:		3				Contact hours:	3
Level/Term:			1/2
Academic Session: 	2024-2025
Course Teacher(s):
Name | Office/Room | Email | Class routine
Mr Md Tazuddin Ahmed | ECE-1123 | mdtuahmedakash@gmail.com
+880 1797091595 | Tuesday: 
9:00 AM-9:50 AM
Wednesday: 
10:00 AM-10:50 AM
Wednesday: 
11:00 AM-11:50 AM
Tasnia Binte Mamun | ECE-1125 | tasnia@bme.buet.ac.bd
+880 1677-900345 | 
Course Contents:
Structure of the Cells; prokaryote vs. eukaryote, their function; Sub-cellular organelles and their structures; Different cell types and their roles in physiology; Cell’s response to their environment; Function of cell organelles and cell membrane. Lower limb: Bones of lower limb; thigh; leg; Sole of foot Joints; Venous and lymphatic drainage; Arches of foot. Abdomen: Introduction to abdomen; Abdominal part : stomach; Small and large intestine; Large blood vessel of gut; Extrahepatic billiary apparatus; Spleen, Pancrease and liver; Kidney and ureter; Diaphragm; Posterior abdominal wall; Suprarenal gland and chromaffin system; Perineum; Urinary bladder and urethra; Boundary and contents of pelvis; Female and Male reproductive organ; Rectum and anal canal; Wall of pelvis. Upper limb: Bones of upper limb; Pectoral region; Axilla; Back; Cutaneous nerves, superficial veins and lymphatic drainage; Scapular region; Arm; Forearm and hand; Joints of upper limb. Thorax: Bones and joints of thorax, wall of thorax, thoracic cavity and pleurae; Lungs; 11 Mediastinum; Pericardium and heart; Superior vena cava, aorta and pulmonary trunk; Trachea, esophagus and thoracic duct. Head and neck: Osteology head and neck; Scalp, temple and face; Side of neck; Back of neck; Contents of vertebral canal; Cranial cavity; Contents of orbit; Anterior triangle of neck; Parotid region; Temporal and infratemporal region; Submandibular region; Deep structure in neck; Prevertebral region; Mouth and pharynx; Nose and paranasal sinuses; Larynx; Ear; Eye ball. Brain: Introduction; Meaning of the brain and spinal cord; Spinal cord; Cranial nerves; Brainstem; Cerebellum; ventricle and limbic system; Neural pathways and reticular formation.
Course Objectives:
The course will cover the structure and function of the different components of a cell.
The course will enable students to get an in-depth understanding of the human anatomy, and the relationship of different human systems, such as cardiovascular system (heart and blood vessel), pulmonary system (lung), renal system, digestive system, nervous system, muscular system and skeletal system.
The course will extend students'' understanding of anatomical concepts and terms.
Course Outcomes:
Discuss the structure and function of different cellular components.
Describe fundamental knowledge on different systems of the human body.
Compare different anatomical structures and anomalies.
Apply the knowledge of human anatomy for designing and constructing medical devices.
Assessment:
Class participation/Attendance:                     10%
Homework Assignment and Quizzes:             20%
Term Final Exam:                                            70%
Textbooks and References:
Anthony Mescher-Junqueira''s Basic Histology Text and Atlas-McGraw-Hill   Medical (2013)
Netter F.H. - Atlas of Human Anatomy (2003)
Weekly Schedule:
Week | Topics
1 | Cell and Tissues:
- Structure of the Cells
- Prokaryote vs. eukaryote,their function
- Sub-cellular organelles and their structures
- Different cell types and their roles in physiology
- Cell’s response to their environment
- Function of cell organelles and cell membrane
- Types of tissues with their functions
2 | Skeletal system:
- Components\
- Exoskeleton /endoskeleton
- Bones of axial and appendicular skeleton
- Organic and inorganic composition of bone
- Function of each composition of bone
- Effect of loss of organic and inorganic compositions
- Classification of bones with example
- Bones of different region of the body
- Function of bone, skeleton
- Types of cartilage with examples and functions.
- Applied anatomy and related medical devices
- Class test # 1 (CO-1,CO-2, CO-3, CO-4)
3 | Joints:
- Definition
- Classification of joints
- Characteristic features of each type with example
- Joints of thorax, upper limb, lower limb, head-neck
- Vertebral column with types
- Line of gravity, weight transmission through the body.
- Applied anatomy and related medical devices
4 | Muscle:
- Characteristic features and functions of different types of muscle
- Classification of skeletal muscles with example
- Characteristic features and action of important muscles
- Applied anatomy and related medical devices
5 | Nervous system:
- Brain: different parts of the brain and their functions
- Spinal cord: beginning, termination and support.
- Cranial nerves: motor, sensory and mixed cranial nerves,
- Meninges: different parts of meninges with their contents
- Applied anatomy and related medical devices
- Class test # 2 (CO-2, CO-3, CO-4)
Mid-term break
6 | Circulatory, Cardiovascular and Lymphatic system:
- Types and characteristic features of each type of circulation.
- Parts and functions of the cardiovascular system
- Gross feature of pericardium, pericardial sac, and heart, conducting
system of heart: location and functions
- Applied anatomy and related medical devices
- Parts and function of the lymphatic system.
7 | Respiratory system:
- Parts of different zones of respiratory tract
- Gross features and functions of pleura and lungs
- Differences between right and left principal bronchus
- Structure and functions of respiratory membrane
- Muscle of respiration
- Applied anatomy and related medical devices
- Class test # 3 (CO-2, CO-3, CO-4)
8 | Digestive system:
- Parts of digestive system, extension, termination and constriction of
esophagus
- Gross features and functions of different parts of the digestive system
- Gross features of liver and pancreas
- Parts of extrahepatic biliary apparatus
- Applied anatomy and related medical devices
9 | Urinary system and Reproductive system:
- Parts of urinary system
- Gross features, and functions of different parts of the urinary system
- Parts of male and female reproductive system and their functions
- Applied anatomy and related medical devices
10 | Mediastinum, Cavities/ canals and Eye:
- Definition, division, contents of mediastinum
- Contents of thoracic cavity, abdominal cavity, pelvic cavity, pelvic cavity,
cranial cavity, orbit, vertebral canal
- Parts and functions of different layers of eyeball
- Refractive media of the eyeball.
11 | Endocrine System, Skin and Ear:
- Parts and functions of skin and skin appendages.
- Definition, location, secretion and function of endocrine glands, difference
between exocrine and endocrine glands
- Different parts of the ear with their functions
- Class test # 4 (CO-2, CO-3, CO-4)
Prepared by: | 
Name:
Signature:
Date: | Mr Md Tazuddin Ahmed
Name:
Signature:
Date: | Tasnia Binte Mamun','[{"name": "Mr Md Tazuddin Ahmed", "room": "ECE-1123", "email": "mdtuahmedakash@gmail.com"}, {"name": "Tasnia Binte Mamun", "room": "ECE-1123", "email": "Tasnia@bme.buet.ac.bd"}]'::jsonb,'[{"component": "Class participation/Attendance", "percent": 10.0}, {"component": "Continuous Assessment", "percent": 20.0}, {"component": "Term Final", "percent": 70.0}]'::jsonb,'[]'::jsonb,'{"folder": "1 - Course Files/L1T2/BME 103/July 2025", "files": {"co_po_mapping": "July 2025/CO PO Mapping.docx", "outline": "July 2025/BME 103 _Course outline_July 2025.docx", "assessment_workbook": "July 2025/Assessment and Scripts/BME 103-CO-PO-Assessment-marks.xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 103\nCourse Title: | Introduction to Living Cells and Human Anatomy\nLevel, Term and Section | 1/2\nAcademic Term | July 2025\nTextbooks used: | Anthony Mescher-Junqueira''s Basic Histology Text and Atlas-McGraw-Hill Medical (2013)\nNetter F.H. - Atlas of Human Anatomy (2003)\nLast term when the course was offered | January 2025\nPart B. Attainment for current and previous terms\nJanuary 2025\nCO1 | CO2 | CO3 | CO4 | CO5 | CO6 | CO7 | CO8 | CO9 | CO10 | CO11 | CO12\n94.12 | 96.08 | 72.55 | 92.16 | NA | NA | NA | NA | NA | NA | NA | NA\nY | Y | Y | Y | NA | NA | NA | NA | NA | NA | NA | NA\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\n92.16 | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA\nY | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA\nJuly 2025\nCO Attainment | CO1 | CO2 | CO3 |  |  |  |  |  |  |  |  | \n%student attained | 82.00% | 96.00% | 60.00% |  |  |  |  |  |  |  |  | \nCohort Attainment | Y | Y | Y |  |  |  |  |  |  |  |  | \n |  |  |  |  |  |  |  |  |  |  |  | \n |  |  |  |  |  |  |  |  |  |  |  | \nPO Attainment | PO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\n%student attained | 84.00% | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A\nCohort Attainment | Y | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A\nPart C. Analysis\nTeachers’ comment on attainment: Satisfactory\nInterpretation of student feedback: Satisfactory\nTeachers’ comment on teaching learning: Youtube videos on anatomy can be used more for ease of understanding of the students.\nPart D. Comments on CQI implemented based on last assessment\nCourse outline and CO-PO mapping was updated on this term upon discussion on the feedback mentioned in the previous CAR.\nPart E. Recommendation\nMajor issues: None\nPlan for future actions for further improvement:\nThe syllabus in the first half of the course should be readjusted properly so that enough emphasis could be given on the ‘Nervous System’.\nSignature(s):\nName: Md Tazuddin Ahmed | Name: Tasnia Binte Mamun\nSignature: | Signature:"}'::jsonb,'{}'::text[],true,true);
insert into stg_co values ('2025-07','BME 103',1,'Discuss the structure and function of different cellular components.',array['C2']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],array['K1']::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 103',2,'Describe fundamental knowledge on different systems of the human body.',array['C1']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],array['K1']::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 103',3,'Compare different anatomical structures and anomalies.',array['C2']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],array['K1']::text[],array['PO1']::text[]);
insert into stg_crit values ('2025-07','BME 103',0,'Term Final','Q01 (a)',10,array['CO1']::text[]);
insert into stg_crit values ('2025-07','BME 103',1,'Term Final','Q01 (b)',10,array['CO1']::text[]);
insert into stg_crit values ('2025-07','BME 103',2,'Term Final','Q01 (c)',10,array['CO2']::text[]);
insert into stg_crit values ('2025-07','BME 103',3,'Term Final','Q01 (d)',15,array['CO2']::text[]);
insert into stg_crit values ('2025-07','BME 103',4,'Term Final','Q05 (a)',15,array['CO2']::text[]);
insert into stg_crit values ('2025-07','BME 103',5,'Term Final','Q05 (b)',15,array['CO3']::text[]);
insert into stg_crit values ('2025-07','BME 103',6,'Term Final','Q05 (c)',15,array['CO2']::text[]);
insert into stg_att values ('2025-07','BME 103','CO','CO1',82.0,'workbook');
insert into stg_att values ('2025-07','BME 103','CO','CO2',96.0,'workbook');
insert into stg_att values ('2025-07','BME 103','CO','CO3',60.0,'workbook');
insert into stg_att values ('2025-07','BME 103','PO','PO1',84.0,'workbook');
insert into stg_car values ('2025-07','BME 103','Teachers’ comment on attainment: Satisfactory
Interpretation of student feedback: Satisfactory
Teachers’ comment on teaching learning: Youtube videos on anatomy can be used more for ease of understanding of the students.','Course outline and CO-PO mapping was updated on this term upon discussion on the feedback mentioned in the previous CAR.','Major issues: None
Plan for future actions for further improvement:
The syllabus in the first half of the course should be readjusted properly so that enough emphasis could be given on the ‘Nervous System’.');
insert into stg_bugs values ('BUGS 26.10.25','2025-10-26','https://buetedu-my.sharepoint.com/:b:/g/personal/shoyadsabur_bme_buet_ac_bd/IQCy_jpgTQFiT5eiZAwUwCoCAa3SOSsoXvVcBvXkXCbvP2o?e=dw7GtT','2025-07','BME 103');
insert into stg_off values ('2025-01','January 2025','BME 150',null,'Designing Biomedical systems using different commercial software packages.','The course will introduce the standards and conventions of engineering drawing
The course will enable students to design and simulate complex biomedical and physiological systems using design and simulation tools.
The course will introduce students to common numeric techniques using MATLAB','Bangladesh University of Engineering and Technology
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No:			BME 150
Course Title:	           Computer-Aided Design in Biomedical Engineering       Sessional
Credit hours:		1.5				Contact hours:	3
Level/Term:			1/2
Academic Session: 	2023-2024
Course Teacher(s):
Name | Office/ 
Room | Email & Telephone | Class routine
Samiul Based Shuvo | ECE-1121 | sbshuvo@bme.buet.ac.bd
+ 880 1521-258181 | Sunday: 
2:00 AM-4:50 AM
Monday: 
11:00 AM-12:50 AM
Samina Nishat Binte Akram | ECE-1125 | samina@bme.buet.ac.bd
+880 1973 730183 | 
Abdullah Al Mamun | ECE-1123 | abdullah@bme.buet.ac.bd
+880 1639-008395 | Sunday: 
2:00 AM-4:50 AM
Srija Sarkar Ananya | ECE- 1013 | srija@bme.buet.ac.bd
+880 1787-151545 | Monday: 
11:00 AM-12:50 AM
Course Contents:
Designing Biomedical systems using different commercial software packages.
Course Objectives:
The course will introduce the standards and conventions of engineering drawing
The course will enable students to design and simulate complex biomedical and physiological systems using design and simulation tools.
The course will introduce students to common numeric techniques using MATLAB
Course Outcomes:
Perform simulation of selected biomedical or physiological system
Construct a device  for biomedical or physiological system application
Use appropriate techniques to solve  common numerical problems
Solve problems relating to computer aided design in biomedical engineering
Assessment:
Class Participation and Continuous Assessment		10%
Lab Test/Project (×3)		                                                 60%
Final Quiz			                                                            30%
Total			                                                          100%
Textbooks and References:
Ibrahim Zeid, Nathan Brown - Mastering SolidWorks_ The Design Approach, 3rd Edition (2021, Peachpit Press).
Mechanical engineering drawing, Dr. Amalesh Chandra Mandal, Dr. Md. Quamrul Islam.
An Introduction to Modeling of Transport Processes, Applications to Biomedical Systems by Ashim Datta and Vineet Rakesh.
MATLAB Programming for Biomedical Engineers and Scientists - Andrew P. King, Paul Aljabar
Weekly Schedule:
Week | Topics
1 | Introduction of engineering drawing:
Computer-aided designing and its standards
Engineering product designing and its standards
Engineering drawing and its standards
Drawing instruments, Lines, Lettering and Dimensioning
Plain and Curves
Orthographic Projection, First & Third angle projection methods
Projection of Lines: Oblique Lines, Traces. Applications of Projection of Lines
Projection of Solids: Cube, Prism, Pyramid, Cylinder, Cone. Suspended Solids
Isometric Projections: Isometric Lines, Planes and Scale
Conversion of given 2D views to Isometric Projection/View
Conversion of given 3D Views to 2D representation
2 | Introduction to Solidworks drawing:
Sketch: drawing of lines, circle, polygon, arc, ellipse, etc, and creating 2D drawings
Sketching tools: move, copy, rotate, scale, mirror, offset and array; trim, extend, fillet, chamfer, dimensioning
3 | Solidworks solid creation 1:
Introduction to solidworks
Extrusion tools: Extruded, Revolved, Swept, Lofted Boss/Base etc.
Cutting tools: Extruded, Revolved, Swept cut etc.
Viewing tools: Live Section Plane, Model Break View, Suppress/Unsuppress etc.
Modification tools: Linear/ Circular Pattern, Thicken, Mirror Feature, Fillet, Rib, Chamfer, etc
Extraction of 2D drawings from solid models
Reverse Modelling
4 | Medical device designing-1 (Stethoscope, Laparoscope, Dental Implant)
5 | Solidworks solid assembly:
Assembly tools: Insert Components, Linear/Circular Component Pattern, Mirror Components, Mate, Exploded View etc.
Medical device designing-2 (Laparoscope, Tracheostomy tube)
6 | Lab test # 1 (CO-1)
7 | Ansys-1
Introduction to Using ANSYS Fluent in ANSYS Workbench
8 | Ansys-2
Solving specific biomedical problem using ANSYS Fluent- I
9 | Ansys-3
Solving specific biomedical problem using ANSYS Fluent- II
10 | Lab test # 2 (CO-2)
11 | Matlab-1
Commands
MATLAB Desktop and Editor
Vectors and Matrices
Indexing into and Modifying Arrays
Array Calculations
Calling Functions
Obtaining Help
12 | Matlab-2
Plotting Data
Importing Data
Logical Arrays
Loops
Conditional statements
Solving specific biomedical problems using Matlab
13 | Lab test # 3 (CO-3)
14 | Lab Quiz (CO-4)
Prepared by: | 
Name:
Signature:
Date: | Samina Nishat Binte Akram
Name:
Signature:
Date: | Samiul Based Shuvo
Name:
Signature:
Date: | Abdullah Al Mamun
Name:
Signature:
Date: | Srija Sarkar Ananya','[{"name": "Samiul Based Shuvo", "room": "ECE-1121", "email": "sbshuvo@bme.buet.ac.bd"}, {"name": "Samina Nishat Binte Akram", "room": "ECE-1125", "email": "samina@bme.buet.ac.bd"}, {"name": "Abdullah Al Mamun", "room": "ECE-1123", "email": "abdullah@bme.buet.ac.bd"}, {"name": "Srija Sarkar Ananya", "room": "ECE- 1013", "email": "srija@bme.buet.ac.bd"}]'::jsonb,'[]'::jsonb,'[{"component": "Continuous Assessment", "weight": 0.1, "marks": 15}, {"component": "Lab Test", "weight": 0.6, "marks": 90}, {"component": "Final Quiz", "weight": 0.3, "marks": 45}]'::jsonb,'{"folder": "1 - Course Files/L1T2/BME 150/January 2025", "files": {"co_po_mapping": "January 2025/CO-PO Mapping.docx", "outline": "January 2025/BME 150 _Course outline_Jan 2025.docx", "assessment_workbook": "January 2025/Assessment and Scripts/BME 150_CO-PO-Assessment-marks.xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 150\nCourse Title: | Computer-Aided Design in Biomedical Engineering Sessional\nLevel, Term and Section | 1-2, A1, A2\nAcademic Term | January 2025\nTextbooks used: | -\nLast term when the course was offered | January 2024\nPart B. Attainment for current and previous terms\nFrom the excel worksheet\nCurrent Term\nCO1 | CO2 | CO3 | CO4 | CO5 | CO6 | CO7 | CO8 | CO9 | CO10 | CO11 | CO12\n88.24% | 94.12% | 96.08% | 100.00% | NA | NA | NA | NA | NA | NA | NA | NA\nY | Y | Y | Y | NA | NA | NA | NA | NA | NA | NA | NA\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\nNA | NA | NA | NA | 98.04% | NA | NA | NA | NA | NA | NA | NA\nNA | NA | NA | NA | Y | NA | NA | NA | NA | NA | NA | NA\nPart C. Analysis\nTeachers’ comment on attainment: Satisfactory\nInterpretation of student feedback:\nTeachers’ comment on teaching learning: Can be more interactive, with more real life applications.\nPart D. Comments on CQI implemented based on last assessment\nN/A\nPart E. Recommendation\nMajor issues: None\nPlan for future actions for further improvement:\nReview of the course assessment data and curriculum mapping indicated that certain course outcomes and CO–PO mappings were not fully aligned with the actual course contents and laboratory activities. In particular, the outcome related to device construction was not directly supported by the instructional activities or assessment tools. Additionally, several Knowledge Profile and Complex Engineering Problem Solving mappings overstated the complexity level addressed by the course.\nIt is recommended that the course outcomes and their associated mappings be revised to better reflect the actual scope, learning activities, and assessment methods of the course. Greater emphasis should be placed on computational modelling, simulation, programming-based problem solving, and computer-aided design, which constitute the primary focus of the course. Outcomes and mappings that imply competencies beyond the intended course scope, such as device construction and higher-level complex engineering problem-solving activities, should be reviewed and adjusted to ensure constructive alignment between course contents, instructional methods, laboratory exercises, assessment tools, and OBE requirements.\nSignature(s):\nName: Samiul Based Shuvo | Name: Md. Abdullah Al Mamun | Name: Samina Nishat Binte Akram | Name: Srija Sarker Anannya\nSignature: | Signature: | Signature: | Signature:"}'::jsonb,'{}'::text[],true,true);
insert into stg_co values ('2025-01','BME 150',1,'Perform simulation of selected biomedical or physiological system',array['C3']::text[],array['Lectures','Homework']::text[],'{}'::text[],array['K3','K5','K6','P1','P3','P5']::text[],array['PO5']::text[]);
insert into stg_co values ('2025-01','BME 150',2,'Construct a device for biomedical or physiological system application',array['C3']::text[],array['Lectures','Simulation']::text[],'{}'::text[],array['K3','K6','P1','P3','P7']::text[],array['PO5']::text[]);
insert into stg_co values ('2025-01','BME 150',3,'Use appropriate techniques to solve common numerical problems',array['C3']::text[],array['Lectures','Coding Tasks']::text[],'{}'::text[],array['K2','K3','K6','P1','P2','P3']::text[],array['PO5']::text[]);
insert into stg_co values ('2025-01','BME 150',4,'Solve problems relating to computer aided design in biomedical engineering',array['C3']::text[],array['Lectures','Homework']::text[],'{}'::text[],array['K5','K6','P1','P3','P7']::text[],array['PO5']::text[]);
insert into stg_crit values ('2025-01','BME 150',0,'Continuous Assessment','Simulation of physiological system using ANSYS',5,array['CO1']::text[]);
insert into stg_crit values ('2025-01','BME 150',1,'Continuous Assessment','Designing of 3 dimentional parts Using solidworks',5,array['CO2']::text[]);
insert into stg_crit values ('2025-01','BME 150',2,'Continuous Assessment','Using MATLAB for design problems',5,array['CO3']::text[]);
insert into stg_crit values ('2025-01','BME 150',3,'Lab Test','Simulation of physiological system using ANSYS',30,array['CO1']::text[]);
insert into stg_crit values ('2025-01','BME 150',4,'Lab Test','Designing of medical device using SOLIDWORKS',30,array['CO2']::text[]);
insert into stg_crit values ('2025-01','BME 150',5,'Lab Test','Using numerical techniques by MATLAB to solve biomecdical problems',30,array['CO3']::text[]);
insert into stg_crit values ('2025-01','BME 150',6,'Lab Quiz','Problems relating to engineering drawing for computer aided design',15,array['CO4']::text[]);
insert into stg_att values ('2025-01','BME 150','CO','CO1',88.24,'workbook');
insert into stg_att values ('2025-01','BME 150','CO','CO2',94.12,'workbook');
insert into stg_att values ('2025-01','BME 150','CO','CO3',96.08,'workbook');
insert into stg_att values ('2025-01','BME 150','CO','CO4',100,'workbook');
insert into stg_att values ('2025-01','BME 150','PO','PO5',98.04,'workbook');
insert into stg_car values ('2025-01','BME 150','Teachers’ comment on attainment: Satisfactory
Interpretation of student feedback:
Teachers’ comment on teaching learning: Can be more interactive, with more real life applications.','','Major issues: None
Plan for future actions for further improvement:
Review of the course assessment data and curriculum mapping indicated that certain course outcomes and CO–PO mappings were not fully aligned with the actual course contents and laboratory activities. In particular, the outcome related to device construction was not directly supported by the instructional activities or assessment tools. Additionally, several Knowledge Profile and Complex Engineering Problem Solving mappings overstated the complexity level addressed by the course.
It is recommended that the course outcomes and their associated mappings be revised to better reflect the actual scope, learning activities, and assessment methods of the course. Greater emphasis should be placed on computational modelling, simulation, programming-based problem solving, and computer-aided design, which constitute the primary focus of the course. Outcomes and mappings that imply competencies beyond the intended course scope, such as device construction and higher-level complex engineering problem-solving activities, should be reviewed and adjusted to ensure constructive alignment between course contents, instructional methods, laboratory exercises, assessment tools, and OBE requirements.');
insert into stg_off values ('2025-07','July 2025','BME 150',null,'Designing Biomedical systems using different commercial software packages.','The course will introduce the standards and conventions of engineering drawing
The course will enable students to design and simulate complex biomedical and physiological systems using design and simulation tools.
The course will introduce students to common numeric techniques using MATLAB','Bangladesh University of Engineering and Technology
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No:			BME 150
Course Title:	           Computer-Aided Design in Biomedical Engineering       Sessional
Credit hours:		1.5				Contact hours:	3
Level/Term:			1/2
Academic Session: 	2024-2025
Course Teacher(s):
Name | Office/ 
Room | Email & Telephone | Class routine
Samiul Based Shuvo | ECE-1121 | sbshuvo@bme.buet.ac.bd
+ 880 1521-258181 | Sunday: 
2:00 AM-4:50 AM
Monday: 
11:00 AM-12:50 AM
Samina Nishat Binte Akram | ECE-1125 | samina@bme.buet.ac.bd
+880 1973 730183 | 
Abdullah Al Mamun | ECE-1123 | abdullah@bme.buet.ac.bd
+880 1639-008395 | Sunday: 
2:00 AM-4:50 AM
Srija Sarkar Ananya | ECE- 1013 | srija@bme.buet.ac.bd
+880 1787-151545 | Monday: 
11:00 AM-12:50 AM
Course Contents:
Designing Biomedical systems using different commercial software packages.
Course Objectives:
The course will introduce the standards and conventions of engineering drawing
The course will enable students to design and simulate complex biomedical and physiological systems using design and simulation tools.
The course will introduce students to common numeric techniques using MATLAB
Course Outcomes:
Perform simulation of selected biomedical or physiological system
Construct a device  for biomedical or physiological system application
Use appropriate techniques to solve  common numerical problems
Solve problems relating to computer aided design in biomedical engineering
Assessment:
Class Participation and Continuous Assessment		10%
Lab Test/Project (×3)		                                                 60%
Final Quiz			                                                            30%
Total			                                                          100%
Textbooks and References:
Ibrahim Zeid, Nathan Brown - Mastering SolidWorks_ The Design Approach, 3rd Edition (2021, Peachpit Press).
Mechanical engineering drawing, Dr. Amalesh Chandra Mandal, Dr. Md. Quamrul Islam.
An Introduction to Modeling of Transport Processes, Applications to Biomedical Systems by Ashim Datta and Vineet Rakesh.
MATLAB Programming for Biomedical Engineers and Scientists - Andrew P. King, Paul Aljabar
Weekly Schedule:
Week | Topics
1 | Introduction of engineering drawing:
Computer-aided designing and its standards
Engineering product designing and its standards
Introduction to 2D drafting
2 | Introduction to Solidworks drawing:
Sketch: drawing of lines, circle, polygon, arc, ellipse, etc, and creating 2D drawings
Sketching tools: move, copy, rotate, scale, mirror, offset and array; trim, extend, fillet, chamfer, dimensioning
3 | Solidworks solid creation:
Extraction of 2D drawings from solid models
Extrusion tools: Extruded, Revolved, Swept, Lofted Boss/Base etc.
Cutting tools: Extruded, Revolved, Swept cut etc.
Relevant Laparoscope’s components creation
4 | Solidworks solid creation:
Viewing tools: Live Section Plane, Model Break View, Suppress/Unsuppress etc.
Modification tools: Linear/ Circular Pattern, Thicken, Mirror Feature, Fillet, Rib, Chamfer, etc
Reverse Modelling
Relevant Laparoscope’s components creation
5 | Solidworks Assembly tool:
Insert Components, Linear/Circular Component Pattern, Mirror Components, Mate, Exploded View etc.
Working drawings
Laparoscope’s components Assembly
6 | Solidworks solid Creation and Assembly:
Tracheostomy tube/ Prosthetic Hip Implant
Motion Study
7 | Solidworks solid Creation and Assembly:
Dynamic hip screw / Bone plate
3D Printed prototyping
8 | Lab test # 1 or /and Final Project with 3D printed model (Based on Paper’s Model/ Given Need)
9 | Ansys-1
Introduction to Using ANSYS Fluent in ANSYS Workbench
Solving specific biomedical problem using ANSYS Fluent- I
10 | Ansys-2
Solving specific biomedical problem using ANSYS Fluent- II
11 | Matlab-1
Commands
MATLAB Desktop and Editor
Vectors and Matrices
Indexing into and Modifying Arrays
Array Calculations
12 | Matlab-2
Plotting Data
Importing Data
Logical Arrays
Loops
Conditional statements
Solving specific biomedical problems using Matlab
13 | Lab test # 2 (CO-2 and CO-3), Lab Quiz
14 | Lab Quiz (CO-4)
Prepared by: | 
Name:
Signature:
Date: | Samina Nishat Binte Akram
Name:
Signature:
Date: | Samiul Based Shuvo
Name:
Signature:
Date: | Abdullah Al Mamun
Name:
Signature:
Date: | Srija Sarkar Ananya','[{"name": "Samiul Based Shuvo", "room": "ECE-1121", "email": "sbshuvo@bme.buet.ac.bd"}, {"name": "Samina Nishat Binte Akram", "room": "ECE-1125", "email": "samina@bme.buet.ac.bd"}, {"name": "Abdullah Al Mamun", "room": "ECE-1123", "email": "abdullah@bme.buet.ac.bd"}, {"name": "Srija Sarkar Ananya", "room": "ECE- 1013", "email": "srija@bme.buet.ac.bd"}]'::jsonb,'[]'::jsonb,'[{"component": "Continuous Assessment", "weight": 0.1, "marks": 15}, {"component": "Lab Test", "weight": 0.6, "marks": 90}, {"component": "Final Quiz", "weight": 0.3, "marks": 45}]'::jsonb,'{"folder": "1 - Course Files/L1T2/BME 150/July 2025", "files": {"co_po_mapping": "July 2025/CO-PO Mapping.docx", "outline": "July 2025/BME 150 _Course outline_July 2025.docx", "assessment_workbook": "July 2025/Assessment and Scripts/BME 150_CO-PO-Assessment-marks.xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 150\nCourse Title: | Computer-Aided Design in Biomedical Engineering Sessional\nLevel, Term and Section | 1-2, A1, A2\nAcademic Term | July 2025\nTextbooks used: | -\nLast term when the course was offered | January 2025\nPart B. Attainment for current and previous terms\nFrom the excel worksheet\nCurrent Term\nCO1 | CO2 | CO3 | CO4 | CO5 | CO6 | CO7 | CO8 | CO9 | CO10 | CO11 | CO12\n88.24% | 64.71% | 62.75% | 88.24% | NA | NA | NA | NA | NA | NA | NA | NA\nY | Y | Y | Y | NA | NA | NA | NA | NA | NA | NA | NA\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\n88.24% | NA | NA | NA | 74.51% | NA | NA | NA | NA | NA | NA | NA\nY | NA | NA | NA | Y | NA | NA | NA | NA | NA | NA | NA\nPrevious Term\nCO1 | CO2 | CO3 | CO4 | CO5 | CO6 | CO7 | CO8 | CO9 | CO10 | CO11 | CO12\n88.24% | 94.12% | 96.08% | 100.00% | NA | NA | NA | NA | NA | NA | NA | NA\nY | Y | Y | Y | NA | NA | NA | NA | NA | NA | NA | NA\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\nNA | NA | NA | NA | 98.04% | NA | NA | NA | NA | NA | NA | NA\nNA | NA | NA | NA | Y | NA | NA | NA | NA | NA | NA | NA\nPart C. Analysis\nTeachers’ comment on attainment: Satisfactory, but lower in percentage of CO attained compared to last term\nInterpretation of student feedback: Content could be more tailored to students’ aptitude and learning pace.\nTeachers’ comment on teaching learning: Better interaction with students from last term, more real world application utilized, like designing medical devices.\nPart D. Comments on CQI implemented based on last assessment\nThe course outcomes were revised and re-mapped to better align course delivery, assessment methods, and program objectives. As a result, students are demonstrating stronger competencies in biomedical system modelling, simulation, programming-based numerical analysis, and the use of modern engineering tools.\nThe assessment framework was enhanced to provide more accurate measurement of learning achievement and outcome attainment. Additionally, the CO–PO mappings were updated to facilitate better documentation for accreditation purposes.\nThese implemented changes have shown a positive impact on student problem-solving skills, practical engineering proficiency, and overall preparedness for advanced studies and professional practice in the field of biomedical engineering.\nPart E. Recommendation\nMajor issues: None\nSignature(s):\nName: Samiul Based Shuvo | Name: Md. Abdullah Al Mamun | Name: Samina Nishat Binte Akram | Name: Srija Sarker Anannya\nSignature: | Signature: | Signature: | Signature:"}'::jsonb,'{}'::text[],true,true);
insert into stg_co values ('2025-07','BME 150',1,'Perform the modelling of device for biomedical or physiological system applications',array['PS2']::text[],array['Guided Instruction','Lectures','Classworks and Homeworks']::text[],array['Continuous Assessment','Lab Test']::text[],array['K6','P1']::text[],array['PO5']::text[]);
insert into stg_co values ('2025-07','BME 150',2,'Perform simulation of selected biomedical or physiological system',array['PS2']::text[],array['Guided Instruction','Lectures','Classworks and Homeworks']::text[],array['Lab Test']::text[],array['K6','P1']::text[],array['PO5']::text[]);
insert into stg_co values ('2025-07','BME 150',3,'Execute different program for solving common numerical problems',array['PS2']::text[],array['Guided Instruction','Lectures','Classworks and Homeworks']::text[],array['Lab Test']::text[],array['K6','P1']::text[],array['PO5']::text[]);
insert into stg_co values ('2025-07','BME 150',4,'Solve problems relating to computer aided design in biomedical engineering',array['C3']::text[],array['Lectures']::text[],array['Lab Quiz']::text[],array['K1','K2','K3','K4','P1']::text[],array['PO1']::text[]);
insert into stg_crit values ('2025-07','BME 150',0,'Continuous Assessment','Perform the modelling of device for biomedical or physiological system applications',15,array['CO1']::text[]);
insert into stg_crit values ('2025-07','BME 150',1,'Lab Test','Perform the modelling of device for biomedical or physiological system applications',30,array['CO1']::text[]);
insert into stg_crit values ('2025-07','BME 150',2,'Lab Test','Perform simulation of selected biomedical or physiological system',30,array['CO2']::text[]);
insert into stg_crit values ('2025-07','BME 150',3,'Lab Test','Execute different program for solving common biomedical problems',30,array['CO3']::text[]);
insert into stg_crit values ('2025-07','BME 150',4,'Lab Quiz','Solve problems relating to computer aided design in biomedical engineering',45,array['CO4']::text[]);
insert into stg_att values ('2025-07','BME 150','CO','CO1',88.24,'workbook');
insert into stg_att values ('2025-07','BME 150','CO','CO2',64.71,'workbook');
insert into stg_att values ('2025-07','BME 150','CO','CO3',62.75,'workbook');
insert into stg_att values ('2025-07','BME 150','CO','CO4',88.24,'workbook');
insert into stg_att values ('2025-07','BME 150','PO','PO1',88.24,'workbook');
insert into stg_att values ('2025-07','BME 150','PO','PO5',74.51,'workbook');
insert into stg_car values ('2025-07','BME 150','Teachers’ comment on attainment: Satisfactory, but lower in percentage of CO attained compared to last term
Interpretation of student feedback: Content could be more tailored to students’ aptitude and learning pace.
Teachers’ comment on teaching learning: Better interaction with students from last term, more real world application utilized, like designing medical devices.','The course outcomes were revised and re-mapped to better align course delivery, assessment methods, and program objectives. As a result, students are demonstrating stronger competencies in biomedical system modelling, simulation, programming-based numerical analysis, and the use of modern engineering tools.
The assessment framework was enhanced to provide more accurate measurement of learning achievement and outcome attainment. Additionally, the CO–PO mappings were updated to facilitate better documentation for accreditation purposes.
These implemented changes have shown a positive impact on student problem-solving skills, practical engineering proficiency, and overall preparedness for advanced studies and professional practice in the field of biomedical engineering.','');
insert into stg_bugs values ('BUGS 26.10.25','2025-10-26','https://buetedu-my.sharepoint.com/:b:/g/personal/shoyadsabur_bme_buet_ac_bd/IQCy_jpgTQFiT5eiZAwUwCoCAa3SOSsoXvVcBvXkXCbvP2o?e=dw7GtT','2025-07','BME 150');
insert into stg_off values ('2025-01','January 2025','BME 201',null,'Terminology of movement: reference planes and directions; Principles of equilibrium: forces, moments and couples, equations of static equilibrium; Simple machine: levers and pulleys; Body segment and mass; Center of gravity; Basic statics and movements at specific joints; Linear and angular kinetics and kinematics: kinetic equations of motion, rotations, moment of inertia, radius of gyration, parallel axis theorem; Impulse and momentum; Terrestrial locomotion: jump, kinetics and kinematics of gait cycle; Applications of human motion analysis; Mechanics of deformable bodies: simple stress and strain, Hooke''s law, stress- strain diagram, multiaxial deformation and stress analyses, combined stresses, mechanical properties of biological tissues, viscoelasticity; Measurement of mechanical properties of cells; Models of cellular biomechanical behavior; Skeletal muscle morphology; Muscles constitutive modeling; Muscle and bone interactions; Bone composition, structure and biomechanical properties; Bone fracture and failure mechanics.','The course will demonstrate an understanding of the basic principles and terminologies of biomechanics
The course will enable the students to identify the major factors involved in the statics and dynamics of musculoskeletal system, human locomotion and gait
The course will describe different forces which act on the body and relate them to injury and illness through evaluation of current scholarly research
The course will familiarize the fundamental techniques of cellular mechanics and mechanobiology
The course will enable the students to apply biomechanics principles to “real-world” clinical and biomechanical systems','Bangladesh University of Engineering and Technology
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No:			BME 201
Course Title:		Biomechanics
Credit hours:		3				Contact hours:	3
Level/Term:			2/1
Academic Session: 	2023-2024
Course Teacher(s):
Name | Office/
Room | Email & Telephone | Class routine | Tutorial Hour
Ms. Shams Nafisa Ali | ECE -1013 | nafisa@bme.buet.ac.bd  
+880 1731-953973 | Sunday:
8:00 AM-8:50 AM
Tuesday:
9:00 AM-9:50 AM
Wednesday:
10:00 PM-10:50 PM | Monday:
4:00 PM-5:00 PM
Mr. Md Abdullah Al Mamun | ECE-1123 | abdullah@bme.buet.ac.bd  
+880 1639-008395 |  | 
Course Contents:
Terminology of movement: reference planes and directions; Principles of equilibrium: forces, moments and couples, equations of static equilibrium; Simple machine: levers and pulleys; Body segment and mass; Center of gravity; Basic statics and movements at specific joints; Linear and angular kinetics and kinematics: kinetic equations of motion, rotations, moment of inertia, radius of gyration, parallel axis theorem; Impulse and momentum; Terrestrial locomotion: jump, kinetics and kinematics of gait cycle; Applications of human motion analysis; Mechanics of deformable bodies: simple stress and strain, Hooke''s law, stress- strain diagram, multiaxial deformation and stress analyses, combined stresses, mechanical properties of biological tissues, viscoelasticity; Measurement of mechanical properties of cells; Models of cellular biomechanical behavior; Skeletal muscle morphology; Muscles constitutive modeling; Muscle and bone interactions; Bone composition, structure and biomechanical properties; Bone fracture and failure mechanics.
Course Objectives:
The course will demonstrate an understanding of the basic principles and terminologies of biomechanics
The course will enable the students to identify the major factors involved in the statics and dynamics of musculoskeletal system, human locomotion and gait
The course will describe different forces which act on the body and relate them to injury and illness through evaluation of current scholarly research
The course will familiarize the fundamental techniques of cellular mechanics and mechanobiology
The course will enable the students to apply biomechanics principles to “real-world” clinical and biomechanical systems
Course Outcomes:
Demonstrate the concepts of force, equilibrium, statics, kinematics and kinetics in human movement
Analyze the range of motion of the human body in daily activities
Apply the basic principles of solid mechanics, such as deformation, torsion, and bending in the context of biomechanics
Inspect the appropriate soft and hard tissue structures based on mechanical properties for specific design considerations
Understand the principles of cellular mechanobiology and relevant measurement techniques
Assessment:
Class participation:		10%
Continuous Assessment:	20%
Final Examination:	           70%
Total:		                     100%
Textbooks and References:
Nihat Özkaya, Margareta Nordin, David Goldsheyder and Dawn Leger.(2012). Fundamentals of Biomechanics: Equilibrium, Motion, and Deformation. 3rd Edition. Springer New York, NY.
Ross Ethier and Craig A. Simmons. (2007). Introductory Biomechanics: From Cells to Organisms. 1st Edition. Cambridge University Press.
Emico Okuno and Luciano Fratin. (2014). Biomechanics of the Human Body. 1st Edition. Springer New York, NY.
Donald R. Peterson and Joseph D. Bronzino. (2007). Biomechanics Principles and Practices. 1st Edition. CRC Press.
Lisa A. Pruitt and Ayyana M. Chakravartula. (2011). Mechanics of Biomaterials: Fundamental Principles for Implant Design. Cambridge University Press.
Ferdinand P. Beer, E. Russell Johnston, Jr., John T. DeWolf, David F. Mazurek. (2015). Mechanics of Materials. 7th Edition. McGraw-Hill Education.
R. C. Hibbeler. (2022). Engineering Mechanics: Statics & Dynamics. 15th Edition. Pearson.
Weekly Schedule:
Week | Topics
1 | Course introduction
- Terminology of movements- reference plane, directions
- Newton’s law, Vector
- Frictional Forces
2 | Principles of equilibrium
- Forces, moments, and couples
- Equations of static equilibrium
- Statistically indeterminate problems
- Simple machines- levers and pulleys
3 | Body segment
- Center of gravity, center of mass
- Centroid of a volume
- Application of statics
4 | Terrestrial locomotion
- Description of jumping, walking, and running
- Gait analysis: steps and phases
- Antalgic gait and other gait abnormalities
- Class test # 1 (CO-1)
5 | Linear kinetics and kinematics
- Kinetic equations of motion
- Rotations, stability of systems
- Uniaxial motion, projectile motion
- Curvilinear motion- rectangular, normal, and tangential component
- Principle of mechanical work, energy, and power
- Application of linear kinetics and kinematics in human body movements
6 | Angular kinetics and kinematics
- Simple harmonic motion
- Relation between linear and angular quantities
- Rotational kinetic energy, work, and power
- Application of angular kinetics and kinematics in human body movements
7 | Inertia and collision
- Parallel axis theorem and perpendicular axis theorem
- Perfectly elastic collision
- Principle of impulse and momentum for rigid body
- Class test # 2 (CO-2)
8 | Uniaxial and multiaxial deformable bodies
- Simple stress and strain
- Hooke''s law, stress- strain diagram
9 | Uniaxial and multiaxial deformable bodies
- Multiaxial stress and generalized Hooke’s Law
- Stress transformation- equation method
10 | Uniaxial and multiaxial deformable bodies
- Mohr’s circle (2D and 3D)
- Eigenvalue method
11 | Torsion, bending, and flexure
- Effect of angular force on bone and muscle
- Class test # 3 (CO-3)
12 | Torsion, bending, and flexure
- Shearing force diagram (SFD)
- Bending moment diagram (BMD)
13 | Muscle-bone interaction, Bone fracture and failure
- Viscoelasticity
- Skeletal muscle morphology
- Muscles constitutive modeling
- Bone composition, structure, and biomechanical properties
- Bone fracture and failure mechanics
14 | Soft tissue biomechanics and cellular mechanobiology
- Mechanical properties of biological tissues
- Measurement of mechanical properties of cells
- Models of cellular biomechanical behavior
- Class test # 4 (CO-4, CO-5)
Prepared by: | 
Name:
Signature:
Date: | Shams Nafisa Ali
Name:
Signature:
Date: | Mr. Md Abdullah Al Mamun','[{"name": "Ms. Shams Nafisa Ali", "room": "ECE -1013", "email": "nafisa@bme.buet.ac.bd"}, {"name": "Mr. Md Abdullah Al Mamun", "room": "ECE-1123", "email": "abdullah@bme.buet.ac.bd"}]'::jsonb,'[]'::jsonb,'[]'::jsonb,'{"folder": "1 - Course Files/L2T1/BME 201 Course File/January 2025", "files": {"co_po_mapping": "January 2025/CO-PO Mapping.docx", "outline": "January 2025/BME 201_ Course outline_january 2025.docx", "assessment_workbook": "January 2025/Assessment and scripts/BME 201-CO-PO-Assessment-marks.xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 201\nCourse Title: | Biomechanics\nLevel, Term and Section | 2/1\nAcademic Term | January 2025\nTextbooks used: | Nihat Özkaya, Margareta Nordin, David Goldsheyder and Dawn Leger. (2012). Fundamentals of\nBiomechanics: Equilibrium, Motion, and Deformation. 3rd Edition. Springer New York, NY .\nRoss Ethier and Craig A. Simmons. (2007). Introductory Biomechanics: From Cells to Organisms. 1st\nEdition. Cambridge University Press.\n3. Emico Okuno and Luciano Fratin. (2014). Biomechanics of the Human Body. 1st Edition. Springer\nNew York, NY .\n4. Donald R. Peterson and Joseph D. Bronzino. (2007). Biomechanics Principles and Practices. 1st\nEdition. CRC Press.\nLisa A. Pruitt and Ayyana M. Chakravartula. (2011). Mechanics of Biomaterials: Fundamental\nPrinciples for Implant Design. Cambridge University Press.\nFerdinand P. Beer, E. Russell Johnston, Jr., John T. DeWolf, David F. Mazurek. (2015). Mechanics of\nMaterials. 7th Edition. McGraw-Hill Education.\nR. C. Hibbeler. (2022). Engineering Mechanics: Statics & Dynamics. 15th Edition. Pearson.\nLast term when the course was offered | July 2023\nPart B. Attainment for current and previous terms\nJanuary 2025\nCO1 | CO2 | CO3 | CO4 | CO5 | CO6 | CO7 | CO8 | CO9 | CO10 | CO11 | CO12\n74 | 28 | 52 | 40 | 68 | NA | NA | NA | NA | NA | NA | NA\nY | N | Y | Y | Y | NA | NA | NA | NA | NA | NA | NA\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\n64 | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA\nY | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA\nTeachers’ comment on attainment: Satisfactory\nInterpretation of student feedback: -\nTeachers’ comment on teaching learning: -\nPart D. Comments on CQI implemented based on last assessment\nN/A\nPart E. Recommendation\nMajor issues: None\nPlan for future actions for further improvement:\nThe second and fourth CO statement is mapped to C4, we need to discuss before next time if we want to readjust this mapping.\nSignature(s):\nName: Ms. Shams Nafisa Ali | Name: Mr. Abdullah Al Mamun\nSignature: | Signature:"}'::jsonb,array['No K/P/A matrix in CO-PO mapping doc']::text[],true,true);
insert into stg_co values ('2025-01','BME 201',1,'Demonstrate the concepts of force, equilibrium, statics, kinematics and kinetics in human movement',array['C2']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-01','BME 201',2,'Analyze the range of motion of the human body in daily activities',array['C4']::text[],array['Lectures','Homework','Tutorials']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-01','BME 201',3,'Apply the basic principles of solid mechanics, such as deformation, torsion, and bending in the context of biomechanics',array['C3']::text[],array['Lectures','Homework','Guided Discussion and Practice']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-01','BME 201',4,'Inspect the appropriate soft and hard tissue structures based on mechanical properties for specific design considerations',array['C4']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-01','BME 201',5,'Understand the principles of cellular mechanobiology and relevant measurement techniques',array['C2']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_crit values ('2025-01','BME 201',0,'Term Final','1(a)',15,array['CO1']::text[]);
insert into stg_crit values ('2025-01','BME 201',1,'Term Final','1(b)',15,array['CO2']::text[]);
insert into stg_crit values ('2025-01','BME 201',2,'Term Final','1(c)',15,array['CO1']::text[]);
insert into stg_crit values ('2025-01','BME 201',3,'Term Final','5(a)',16,array['CO3']::text[]);
insert into stg_crit values ('2025-01','BME 201',4,'Term Final','5(b)',20,array['CO4']::text[]);
insert into stg_crit values ('2025-01','BME 201',5,'Term Final','5(c)',9,array['CO5']::text[]);
insert into stg_att values ('2025-01','BME 201','CO','CO1',74,'summary');
insert into stg_att values ('2025-01','BME 201','CO','CO2',28,'summary');
insert into stg_att values ('2025-01','BME 201','CO','CO3',52,'summary');
insert into stg_att values ('2025-01','BME 201','CO','CO4',40,'summary');
insert into stg_att values ('2025-01','BME 201','CO','CO5',68,'summary');
insert into stg_att values ('2025-01','BME 201','PO','PO1',64,'summary');
insert into stg_car values ('2025-01','BME 201','Teachers’ comment on attainment: Satisfactory
Interpretation of student feedback: -
Teachers’ comment on teaching learning: -','','Major issues: None
Plan for future actions for further improvement:
The second and fourth CO statement is mapped to C4, we need to discuss before next time if we want to readjust this mapping.');
insert into stg_off values ('2025-07','July 2025','BME 201',null,'Terminology of movement: reference planes and directions; Principles of equilibrium: forces, moments and couples, equations of static equilibrium; Simple machine: levers and pulleys; Body segment and mass; Center of gravity; Basic statics and movements at specific joints; Linear and angular kinetics and kinematics: kinetic equations of motion, rotations, moment of inertia, radius of gyration, parallel axis theorem; Impulse and momentum; Terrestrial locomotion: jump, kinetics and kinematics of gait cycle; Applications of human motion analysis; Mechanics of deformable bodies: simple stress and strain, Hooke''s law, stress- strain diagram, multiaxial deformation and stress analyses, combined stresses, mechanical properties of biological tissues, viscoelasticity; Measurement of mechanical properties of cells; Models of cellular biomechanical behavior; Skeletal muscle morphology; Muscles constitutive modeling; Muscle and bone interactions; Bone composition, structure and biomechanical properties; Bone fracture and failure mechanics.','The course will demonstrate an understanding of the basic principles and terminologies of biomechanics
The course will enable the students to identify the major factors involved in the statics and dynamics of musculoskeletal system, human locomotion and gait
The course will describe different forces which act on the body and relate them to injury and illness through evaluation of current scholarly research
The course will familiarize the fundamental techniques of cellular mechanics and mechanobiology
The course will enable the students to apply biomechanics principles to “real-world” clinical and biomechanical systems','Bangladesh University of Engineering and Technology
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No:			BME 201
Course Title:		Biomechanics
Credit hours:		3				Contact hours:	3
Level/Term:			2/1
Academic Session: 	2024-2025
Course Teacher(s):
Name | Office/Room | Email & Telephone | Class routine
Md. Abdullah Al Mamun | ECE 1123 | abdullah@bme.buet.ac.bd
+8801797091595 | Saturday:
09:00 AM-09:50 AM Sunday:
09:00 AM-09:50 AM Tuesday:
11:00 AM-11:50:00
Srija Sarker Anannya | ECE 1121 | srija@bme.buet.ac.bd
+8801844453637 | 
Course Contents:
Terminology of movement: reference planes and directions; Principles of equilibrium: forces, moments and couples, equations of static equilibrium; Simple machine: levers and pulleys; Body segment and mass; Center of gravity; Basic statics and movements at specific joints; Linear and angular kinetics and kinematics: kinetic equations of motion, rotations, moment of inertia, radius of gyration, parallel axis theorem; Impulse and momentum; Terrestrial locomotion: jump, kinetics and kinematics of gait cycle; Applications of human motion analysis; Mechanics of deformable bodies: simple stress and strain, Hooke''s law, stress- strain diagram, multiaxial deformation and stress analyses, combined stresses, mechanical properties of biological tissues, viscoelasticity; Measurement of mechanical properties of cells; Models of cellular biomechanical behavior; Skeletal muscle morphology; Muscles constitutive modeling; Muscle and bone interactions; Bone composition, structure and biomechanical properties; Bone fracture and failure mechanics.
Course Objectives:
The course will demonstrate an understanding of the basic principles and terminologies of biomechanics
The course will enable the students to identify the major factors involved in the statics and dynamics of musculoskeletal system, human locomotion and gait
The course will describe different forces which act on the body and relate them to injury and illness through evaluation of current scholarly research
The course will familiarize the fundamental techniques of cellular mechanics and mechanobiology
The course will enable the students to apply biomechanics principles to “real-world” clinical and biomechanical systems
Course Outcomes:
Demonstrate the concepts of force, equilibrium, statics, kinematics and kinetics in human movement
Analyze the range of motion of the human body in daily activities
Apply the basic principles of solid mechanics, such as deformation, torsion, and bending in the context of biomechanics
Inspect the appropriate soft and hard tissue structures based on mechanical properties for specific design considerations
Understand the principles of cellular mechanobiology and relevant measurement techniques
Assessment:
Class participation:		10%
Continuous Assessment:	20%
Final Examination:	           70%
Total:		                     100%
Textbooks and References:
Nihat Özkaya, Margareta Nordin, David Goldsheyder and Dawn Leger.(2012). Fundamentals of Biomechanics: Equilibrium, Motion, and Deformation. 3rd Edition. Springer New York, NY.
Ross Ethier and Craig A. Simmons. (2007). Introductory Biomechanics: From Cells to Organisms. 1st Edition. Cambridge University Press.
Emico Okuno and Luciano Fratin. (2014). Biomechanics of the Human Body. 1st Edition. Springer New York, NY.
Donald R. Peterson and Joseph D. Bronzino. (2007). Biomechanics Principles and Practices. 1st Edition. CRC Press.
Lisa A. Pruitt and Ayyana M. Chakravartula. (2011). Mechanics of Biomaterials: Fundamental Principles for Implant Design. Cambridge University Press.
Ferdinand P. Beer, E. Russell Johnston, Jr., John T. DeWolf, David F. Mazurek. (2015). Mechanics of Materials. 7th Edition. McGraw-Hill Education.
R. C. Hibbeler. (2022). Engineering Mechanics: Statics & Dynamics. 15th Edition. Pearson.
Weekly Schedule:
Week | Topics
1 | Course introduction
- Terminology of movements- reference plane, directions
- Newton’s law, Vector
- Frictional Forces
2 | Principles of equilibrium
- Forces, moments, and couples
- Equations of static equilibrium
- Statistically indeterminate problems
- Simple machines- levers and pulleys
3 | Body segment
- Center of gravity, center of mass
- Centroid of a volume
- Application of statics
4 | Terrestrial locomotion
- Description of jumping, walking, and running
- Gait analysis: steps and phases
- Antalgic gait and other gait abnormalities
- Class test # 1 (CO-1)
5 | Linear kinetics and kinematics
- Kinetic equations of motion
- Rotations, stability of systems
- Uniaxial motion, projectile motion
- Curvilinear motion- rectangular, normal, and tangential component
- Principle of mechanical work, energy, and power
- Application of linear kinetics and kinematics in human body movements
6 | Angular kinetics and kinematics
- Simple harmonic motion
- Relation between linear and angular quantities
- Rotational kinetic energy, work, and power
- Application of angular kinetics and kinematics in human body movements
7 | Inertia and collision
- Parallel axis theorem and perpendicular axis theorem
- Perfectly elastic collision
- Principle of impulse and momentum for rigid body
- Class test # 2 (CO-2)
8 | Uniaxial and multiaxial deformable bodies
- Simple stress and strain
- Hooke''s law, stress- strain diagram
9 | Uniaxial and multiaxial deformable bodies
- Multiaxial stress and generalized Hooke’s Law
- Stress transformation- equation method
10 | Uniaxial and multiaxial deformable bodies
- Mohr’s circle (2D and 3D)
- Eigenvalue method
11 | Torsion, bending, and flexure
- Effect of angular force on bone and muscle
- Class test # 3 (CO-3)
12 | Torsion, bending, and flexure
- Shearing force diagram (SFD)
- Bending moment diagram (BMD)
13 | Muscle-bone interaction, Bone fracture and failure
- Viscoelasticity
- Skeletal muscle morphology
- Muscles constitutive modeling
- Bone composition, structure, and biomechanical properties
- Bone fracture and failure mechanics
14 | Soft tissue biomechanics and cellular mechanobiology
- Mechanical properties of biological tissues
- Measurement of mechanical properties of cells
- Models of cellular biomechanical behavior
- Class test # 4 (CO-4, CO-5)
Prepared by: | 
Name:
Signature:
Date: | Md. Abdullah Al Mamun
Name:
Signature:
Date: | Srija Sarker Anannya','[{"name": "Md. Abdullah Al Mamun", "room": "ECE 1123", "email": "abdullah@bme.buet.ac.bd"}, {"name": "Srija Sarker Anannya", "room": "ECE 1121", "email": "srija@bme.buet.ac.bd"}]'::jsonb,'[{"component": "Class participation/Attendance", "percent": 10.0}, {"component": "Continuous Assessment", "percent": 20.0}, {"component": "Term Final", "percent": 70.0}]'::jsonb,'[]'::jsonb,'{"folder": "1 - Course Files/L2T1/BME 201 Course File/July 2025", "files": {"co_po_mapping": "July 2025/CO-PO Mapping.docx", "outline": "July 2025/BME 201_ Course outline_july 2025.docx", "assessment_workbook": "July 2025/Assessments and scripts/BME 201-CO-PO-Assessment-marks.xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 201\nCourse Title: | Biomechanics\nLevel, Term and Section | 2/1\nAcademic Term | July 2025\nTextbooks used: | Nihat Özkaya, Margareta Nordin, David Goldsheyder and Dawn Leger. (2012). Fundamentals of Biomechanics: Equilibrium, Motion, and Deformation. 3rd Edition. Springer New York, NY.\nRoss Ethier and Craig A. Simmons. (2007). Introductory Biomechanics: From Cells to Organisms. 1st Edition. Cambridge University Press.\nEmico Okuno and Luciano Fratin. (2014). Biomechanics of the Human Body. 1st Edition. Springer New York, NY.\nDonald R. Peterson and Joseph D. Bronzino. (2007). Biomechanics Principles and Practices. 1st Edition. CRC Press.\nLisa A. Pruitt and Ayyana M. Chakravartula. (2011). Mechanics of Biomaterials: Fundamental Principles for Implant Design. Cambridge University Press.\nFerdinand P. Beer, E. Russell Johnston, Jr., John T. DeWolf, David F. Mazurek. (2015). Mechanics of Materials. 7th Edition. McGraw-Hill Education.\nR. C. Hibbeler. (2022). Engineering Mechanics: Statics  Dynamics. 15th Edition. Pearson.\nLast term when the course was offered | N/A\nPart B. Attainment for current and previous terms\nJanuary 2025\nCO1 | CO2 | CO3 | CO4 | CO5 | CO6 | CO7 | CO8 | CO9 | CO10 | CO11 | CO12\n74 | 28 | 52 | 40 | 68 | NA | NA | NA | NA | NA | NA | NA\nY | N | Y | Y | Y | NA | NA | NA | NA | NA | NA | NA\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\n64 | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA\nY | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA\nJuly 2025\nCO1 | CO2 | CO3 | CO4 | CO5\n90.20% | 58.82% | 72.55% | 76.47% | 35.29%\nY | Y | Y | Y | N\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\n76.47% | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A\nY | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A\nPart C. Analysis\nTeachers’ comment on attainment: Satisfactory\nInterpretation of student feedback:\nTeachers’ comment on teaching learning:\nPart D. Comments on CQI implemented based on last assessment\nN/A\nPart E. Recommendation\nMajor issues:\nPlan for future actions for further improvement:\nSignature(s):\nName: Md. Abdullah Al Mamun | Name: Srija Sarker Anannya\nSignature: | Signature:"}'::jsonb,array['No K/P/A matrix in CO-PO mapping doc','Cohort CO5 NOT attained: 35.29% of students (threshold 40%)']::text[],true,true);
insert into stg_co values ('2025-07','BME 201',1,'Demonstrate the concepts of force, equilibrium, statics, kinematics and kinetics in human movement',array['C2']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 201',2,'Analyze the range of motion of the human body in daily activities',array['C4']::text[],array['Lectures','Homework','Tutorials']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 201',3,'Apply the basic principles of solid mechanics, such as deformation, torsion, and bending in the context of biomechanics',array['C3']::text[],array['Lectures','Homework','Guided Discussion and Practice']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 201',4,'Inspect the appropriate soft and hard tissue structures based on mechanical properties for specific design considerations',array['C4']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 201',5,'Understand the principles of cellular mechanobiology and relevant measurement techniques',array['C2']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_crit values ('2025-07','BME 201',0,'Term Final','Q01 (a)',15,array['CO1']::text[]);
insert into stg_crit values ('2025-07','BME 201',1,'Term Final','Q01 (b)',15,array['CO2']::text[]);
insert into stg_crit values ('2025-07','BME 201',2,'Term Final','Q01 (c)',15,array['CO1']::text[]);
insert into stg_crit values ('2025-07','BME 201',3,'Term Final','Q05 (a)',20,array['CO3']::text[]);
insert into stg_crit values ('2025-07','BME 201',4,'Term Final','Q05 (b)',13,array['CO4']::text[]);
insert into stg_crit values ('2025-07','BME 201',5,'Term Final','Q05 (c)',12,array['CO5']::text[]);
insert into stg_att values ('2025-07','BME 201','CO','CO1',90.2,'workbook');
insert into stg_att values ('2025-07','BME 201','CO','CO2',58.82,'workbook');
insert into stg_att values ('2025-07','BME 201','CO','CO3',72.55,'workbook');
insert into stg_att values ('2025-07','BME 201','CO','CO4',76.47,'workbook');
insert into stg_att values ('2025-07','BME 201','CO','CO5',35.29,'workbook');
insert into stg_att values ('2025-07','BME 201','PO','PO1',76.47,'workbook');
insert into stg_car values ('2025-07','BME 201','Teachers’ comment on attainment: Satisfactory
Interpretation of student feedback:
Teachers’ comment on teaching learning:','','');
insert into stg_off values ('2025-01','January 2025','BME 202',null,'Computational solid mechanics for biomedical problems; Simulations of musculoskeletal structure and movement; Gait force analysis using force plate data; Testing of living tissue properties and functions; Lab Project: based on simulation/ experiment.','The course will enable students to simulate different biomechanical systems
This course will enable students to perform biomechanical measurements in different human movements and activities.
The course will enable students to investigate mechanical characteristics of different biological materials','Bangladesh University of Engineering and Technology
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No:			BME 202
Course Title:		Biomechanics Sessional
Credit hours:		1.5				Contact hours:	3
Level/Term:			2/1
Academic Session: 	2023-2024
Course Teacher(s):
Name | Office/ Room | Email & Telephone | Class routine
Shams Nafisa Ali | ECE-1013 | nafisa@bme.buet.ac.bd
+880 1731953973 | Monday: 
2:00 PM-5:00 PM
Abdullah Al Mamun | ECE-1123 | abdullah@bme.buet.ac.bd
+880 1639-008395 | Monday: 
2:00 PM-5:00 PM
Srija Sarkar Ananya | ECE-1013 | srija@bme.buet.ac.bd
+880 1787-151545 | Monday: 
2:00 PM-5:00 PM
Course Contents:
Computational solid mechanics for biomedical problems; Simulations of musculoskeletal structure and movement; Gait force analysis using force plate data; Testing of living tissue properties and functions; Lab Project: based on simulation/ experiment.
Course Objectives:
The course will enable students to simulate different biomechanical systems
This course will enable students to perform biomechanical measurements in different human movements and activities.
The course will enable students to investigate mechanical characteristics of different biological materials
Course Outcomes:
Perform computational modeling of different biomechanical phenomenon
Demonstrate an understanding of statics and dynamics in human movement and musculoskeletal systems
Analyze different mechanical properties of different biological tissues
Display effective teamwork as an individual and as a leader to implement real world biomechanical systems
Assessment:
Continuous Assessment:	                        10%
Project Demonstration and Presentation:  40%
Lab Test:                                                     20%
Lab Quiz:		                                    20%
Total:	                                                         100%
Textbooks and References:
Applied Biomechanics Lab Manual by John C. Garner
Fundamentals of Biomechanics: Equilibrium, Motion, and Deformation (Second Edition) by Nihat Ozkay and Margareta Nordin
Fundamentals of Biomechanics by Duane Knudson
Weekly Schedule:
Week | Topics
1 | Analysis of a Cardiovascular Stent in Balloon Angioplasty
2 | Analyzing the Effect of Uniaxial Tension, Knee Flexion and Rotation on Anterior Cruciate Ligament (ACL) and Observing Creep Deformation of an Intervertebral Disc (IVD)
3 | Lab Test-1
4 | Analysis and Interpretation and Muscle Fatigue using a Hand Dynamometer Using Electromyography (EMG) Signal
5 | Understanding and Analysis of Gait Cycle Parameters
6 | Mechanical Properties of Biological/ Natural Sample
7 | Lab Quiz (CO-2, CO-3)
8 | Lab Project: based on simulation/ experiment and Presentation
Prepared by: | 
Name:
Signature:
Date: | Shams Nafisa Ali
Name:
Signature:
Date: | Abdullah Al Mamun
Name:
Signature:
Date: | Srija Sarkar Ananya','[{"name": "Shams Nafisa Ali", "room": "ECE-1013", "email": "nafisa@bme.buet.ac.bd"}, {"name": "Abdullah Al Mamun", "room": "ECE-1123", "email": "abdullah@bme.buet.ac.bd"}, {"name": "Srija Sarkar Ananya", "room": "ECE-1013", "email": "srija@bme.buet.ac.bd"}]'::jsonb,'[]'::jsonb,'[{"component": "Lab Test", "weight": 0.2, "marks": 15}, {"component": "Lab Quiz", "weight": 0.2, "marks": 15}, {"component": "Attendance, Lab Report, Project, Report and Presentation", "weight": 0.6, "marks": 45}]'::jsonb,'{"folder": "1 - Course Files/L2T1/BME 202 Course File/January 2025", "files": {"co_po_mapping": "January 2025/CO-PO Mapping.docx", "outline": "January 2025/BME 202_Course outline_january 2025.docx", "assessment_workbook": "January 2025/Assessments and Scripts/CO-PO-Assessment Marks.xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 202\nCourse Title: | Biomechanics Sessional\nLevel, Term and Section | 2-1\nAcademic Term | January 2025\nTextbooks used: | -\nLast term when the course was offered | January 2024\nPart B. Attainment for current and previous terms\nCO Attainment | CO1 | CO2 | CO3 | CO4\n% Student Attained | 90.00% | 90.00% | 78.00% | 98.00%\nCohort attainment | Y | Y | Y | Y\nPO Attainment | PO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\n% Student Attained | 90.00% | 78.00% | NA | NA | 90.00% | NA | NA | NA | 98.00% | NA | NA | NA\nCohort | Y | Y | NA | NA | Y | NA | NA | NA | Y | NA | NA | NA\nPart C. Analysis\nTeachers’ comment on attainment: Satisfactory\nInterpretation of student feedback:\nTeachers’ comment on teaching learning: Can be more interactive, with more real life applications.\nPart D. Comments on CQI implemented based on last assessment\nN/A\nPart E. Recommendation\nMajor issues: None\nPlan for future actions for further improvement: Addition of new content, such as drafting, compliance of devices with ISO standards, etc.\nSignature(s):\nName: Shams Nafisa Ali | Name: Md. Abdullah Al Mamun | Name: Srija Sarker Anannya\nSignature: | Signature: | Signature:"}'::jsonb,array['No K/P/A matrix in CO-PO mapping doc']::text[],true,true);
insert into stg_co values ('2025-01','BME 202',1,'Perform computational modeling of different biomechanical phenomenon',array['PS2']::text[],array['Lectures','Demonstration of Simulation','Report writing']::text[],array['Lab Test','Continuous Assessment','Lab Quiz']::text[],'{}'::text[],array['PO5']::text[]);
insert into stg_co values ('2025-01','BME 202',2,'Demonstrate an understanding of statics and dynamics in human movement and musculoskeletal systems',array['PS3']::text[],array['Lectures','Data collection using computer software']::text[],array['Lab Test','Continuous Assessment','Lab Quiz']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-01','BME 202',3,'Analyze different mechanical properties of different biological tissues',array['C4']::text[],array['Lectures','Report writing']::text[],array['Continuous Assessment','Lab Quiz']::text[],'{}'::text[],array['PO2']::text[]);
insert into stg_co values ('2025-01','BME 202',4,'Display effective teamwork as an individual and as a leader to implement real world biomechanical systems',array['AF3']::text[],array['Term Project','Hands-on Group Activities']::text[],array['Project Demonstration and Presentation']::text[],'{}'::text[],array['PO9']::text[]);
insert into stg_crit values ('2025-01','BME 202',0,'Lab Test','Perform computational modeling of different biomechanical phenomenon',7.5,array['CO1']::text[]);
insert into stg_crit values ('2025-01','BME 202',1,'Lab Test','Demonstrate an understanding of statics and dynamics in human movement and musculoskeletal systems',7.5,array['CO2']::text[]);
insert into stg_crit values ('2025-01','BME 202',2,'Lab Quiz','Analyze different mechanical properties of different biological tissues',15,array['CO3']::text[]);
insert into stg_crit values ('2025-01','BME 202',3,'Attendance, Lab Report, Project, Report and Presentation','Display effective teamwork as an individual and as a leader to implement real world biomechanical systems',45,array['CO4']::text[]);
insert into stg_att values ('2025-01','BME 202','CO','CO1',90.0,'car');
insert into stg_att values ('2025-01','BME 202','CO','CO2',90.0,'car');
insert into stg_att values ('2025-01','BME 202','CO','CO3',78.0,'car');
insert into stg_att values ('2025-01','BME 202','CO','CO4',98.0,'car');
insert into stg_att values ('2025-01','BME 202','PO','PO1',90.0,'car');
insert into stg_att values ('2025-01','BME 202','PO','PO2',78.0,'car');
insert into stg_att values ('2025-01','BME 202','PO','PO5',90.0,'car');
insert into stg_att values ('2025-01','BME 202','PO','PO9',98.0,'car');
insert into stg_car values ('2025-01','BME 202','Teachers’ comment on attainment: Satisfactory
Interpretation of student feedback:
Teachers’ comment on teaching learning: Can be more interactive, with more real life applications.','','Major issues: None
Plan for future actions for further improvement: Addition of new content, such as drafting, compliance of devices with ISO standards, etc.');
insert into stg_off values ('2025-07','July 2025','BME 202',null,'Computational solid mechanics for biomedical problems; Simulations of musculoskeletal structure and movement; Gait force analysis using force plate data; Testing of living tissue properties and functions; Lab Project: based on simulation/ experiment.','The course will enable students to simulate different biomechanical systems
This course will enable students to perform biomechanical measurements in different human movements and activities.
The course will enable students to investigate mechanical characteristics of different biological materials','Bangladesh University of Engineering and Technology
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No:			BME 202
Course Title:		Biomechanics Sessional
Credit hours:		1.5				Contact hours:	3
Level/Term:			2/1
Academic Session: 	2024-2025
Course Teacher(s):
Name | Office/ 
Room | Email & Telephone | Class routine
Abdullah Al Mamun | ECE-1123 | abdullah@bme.buet.ac.bd
+880 1639-008395 | Saturday: 
2:00 PM-5:00 PM
Srija Sarkar Ananya | ECE-1013 | srija@bme.buet.ac.bd
+880 1787-151545 | Monday: 
2:00 PM-5:00 PM
Chaity Chakraborty | ECE-1013 | chaity@bme.buet.ac.bd
+880 1409-814341 | Monday: 
2:00 PM-5:00 PM
Course Contents:
Computational solid mechanics for biomedical problems; Simulations of musculoskeletal structure and movement; Gait force analysis using force plate data; Testing of living tissue properties and functions; Lab Project: based on simulation/ experiment.
Course Objectives:
The course will enable students to simulate different biomechanical systems
This course will enable students to perform biomechanical measurements in different human movements and activities.
The course will enable students to investigate mechanical characteristics of different biological materials
Course Outcomes:
Perform computational modeling of different biomechanical phenomenon
Demonstrate an understanding of statics and dynamics in human movement and musculoskeletal systems
Design a bio-inspired soft robotic system by applying biomechanical principles
Assessment:
Homework/Report:	 20%
Lab Test:                  40%
Lab Quiz:		 40%
Total:	                      100%
Textbooks and References:
Applied Biomechanics Lab Manual by John C. Garner
Fundamentals of Biomechanics: Equilibrium, Motion, and Deformation (Second Edition) by Nihat Ozkay and Margareta Nordin
Fundamentals of Biomechanics by Duane Knudson
Weekly Schedule:
Week | Topics
1 | Analyzing the Effect of Uniaxial Tension, Knee Flexion and Rotation on Anterior Cruciate Ligament (ACL) and Observing Creep Deformation of an Intervertebral Disc (IVD)
2 | Simulation-Based Design to Prevent Ankle Injuries (OpenSim)
3 | Lab Test
4 | Analysis and Interpretation and Muscle Fatigue using a Hand Dynamometer Using Electromyography (EMG) Signal
5 | Understanding and Analysis of Gait Cycle Parameters
6 | Fabrication and Performance Testing of a Soft Robotic Actuator
7 | Lab Quiz
Prepared by: | 
Name:
Signature:
Date: | Abdullah Al Mamun
Name:
Signature:
Date: | Srija Sarkar Ananya
Name:
Signature:
Date: | Chaity Chakraborty','[{"name": "Abdullah Al Mamun", "room": "ECE-1123", "email": "abdullah@bme.buet.ac.bd"}, {"name": "Srija Sarkar Ananya", "room": "ECE-1013", "email": "srija@bme.buet.ac.bd"}, {"name": "Chaity Chakraborty", "room": "ECE-1013", "email": "chaity@bme.buet.ac.bd"}]'::jsonb,'[]'::jsonb,'[{"component": "Lab Test", "weight": 0.4, "marks": 30}, {"component": "Lab Quiz", "weight": 0.6, "marks": 45}]'::jsonb,'{"folder": "1 - Course Files/L2T1/BME 202 Course File/July 2025", "files": {"co_po_mapping": "July 2025/CO-PO Mapping.docx", "outline": "July 2025/BME 202_Course outline_july 2025.docx", "assessment_workbook": "July 2025/Assessment and Scripts/BME 202-CO-PO-Assessment-Marks.xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 202\nCourse Title: | Biomechanics Sessional\nLevel, Term and Section | 2-1\nAcademic Term | July 2025\nTextbooks used: | -\nLast term when the course was offered | January 2025\nPart B. Attainment for current and previous terms\nJanuary 2025:\nCO Attainment | CO1 | CO2 | CO3 | CO4\n% Student Attained | 90.00% | 90.00% | 78.00% | 98.00%\nCohort attainment | Y | Y | Y | Y\nPO Attainment | PO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\n% Student Attained | 90.00% | 78.00% | NA | NA | 90.00% | NA | NA | NA | 98.00% | NA | NA | NA\nCohort | Y | Y | NA | NA | Y | NA | NA | NA | Y | NA | NA | NA\nJuly 2025:\nCO Attainment | CO1 | CO2 | CO3\n% Student Attained | 74.51% | 96.08% | 92.16%\nCohort attainment | Y | Y | Y\nPO Attainment | PO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\n% Student Attained | NA | NA | NA | NA | 94.12% | NA | NA | NA | NA | NA | NA | NA\nCohort | NA | NA | NA | NA | Y | NA | NA | NA | NA | NA | NA | NA\nPart C. Analysis\nTeachers’ comment on attainment: Satisfactory\nInterpretation of student feedback:\nTeachers’ comment on teaching learning: Can be more interactive, with more real life applications.\nPart D. Comments on CQI implemented based on last assessment\nN/A\nPart E. Recommendation\nMajor issues: None\nPlan for future actions for further improvement: Addition of new content, such as drafting, compliance of devices with ISO standards, etc.\nSignature(s):\nName: Md. Abdullah Al Mamun | Name: Srija Sarker Anannya | Name: Chaity Chakraborty\nSignature: | Signature: | Signature:"}'::jsonb,array['No K/P/A matrix in CO-PO mapping doc']::text[],true,true);
insert into stg_co values ('2025-07','BME 202',1,'Perform computational modeling of different biomechanical phenomenon',array['PS2']::text[],array['Lectures','Demonstration of Simulation']::text[],array['Lab Test']::text[],'{}'::text[],array['PO5']::text[]);
insert into stg_co values ('2025-07','BME 202',2,'Demonstrate an understanding of statics and dynamics in human movement and musculoskeletal systems',array['PS2']::text[],array['Lectures','Data collection using computer software']::text[],array['Lab Quiz']::text[],'{}'::text[],array['PO5']::text[]);
insert into stg_co values ('2025-07','BME 202',3,'Design a bio-inspired soft robotic system by applying biomechanical principles',array['PS5']::text[],array['Hands-on Group Activities']::text[],array['Lab Quiz','Demonstration']::text[],'{}'::text[],array['PO5']::text[]);
insert into stg_crit values ('2025-07','BME 202',0,'Lab Test','Perform computational modeling of different biomechanical phenomenon',30,array['CO1']::text[]);
insert into stg_crit values ('2025-07','BME 202',1,'Lab Quiz','Perform computational modeling of different biomechanical phenomenon',10,array['CO1']::text[]);
insert into stg_crit values ('2025-07','BME 202',2,'Lab Quiz','Demonstrate an understanding of statics and dynamics in human movement and musculoskeletal systems',25,array['CO2']::text[]);
insert into stg_crit values ('2025-07','BME 202',3,'Lab Quiz','Design a bio-inspired soft robotic system by applying biomechanical principles',10,array['CO3']::text[]);
insert into stg_att values ('2025-07','BME 202','CO','CO1',74.51,'car');
insert into stg_att values ('2025-07','BME 202','CO','CO2',96.08,'car');
insert into stg_att values ('2025-07','BME 202','CO','CO3',92.16,'car');
insert into stg_att values ('2025-07','BME 202','PO','PO5',94.12,'car');
insert into stg_car values ('2025-07','BME 202','Teachers’ comment on attainment: Satisfactory
Interpretation of student feedback:
Teachers’ comment on teaching learning: Can be more interactive, with more real life applications.','','Major issues: None
Plan for future actions for further improvement: Addition of new content, such as drafting, compliance of devices with ISO standards, etc.');
insert into stg_bugs values ('BUGS 26.10.25','2025-10-26','https://buetedu-my.sharepoint.com/:b:/g/personal/shoyadsabur_bme_buet_ac_bd/IQCy_jpgTQFiT5eiZAwUwCoCAa3SOSsoXvVcBvXkXCbvP2o?e=dw7GtT','2025-07','BME 202');
insert into stg_off values ('2025-01','January 2025','BME 203',null,'Introduction to physiology: integrative science of physiology, homeostasis; Endocrine system: hormones, classification of hormones, control of hormone release; Central nervous system: organization of the nervous system spinal cord, brain; Sensory physiology: general properties of sensory systems, somatic senses, chemoreception: smell and taste, hearing, vision; Efferent motor control: autonomic, somatic; Muscles:
skeletal muscle, mechanics of movement, smooth muscle, cardiac muscle; Cardiovascular system: overview, pressure, volume, flow, resistance, cardiac muscle and the heart, heart as a pump; Blood flow and control of blood pressure: blood vessels, blood pressure, regulation of cardiovascular function, exchange at the capillaries; Blood: plasma and the cellular elements of blood, blood cell production, red blood cell, platelets, hemostasis and coagulation; Respiratory system: gas laws, ventilation; gas exchange, regulation of ventilation; Renal system: function of kidneys, kidney function, fluid and electrolyte balance, Digestive system: digestive function and processes, regulation of GI function, Integrated function of cephalic, gastric and intestinal.','This course focuses on the study of the functioning of human tissues, organs and organ systems
Physical, chemical and mechanistic bases of normal physiology and the integrated function of the human body will be presented with special emphasis
This course will also introduce pathophysiological changes associated with different human diseases','Bangladesh University of Engineering and Technology
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No:			BME 203
Course Title:		Human Physiology
Credit hours:		3				Contact hours:	3
Level/Term:			2/1
Academic Session: 	2023-2024
Course Teacher(s):
Name | Office/ Room | Email & Telephone | Class routine | Tutorial Hour
Ms. Shams Nafisa Ali | ECE -1013 | nafisa@bme.buet.ac.bd  
+880 1731-953973 | Monday:
12:00 AM-12:50 AM
Tuesday:
10:00 AM-10:50 AM
Wednesday:
9:00 PM-9:50 PM | Wednesday:
4:00 PM-5:00 PM
Ms. Tasnia Binte Mamun | ECE-1125 | tasnia@bme.buet.ac.bd
+880 1677-900345 |  | 
Course Contents:
Introduction to physiology: integrative science of physiology, homeostasis; Endocrine system: hormones, classification of hormones, control of hormone release; Central nervous system: organization of the nervous system spinal cord, brain; Sensory physiology: general properties of sensory systems, somatic senses, chemoreception: smell and taste, hearing, vision; Efferent motor control: autonomic, somatic; Muscles:
skeletal muscle, mechanics of movement, smooth muscle, cardiac muscle; Cardiovascular system: overview, pressure, volume, flow, resistance, cardiac muscle and the heart, heart as a pump; Blood flow and control of blood pressure: blood vessels, blood pressure, regulation of cardiovascular function, exchange at the capillaries; Blood: plasma and the cellular elements of blood, blood cell production, red blood cell, platelets, hemostasis and coagulation; Respiratory system: gas laws, ventilation; gas exchange, regulation of ventilation; Renal system: function of kidneys, kidney function, fluid and electrolyte balance, Digestive system: digestive function and processes, regulation of GI function, Integrated function of cephalic, gastric and intestinal.
Course Objectives:
This course focuses on the study of the functioning of human tissues, organs and organ systems
Physical, chemical and mechanistic bases of normal physiology and the integrated function of the human body will be presented with special emphasis
This course will also introduce pathophysiological changes associated with different human diseases
Course Outcomes:
Explain human physiological mechanisms by applying basic principles of biology and chemistry
Describe the fundamental mechanisms underlying normal function of cells, tissues, organs, and organ systems in humans
Explain the basic mechanisms of homeostasis by integrating the functions of cells, tissues, organs, and organ systems
Apply knowledge of functional mechanisms and their regulation to explain the pathophysiology underlying common diseases
Assessment:
Class participation/Attendance:    10%
Continuous Assessment:	            20%
Final Exam:				 70%
Total:				           100%
Textbooks and References:
Guyton and Hall Textbook of Medical Physiology (Guyton Physiology) 13th Edition
Physiology: An Integrated Approach. 7th Edition, by Dee Unglaub Silverthorn. Pearson, 2015.ISBN-13: 978-0321981226
Weekly Schedule:
Week | Topics
1 | Introduction to physiology:
- Integrative science of physiology
Homeostasis
2 | Blood:
- Plasma and the cellular elements of blood
- Blood cell production
- Red blood cell
3 | Blood:
- Platelets
- Hemostasis
- Coagulation;
Class Test #1 (CO-1, CO-2, CO-3)
4 | Digestive system:
- Digestive function and processes
- Regulation of GI function
- Integrated function of cephalic, gastric and intestinal.
5 | Muscles:
- Skeletal muscle
- Mechanics of movement
- Smooth muscle
- Cardiac muscle;
6 | Sensory physiology:
- General properties of sensory systems
- Somatic senses
Chemoreception:
- Smell and taste
- Hearing
- Vision;
Efferent motor control:
- Autonomic
- Somatic;
7 | Central nervous system:
- Organization of the nervous system spinal cord, brain;
#Class Test 2 (CO-1, CO-2)
8 | Cardiovascular system:
- Overview
- Pressure, volume, flow, resistance
- Cardiac muscle and the heart,
- Heart as a pump
9 | Blood flow and control of blood pressure:
- Blood vessels,
- Blood pressure
- Regulation of cardiovascular function
- Exchange at the capillaries;
10 | Respiratory system:
- Gas laws,
- Ventilation;
11 | Respiratory system:
- Gas exchange
- Regulation of ventilation;
#Class Test 3 (CO-1, CO-2, CO-3)
12 | Renal system:
- Function of kidneys
13 | Renal system:
- Fluid and electrolyte balance
14 | Endocrine system:
- Hormones
- Classification of hormones
- Control of hormone release
#Class Test 4 (CO-1, CO-2, CO-4)
Prepared by: | 
Name:
Signature:
Date: | Shams Nafisa Ali
Name:
Signature:
Date: | Ms. Tasnia Binte Mamun','[{"name": "Ms. Shams Nafisa Ali", "room": "ECE -1013", "email": "nafisa@bme.buet.ac.bd"}, {"name": "Ms. Tasnia Binte Mamun", "room": "ECE-1125", "email": "tasnia@bme.buet.ac.bd"}]'::jsonb,'[]'::jsonb,'[]'::jsonb,'{"folder": "1 - Course Files/L2T1/BME 203 Course File/January 2025", "files": {"co_po_mapping": "January 2025/CO-PO Mapping.docx", "outline": "January 2025/BME 203_Course outline_january 2025.docx", "assessment_workbook": "January 2025/Assessment and scripts/BME 203-CO-PO-Assessment-marks.xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 203\nCourse Title: | Human Physiology\nLevel, Term and Section | 2/1\nAcademic Term | January 2025\nTextbooks used: | 1. Human Physiology: An Integrated Approach. 7th Edition, by Dee Unglaub Silverthorn. Pearson, 2015.\nISBN-13: 978-0321981226\n2. Guyton and Hall Textbook of Medical Physiology (Guyton Physiology) 13th Edition\nLast term when the course was offered | July 2023\nPart B. Attainment for current and previous terms\nJanuary 2025\nCO1 | CO2 | CO3 | CO4 | CO5 | CO6 | CO7 | CO8 | CO9 | CO10 | CO11 | CO12\n60 | 72 | 86 | 62 | NA | NA | NA | NA | NA | NA | NA | NA\nY | Y | Y | Y | NA | NA | NA | NA | NA | NA | NA | NA\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\n80 | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA\nY | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA\nTeachers’ comment on attainment: Satisfactory\nInterpretation of student feedback: -\nTeachers’ comment on teaching learning: -\nPart D. Comments on CQI implemented based on last assessment\nN/A\nPart E. Recommendation\nMajor issues: None\nPlan for future actions for further improvement:\nSignature(s):\nName: Ms. Shams Nafisa Ali | Name: Ms. Tasnia Binte Mamun\nSignature: | Signature:"}'::jsonb,array['No K/P/A matrix in CO-PO mapping doc']::text[],true,true);
insert into stg_co values ('2025-01','BME 203',1,'Explain human physiological mechanisms by applying basic principles of biology and chemistry',array['C2']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-01','BME 203',2,'Describe the fundamental mechanisms underlying normal function of cells, tissues, organs, and organ systems in humans',array['C1']::text[],array['Lectures','Homework','Audio-visual demonstration']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-01','BME 203',3,'Explain the basic mechanisms of homeostasis by integrating the functions of cells, tissues, organs, and organ systems',array['C2']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-01','BME 203',4,'Apply knowledge of functional mechanisms and their regulation to explain the pathophysiology underlying common diseases',array['C3']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_crit values ('2025-01','BME 203',0,'Term Final','1(a)',20,array['CO1']::text[]);
insert into stg_crit values ('2025-01','BME 203',1,'Term Final','1(b)',10,array['CO3']::text[]);
insert into stg_crit values ('2025-01','BME 203',2,'Term Final','1(c)',15,array['CO1']::text[]);
insert into stg_crit values ('2025-01','BME 203',3,'Term Final','5(a)',12,array['CO2']::text[]);
insert into stg_crit values ('2025-01','BME 203',4,'Term Final','5(b)',5,array['CO1']::text[]);
insert into stg_crit values ('2025-01','BME 203',5,'Term Final','5(c)',13,array['CO4']::text[]);
insert into stg_crit values ('2025-01','BME 203',6,'Term Final','5(d)',15,array['CO2']::text[]);
insert into stg_att values ('2025-01','BME 203','CO','CO1',60,'summary');
insert into stg_att values ('2025-01','BME 203','CO','CO2',72,'summary');
insert into stg_att values ('2025-01','BME 203','CO','CO3',86,'summary');
insert into stg_att values ('2025-01','BME 203','CO','CO4',62,'summary');
insert into stg_att values ('2025-01','BME 203','PO','PO1',80,'summary');
insert into stg_car values ('2025-01','BME 203','Teachers’ comment on attainment: Satisfactory
Interpretation of student feedback: -
Teachers’ comment on teaching learning: -','','');
insert into stg_off values ('2025-07','July 2025','BME 203',null,null,null,null,'[{"name": "Ms. Chaity Chakraborty", "room": "ECE -1013", "email": "chaity@bme.buet.ac.bd"}, {"name": "Ms. Tasnia Binte Mamun", "room": "ECE-1125", "email": "tasnia@bme.buet.ac.bd"}]'::jsonb,'[{"component": "Class participation/Attendance", "percent": 10.0}, {"component": "Continuous Assessment", "percent": 20.0}, {"component": "Term Final", "percent": 70.0}]'::jsonb,'[]'::jsonb,'{"folder": "1 - Course Files/L2T1/BME 203 Course File/July 2025", "files": {"co_po_mapping": "July 2025/CO-PO Mapping.docx", "outline": "July 2025/BME 203 Course Outline.pdf", "assessment_workbook": "July 2025/Assessments and scripts/BME 203-CO-PO-Assessment-marks.xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 203\nCourse Title: | Human Physiology\nLevel, Term and Section | 2/1\nAcademic Term | July 2025\nTextbooks used: | 1. Human Physiology: An Integrated Approach. 7th Edition, by Dee Unglaub Silverthorn. Pearson, 2015.\nISBN-13: 978-0321981226\n2. Guyton and Hall Textbook of Medical Physiology (Guyton Physiology) 13th Edition\nLast term when the course was offered | January 2025\nPart B. Attainment for current and previous terms\nJanuary 2025\nCO1 | CO2 | CO3 | CO4 | CO5 | CO6 | CO7 | CO8 | CO9 | CO10 | CO11 | CO12\n60 | 72 | 86 | 62 | NA | NA | NA | NA | NA | NA | NA | NA\nY | Y | Y | Y | NA | NA | NA | NA | NA | NA | NA | NA\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\n80 | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA\nY | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA\nJuly 2025\nCO1 | CO2 | CO3 | CO4 | CO5 | CO6 | CO7 | CO8 | CO9 | CO10 | CO11 | CO12\n78.43 | 84.31 | 90.20 | 70.59 | NA | NA | NA | NA | NA | NA | NA | NA\nY | Y | Y | Y | NA | NA | NA | NA | NA | NA | NA | NA\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\n78.43 | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA\nY | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA\nTeachers’ comment on attainment: Satisfactory\nInterpretation of student feedback: -\nTeachers’ comment on teaching learning: -\nPart D. Comments on CQI implemented based on last assessment\nN/A\nPart E. Recommendation\nMajor issues: None\nPlan for future actions for further improvement: Will try to make course content more interactive.\nSignature(s):\nName: Ms. Chaity Chakraborty | Name: Ms. Tasnia Binte Mamun\nSignature: | Signature:"}'::jsonb,array['Basic Information.docx names BME 201 (folder is BME 203)']::text[],false,true);
insert into stg_co values ('2025-07','BME 203',1,'Explain human physiological mechanisms by applying basic principles of biology and chemistry',array['C2']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],array['K1','K2']::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 203',2,'Describe the fundamental mechanisms underlying normal function of cells, tissues, organs, and organ systems in humans',array['C1']::text[],array['Lectures','Homework','Audio-visual demonstration']::text[],array['Written exams']::text[],array['K1','K2']::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 203',3,'Explain the basic mechanisms of homeostasis by integrating the functions of cells, tissues, organs, and organ systems',array['C2']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],array['K1','K2']::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 203',4,'Apply knowledge of functional mechanisms and their regulation to explain the pathophysiology underlying common diseases',array['C3']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],array['K1','K2','K3','K4','P1']::text[],array['PO1']::text[]);
insert into stg_crit values ('2025-07','BME 203',0,'Term Final','Q01 (a)',15,array['CO3']::text[]);
insert into stg_crit values ('2025-07','BME 203',1,'Term Final','Q01 (b)',15,array['CO1']::text[]);
insert into stg_crit values ('2025-07','BME 203',2,'Term Final','Q01 (c)',15,array['CO1']::text[]);
insert into stg_crit values ('2025-07','BME 203',3,'Term Final','Q05 (a)',16,array['CO2']::text[]);
insert into stg_crit values ('2025-07','BME 203',4,'Term Final','Q05 (b)',18,array['CO2']::text[]);
insert into stg_crit values ('2025-07','BME 203',5,'Term Final','Q05 (c)',11,array['CO4']::text[]);
insert into stg_att values ('2025-07','BME 203','CO','CO1',78.43,'workbook');
insert into stg_att values ('2025-07','BME 203','CO','CO2',84.31,'workbook');
insert into stg_att values ('2025-07','BME 203','CO','CO3',90.2,'workbook');
insert into stg_att values ('2025-07','BME 203','CO','CO4',70.59,'workbook');
insert into stg_att values ('2025-07','BME 203','PO','PO1',78.43,'workbook');
insert into stg_car values ('2025-07','BME 203','Teachers’ comment on attainment: Satisfactory
Interpretation of student feedback: -
Teachers’ comment on teaching learning: -','','Major issues: None
Plan for future actions for further improvement: Will try to make course content more interactive.');
insert into stg_off values ('2025-01','January 2025','BME 204',null,'Experiments based on BME 203.','This course experimentally demonstrates different processes and phenomenon of human physiology
This course aims to teach students how to acquire various physiological signals and how to assess them','Bangladesh University of Engineering and Technology
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No:		BME 204
Course Title:		Human Physiology Sessional
Credit hours:		1.5					Contact hours:	3
Level/Term:		2/1
Academic Session: 	2024-2025
Course Teacher(s):
Name | Office/
Room | Email & Telephone | Class routine
Md. Tazuddin Ahmed | ECE-1018 | mdtuahmed@bme.buet.ac.bd | Saturday:
11:00 AM-2:00 PM
Tuesday:
11:00 AM-2:00 PM
Shoyad Ibn Sabur Khan Nuhash | ECE-1018 | shoyadsabur@bme.buet.ac.bd | 
Tasnia Binte Mamun | ECE-1019 | tasnia@bme.buet.ac.bd | 
Samina Nishat Binte Akram | ECE-1019 | nishat@bme.buet.ac.bd | 
Course Content:
Experiments based on BME 203.
Course Objectives:
This course experimentally demonstrates different processes and phenomenon of human physiology
This course aims to teach students how to acquire various physiological signals and how to assess them
Course Outcomes:
Demonstrate various physiological processes of the human body using standard laboratory apparatus.
Correlate human physiological principles with the observations made in the laboratory.
Perform various physiological signal acquisition experiments
Analyze the results of experiments performed to interpret and formulate conclusions
Textbooks and References:
Ghai, C. L. A textbook of practical physiology. JP Medical Ltd, 2012
Guyton, Hall, Textbook of medical physiology, Elsevier Saunders
Lab Manuals
Weekly Schedule:
Lec# | Lecture Topics
1 | Introduction
2 | Estimation of Hemoglobin with Analysis and Interpretation of Results
3 | Determination of ABO and Rh Blood Groups with Interpretation and Analysis of Results
4 | Study of the Physiology of the Human Eye by Measurement of Visual Field, Visual Acuity, Color Vision and Observation of Light Reflex; Part A: Mapping of Visual Field by Perimeter; Part B: Observation of Light Reflexes and Analysis of Results
5 | Determination of Differential Count of WBC with Analysis and Interpretation of Results and Recording of Systemic Arterial Blood Pressure
6 | ESR Estimation and Interpretation of Results
7 | ECG Signal Recording, Analysis and Interpretation under Normal Conditions and Study of Variation of ECG Signal with Arrhythmia and other Coronary Diseases
8 | Study of PPG and Variation of PPG under a Variety of Physiological and Experimental Conditions
9 | EEG Signal Recording, Analysis and Interpretation and Study of Variation of Alpha Rhythm with Mental Arithmetic and Hyperventilation; Part A: Recording of EEG and Identification of EEG Complex; Part B: Recording of EEG under Different Conditions and Variation of Alpha
Rhythm Activity
10 | Spirometric Measurement of Lung Function Test by Determination of FVC, FEV and MVV with Interpretation and Analysis of Results
11 | Lab Viva-I
12 | Lab Viva-II
13 | Lab Quiz
Assessment:
Class Participation		10%
Continuous Assessment	30%
Final Viva			15%
Lab Test			15%
Lab Quiz			30%
Total		            	100%','[{"name": "Md. Tazuddin Ahmed", "room": "ECE-1018", "email": "mdtuahmed@bme.buet.ac.bd"}, {"name": "Shoyad Ibn Sabur Khan Nuhash", "room": "ECE-1018", "email": "shoyadsabur@bme.buet.ac.bd"}, {"name": "Tasnia Binte Mamun", "room": "ECE-1019", "email": "tasnia@bme.buet.ac.bd"}, {"name": "Samina Nishat Binte Akram", "room": "ECE-1019", "email": "nishat@bme.buet.ac.bd"}]'::jsonb,'[]'::jsonb,'[{"component": "Continuous Assessment", "weight": 0.4, "marks": 60}, {"component": "Lab Test", "weight": 0.15, "marks": 22.5}, {"component": "Lab Quiz", "weight": 0.3, "marks": 45}, {"component": "Final Viva", "weight": 0.15, "marks": 22.5}]'::jsonb,'{"folder": "1 - Course Files/L2T1/BME 204 Course File/January 2025", "files": {"co_po_mapping": "January 2025/CO-PO Mapping.docx", "outline": "January 2025/BME 204 - Course outline - January 2025.docx", "assessment_workbook": "January 2025/Assessments and Scripts/BME 204-CO-PO-Assessment-Marks.xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 204\nCourse Title: | Human Physiology Sessional\nLevel, Term and Section | 2/1\nAcademic Term | January 2025\nTextbooks used: | Ghai, C. L. A textbook of practical physiology. JP Medical Ltd, 2012\nGuyton, Hall, Textbook of medical physiology, Elsevier Saunders\nLast term when the course was offered | January 2024\nPart B. Attainment for current and previous terms\nJanuary 2025\nCO1 | CO2 | CO3 | CO4 | CO5 | CO6 | CO7 | CO8 | CO9 | CO10 | CO11 | CO12\n98 | 96 | 98 | 96 | NA | NA | NA | NA | NA | NA | NA | NA\nY | Y | Y | Y | NA | NA | NA | NA | NA | NA | NA | NA\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\n96 | 96 | NA | NA | 100 | NA | NA | NA | NA | NA | NA | NA\nY | Y | NA | NA | Y | NA | NA | NA | NA | NA | NA | NA\nPrevious term: Not available\nPart C. Analysis\nTeachers’ comment on attainment: The overall attainment is satisfactory, with all assessed outcomes surpassing the attainment threshold of 40%.\nInterpretation of student feedback: N/A\nTeachers’ comment on teaching learning: Can be more interactive, with more real life applications.\nPart D. Comments on CQI implemented based on last assessment\nN/A\nPart E. Recommendation\nMajor issues: None\nPlan for future actions for further improvement: None.\nSignature(s):\nName: Ms. Tasnia Binte Mamun | Mr. Shoyad Ibn Sabur Khan Nuhash | Name: Ms. Samina Nishat Binte Akram | Name: Mr. Tazuddin Ahmed\nSignature: | Signature: | Signature: | Signature:"}'::jsonb,'{}'::text[],true,true);
insert into stg_co values ('2025-01','BME 204',1,'Demonstrate various physiological processes of the human body using standard laboratory apparatus',array['PS3']::text[],array['Lectures','Demonstrations','Hands-on Group Activities','Practical observation']::text[],array['Continuous Assessment']::text[],array['K6','P1']::text[],array['PO5']::text[]);
insert into stg_co values ('2025-01','BME 204',2,'Correlate human physiological principles with the observations made in the laboratory',array['C2']::text[],array['Lectures','Demonstrations','Guided lab discussions']::text[],array['Lab Quiz','Final Viva']::text[],array['K1','K2','K3','K4','P1']::text[],array['PO1']::text[]);
insert into stg_co values ('2025-01','BME 204',3,'Perform various physiological signal acquisition experiments',array['PS3']::text[],array['Lectures','Demonstrations','Homework']::text[],array['Lab Test']::text[],array['K6','P1']::text[],array['PO5']::text[]);
insert into stg_co values ('2025-01','BME 204',4,'Analyze the results of experiments performed to interpret and formulate conclusions',array['C4']::text[],array['Lectures','Demonstrations','Homework']::text[],array['Continuous Assessment','Lab Quiz']::text[],array['K1','K2','K3','K4','P1','P3']::text[],array['PO2']::text[]);
insert into stg_crit values ('2025-01','BME 204',0,'Continuous Assessment','Demonstrate various physiological processes of the human body using standard laboratory apparatus',20,array['CO1']::text[]);
insert into stg_crit values ('2025-01','BME 204',1,'Continuous Assessment','Analyze the results of experiments performed to interpret and formulate conclusions',40,array['CO4']::text[]);
insert into stg_crit values ('2025-01','BME 204',2,'Lab Test','Perform various physiological signal acquisition experiments',22.5,array['CO3']::text[]);
insert into stg_crit values ('2025-01','BME 204',3,'Lab Quiz','Correlate human physiological principles with the observations made in the laboratory',20,array['CO2']::text[]);
insert into stg_crit values ('2025-01','BME 204',4,'Lab Quiz','Analyze the results of experiments performed to interpret and formulate conclusions',25,array['CO4']::text[]);
insert into stg_crit values ('2025-01','BME 204',5,'Final Viva','Correlate human physiological principles with the observations made in the laboratory',22.5,array['CO2']::text[]);
insert into stg_att values ('2025-01','BME 204','CO','CO1',98.0,'car');
insert into stg_att values ('2025-01','BME 204','CO','CO2',96.0,'car');
insert into stg_att values ('2025-01','BME 204','CO','CO3',98.0,'car');
insert into stg_att values ('2025-01','BME 204','CO','CO4',96.0,'car');
insert into stg_att values ('2025-01','BME 204','PO','PO1',96.0,'car');
insert into stg_att values ('2025-01','BME 204','PO','PO2',96.0,'car');
insert into stg_att values ('2025-01','BME 204','PO','PO5',100.0,'car');
insert into stg_car values ('2025-01','BME 204','Teachers’ comment on attainment: The overall attainment is satisfactory, with all assessed outcomes surpassing the attainment threshold of 40%.
Interpretation of student feedback: N/A
Teachers’ comment on teaching learning: Can be more interactive, with more real life applications.','','Major issues: None
Plan for future actions for further improvement: None.');
insert into stg_bugs values ('BUGS 09.04.25','2025-04-09','https://buetedu-my.sharepoint.com/:b:/g/personal/shoyadsabur_bme_buet_ac_bd/IQCjIvypYsjBQLUopsrX7yx3AZtJDMIoD-etVNDs3LN3IwY?e=2OdeOt','2025-01','BME 204');
insert into stg_off values ('2025-07','July 2025','BME 204',null,'Experiments based on BME 203.','This course experimentally demonstrates different processes and phenomenon of human physiology
This course aims to teach students how to acquire various physiological signals and how to assess them','Bangladesh University of Engineering and Technology
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No:		BME 204
Course Title:	Human Physiology Sessional
Credit hours:	1.5					Contact hours:  3
Level/Term:		2/1
Academic Session:   2024-2025
Course Teacher(s):
Name | Office/
Room | Email & Telephone | Class routine
Mr. Md. Tazuddin Ahmed | ECE-1121 | mdtuahmed@bme.buet.ac.bd | Saturday:
11:00 AM-2:00 PM
Sunday:
11:00 AM-2:00 PM
Ms. Tasnia Binte Mamun | ECE-1123 | tasnia@bme.buet.ac.bd | 
Mr. Sayeed Sajjad Razin | ECE-1119 | razin@bme.buet.ac.bd | 
Ms. Chaity Chakraborty | ECE-1013 | chaity@bme.buet.ac.bd | 
Course Content:
Experiments based on BME 203.
Course Objectives:
This course experimentally demonstrates different processes and phenomenon of human physiology
This course aims to teach students how to acquire various physiological signals and how to assess them
Course Outcomes:
Demonstrate various physiological processes of the human body using standard laboratory apparatus.
Correlate human physiological principles with the observations made in the laboratory.
Perform various physiological signal acquisition experiments
Analyze the results of experiments performed to interpret and formulate conclusions
Textbooks and References:
Ghai, C. L. A textbook of practical physiology. JP Medical Ltd, 2012
Guyton, Hall, Textbook of medical physiology, Elsevier Saunders
Lab Manuals
Weekly Schedule:
Lec# | Lecture Topics
1 | Introduction
2 | Estimation of Hemoglobin with Analysis and observe the shape of RBC in normal saline.
3 | Determination of ABO and Rh Blood Groups with Interpretation and Analysis of Results
4 | Study of the Physiology of the Human Eye by Measurement of Visual Field, Visual Acuity, Color Vision and Observation of Light Reflex; Part A: Mapping of Visual Field by Perimeter; Part B: Observation of Light Reflexes and Analysis of Results
5 | Determination of Differential Count of WBC with Analysis and Interpretation of Results and Recording of Systemic Arterial Blood Pressure
6 | ESR Estimation and Interpretation of Results
7 | ECG Signal Recording, Analysis and Interpretation under Normal Conditions and Study of Variation of ECG Signal with Arrhythmia and other Coronary Diseases
8 | Study of PPG and Variation of PPG under a Variety of Physiological and Experimental Conditions
9 | EEG Signal Recording, Analysis and Interpretation and Study of Variation of Alpha Rhythm with Mental Arithmetic and Hyperventilation; Part A: Recording of EEG and Identification of EEG Complex; Part B: Recording of EEG under Different Conditions and Variation of Alpha
Rhythm Activity
10 | Spirometric Measurement of Lung Function Test by Determination of FVC, FEV and MVV with Interpretation and Analysis of Results
11 | Lab Viva-I
12 | Lab Viva-II
13 | Lab Quiz
Assessment:
Class Participation		10%
Continuous Assessment	40%
Final Viva			20%
Lab Quiz			30%
Total		            	100%','[{"name": "Mr. Md. Tazuddin Ahmed", "room": "ECE-1121", "email": "mdtuahmed@bme.buet.ac.bd"}, {"name": "Ms. Tasnia Binte Mamun", "room": "ECE-1123", "email": "tasnia@bme.buet.ac.bd"}, {"name": "Mr. Sayeed Sajjad Razin", "room": "ECE-1119", "email": "razin@bme.buet.ac.bd"}, {"name": "Ms. Chaity Chakraborty", "room": "ECE-1013", "email": "chaity@bme.buet.ac.bd"}]'::jsonb,'[{"component": "Class Participation", "percent": 10.0}, {"component": "Continuous Assessment", "percent": 30.0}, {"component": "Final Viva", "percent": 15.0}, {"component": "Lab Test", "percent": 15.0}, {"component": "Lab Quiz", "percent": 30.0}]'::jsonb,'[{"component": "Class Participation", "weight": 0.1, "marks": 15}, {"component": "Continuous Assessment_Viva", "weight": 0.2, "marks": 30}, {"component": "Continuous Assessment_Quiz", "weight": 0.2, "marks": 30}, {"component": "Final Viva", "weight": 0.2, "marks": 30}, {"component": "Final Quiz", "weight": 0.3, "marks": 45}, {"component": "Total", "weight": 1, "marks": 150}]'::jsonb,'{"folder": "1 - Course Files/L2T1/BME 204 Course File/July 2025", "files": {"co_po_mapping": "July 2025/CO-PO Mapping.docx", "outline": "July 2025/BME 204_Course outline.docx", "assessment_workbook": "July 2025/Assessments and scripts/BME 204-CO-PO-Assessment-Marks.xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 204\nCourse Title: | Human Physiology Sessional\nLevel, Term and Section | 2/1\nAcademic Term | July 2025\nTextbooks used: | Ghai, C. L. A textbook of practical physiology. JP Medical Ltd, 2012\nGuyton, Hall, Textbook of medical physiology, Elsevier Saunders\nLast term when the course was offered | January 2025\nPart B. Attainment for current and previous terms\nJuly 2025\nCO1 | CO2 | CO3 | CO4 | CO5 | CO6 | CO7 | CO8 | CO9 | CO10 | CO11 | CO12\n100 | 100 | 100 | 98.04 | NA | NA | NA | NA | NA | NA | NA | NA\nY | Y | Y | Y | NA | NA | NA | NA | NA | NA | NA | NA\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\n100 | 98.04 | NA | NA | 100 | NA | NA | NA | NA | NA | NA | NA\nY | Y | NA | NA | Y | NA | NA | NA | NA | NA | NA | NA\nJanuary 2025\nCO1 | CO2 | CO3 | CO4 | CO5 | CO6 | CO7 | CO8 | CO9 | CO10 | CO11 | CO12\n98 | 96 | 98 | 96 | NA | NA | NA | NA | NA | NA | NA | NA\nY | Y | Y | Y | NA | NA | NA | NA | NA | NA | NA | NA\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\n96 | 96 | NA | NA | 100 | NA | NA | NA | NA | NA | NA | NA\nY | Y | NA | NA | Y | NA | NA | NA | NA | NA | NA | NA\nPart C. Analysis\nTeachers’ comment on attainment: The overall attainment is satisfactory, with all assessed outcomes surpassing the attainment threshold of 40%.\nInterpretation of student feedback: N/A\nTeachers’ comment on teaching learning:  N/A\nPart D. Comments on CQI implemented based on last assessment\nN/A\nPart E. Recommendation\nMajor issues: None\nPlan for future actions for further improvement: Incorporating more experiments can help students better understand theoretical concepts.\nSignature(s):\nName: Mr. Tazuddin Ahmed | Name: Ms. Chaity Chakraborty | Name: Mr. Sayeed Sajjad Razin | Name: Ms. Tasnia Binte Mamun\nSignature: | Signature: | Signature: | Signature:"}'::jsonb,array['No K/P/A matrix in CO-PO mapping doc']::text[],true,true);
insert into stg_co values ('2025-07','BME 204',1,'Demonstrate various physiological processes of the human body using standard laboratory apparatus',array['PS3']::text[],array['Lectures','Demonstrations','Hands-on Group Activities','Practical observation']::text[],array['Continuous Assessment']::text[],'{}'::text[],array['PO5']::text[]);
insert into stg_co values ('2025-07','BME 204',2,'Explain human physiological principles with the observations made in the laboratory',array['C2']::text[],array['Lectures','Discussion']::text[],array['Lab Quiz','Final Viva']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 204',3,'Perform various physiological signal acquisition experiments',array['PS3']::text[],array['Lectures','Demonstrations','Homework']::text[],array['Continuous Assessment']::text[],'{}'::text[],array['PO5']::text[]);
insert into stg_co values ('2025-07','BME 204',4,'Analyse the results of experiments performed to interpret and formulate conclusions',array['C4']::text[],array['Lectures','Homework']::text[],array['Lab Quiz']::text[],'{}'::text[],array['PO2']::text[]);
insert into stg_crit values ('2025-07','BME 204',0,'Class Participation','Perform various physiological signal acquisition experiments',15,array['CO3']::text[]);
insert into stg_crit values ('2025-07','BME 204',1,'Continuous Assessment','Demonstrate various physiological processes of the human body using standard laboratory apparatus',30,array['CO1']::text[]);
insert into stg_crit values ('2025-07','BME 204',2,'Continuous Assessment','Correlate human physiological principles with the observations made in the laboratory',30,array['CO4']::text[]);
insert into stg_crit values ('2025-07','BME 204',3,'Final Viva','Correlate human physiological principles with the observations made in the laboratory',30,array['CO2']::text[]);
insert into stg_crit values ('2025-07','BME 204',4,'Lab Quiz','Correlate human physiological principles with the observations made in the laboratory',20,array['CO2']::text[]);
insert into stg_crit values ('2025-07','BME 204',5,'Lab Quiz','Analyze the results of experiments performed to interpret and formulate conclusions',25,array['CO4']::text[]);
insert into stg_att values ('2025-07','BME 204','CO','CO1',100,'workbook');
insert into stg_att values ('2025-07','BME 204','CO','CO2',100,'workbook');
insert into stg_att values ('2025-07','BME 204','CO','CO3',100,'workbook');
insert into stg_att values ('2025-07','BME 204','CO','CO4',98.04,'workbook');
insert into stg_att values ('2025-07','BME 204','PO','PO1',100,'workbook');
insert into stg_att values ('2025-07','BME 204','PO','PO2',98.04,'workbook');
insert into stg_att values ('2025-07','BME 204','PO','PO5',100,'workbook');
insert into stg_car values ('2025-07','BME 204','Teachers’ comment on attainment: The overall attainment is satisfactory, with all assessed outcomes surpassing the attainment threshold of 40%.
Interpretation of student feedback: N/A
Teachers’ comment on teaching learning:  N/A','','Major issues: None
Plan for future actions for further improvement: Incorporating more experiments can help students better understand theoretical concepts.');
insert into stg_bugs values ('BUGS 26.10.25','2025-10-26','https://buetedu-my.sharepoint.com/:b:/g/personal/shoyadsabur_bme_buet_ac_bd/IQCy_jpgTQFiT5eiZAwUwCoCAa3SOSsoXvVcBvXkXCbvP2o?e=dw7GtT','2025-07','BME 204');
insert into stg_off values ('2025-07','July 2025','BME 205',null,'Concept of fluid continuum; Forces acting on a fluid; Properties of fluids; Surface tension; Statics of fluids; Manometers; Forces on submerged surfaces; Fluids in motion: concept of shear stress and classification of fluids, fluid flow in closed conduits, laminar and turbulent flow, friction factor, dynamic similarity, dimensionless numbers, viscoelastic and viscoplastic property; Control volume analysis: mass and momentum balance, continuity and momentum equations; Bernoulli’s principle; Newton’s law of viscosity; Navier-Stokes equations; Poiseuille flow; Pulsatile flow in rigid and elastic tube; Basic Hemodynamics: hematology and blood rheology; Compliance, inertance and resistance in blood vessels; Multiphase flow; Micro and macrocirculation: Fahreus-Lindqvist effect, hemodynamics in vascular diseases; Respiratory flow: pressure-volume relationship; Assistive and implantable devices;
Basic modes of heat transfer; Heat Transfer in Biological Systems; Thermal regulation of human body; Thermal injury; Therapeutic applications of bioheat transfer; Different approaches in bioheat transfer modeling.','The course will cover the basic laws, principles and phenomena in the area of fluid mechanics
The course will enable students to integrate fluid dynamics engineering concepts to examine and model the biological flow in human body
Mathematical/physical models for the blood flows in the healthy and diseased physiological systems will be discussed
Fundamental principles and laws of heat transfer and the implications of these principles for the analysis of physiological system will be introduced','Bangladesh University of Engineering and Technology
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No:			BME 205
Course Title:		Biofluid Mechanics and Heat Transfer
Credit hours:		3				Contact hours:	3
Level/Term:			2/2
Academic Session: 	2023-2024
Course Teacher(s):
Name | Office/
Room | Email & Telephone | Class routine
Mr. Shoyad Ibn Sabur Khan Nuhash | ECE-1017 | shoyadsabur@bme.buet.ac.bd
+880 1515 212 213 | Sunday:
12:00 PM - 12:50 PM
Monday:
12:00 PM - 12:50 PM
Tuesday:
09:00 AM - 09:50 AM
Mr. Abdullah Al Mamun | ECE-1123 | mabdullahmamun17@gmail.com
+880 1639 008 395 | 
Course Contents:
Concept of fluid continuum; Forces acting on a fluid; Properties of fluids; Surface tension; Statics of fluids; Manometers; Forces on submerged surfaces; Fluids in motion: concept of shear stress and classification of fluids, fluid flow in closed conduits, laminar and turbulent flow, friction factor, dynamic similarity, dimensionless numbers, viscoelastic and viscoplastic property; Control volume analysis: mass and momentum balance, continuity and momentum equations; Bernoulli’s principle; Newton’s law of viscosity; Navier-Stokes equations; Poiseuille flow; Pulsatile flow in rigid and elastic tube; Basic Hemodynamics: hematology and blood rheology; Compliance, inertance and resistance in blood vessels; Multiphase flow; Micro and macrocirculation: Fahreus-Lindqvist effect, hemodynamics in vascular diseases; Respiratory flow: pressure-volume relationship; Assistive and implantable devices;
Basic modes of heat transfer; Heat Transfer in Biological Systems; Thermal regulation of human body; Thermal injury; Therapeutic applications of bioheat transfer; Different approaches in bioheat transfer modeling.
Course Objectives:
The course will cover the basic laws, principles and phenomena in the area of fluid mechanics
The course will enable students to integrate fluid dynamics engineering concepts to examine and model the biological flow in human body
Mathematical/physical models for the blood flows in the healthy and diseased physiological systems will be discussed
Fundamental principles and laws of heat transfer and the implications of these principles for the analysis of physiological system will be introduced
Course Outcomes:
Explain the basic laws, principles and phenomena of fluid mechanics
Solve biofluid problems using fluid mechanics equations in physiological conditions
Employ mathematical/physical models for the blood flows in the healthy and diseased physiological system
Apply the principles of heat transfer in biological systems
Assessment:
Class participation/Attendance:		10%
Continuous Evaluation:			20%
Term Final Exam:				70%
Textbooks and References:
David A. Rubenstein (2021). Biofluid Mechanics: An Introduction to Fluid Mechanics, Macrocirculation, and Microcirculation (Biomedical Engineering). 3rd Edition, Academic Press
Biofluid Mechanics, Principles and Applications by Ali Ostadfar
Heat and Mass Transfer: A Biological Context, Second Edition by Ashim K. Datta
Heat and Mass Transfer: Fundamentals and Applications 5th Edition by Yunus Cengel, Afshin Ghajar
T. L. Bergman, A. S. Lavine, F. Incropera, D. DeWitt. (20). Fundamentals of Heat and Mass Transfer, 7th Edition
Weekly Schedule:
Week | Topics
1 | Concepts of fluid:
Newtonian and non-Newtonian fluid
Properties of fluid
Surface tension
2 | Static fluid:
Buoyancy
Basic equations of fluid statics
3 | Static fluid:
Total pressure on submerged surfaces
Manometers
Mathematical problems
Winter Vacation
4 | Fundamentals of fluid flow:
Types of fluid flows
Dimensionless numbers
Class test # 1
5 | Principles of fluid flow:
Conservation equations
Continuity equation
6 | Principles of fluid flow:
Navier-Stokes equation
Bernoulli’s equation
Mathematical problems
7 | Principles of fluid flow:
Poisseuille’s Law
Darcy-Weisbach equation
Mathematical problems
Class test # 2
8 | Macrocirculation:
Circulatory system
Pulsatile flow
Womersley Number
Vascular bifurcation and branches
9 | Macrocirculation:
Flow Separation
Blood flow through curved vessels
Mechanical and elastic properties
10 | Microcirculation:
Blood flow in arterioles and capillaries
Fahraeus effect and Fahreus-Lindqvist effect
11 | Microcirculation:
Mass transport in tissue
Porosity, tortuosity, permeability
Class test # 3
Assistive and implantable devices.
12 | Basics of Heat Transfer:
Conduction, convection, radiation
Heat transfer in biological systems
Ramadan and Eid-Ul-Fitr Vacation
13 | Basics of Heat Transfer:
Thermoregulation in human body
Thermal injury
14 | Basics of Heat Transfer:
Therapeutic applications of bioheat transfer
Different approaches in bioheat transfer modeling
Class test # 4
Prepared by: | 
Name:
Signature:
Date: | Mr. Shoyad Ibn Sabur Khan Nuhash
29/11/2025
Name:
Signature:
Date: | Mr. Abdullah Al Mamun
29/11/2025','[{"name": "Mr. Shoyad Ibn Sabur Khan Nuhash", "room": "ECE-1017", "email": "shoyadsabur@bme.buet.ac.bd"}, {"name": "Mr. Abdullah Al Mamun", "room": "ECE-1123", "email": "mabdullahmamun17@gmail.com"}]'::jsonb,'[{"component": "Class participation/Attendance", "percent": 10.0}, {"component": "Continuous Assessment", "percent": 20.0}, {"component": "Term Final", "percent": 70.0}]'::jsonb,'[]'::jsonb,'{"folder": "1 - Course Files/L2T2/BME 205 Course File/July 2025", "files": {"co_po_mapping": "July 2025/CO-PO Mapping_BME 205_July 2025.docx", "outline": "July 2025/BME 205_Course outline_July 2025.docx", "assessment_workbook": "July 2025/Assessments and scripts/BME 205-CO-PO-Assessment-marks.xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 205\nCourse Title: | Biofluid Mechanics and Heat Transfer\nLevel, Term and Section | 2/2\nAcademic Term | July 2025\nTextbooks used: | David A. Rubenstein (2021). Biofluid Mechanics: An Introduction to Fluid Mechanics, Macrocirculation, and Microcirculation (Biomedical Engineering). 3rd Edition, Academic Press\nBiofluid Mechanics, Principles and Applications by Ali Ostadfar\nHeat and Mass Transfer: A Biological Context, Second Edition by Ashim K. Datta\nHeat and Mass Transfer: Fundamentals and Applications 5th Edition by Yunus Cengel, Afshin Ghajar\nT. L. Bergman, A. S. Lavine, F. Incropera, D. DeWitt. (20). Fundamentals of Heat and Mass Transfer, 7th Edition\nLast term when the course was offered | January 2024\nPart B. Attainment for current and previous terms\nCurrent Term: July 2025 Term\nCO Attainment | CO1 | CO2 | CO3 | CO4\n%student attained | 93.88% | 89.80% | 83.67% | 85.71%\nCohort Attainment | Y | Y | Y | Y\nPO Attainment | PO1\n%student attained | 91.84%\nCohort Attainment | Y\nPart C. Analysis\nTeachers’ comment on attainment: CO2, CO3, CO4 attainment needs improvement.\nInterpretation of student feedback: N/A\nTeachers’ comment on teaching learning:\nMore case studies and practical scenario related problems should be solved in class.\nThe review of course delivery and assessment practices indicated that several documented delivery methods and assessment tools were not being implemented as independent, measurable components in a consistent manner across offerings of the course. In particular, homework, tutorial sessions, guided discussions, and assignment-based assessments were not always separately evaluated for CO attainment. This created unnecessary complexity in outcome mapping and assessment documentation while providing limited additional evidence of student attainment.\nIt was observed that the course outline explicitly identified Course Outcome (CO) mappings alongside class test declarations, although class tests are currently not utilized for CO-PO attainment calculations. Furthermore, class test questions are primarily designed as formative assessments and are not consistently developed using OBE-based question mapping criteria. As a result, the explicit inclusion of CO references in class test descriptions may create ambiguity regarding their role in formal outcome assessment and may not accurately reflect the current assessment and attainment methodology adopted by the course.\nPart D. Comments on CQI implemented based on last assessment\nN/A\nPart E. Recommendation\nMajor issues: None\nPlan for future actions for further improvement:\nThe course outcomes should be retained as they adequately reflect the intended learning objectives of the course. However, the delivery methods and assessment tools should be streamlined to better align with actual instructional practices and available assessment evidence. Assessment of the course outcomes may be consolidated around written examinations and structured classroom participation to improve consistency, transparency, and ease of CO attainment evaluation.\nTo ensure consistency between documented assessment practices and the OBE implementation framework, assessment components that are not directly used for CO–PO attainment evaluation should not be explicitly identified as CO-mapped assessment tools. The course documentation should clearly distinguish between formative assessments used for learning reinforcement and summative assessments used for outcome attainment measurement. Accordingly, explicit CO references associated with class tests may be removed unless class tests are formally incorporated into the CO attainment calculation process and are designed using appropriate OBE mapping criteria.\nSignature(s):\nName: Shoyad Ibn Sabur Khan Nuhash | Name: Md. Abdullah Al Mamun\nSignature: | Signature:"}'::jsonb,'{}'::text[],true,true);
insert into stg_co values ('2025-07','BME 205',1,'Explain the basic laws, principles and phenomena of fluid mechanics',array['C2']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],array['K1','K2','K3','K4','P1']::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 205',2,'Solve biofluid problems using fluid mechanics equations in physiological conditions',array['C3']::text[],array['Lectures','Homework','Tutorials']::text[],array['Written exams','Assignments']::text[],array['K1','K2','K3','K4','P1']::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 205',3,'Employ mathematical/physical models for the blood flows in the healthy and diseased physiological systems',array['C3']::text[],array['Lectures','Homework','Guided Discussion and Practice']::text[],array['Written exams','Assignments']::text[],array['K1','K2','K3','K4','P1']::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 205',4,'Apply the principles of heat transfer in biological systems',array['C3']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],array['K1','K2','K3','K4','P1']::text[],array['PO1']::text[]);
insert into stg_crit values ('2025-07','BME 205',0,'Term Final','Q. 01 (a)',10,array['CO2']::text[]);
insert into stg_crit values ('2025-07','BME 205',1,'Term Final','Q. 01 (b)',12,array['CO2']::text[]);
insert into stg_crit values ('2025-07','BME 205',2,'Term Final','Q. 01 (c)',13,array['CO2']::text[]);
insert into stg_crit values ('2025-07','BME 205',3,'Term Final','Q. 01 (d)',10,array['CO1']::text[]);
insert into stg_crit values ('2025-07','BME 205',4,'Term Final','Q. 05 (a)',15,array['CO4']::text[]);
insert into stg_crit values ('2025-07','BME 205',5,'Term Final','Q. 05 (b)',15,array['CO4']::text[]);
insert into stg_crit values ('2025-07','BME 205',6,'Term Final','Q. 05 (c)',15,array['CO3']::text[]);
insert into stg_att values ('2025-07','BME 205','CO','CO1',93.88,'workbook');
insert into stg_att values ('2025-07','BME 205','CO','CO2',89.8,'workbook');
insert into stg_att values ('2025-07','BME 205','CO','CO3',83.67,'workbook');
insert into stg_att values ('2025-07','BME 205','CO','CO4',85.71,'workbook');
insert into stg_att values ('2025-07','BME 205','PO','PO1',91.84,'workbook');
insert into stg_car values ('2025-07','BME 205','Teachers’ comment on attainment: CO2, CO3, CO4 attainment needs improvement.
Interpretation of student feedback: N/A
Teachers’ comment on teaching learning:
More case studies and practical scenario related problems should be solved in class.
The review of course delivery and assessment practices indicated that several documented delivery methods and assessment tools were not being implemented as independent, measurable components in a consistent manner across offerings of the course. In particular, homework, tutorial sessions, guided discussions, and assignment-based assessments were not always separately evaluated for CO attainment. This created unnecessary complexity in outcome mapping and assessment documentation while providing limited additional evidence of student attainment.
It was observed that the course outline explicitly identified Course Outcome (CO) mappings alongside class test declarations, although class tests are currently not utilized for CO-PO attainment calculations. Furthermore, class test questions are primarily designed as formative assessments and are not consistently developed using OBE-based question mapping criteria. As a result, the explicit inclusion of CO references in class test descriptions may create ambiguity regarding their role in formal outcome assessment and may not accurately reflect the current assessment and attainment methodology adopted by the course.','','Major issues: None
Plan for future actions for further improvement:
The course outcomes should be retained as they adequately reflect the intended learning objectives of the course. However, the delivery methods and assessment tools should be streamlined to better align with actual instructional practices and available assessment evidence. Assessment of the course outcomes may be consolidated around written examinations and structured classroom participation to improve consistency, transparency, and ease of CO attainment evaluation.
To ensure consistency between documented assessment practices and the OBE implementation framework, assessment components that are not directly used for CO–PO attainment evaluation should not be explicitly identified as CO-mapped assessment tools. The course documentation should clearly distinguish between formative assessments used for learning reinforcement and summative assessments used for outcome attainment measurement. Accordingly, explicit CO references associated with class tests may be removed unless class tests are formally incorporated into the CO attainment calculation process and are designed using appropriate OBE mapping criteria.');
insert into stg_off values ('2025-07','July 2025','BME 206',null,'Experiments based on BME 205.','The course will provide a hands-on experience on fluid fundamentals.
Analysis of biofluid flow in different biological systems will be covered.
Heat transfer in physiological systems will be simulated in different diseased conditions.','Bangladesh University of Engineering and Technology
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No:		BME 206
Course Title:		Biofluid Mechanics and Heat Transfer Sessional
Credit hours:		1.5					Contact hours:	3
Level/Term:		2/2
Academic Session: 	2024-2025
Course Teacher(s):
Name | Office/
Room | Email & Telephone | Class routine
Mr. Shoyad Ibn Sabur Khan Nuhash | ECE-1005 | shoyadsabur@bme.buet.ac.bd
+880 1515-212213 | Saturday (A1)
02:30 PM - 05:00 PM
Sunday (A2)
02:30 PM - 05:00 PM
Mr. Md. Abdullah Al Mamun | ECE-1024 | mamun@bme.buet.ac.bd
+880 1639-008395 | 
Ms. Tasnia Binte Mamun | ECE-1025 | tasnia@bme.buet.ac.bd
+880 1677-900345 | 
Course Content:
Experiments based on BME 205.
Course Objectives:
The course will provide a hands-on experience on fluid fundamentals.
Analysis of biofluid flow in different biological systems will be covered.
Heat transfer in physiological systems will be simulated in different diseased conditions.
Course Outcomes:
Show understanding of biofluid mechanics principles through hands-on experiments
Analyze physiological and pathological flow behavior in biological systems.
Develop and simulate biofluid and heat transfer models
Textbooks and References:
An Introduction to Modeling of Transport Processes, Applications to Biomedical Systems by Ashim Datta and Vineet Rakesh
Weekly Schedule:
Lec# | Lecture Topics
1 | Rheological behaviour of Biological Fluid Analogs
2 | Study of Bernoulli’s Theorem with a Venturi Tube
3 | Study of Friction Loss in Biological Systems
4 | Investigation of a Dialysis Machine and its Principles
5 | ANSYS Simulation of 3D Bifurcating Artery
6 | ANSYS Simulation for Modelling Drug Particle Transport and Deposition in the tracheal airway - Part I
7 | ANSYS Simulation for Modelling Drug Particle Transport and Deposition in the tracheal airway - Part II
8 | Lab Test - 1 (ANSYS)
9 | COMSOL Simulation on Hemodialysis and Dialyzer Functionality
10 | COMSOL Simulation of Burn Injury in Blood Perfused Skin
11 | COMSOL Simulation of Drug Release and Washout Kinetics from DES
12 | Microfluidic model of human Lung on a Chip
13 | Lab Test - 2 (COMSOL)
14 | Lab Quiz
Assessment:
Class Participation and Continuous Assessment	35%
Lab Test						40%
Lab Quiz						25%
Total						            100%','[{"name": "Mr. Shoyad Ibn Sabur Khan Nuhash", "room": "ECE-1005", "email": "shoyadsabur@bme.buet.ac.bd"}, {"name": "Mr. Md. Abdullah Al Mamun", "room": "ECE-1024", "email": "mamun@bme.buet.ac.bd"}, {"name": "Ms. Tasnia Binte Mamun", "room": "ECE-1025", "email": "tasnia@bme.buet.ac.bd"}]'::jsonb,'[{"component": "Class Participation and Continuous Assessment", "percent": 35.0}, {"component": "Lab Test", "percent": 40.0}, {"component": "Lab Quiz", "percent": 25.0}]'::jsonb,'[{"component": "Continuous Assessment", "weight": 0.2, "marks": 30}, {"component": "Lab Reports", "weight": 0.15, "marks": 22.5}, {"component": "Lab Test", "weight": 0.4, "marks": 60}, {"component": "Final Quiz", "weight": 0.25, "marks": 37.5}]'::jsonb,'{"folder": "1 - Course Files/L2T2/BME 206 Course File/July 2025", "files": {"co_po_mapping": "July 2025/CO-PO mapping.docx", "outline": "July 2025/BME 206 - Course outline - July 2025.docx", "assessment_workbook": "July 2025/Assessments and scripts/BME 206-CO-PO-Assessment-Marks.xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 206\nCourse Title: | Biofluid Mechanics and Heat Transfer Sessional\nLevel, Term and Section | 2/2\nAcademic Term | July 2025\nTextbooks used: | An Introduction to Modeling of Transport Processes, Applications to Biomedical Systems by Ashim Datta and Vineet Rakesh\nLast term when the course was offered | January 2025\nPart B. Attainment for current and previous terms\nCurrent term:\n(From the excel worksheet)\nCO1 | CO2 | CO3 | CO4 | CO5 | CO6 | CO7 | CO8 | CO9 | CO10 | CO11 | CO12\n96 | 94 | 82 | NA | NA | NA | NA | NA | NA | NA | NA | NA\nY | Y | Y | NA | NA | NA | NA | NA | NA | NA | NA | NA\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\nNA | NA | NA | NA | 94 | NA | NA | NA | NA | NA | NA | NA\nNA | NA | NA | NA | Y | NA | NA | NA | NA | NA | NA | NA\nPrevious term:\nNot available\nPart C. Analysis\nTeachers’ comment on attainment: All the course outcomes (COs) mapped to this course were achieved by 100% of students. The overall attainment is highly satisfactory, with all assessed outcomes surpassing the attainment threshold of 40%.\nInterpretation of student feedback: N/A\nTeachers’ comment on teaching learning: Can be more interactive, with more real-life applications.\nPart D. Comments on CQI implemented based on last assessment\nN/A\nPart E. Recommendation\nMajor issues: None\nPlan for future actions for further improvement:\nBased on the current course delivery and outcome assessment, the following actions are recommended to further enhance the alignment and effectiveness of BME 206: Provision of high-performance computers is recommended to ensure the smooth execution of laboratory sessions and computational tasks, Installation of an Uninterruptible Power Supply (UPS) system is necessary to prevent disruptions caused by power outages and to ensure that students'' laboratory activities and assessments are not adversely affected.\nSignature(s):\nName: Mr. Abdullah Al Mamun | Name: Mr. Shoyad Ibn Sabur Khan Nuhash | Name: Ms. Tasnia Binte Mamun\nSignature: | Signature: | Signature:"}'::jsonb,'{}'::text[],true,true);
insert into stg_co values ('2025-07','BME 206',1,'Show understanding of biofluid mechanics principles through hands-on experiments',array['PS2']::text[],array['Lectures','Demonstrations','Hands-on Group Activities']::text[],array['Continuous Assessment','Lab Quiz']::text[],array['K6','P1']::text[],array['PO5']::text[]);
insert into stg_co values ('2025-07','BME 206',2,'Analyze physiological and pathological flow behavior in biological systems',array['C4','PS3']::text[],array['Lectures','Guided Instruction','Homework/ Assignments']::text[],array['Lab Test','Lab Quiz']::text[],array['K6','P1']::text[],array['PO5']::text[]);
insert into stg_co values ('2025-07','BME 206',3,'Develop and simulate biofluid and heat transfer models',array['PS4']::text[],array['Lectures','Guided Instruction','Homework/ Assignments']::text[],array['Lab Test','Lab Quiz']::text[],array['K6','P1']::text[],array['PO5']::text[]);
insert into stg_crit values ('2025-07','BME 206',0,'Continuous Assessment','Show understanding of biofluid mechanics principles through hands-on experiments',30,array['CO1']::text[]);
insert into stg_crit values ('2025-07','BME 206',1,'Lab Report','Show understanding of biofluid mechanics principles through hands-on experiments',22.5,array['CO1']::text[]);
insert into stg_crit values ('2025-07','BME 206',2,'Lab Test','Analyze physiological and pathological flow behavior in biological systems',30,array['CO2']::text[]);
insert into stg_crit values ('2025-07','BME 206',3,'Lab Test','Develop and simulate biofluid and heat transfer models',30,array['CO3']::text[]);
insert into stg_crit values ('2025-07','BME 206',4,'Lab Quiz','Show understanding of biofluid mechanics principles through hands-on experiments',12.5,array['CO1']::text[]);
insert into stg_crit values ('2025-07','BME 206',5,'Lab Quiz','Analyze physiological and pathological flow behavior in biological systems',4.17,array['CO2']::text[]);
insert into stg_crit values ('2025-07','BME 206',6,'Lab Quiz','Develop and simulate biofluid and heat transfer models',20.83,array['CO3']::text[]);
insert into stg_att values ('2025-07','BME 206','CO','CO1',96.0,'workbook');
insert into stg_att values ('2025-07','BME 206','CO','CO2',94.0,'workbook');
insert into stg_att values ('2025-07','BME 206','CO','CO3',82.0,'workbook');
insert into stg_att values ('2025-07','BME 206','PO','PO5',94.0,'workbook');
insert into stg_car values ('2025-07','BME 206','Teachers’ comment on attainment: All the course outcomes (COs) mapped to this course were achieved by 100% of students. The overall attainment is highly satisfactory, with all assessed outcomes surpassing the attainment threshold of 40%.
Interpretation of student feedback: N/A
Teachers’ comment on teaching learning: Can be more interactive, with more real-life applications.','','Major issues: None
Plan for future actions for further improvement:
Based on the current course delivery and outcome assessment, the following actions are recommended to further enhance the alignment and effectiveness of BME 206: Provision of high-performance computers is recommended to ensure the smooth execution of laboratory sessions and computational tasks, Installation of an Uninterruptible Power Supply (UPS) system is necessary to prevent disruptions caused by power outages and to ensure that students'' laboratory activities and assessments are not adversely affected.');
insert into stg_bugs values ('BUGS 26.10.25','2025-10-26','https://buetedu-my.sharepoint.com/:b:/g/personal/shoyadsabur_bme_buet_ac_bd/IQCy_jpgTQFiT5eiZAwUwCoCAa3SOSsoXvVcBvXkXCbvP2o?e=dw7GtT','2025-07','BME 206');
insert into stg_off values ('2025-07','July 2025','BME 207',null,'Introduction to biomaterials: structure and properties of metals, polymers (natural and synthetic), ceramics and glasses, composites.; Machining of biocompatible materials: conventional and nonconventional machining; Fabrication methods: additive manufacturing, spinning, particle synthesis, hydrogel. Characterization techniques: scanning electron microscopy, transmission electron microscopy, fourier transform infrared spectroscopy (FTIR), x-ray diffraction (XRD), energy dispersive x-ray spectroscopy (EDS), tensile testing, thermal analysis; Biocompatibility: biomaterials-tissue interaction, wound healing and foreign-body response, blood clotting and blood-biomaterial interaction, protein-biomaterial interaction; Applications of biomaterials.','The course will cover all types of biomaterials and their manufacturing techniques.
Materials characterization technologies will be introduced.
Biocompatibility of biomaterials will be covered.','Bangladesh University of Engineering and Technology
 DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No:			BME 207
Course Title:		Biomaterials
Credit hours:                   3				Contact hours:      3
Level/Term:			2/2
Academic Session: 	2023-2024
Course Teacher(s):
Name | Office/
 Room | Email & Telephone | Class routine
Dr. Muhammad Tarik Arafat | ECE-1023 | tarikarafat@bme.buet.ac.bd
+880 1911 764467 | Saturday:
 09:00 AM-09:50 AM
Sunday:
 09:00 AM-09:50 AM
Wednesday:
 09:00 AM-09:50 AM
Ms. Samina Nishat Binte Akram | ECE-1125 | Samina@bme.buet.ac.bd
+880 1973 730183 | 
Course Contents:
Introduction to biomaterials: structure and properties of metals, polymers (natural and synthetic), ceramics and glasses, composites.; Machining of biocompatible materials: conventional and nonconventional machining; Fabrication methods: additive manufacturing, spinning, particle synthesis, hydrogel. Characterization techniques: scanning electron microscopy, transmission electron microscopy, fourier transform infrared spectroscopy (FTIR), x-ray diffraction (XRD), energy dispersive x-ray spectroscopy (EDS), tensile testing, thermal analysis; Biocompatibility: biomaterials-tissue interaction, wound healing and foreign-body response, blood clotting and blood-biomaterial interaction, protein-biomaterial interaction; Applications of biomaterials.
Course Objectives:
The course will cover all types of biomaterials and their manufacturing techniques.
Materials characterization technologies will be introduced.
Biocompatibility of biomaterials will be covered.

 

Course Outcomes:
Explain the types of biomaterials and their manufacturing methods used in biomedical applications
Examine the advantages and disadvantages of using a biomaterial in a clinical setting
Classify the properties of biomaterials using characterization tools
Apply the knowledge of biocompatibility in using biomaterials
Assessment:
Class participation/Attendance:              10%
Homework Assignment and Quizzes:     20%
Term Final Exam:				70%
Textbooks and References:
Biomaterials Science An Introduction to Materials in Medicine by Buddy D. Ratner, Allan S. Hoffman, Frederick J. Schoen, Jack E. Lemons (4th edition).
Weekly Schedule:
Week | Topics
1 | Introduction to biomaterials: Structure and properties of biomaterials
2 | Introduction to biomaterials: Structure and properties of biomaterials
3 | Introduction to biomaterials:
Types of biomaterials: metals.
Application of metallic biomaterials
4 | Introduction to biomaterials:
Types of biomaterials: metals.
Application of metallic biomaterials
5 | Introduction to biomaterials:
Types of biomaterials: polymer
Application of polymeric biomaterials
Mid Term Break
6 | Introduction to biomaterials:
Types of biomaterials: ceramics,glasses and composites
Types of biomaterials:.
Application of ceramic, glasses and composite biomaterials
7 | Machining of biomaterials:
Analysis of Additive manufacturing technology
Examples of fabrication methodologies
8 | Machining of biomaterials:
Fiber formation techniques
Methods of electrospinning
Examples of fabrication methodologies
Particle synthesis techniques
Preparing hydrogels
Examples of fabrication methodologies
9 | Characterization of biomaterials:
Electron microscopy techniques including scanning electron microscopy (SEM) and transmission electron microscopy (TEM)
Examples of SEM and TEM images
Analysis of SEM and TEM images using Image-J
Fourier transform infrared spectroscopy (FTIR), x-ray diffraction (XRD) and energy dispersive x-ray spectroscopy (EDS)
Examples of FTIR, XRD and EDS
Analysis of FTIR, XRD and EDS using graph plotting softwares
10 | Characterization of biomaterials:
Tensile and compression testing theories and methodologies
Examples of stress-strain graphs
Analysis of tensile testing using graph plotting softwares
11 | Characterization of biomaterials:
Thermal analysis and its methodologies
Examples of thermal graphs (TGA and DSC)
Analysis of thermal graphs using graph plotting softwares
12 | Biocompatibility of biomaterials:
Biomaterials and tissue interaction
Biomaterials and blood interaction
13 | Biocompatibility of biomaterials:
Wound healing and foreign body response
Blood clotting
Biomaterials and protein interaction
Application of biomaterials.
Prepared by: | 
Name:
 Signature:
Date: | Dr. Muhammad Tarik Arafat
14/06/2026
Name:
 Signature:
Date: | Ms. Samina Nishat Binte Akram
14/06/2026','[{"name": "Dr. Md. Tarik Arafat", "room": "ECE-1121", "email": "sbshuvo@bme.buet.ac.bd"}, {"name": "Samina Nishat Binte Akram", "room": "ECE-1125", "email": "tasnia@bme.buet.ac.bd"}]'::jsonb,'[{"component": "Class participation/Attendance", "percent": 10.0}, {"component": "Homework Assignment and Quizzes", "percent": 20.0}, {"component": "Term Final Exam", "percent": 70.0}]'::jsonb,'[]'::jsonb,'{"folder": "1 - Course Files/L2T2/BME 207 course file/July 2025", "files": {"co_po_mapping": "July 2025/CO-PO Mapping.docx", "outline": "July 2025/BME 207_Course Outline.docx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 207\nCourse Title: | Biomaterials\nLevel, Term and Section | 2/2, Section A1, A2\nAcademic Term | July 2025\nTextbooks used: | 1.Biomaterials Science : An Introduction to Materials in Medicine by Buddy D. Ratner, Allan S. Hoffman, Frederick J. Schoen, Jack E. Lemons (4th edition)\n2. William D. Callister, David G. Rethwisch-Materials Science and Engineering_ An Introduction-Wiley (2013)\nLast term when the course was offered | \nPart B. Attainment for current and previous terms\nJuly 2025\nCO1 | CO2 | CO3 | CO4 | CO5 | CO6 | CO7 | CO8 | CO9 | CO10 | CO11 | CO12\n83.67 | 93.88 | 85.71 | 91.84 | NA | NA | NA | NA | NA | NA | NA | NA\nY | Y | Y | Y | NA | NA | NA | NA | NA | NA | NA | NA\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\n95.92 | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA\nY | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA\nJanuary 2025\nNot available\nPart C. Analysis\nTeachers’ comment on attainment: Attainment is satisfactory.\nInterpretation of student feedback: N/A\nTeachers’ comment on teaching learning: Current teaching learning process is optimized for the course type and load\nPart D. Comments on CQI implemented based on last assessment\nN/A\nPart E. Recommendation\nMajor issues: N/A\nPlan for future actions for further improvement:\nNeeds a more comprehensive approach to biomaterials, with introduction of newer biomaterials as well\nAddition of presentations as an assessment criterion, a more assignment-based approach will be good as well.\nSignature(s):\nName: Dr. M Tarik Arafat | Name: Ms. Samina Nishat Binte Akram\nSignature: | Signature:"}'::jsonb,array['No item-to-CO mapping found (no CO-PO assessment workbook, or an unrecognised layout)']::text[],true,false);
insert into stg_co values ('2025-07','BME 207',1,'Explain the types of biomaterials and their manufacturing methods used in biomedical applications',array['C2']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],array['K1','K2','K3','K4','P1']::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 207',2,'Examine the advantages and disadvantages of using a biomaterial in a clinical setting',array['C4']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],array['K1','K2','K3','K4','P1']::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 207',3,'Classify the properties of biomaterials using characterization tools',array['C2']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],array['K1','K2','K3','K4','P1']::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 207',4,'Apply the knowledge of biocompatibility in using biomaterials',array['C3']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],array['K1','K2','K3','K4','P1']::text[],array['PO1']::text[]);
insert into stg_att values ('2025-07','BME 207','CO','CO1',83.67,'car');
insert into stg_att values ('2025-07','BME 207','CO','CO2',93.88,'car');
insert into stg_att values ('2025-07','BME 207','CO','CO3',85.71,'car');
insert into stg_att values ('2025-07','BME 207','CO','CO4',91.84,'car');
insert into stg_att values ('2025-07','BME 207','PO','PO1',95.92,'car');
insert into stg_car values ('2025-07','BME 207','Teachers’ comment on attainment: Attainment is satisfactory.
Interpretation of student feedback: N/A
Teachers’ comment on teaching learning: Current teaching learning process is optimized for the course type and load','','Major issues: N/A
Plan for future actions for further improvement:
Needs a more comprehensive approach to biomaterials, with introduction of newer biomaterials as well
Addition of presentations as an assessment criterion, a more assignment-based approach will be good as well.');
insert into stg_off values ('2025-07','July 2025','BME 208',null,'Experiments based on BME 207.','The course will provide hands-on experience on synthesizing different biomaterials
Characterizing biomaterials for various properties will be introduced
Students will learn how the properties of biomaterials will change depending on the surrounding environment or condition
Safety in a wet lab will be covered','Bangladesh University of Engineering and Technology
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No:			BME 208
Course Title:		Biomaterials Sessional
Credit hours:		1.5				Contact hours:	3
Level/Term:			2/2
Academic Session: 	2024-2025
Course Teacher(s):
Name | Office/ Room | Email & Telephone | Class routine
Ms. Samina Nishat Binte Akram | ECE-1123 | samina@bme.buet.ac.bd
+88001973730183 | Monday:
2:00 PM-5:00 PM
Wednesday:
11:00 AM-2:00 PM
Ms. Srija Sarker Anannya | ECE-1013 | srija@bme.buet.ac.bd
+8801787151545 | 
Ms. Chaity Chakraborty | ECE-1013 | chaity@bme.buet.ac.bd
+8801782754675 | 
Course Contents:
Experiments based on BME 207.
Course Objectives:
The course will provide hands-on experience on synthesizing different biomaterials
Characterizing biomaterials for various properties will be introduced
Students will learn how the properties of biomaterials will change depending on the surrounding environment or condition
Safety in a wet lab will be covered
Course Outcomes:
Synthesis of different biomaterials and analysis of their characteristics
Evaluate the use of a biomaterial based on their properties under specific conditions/Project
Demonstrate safety and precautionary steps and accuracy while working in a wet lab
Assessment:
Lab Report:		                                 10%
Continuous Assessment:	                      30%
Paper Presentation:				25%
Lab Quiz:		                                35%
Total:	                                                     100%
Textbooks and References:
A Laboratory Course in Biomaterials by Wujing Xian
A Manual for Biomaterials_Scaffold Fabrication Technology by Gilson Khang, Moon Suk Kim, Hai Bang Lee
Biomaterials Science An Introduction to Materials in Medicine by Buddy D. Ratner, Allan S. Hoffman, Frederick J. Schoen, Jack E. Lemons (4th edition).
Weekly Schedule:
Week | Topics
1 | Introduction to the Lab:
-Safety training in a biomaterials lab
- Introduction to basic instruments and imaging techniques in a biomaterials lab
2 | Metallic Nanoparticle synthesis via chemical routes​:
- FeO nanoparticle synthesis via chemical route​
- Dextran coated NP synthesis
3 | Synthesis and visualization of nanofiber matrix via electrospinning​
4 | Study of corrosion of metallic implants by weight loss method
5 | Study of corrosion of metallic implants by weight loss method
6 | To estimate the hemocompatibility properties of biomaterials by hemolysis studies​
7 | Study of swelling, degradation and drug release of polymeric hydrogels
8 | Surface microstructural characterization of biomaterials
9 | Biomaterials based composite synthesis and its mechanical characterization
10 | Extraction of DNA and observation through spectrophotometer/ gel electrophoresis​
11 | Lab Quiz
12 | Paper presentation
Prepared by: | 
Name:
Signature:
Date: | Ms. Samina Nishat Binte Akram
Name:
Signature:
Date: | Ms. Srija Sarker Anannya
Name:
Signature:
Date: | Ms. Chaity Chakraborty','[{"name": "Ms. Samina Nishat Binte Akram", "room": "ECE-1123", "email": "samina@bme.buet.ac.bd"}, {"name": "Ms. Srija Sarker Anannya", "room": "ECE-1013", "email": "srija@bme.buet.ac.bd"}, {"name": "Ms. Chaity Chakraborty", "room": "ECE-1013", "email": "chaity@bme.buet.ac.bd"}]'::jsonb,'[{"component": "Class Participation", "percent": 10.0}, {"component": "Continuous Assessment_Viva", "percent": 10.0}, {"component": "Continuous Assessment_Quiz", "percent": 20.0}, {"component": "Paper Presentation", "percent": 25.0}, {"component": "Lab Quiz", "percent": 35.0}]'::jsonb,'[{"component": "Lab Report", "weight": 0.1, "marks": 15}, {"component": "Continuous Assessment_Viva", "weight": 0.1, "marks": 15}, {"component": "Continuous Assessment_Lab test", "weight": 0.2, "marks": 30}, {"component": "Paper Presentation", "weight": 0.25, "marks": 37.5}, {"component": "Final Quiz", "weight": 0.35, "marks": 52.5}, {"component": "Total", "weight": 1, "marks": 150}]'::jsonb,'{"folder": "1 - Course Files/L2T2/BME 208 Course File/July 2025", "files": {"co_po_mapping": "July 2025/CO-PO Mapping.docx", "outline": "July 2025/BME 208_Course outline.docx", "assessment_workbook": "July 2025/Assessments and scripts/BME 208-CO-PO-Assessment-Marks.xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 208\nCourse Title: | Biomaterials Sessional\nLevel, Term and Section | 2/2\nAcademic Term | July 2025\nTextbooks used: | A Laboratory Course in Biomaterials by Wujing Xian\nA Manual for Biomaterials_Scaffold Fabrication Technology by Gilson Khang, Moon Suk Kim, Hai Bang Lee\nBiomaterials Science An Introduction to Materials in Medicine by Buddy D. Ratner, Allan S. Hoffman, Frederick J. Schoen, Jack E. Lemons (4th edition).\nLast term when the course was offered | January 2024\nPart B. Attainment for current and previous terms\nCurrent term: July 2025\n(From the excel worksheet)\nCO1 | CO2 | CO3 | CO4 | CO5 | CO6 | CO7 | CO8 | CO9 | CO10 | CO11 | CO12\n92 | 94 | 96 | NA | NA | NA | NA | NA | NA | NA | NA | NA\nY | Y | Y | NA | NA | NA | NA | NA | NA | NA | NA | NA\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\nNA | 94 | NA | NA | 92 | 96 | NA | NA | NA | NA | NA | NA\nNA | Y | NA | NA | Y | Y | NA | NA | NA | NA | NA | NA\nPrevious term:  Not available\nPart C. Analysis\nTeachers’ comment on attainment: The overall attainment is satisfactory, with all assessed outcomes surpassing the attainment threshold of 40%.\nInterpretation of student feedback: N/A\nTeachers’ comment on teaching learning: N/A\nPart D. Comments on CQI implemented based on last assessment\nThe course outcomes were streamlined to better reflect the integrated nature of biomaterials laboratory activities. The CO-PO and KPA mappings were revised to ensure alignment with the actual competencies developed through the course. Greater emphasis was placed on laboratory reports, continuous assessment, and scientific presentations to improve the validity and reliability of outcome assessment. Assessment methods and learning activities were aligned with the intended cognitive and practical skill levels addressed by the course.\nPart E. Recommendation\nMajor issues: None\nPlan for future actions for further improvement: None\nSignature(s):\nName: Ms. Samina Nishat Binte Akram | Name: Ms. Srija Sarker Anannya | Name: Ms. Chaity Chakraborty\nSignature: | Signature: | Signature:"}'::jsonb,array['No K/P/A matrix in CO-PO mapping doc']::text[],true,true);
insert into stg_co values ('2025-07','BME 208',1,'Synthesis of different biomaterials and analysis of their characteristics',array['PS1','C3']::text[],array['Demonstration of Experiments','Hands-on Group Activities','Lectures']::text[],array['Continuous Assessment','Lab Report','Final Quiz']::text[],'{}'::text[],array['PO5']::text[]);
insert into stg_co values ('2025-07','BME 208',2,'Evaluate the use of a biomaterial based on their properties under specific conditions/Project',array['C5']::text[],array['Lectures']::text[],array['Paper Presentation']::text[],'{}'::text[],array['PO2']::text[]);
insert into stg_co values ('2025-07','BME 208',3,'Demonstrate safety and precautionary steps and accuracy while working in a wet-lab',array['C2']::text[],array['Demonstration of Experiments','Lectures']::text[],array['Continuous Assessment']::text[],'{}'::text[],array['PO6']::text[]);
insert into stg_crit values ('2025-07','BME 208',0,'Lab Report','Synthesis of different biomaterials and analysis of their characteristics',15,array['CO1']::text[]);
insert into stg_crit values ('2025-07','BME 208',1,'CA_Viva','Evaluate the use of a biomaterial based on their properties under specific conditions/Project',15,array['CO2']::text[]);
insert into stg_crit values ('2025-07','BME 208',2,'CA_Lab test','Demonstrate safety and precautionary steps and accuracy while working in a wet-lab',30,array['CO3']::text[]);
insert into stg_crit values ('2025-07','BME 208',3,'Paper Presentation','Evaluate the use of a biomaterial based on their properties under specific conditions/Project',37.5,array['CO2']::text[]);
insert into stg_crit values ('2025-07','BME 208',4,'Final Quiz','Synthesis of different biomaterials and analysis of their characteristics',52.5,array['CO1']::text[]);
insert into stg_att values ('2025-07','BME 208','CO','CO1',92.0,'workbook');
insert into stg_att values ('2025-07','BME 208','CO','CO2',94.0,'workbook');
insert into stg_att values ('2025-07','BME 208','CO','CO3',96.0,'workbook');
insert into stg_att values ('2025-07','BME 208','PO','PO2',94.0,'workbook');
insert into stg_att values ('2025-07','BME 208','PO','PO5',92.0,'workbook');
insert into stg_att values ('2025-07','BME 208','PO','PO6',96.0,'workbook');
insert into stg_car values ('2025-07','BME 208','Teachers’ comment on attainment: The overall attainment is satisfactory, with all assessed outcomes surpassing the attainment threshold of 40%.
Interpretation of student feedback: N/A
Teachers’ comment on teaching learning: N/A','The course outcomes were streamlined to better reflect the integrated nature of biomaterials laboratory activities. The CO-PO and KPA mappings were revised to ensure alignment with the actual competencies developed through the course. Greater emphasis was placed on laboratory reports, continuous assessment, and scientific presentations to improve the validity and reliability of outcome assessment. Assessment methods and learning activities were aligned with the intended cognitive and practical skill levels addressed by the course.','');
insert into stg_bugs values ('BUGS 26.10.25','2025-10-26','https://buetedu-my.sharepoint.com/:b:/g/personal/shoyadsabur_bme_buet_ac_bd/IQCy_jpgTQFiT5eiZAwUwCoCAa3SOSsoXvVcBvXkXCbvP2o?e=dw7GtT','2025-07','BME 208');
insert into stg_off values ('2025-07','July 2025','BME 210',null,'Laboratory on numerical techniques using computer solutions of differentiation and integration problems, solving a system of linear equations, curve fitting, Numerical solution of linear and nonlinear ordinary differential equations: Runge- Kutta method; Numerical solution of partial differential equations: finite difference method; Optimization','The course will enable students to:
Master basic techniques and algorithms for solving a wide range of numerical problems encountered in biomedical engineering.
Approximate, optimize, interpolate, and fit a function using various numerical methods
Solve a large system of linear algebraic equations using direct and iterative numerical methods.
Solve differential equations that occur in many branches of biomedical engineering
Acquire software and programming skills for scientific and engineering computations.','Bangladesh University of Engineering and Technology
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No:		BME 210
Course Title:	Numerical Techniques Sessional
Credit hours:		0.75						Contact hours:	1.5
Level/Term:		2/2
Academic Session: 	2023-2024
Course Teacher(s):
Name | Office/Room | Email & Telephone | Class routine
Shoyad Ibn Sabur Khan Nuhash | ECE 1017 | shoyadsabur@bme.buet.ac.bd
+8801515212213 | Saturday (A1):
02:00 PM-05:00 PM Tuesday (A2):
02:00 PM-05:00 PM
Md. Tazuddin Ahmed | ECE 1123 | mdtuahmed@bme.buet.ac.bd
+8801797091595 | Saturday (A1):
02:00 PM-05:00 PM Tuesday (A2):
02:00 PM-05:00 PM
Sayeed Sajjad Razin | ECE 1121 | razin@bme.buet.ac.bd
+8801844453637 | Saturday (A1):
02:00 PM-05:00 PM Tuesday (A2):
02:00 PM-05:00 PM
Course Contents:
Laboratory on numerical techniques using computer solutions of differentiation and integration problems, solving a system of linear equations, curve fitting, Numerical solution of linear and nonlinear ordinary differential equations: Runge- Kutta method; Numerical solution of partial differential equations: finite difference method; Optimization
Course Objectives:
The course will enable students to:
Master basic techniques and algorithms for solving a wide range of numerical problems encountered in biomedical engineering.
Approximate, optimize, interpolate, and fit a function using various numerical methods
Solve a large system of linear algebraic equations using direct and iterative numerical methods.
Solve differential equations that occur in many branches of biomedical engineering
Acquire software and programming skills for scientific and engineering computations.
Course Outcomes:
Apply numerical techniques in pre-specified problems
Solve problems relating to numerical techniques
Assessment:
Class Participation and Continuous Assessment	40%
Lab Test	30%
Lab Quiz	30%
Textbooks and References:
J. H. Mathews and K. D. Fink, Numerical Methods using MATLAB, 4th edition, Upper Saddle River, NJ: Pearson prentice hall (2004).
D. M. Etter, Engineering problem solving with MATLAB, 2nd edition, Prentice-Hall, Inc. (1997).
E. Balagurusamy, Numerical Methods, 4th Reprint, Tata McGraw-Hill, Inc.
G. Shanker Rao, Numerical Analysis, 2nd edition, New Age International (P) Limited.
S. Chapra  R. Canale, Numerical Methods for Engineers, 6th edition, McGraw Hill.
Weekly Schedule:
Lecture | Topics
1 | Introduction to MATLAB  Numerical Methods
Taylor series approximation
Interpolation
Linear and Polynomial interpolation
Curve Fitting
Least square and Linear ​regression
2 | Systems of Linear Equations and Linear Programming
Backslash and pseudo-inverse operator
Gauss-Jordan Elimination and Pivoting
Gauss-Seidel Iterative Method
3 | Numerical Differentiation
Forward difference formula; central difference formula,
Error analysis
Richardson’s Extrapolation
4 | Numerical Integration
Trapezoidal rule, Simpson methods,
Adaptive Integration
5 | Solutions to Ordinary Differential Equations
Euler’s method ​
Improved Euler''s method
Initial value problem; Boundary value problem
Taylor series method; Runge-Kutta method ​
The midpoint method; Ralston’s method; linear shooting method
6 | Partial Differential Equation ​
Finite difference method, finite element method (FEM) ​
Explicit method, implicit method
Elliptic equation: Laplacian difference equation
7 | Optimization ​
Existence, uniqueness, conditioning; Optimality conditions
Local and global optimal; ascent-based methods
Newton''s method; golden section method; successive parabolic interpolation
8 | Lab Test (CO-1)
9 | Lab Quiz (CO-2)
Prepared by:
Name:
Signature:
Date: | Shoyad Ibn Sabur Khan Nuhash
Name:
Signature:
Date: | Md. Tazuddin Ahmed
Name:
Signature:
Date: | Sayeed Sajjad Razin','[{"name": "Shoyad Ibn Sabur Khan Nuhash", "room": "ECE 1017", "email": "shoyadsabur@bme.buet.ac.bd"}, {"name": "Md. Tazuddin Ahmed", "room": "ECE 1123", "email": "mdtuahmed@bme.buet.ac.bd"}, {"name": "Sayeed Sajjad Razin", "room": "ECE 1121", "email": "razin@bme.buet.ac.bd"}]'::jsonb,'[{"component": "Class Participation and Continuous Assessment", "percent": 40.0}, {"component": "Lab Test", "percent": 30.0}, {"component": "Lab Quiz", "percent": 30.0}]'::jsonb,'[]'::jsonb,'{"folder": "1 - Course Files/L2T2/BME 210 Course Files/July 2025", "files": {"co_po_mapping": "July 2025/CO-PO Mapping.docx", "outline": "July 2025/BME 210_Course outline.docx", "assessment_workbook": "July 2025/Assessments and scripts/BME 210-CO-PO-Assessment-marks.xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 210\nCourse Title: | Numerical Techniques Sessional\nLevel, Term and Section | 2/2\nAcademic Term | July 2025\nTextbooks used: | J. H. Mathews and K. D. Fink, Numerical Methods using MATLAB, 4th edition, Upper Saddle River, NJ: Pearson prentice hall (2004).\nD. M. Etter, Engineering problem solving with MATLAB, 2nd edition, Prentice-Hall, Inc. (1997).\nE. Balagurusamy, Numerical Methods, 4th Reprint, Tata McGraw-Hill, Inc.\nG. Shanker Rao, Numerical Analysis, 2nd edition, New Age International (P) Limited.\nS. Chapra  R. Canale, Numerical Methods for Engineers, 6th edition, McGraw Hill.\nLast term when the course was offered | January 2025\nPart B. Attainment for current and previous terms\nJuly 2025:\nCO1 | CO2\n79.59% | 91.84%\nY | Y\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\n91.84% | N/A | N/A | N/A | 79.59% | N/A | N/A | N/A | N/A | N/A | N/A | N/A\nY | N/A | N/A | N/A | Y | N/A | N/A | N/A | N/A | N/A | N/A | N/A\nJanuary 2025:\nNot Available\nPart C. Analysis\nTeachers’ comment on attainment: Satisfactory\nInterpretation of student feedback: Satisfactory\nTeachers’ comment on teaching learning: Active participation of students was observed.\nPart D. Comments on CQI implemented based on last assessment\nMarks distribution and CO-PO mapping were updated on this term upon discussion on the feedback mentioned in the previous CAR.\nPart E. Recommendation\nMajor issues: None\nPlan for future actions for further improvement: A major time in the lab is spent on teaching theory. A theory course or some other arrangement for the theoretical background may be useful.\nSignature(s):\nName: Shoyad Ibn Sabur Khan Nuhash | Name: Md. Tazuddin Ahmed | Name: Sayeed Sajjad Razin\nSignature: | Signature: | Signature:"}'::jsonb,array['No K/P/A matrix in CO-PO mapping doc']::text[],true,true);
insert into stg_co values ('2025-07','BME 210',1,'Apply numerical techniques in pre-specified problems',array['C3','PS2']::text[],array['Lectures','Coding Tasks','Homework']::text[],array['Lab Test','Continuous Assessment']::text[],'{}'::text[],array['PO5']::text[]);
insert into stg_co values ('2025-07','BME 210',2,'Solve problems relating to numerical techniques',array['C3']::text[],array['Lectures','Homework']::text[],array['Lab Quiz','Continuous Assessment']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_crit values ('2025-07','BME 210',0,'Lab Test','Apply numerical techniques in pre-specified problems',22.5,array['CO1']::text[]);
insert into stg_crit values ('2025-07','BME 210',1,'Continuous Assessment','Apply numerical techniques in pre-specified problems',15,array['CO1']::text[]);
insert into stg_crit values ('2025-07','BME 210',2,'Continuous Assessment','Solve problems relating to numerical techniques',15,array['CO2']::text[]);
insert into stg_crit values ('2025-07','BME 210',3,'Lab Quiz','Solve problems relating to numerical techniques',22.5,array['CO2']::text[]);
insert into stg_att values ('2025-07','BME 210','CO','CO1',79.59,'workbook');
insert into stg_att values ('2025-07','BME 210','CO','CO2',91.84,'workbook');
insert into stg_att values ('2025-07','BME 210','PO','PO1',91.84,'workbook');
insert into stg_att values ('2025-07','BME 210','PO','PO5',79.59,'workbook');
insert into stg_car values ('2025-07','BME 210','Teachers’ comment on attainment: Satisfactory
Interpretation of student feedback: Satisfactory
Teachers’ comment on teaching learning: Active participation of students was observed.','Marks distribution and CO-PO mapping were updated on this term upon discussion on the feedback mentioned in the previous CAR.','Major issues: None
Plan for future actions for further improvement: A major time in the lab is spent on teaching theory. A theory course or some other arrangement for the theoretical background may be useful.');
insert into stg_bugs values ('BUGS 26.10.25','2025-10-26','https://buetedu-my.sharepoint.com/:b:/g/personal/shoyadsabur_bme_buet_ac_bd/IQCy_jpgTQFiT5eiZAwUwCoCAa3SOSsoXvVcBvXkXCbvP2o?e=dw7GtT','2025-07','BME 210');
insert into stg_off values ('2025-07','July 2025','BME 211',null,'Introduction to Bioelectricity and Excitable Cells; Bioelectric potentials and currents: ionic composition of excitable cells, Nernst-Planck equation, membrane structure, Nernst potential, parallel-conductance model; Membrane channels: channel structure, biophysical methods for measuring channel properties, macroscopic channel kinetics, channel statistics, introduction to the Hodgkin-Huxley membrane model; Action potentials: observing action potentials, nonlinear membrane behavior, origin of action potential, resting and peak voltages, voltage and space clamp, Hodgkin-Huxley equations, simulation of membrane action potential, action potential characteristics, active transport, calcium channels and "other" membrane models; Impulse propagation: core-conductor model, cable equations, local circuit currents during propagation, mathematics of propagating action potentials, propagation velocity constraint for uniform fiber, propagation in myelinated nerve fibers; Electrical stimulation of excitable tissue: linear (subthreshold) response of a single spherical cells, linear (subthreshold) response of a cylindrical fiber; Cardiac electrophysiology: electrical nature of intercellular communication, source models, ECG measurement and analysis; The Neuromuscular junction: structure of the neuromuscular junction, evidence for the quantal nature of transmitter release, Poisson statistics for transmitter release, the effect of Ca2+ and Mg2+ on transmitter release, post-junctional response to transmitter; Skeletal muscle: muscle structure, muscle contraction, structure of the myofibril, sliding filament theory, Excitation-contraction, EMG measurement and analysis; Neural electrophysiology: structure of the nervous system, sensory transducers and neurons, neural synapses, excitation and inhibition, neural coding and computation, EEG measurement and analysis, brain-computer interfaces; Functional electrical stimulation: electrodes and electrode-tissue behavior, nerve excitation; Recent advancements in Bioelectricity.','The course will enable students to model the membrane of an excitable cell and cellular phenomena
The course will help the students to learn fundamental knowledge of bio-signal generation and propagation
The course will enable the students to analyze design characteristics and parameters of electrical stimulation
The course will demonstrate state-of-the-art research applications correlating different diseases and conditions relevant to bioelectricity','Bangladesh University of Engineering and Technology
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No:			BME 211
Course Title:		Bioelectricity
Credit hours:		3				Contact hours:	3
Level/Term:			2/2
Academic Session: 	2023-2024
Course Teacher(s):
Name | Office/Room | Email | Class routine
Samiul Based Shuvo | ECE-1121 | sbshuvo@bme.buet.ac.bd
+880 1521258181 | Sunday:
09:00 AM-09:50 AM
Monday:
09:00 AM-09:50 AM
Tuesday:
12:00 PM-12:50 PM
Tasnia Binte Mamun | ECE-1123 | tasnia@bme.buet.ac.bd
+880 1677-900345 | 
Course Contents:
Introduction to Bioelectricity and Excitable Cells; Bioelectric potentials and currents: ionic composition of excitable cells, Nernst-Planck equation, membrane structure, Nernst potential, parallel-conductance model; Membrane channels: channel structure, biophysical methods for measuring channel properties, macroscopic channel kinetics, channel statistics, introduction to the Hodgkin-Huxley membrane model; Action potentials: observing action potentials, nonlinear membrane behavior, origin of action potential, resting and peak voltages, voltage and space clamp, Hodgkin-Huxley equations, simulation of membrane action potential, action potential characteristics, active transport, calcium channels and "other" membrane models; Impulse propagation: core-conductor model, cable equations, local circuit currents during propagation, mathematics of propagating action potentials, propagation velocity constraint for uniform fiber, propagation in myelinated nerve fibers; Electrical stimulation of excitable tissue: linear (subthreshold) response of a single spherical cells, linear (subthreshold) response of a cylindrical fiber; Cardiac electrophysiology: electrical nature of intercellular communication, source models, ECG measurement and analysis; The Neuromuscular junction: structure of the neuromuscular junction, evidence for the quantal nature of transmitter release, Poisson statistics for transmitter release, the effect of Ca2+ and Mg2+ on transmitter release, post-junctional response to transmitter; Skeletal muscle: muscle structure, muscle contraction, structure of the myofibril, sliding filament theory, Excitation-contraction, EMG measurement and analysis; Neural electrophysiology: structure of the nervous system, sensory transducers and neurons, neural synapses, excitation and inhibition, neural coding and computation, EEG measurement and analysis, brain-computer interfaces; Functional electrical stimulation: electrodes and electrode-tissue behavior, nerve excitation; Recent advancements in Bioelectricity.
Course Objectives:
The course will enable students to model the membrane of an excitable cell and cellular phenomena
The course will help the students to learn fundamental knowledge of bio-signal generation and propagation
The course will enable the students to analyze design characteristics and parameters of electrical stimulation
The course will demonstrate state-of-the-art research applications correlating different diseases and conditions relevant to bioelectricity
Course Outcomes:
Understand the fundamental basis of bioelectric phenomena and bio-signal generation
Investigate characteristics of membrane/channels/ cellular phenomena by constructing appropriate mathematical models
Analyze the generation and propagation of surface electrical potentials
Construct bioelectrical system that meets specified requirements
Assessment:
Class participation/Attendance:		10%
Homework Assignment and Quizzes:	20%
Term Final Exam:				70%
Textbooks and References:
R. Plonsey and R. C. Barr, “Bioelectricity: A Quantitative Approach,” 3rd Edition, Springer, 2007.
D. Johnston and S. M.-S. Wu, “Foundations of cellular neurophysiology,” MIT Press, 1994.
R. M. Gulrajani, “Bioelectricity and Biomagnetism,” John Wiley &. Sons, Inc. New York, 1998.
C. Koch, “Biophysics of Computation: Information Processing in Single Neurons,” Oxford University Press, 1998.
J. Feher, “Quantitative Human Physiology: An Introduction”, 2nd Edition, Elsevier, 2017.
D. Silverthorn, “Human Physiology: An Integrated Approach”, 7th Edition, Pearson, 2016.
Weekly Schedule:
Week | Topics
1 | Introduction to bioelectricity and excitable cells. Basic biophysical concepts: sources and fields. Current applications, future trends, and challenges of bioelectricity.Skeletal muscle: Muscle structure; muscle contraction; structure of the myofibril; Sliding filament theory, Excitation-contraction.
2 | The neuromuscular junction: Structure of the neuromuscular junction; Evidence for the quantal nature of transmitter release, Poisson statistics for transmitter release, the effect of Ca2+ and Mg2+ on transmitter release, Parallel-Conductance Model of Postsynaptic Membrane; post-junctional response to transmitter.
3 | EMG measurement and analysis; EMG-controlled movement of prosthetic hand/foot. Cardiac electrophysiology: Electrical nature of intercellular communication; gap-junctional structure, functional continuity and resistance, Cardiac cellular models, idealized temporal and spatial cardiac action potential waveforms.
4 | ECG measurement and analysis; Neural electrophysiology: Structure of the nervous system; sensory vs motor neurons; Neural coding and computation
5 | Neural electrophysiology: Origin of EEG; EEG measurement and analysis; Brain-computer interface (BCI)
Mid-term break
6 | Functional electrical stimulation: Electrodes and electrode-tissue behavior; electrode material and types; Electrode operating characteristics; nerve excitation; Different types of stimulation based on application and corresponding waveforms.
7 | Analysis of electrode performance and criteria for satisfactory performance. Recent advancements in Bioelectricity: Pain reducing and rehabilitation; Emotion recognition; cognitive study; sleep disorder and seizure analysis. Synthetic speech generation from EEG; gesture/eye movement/EEG-controlled movement of prosthetic hand/foot.
8 | Bioelectric potentials and currents: Ionic composition of excitable cells; ionic flux; diffusion and Fick’s Law; Ionic mobility, conductance and conductivity; Einstein equation; Nernst-Planck equation; Nernst potential.
9 | Bioelectric potentials and currents: Membrane structure and properties; Single-ion permeability: concentration cell, Transmembrane potential and currents, Nernst Equilibrium; Modeling membrane characteristics: Parallel-conductance model; chloride contribution; effect of sudden reduction in external chloride concentration.
10 | Membrane channels:  Channel structure and types; selective permeability; active and passive transport through channels; Channel gating: Boltzmann distribution; Biophysical methods for measuring channel properties: Patch-clamp configurations, workflow and considerations for its fair use ; Macroscopic channel kinetics; channel statistics; Introduction to the Hodgkin-Huxley membrane model.
11 | Action potentials: Origin of action potential; resting and peak voltages; action potential characteristics; Voltage and space clamp techniques for action potential measurement; Recording action potential: noteworthy attributes; Hodgkin-Huxley equations; Nonlinear membrane behavior; mathematical model and equations for Na, K; Simulation of membrane action potential.
12 | Impulse propagation: Core-conductor model; cable equations; Local circuit currents during propagation, propagation in myelinated nerve fibers; Mathematics and simulation of propagating action potentials; Propagation velocity constraint for uniform fiber.
13 | Electrical stimulation of excitable tissue: Crucial simulation parameters; strength-duration curve; Linear(subthreshold) response of a single spherical cell; Linear(subthreshold) response of a cylindrical fiber; fiber equations.
Prepared by: | 
Name:
Signature:
Date: | Tasnia Binte Mamun
Name:
Signature:
Date: | Samiul Based Shuvo','[{"name": "Samiul Based Shuvo", "room": "ECE-1121", "email": "sbshuvo@bme.buet.ac.bd"}, {"name": "Tasnia Binte Mamun", "room": "ECE-1123", "email": "tasnia@bme.buet.ac.bd"}]'::jsonb,'[{"component": "Class participation/Attendance", "percent": 10.0}, {"component": "Continuous Assessment", "percent": 20.0}, {"component": "Term Final", "percent": 70.0}]'::jsonb,'[]'::jsonb,'{"folder": "1 - Course Files/L2T2/BME 211 Course File/July 2025", "files": {"co_po_mapping": "July 2025/CO-PO Mapping.docx", "outline": "July 2025/BME 211_Course outline.docx", "assessment_workbook": "July 2025/Assessments and scripts/BME 211-CO-PO-Assessment-marks.xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 211\nCourse Title: | Bioelectricity\nLevel, Term and Section | 2/2\nAcademic Term | July 2025\nTextbooks used: | R. Plonsey and R. C. Barr, “Bioelectricity: A Quantitative Approach,” 3rd Edition, Springer, 2007.\nD. Johnston and S. M.-S. Wu, “Foundations of cellular neurophysiology,” MIT Press, 1994.\nR. M. Gulrajani, “Bioelectricity and Biomagnetism,” John Wiley &. Sons, Inc. New York, 1998.\nC. Koch, “Biophysics of Computation: Information Processing in Single Neurons,” Oxford University Press, 1998.\nJ. Feher, “Quantitative Human Physiology: An Introduction”, 2nd Edition, Elsevier, 2017.\nD. Silverthorn, “Human Physiology: An Integrated Approach”, 7th Edition, Pearson, 2016.\nLast term when the course was offered | January 2024\nPart B. Attainment for current and previous terms\nJuly 2025\nCO1 | CO2 | CO3 | CO4 | CO5 | CO6 | CO7 | CO8 | CO9 | CO10 | CO11 | CO12\n77.55 | 97.96 | 75.5 | 83.67 | NA | NA | NA | NA | NA | NA | NA | NA\nY | Y | Y | Y | NA | NA | NA | NA | NA | NA | NA | NA\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\n89.80 | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA\nY | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA\nPrevious term:\nNot available\nPart C. Analysis\nTeachers’ comment on attainment: CO1 and CO3 attainments need improvement.\nInterpretation of student feedback: N/A\nTeachers’ comment on teaching learning: For continuous assessment, coding-based problems can be incorporated with class tests.\nPart D. Comments on CQI implemented based on last assessment\nN/A\nPart E. Recommendation\nMajor issues: None\nPlan for future actions for further improvement: None\nSignature(s):\nName: Samiul Based Shuvo | Name: Tasnia Binte Mamun\nSignature: | Signature:"}'::jsonb,array['No K/P/A matrix in CO-PO mapping doc']::text[],true,true);
insert into stg_co values ('2025-07','BME 211',1,'Understand the fundamental basis of bioelectric phenomena and bio-signal generation',array['C2']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 211',2,'Investigate characteristics of membrane/channels/ cellular phenomena by constructing appropriate mathematical models',array['C4']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 211',3,'Analyze the generation and propagation of surface electrical potentials',array['C4']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 211',4,'Construct bioelectrical system that meets specified requirements',array['C3']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_crit values ('2025-07','BME 211',0,'Term Final','Q01 (a)',15,array['CO1']::text[]);
insert into stg_crit values ('2025-07','BME 211',1,'Term Final','Q01 (b)',20,array['CO4']::text[]);
insert into stg_crit values ('2025-07','BME 211',2,'Term Final','Q01 (c)',10,array['CO3']::text[]);
insert into stg_crit values ('2025-07','BME 211',3,'Term Final','Q05 (a)',20,array['CO2']::text[]);
insert into stg_crit values ('2025-07','BME 211',4,'Term Final','Q05 (b)',25,array['CO3']::text[]);
insert into stg_att values ('2025-07','BME 211','CO','CO1',77.55,'workbook');
insert into stg_att values ('2025-07','BME 211','CO','CO2',97.96,'workbook');
insert into stg_att values ('2025-07','BME 211','CO','CO3',75.51,'workbook');
insert into stg_att values ('2025-07','BME 211','CO','CO4',83.67,'workbook');
insert into stg_att values ('2025-07','BME 211','PO','PO1',89.8,'workbook');
insert into stg_car values ('2025-07','BME 211','Teachers’ comment on attainment: CO1 and CO3 attainments need improvement.
Interpretation of student feedback: N/A
Teachers’ comment on teaching learning: For continuous assessment, coding-based problems can be incorporated with class tests.','','');
insert into stg_off values ('2022-07','July 2022','BME 300','BME 19',null,'This course will introduce undergraduate students to the fundamental methodology of biomedical engineering design
Students will interact with medical professionals to identify and assess clinical needs
The course will involve students in the concept generation of a medical device and develop a demonstrable prototype
Students will become familiar with the ethical principles, regulatory framework, and other concepts.','Bangladesh University of Engineering and Technology
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No:			BME 300
Course Title:		Biomedical Engineering Design II
Credit hours:		3				Contact hours:	3
Level/Term:			3/1
Academic Session: 	2021-2022
Course Teacher(s):
Name | Office/Room | Email | Class routine
Md. Kawsar Ahmed | ECE-1018 | kawsarahmed@bme.buet.ac.bd
+1 (434) 882-5397 | Saturday:
11:00 AM-1:30 PM
Shoyad Ibn Sabur Khan Nuhash | ECE-1018 | shoyadsabur@bme.buet.ac.bd
+880 1515212213 | 
Taufiq Hasan Aneem | ECE-1018 | taufiqhaneem@bme.buet.ac.bd
+880 1742-134695 | 
Wahidur Rahman Rafsan | ECE-1018 | wahidurrahman@bme.buet.ac.bd
+8801611518006 | 
Samiul Based Shuvo | ECE-1018 | sbshuvo@bme.buet.ac.bd
+ 880 1521-258181 | 
Shams Nafisa Ali | ECE-1019 | nafisa@bme.buet.ac.bd
+880 1731-953973 | 
Course Objectives:
This course will introduce undergraduate students to the fundamental methodology of biomedical engineering design
Students will interact with medical professionals to identify and assess clinical needs
The course will involve students in the concept generation of a medical device and develop a demonstrable prototype
Students will become familiar with the ethical principles, regulatory framework, and other concepts.
Course Outcomes:
Assess clinical needs identified through systematic observations made in a relevant healthcare setting
Create a conceptual design according to feasibility considering clinical, social, cultural, and environmental factors
Estimate the cost of developing a prototype considering component expenses and manufacturing
Develop a working prototype medical device based on the technical specifications of a design concept
Display the ability to function within a multidisciplinary team
Demonstrate ethical practices standards in case of dealing with clinical/patient data
Show effective communication skills within and outside the team
Assessment:
Continuous Assessment 	10%
Presentation			30%
Demonstration			40%
Final Report			20%
Assessment Strategy
Continuous Assessment: Continuous assessment through assigned tasks by the supervisor. The scheme of the continuous assessment for the course will be decided by the supervisor, which may include presentations, demonstrations or written assignments.
Presentation: Presentation will be given by the student on the design work conducted within the course period.
Demonstration: Demonstrations will be given by the student on the design work conducted within the course period.
Report: A final report is required to be submitted on the design project.
Textbooks and References:
Paul, Stefanos A. Zenios Josh Makower, and G. Yock. "Biodesign: The Process Of Innovating Medical Technologies."
Ogrodnik, Peter J. Medical device design: innovation from concept to market. Academic Press, 2019.
Yazdi, Youseph, and Soumyadipta Acharya. "A new model for graduate education and innovation in medical technology." Annals of Biomedical Engineering 41.9 (2013): 1822-1833.
Bos, Gert. "ISO 13485: 2003/2016—Medical Devices—Quality Management Systems—Requirements for Regulatory Purposes." Handbook of Medical Device Regulatory Affairs in Asia. Pan Stanford, 2018. 153-174. (Sec 7.3)
Weekly Schedule:
Week# | Lecture Topics
1 | Identify clinical needs
- 	Observations in healthcare setting
- 	Disease state fundamentals
- 	Problem identification
2 | Analysis of existing solutions
- 	Treatment options and pathways
- 	Market analysis
3 | Assess the identified clinical needs
- 	Compare the clinical needs based on potential impact
- 	Need statement development
4 | Create a set of conceptual designs and continuous assessment
- 	Ideation and brainstorming
- 	Concept screening
5 | Create a set of conceptual designs and continuous assessment
- 	Ideation and brainstorming
- 	Concept screening
6 | Evaluate conceptual designs and continuous assessment
- 	Intellectual property basics
- 	Reimbursement basics
- 	Concept exploring and testing
7 | Evaluate conceptual designs and continuous assessment
- 	Intellectual property basics
- 	Reimbursement basics
- 	Concept exploring and testing
- 	Final concept selection
8 | Final concept presentation
9 | Develop a working prototype and continuous assessment
- 	Material selection
- 	Prototyping
- 	Trial and error
10 | Develop a working prototype and continuous assessment
- 	Material selection
- 	Prototyping
- 	Trial and error
11 | Develop a working prototype and continuous assessment
- 	Material selection
- 	Prototyping
- 	Trial and error
12 | Develop a working prototype and continuous assessment
- 	Material selection
- 	Prototyping
- 	Trial and error
13 | Final Presentation
14 | Project demonstration and report submission','[{"name": "Md. Kawsar Ahmed", "room": "ECE-1018", "email": "kawsarahmed@bme.buet.ac.bd"}, {"name": "Shoyad Ibn Sabur Khan Nuhash", "room": "ECE-1018", "email": "shoyadsabur@bme.buet.ac.bd"}, {"name": "Taufiq Hasan Aneem", "room": "ECE-1018", "email": "taufiqhaneem@bme.buet.ac.bd"}, {"name": "Wahidur Rahman Rafsan", "room": "ECE-1018", "email": "wahidurrahman@bme.buet.ac.bd"}, {"name": "Samiul Based Shuvo", "room": "ECE-1018", "email": "sbshuvo@bme.buet.ac.bd"}, {"name": "Shams Nafisa Ali", "room": "ECE-1019", "email": "nafisa@bme.buet.ac.bd"}]'::jsonb,'[]'::jsonb,'[{"component": "Continuous Assessment", "weight": 0.1, "marks": 15}, {"component": "Presentations", "weight": 0.3, "marks": 45}, {"component": "Demonstrations", "weight": 0.4, "marks": 60}, {"component": "Final Report", "weight": 0.2, "marks": 30}]'::jsonb,'{"folder": "1 - Course Files/L3T1/BME 300 Course File/July 2022", "files": {"co_po_mapping": "July 2022/CO-PO mapping.docx", "outline": "July 2022/BME 300 Course Outline.docx", "assessment_workbook": "July 2022/Assessments and Scripts/BME 300-CO-PO-Assessment Marks-Jul-22 (BME19).xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 300\nCourse Title: | Biomedical Engineering Design I\nLevel, Term and Section | 3/1\nAcademic Term | July 2022\nTextbooks used: | Paul, Stefanos A. Zenios Josh Makower, and G. Yock. \"Biodesign: The Process of Innovating Medical Technologies.\"\nOgrodnik, Peter J. Medical device design: innovation from concept to market. Academic Press, 2019.\nYazdi, Youseph, and Soumyadipta Acharya. \"A new model for graduate education and innovation in medical technology.\" Annals of Biomedical Engineering 41.9 (2013): 1822-1833.\nBos, Gert. \"ISO 13485: 2003/2016—Medical Devices—Quality Management Systems—Requirements for Regulatory Purposes.\" Handbook of Medical Device Regulatory Affairs in Asia. Pan Stanford, 2018. 153-174. (Sec 7.3)\nLast term when the course was offered | July 2021\nPart B. Attainment for current and previous terms\nCurrent term:\n(From the excel worksheet)\nCO1 | CO2 | CO3 | CO4 | CO5 | CO6 | CO7 | CO8 | CO9 | CO10 | CO11 | CO12\n100 | 100 | 100 | 100 | 100 | 100 | 100 | NA | NA | NA | NA | NA\nY | Y | Y | Y | Y | Y | Y | NA | NA | NA | NA | NA\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\nNA | 100 | 100 | NA | 100 | NA | NA | 100 | 100 | 100 | 100 | NA\nNA | Y | Y | NA | Y | NA | NA | Y | Y | Y | Y | NA\nPrevious term: Not available\nPart C. Analysis\nTeachers’ comment on attainment: All the course outcomes (COs) mapped to this course were achieved by 100% of students. The overall attainment is satisfactory, with all assessed outcomes surpassing the attainment threshold of 40%.\nInterpretation of student feedback: N/A\nTeachers’ comment on teaching learning: The current structure effectively facilitates student engagement in design-based learning. However, in future iterations, increased exposure to field observations and stakeholder interaction is recommended to further strengthen design contextualization and real-world applicability.\nPart D. Comments on CQI implemented based on last assessment\nThe assessment tools, delivery methods, and marks distribution were revised based on the feedback from the course teachers obtained through CAR (course assessment report) and deliberations within the BUGS meeting.\nPart E. Recommendation\nMajor issues: None\nPlan for future actions for further improvement:\nIncorporation of new CO: While the design projects naturally involve societal, health, safety, legal, and cultural considerations, there are currently no dedicated course outcomes that explicitly address these aspects. It is recommended that a CO be added in future offerings to ensure these important dimensions are formally incorporated and assessed, in alignment with OBE and accreditation expectations.\nSignature(s):\nName: Mr. Kawsar Ahmed | Mr. Shoyad Ibn Sabur Khan Nuhash | Name: Ms. Shams Nafisa Ali | Name: Mr. Samiul Based Shuvo\nSignature: | Signature: | Signature: | Signature:"}'::jsonb,'{}'::text[],true,true);
insert into stg_co values ('2022-07','BME 300',1,'Assess clinical needs identified through systematic observations made in a relevant healthcare setting',array['C4']::text[],array['Lectures','Hospital visits']::text[],array['Presentations']::text[],array['K1','K2','K3','K4']::text[],array['PO2']::text[]);
insert into stg_co values ('2022-07','BME 300',2,'Create a conceptual design according to feasibility considering clinical, social, cultural, and environmental factors',array['C6']::text[],array['Lectures']::text[],array['Presentations','Demonstration']::text[],array['K5','K6','K8','P1','P2','P3','P6','P7']::text[],array['PO3']::text[]);
insert into stg_co values ('2022-07','BME 300',3,'Estimate the cost of developing a prototype considering component expenses and manufacturing',array['C4']::text[],array['Lectures']::text[],array['Presentations','Reports']::text[],array['K2']::text[],array['PO11']::text[]);
insert into stg_co values ('2022-07','BME 300',4,'Develop a working prototype medical device based on the technical specifications of a design concept',array['C6','PS3']::text[],array['Lectures']::text[],array['Demonstration','Presentations']::text[],array['K3','K4','K5','K6','P1','P2','P3']::text[],array['PO5']::text[]);
insert into stg_co values ('2022-07','BME 300',5,'Display the ability to function within a multidisciplinary team',array['AF3']::text[],array['Lectures','Discussion']::text[],array['Continuous Assessment']::text[],array['K7']::text[],array['PO9']::text[]);
insert into stg_co values ('2022-07','BME 300',6,'Demonstrate ethical practices standards in case of dealing with clinical/patient data',array['AF3']::text[],array['Lectures','Discussion']::text[],array['Demonstration','Reports']::text[],array['K7']::text[],array['PO8']::text[]);
insert into stg_co values ('2022-07','BME 300',7,'Show effective communication skills within and outside the team',array['AF3']::text[],array['Lectures','Discussion']::text[],array['Presentations','Demonstration','Reports']::text[],array['A1','A2','A3']::text[],array['PO10']::text[]);
insert into stg_crit values ('2022-07','BME 300',0,'Presentation 01','Clinical Need Identification',7.5,array['CO1']::text[]);
insert into stg_crit values ('2022-07','BME 300',1,'Presentation 01','Initial Solution Concepts',2.5,array['CO2']::text[]);
insert into stg_crit values ('2022-07','BME 300',2,'Presentation 01','Proposed Design Solution: Methodology',2.5,array['CO2']::text[]);
insert into stg_crit values ('2022-07','BME 300',3,'Presentation 01','Proposed Design Solution: Feasibility',2.5,array['CO2']::text[]);
insert into stg_crit values ('2022-07','BME 300',4,'Presentation 01','Cost Estimation / Resource Planning',2.5,array['CO3']::text[]);
insert into stg_crit values ('2022-07','BME 300',5,'Presentation 01','Presentation Skills',2.5,array['CO7']::text[]);
insert into stg_crit values ('2022-07','BME 300',6,'Presentation 01','Participation in QnA',2.5,array['CO7']::text[]);
insert into stg_crit values ('2022-07','BME 300',7,'Demo 01','Prototype Design: Feasibility',20,array['CO2']::text[]);
insert into stg_crit values ('2022-07','BME 300',8,'Demo 01','Prototype Design: Technical Soundness and Functionality',10,array['CO4']::text[]);
insert into stg_crit values ('2022-07','BME 300',9,'Presentation 02','Problem Statement',2,array['CO7']::text[]);
insert into stg_crit values ('2022-07','BME 300',10,'Presentation 02','Design Specification (Aim & Objevtive)',2,array['CO4']::text[]);
insert into stg_crit values ('2022-07','BME 300',11,'Presentation 02','Design Implementation',3.5,array['CO4']::text[]);
insert into stg_crit values ('2022-07','BME 300',12,'Presentation 02','Performance Evaluation',2,array['CO4']::text[]);
insert into stg_crit values ('2022-07','BME 300',13,'Presentation 02','Novelty',2,array['CO7']::text[]);
insert into stg_crit values ('2022-07','BME 300',14,'Presentation 02','Cost & Financial Analysis',5,array['CO3']::text[]);
insert into stg_crit values ('2022-07','BME 300',15,'Presentation 02','Further Directions/ Recommendations',2,array['CO7']::text[]);
insert into stg_crit values ('2022-07','BME 300',16,'Presentation 02','Presentation Skills',2,array['CO7']::text[]);
insert into stg_crit values ('2022-07','BME 300',17,'Presentation 02','Participation in QnA',2,array['CO7']::text[]);
insert into stg_crit values ('2022-07','BME 300',18,'Demo 02','Design Requirement',5,array['CO4']::text[]);
insert into stg_crit values ('2022-07','BME 300',19,'Demo 02','Design Accomplishment',5,array['CO4']::text[]);
insert into stg_crit values ('2022-07','BME 300',20,'Demo 02','Result Analysis and Design Verification',10,array['CO4']::text[]);
insert into stg_crit values ('2022-07','BME 300',21,'Demo 02','Adherence to Ethical Practices/Codes',5,array['CO6']::text[]);
insert into stg_crit values ('2022-07','BME 300',22,'Demo 02','Poster',5,array['CO7']::text[]);
insert into stg_crit values ('2022-07','BME 300',23,'Report','Introduction to Problem',3,array['CO7']::text[]);
insert into stg_crit values ('2022-07','BME 300',24,'Report','Background and Literature Review',3,array['CO7']::text[]);
insert into stg_crit values ('2022-07','BME 300',25,'Report','Effective Presentation of Methodology',6,array['CO7']::text[]);
insert into stg_crit values ('2022-07','BME 300',26,'Report','Adherence to Ethical Practices/Codes',6,array['CO6']::text[]);
insert into stg_crit values ('2022-07','BME 300',27,'Report','Financial Analysis',6,array['CO3']::text[]);
insert into stg_crit values ('2022-07','BME 300',28,'Report','Overall Formatting',6,array['CO7']::text[]);
insert into stg_att values ('2022-07','BME 300','CO','CO1',100.0,'car');
insert into stg_att values ('2022-07','BME 300','CO','CO2',100.0,'car');
insert into stg_att values ('2022-07','BME 300','CO','CO3',100.0,'car');
insert into stg_att values ('2022-07','BME 300','CO','CO4',100.0,'car');
insert into stg_att values ('2022-07','BME 300','CO','CO5',100.0,'car');
insert into stg_att values ('2022-07','BME 300','CO','CO6',100.0,'car');
insert into stg_att values ('2022-07','BME 300','CO','CO7',100.0,'car');
insert into stg_att values ('2022-07','BME 300','PO','PO2',100.0,'car');
insert into stg_att values ('2022-07','BME 300','PO','PO3',100.0,'car');
insert into stg_att values ('2022-07','BME 300','PO','PO5',100.0,'car');
insert into stg_att values ('2022-07','BME 300','PO','PO8',100.0,'car');
insert into stg_att values ('2022-07','BME 300','PO','PO9',100.0,'car');
insert into stg_att values ('2022-07','BME 300','PO','PO10',100.0,'car');
insert into stg_att values ('2022-07','BME 300','PO','PO11',100.0,'car');
insert into stg_car values ('2022-07','BME 300','Teachers’ comment on attainment: All the course outcomes (COs) mapped to this course were achieved by 100% of students. The overall attainment is satisfactory, with all assessed outcomes surpassing the attainment threshold of 40%.
Interpretation of student feedback: N/A
Teachers’ comment on teaching learning: The current structure effectively facilitates student engagement in design-based learning. However, in future iterations, increased exposure to field observations and stakeholder interaction is recommended to further strengthen design contextualization and real-world applicability.','The assessment tools, delivery methods, and marks distribution were revised based on the feedback from the course teachers obtained through CAR (course assessment report) and deliberations within the BUGS meeting.','Major issues: None
Plan for future actions for further improvement:
Incorporation of new CO: While the design projects naturally involve societal, health, safety, legal, and cultural considerations, there are currently no dedicated course outcomes that explicitly address these aspects. It is recommended that a CO be added in future offerings to ensure these important dimensions are formally incorporated and assessed, in alignment with OBE and accreditation expectations.');
insert into stg_bugs values ('BUGS 9.11.22','2022-11-09','https://buetedu-my.sharepoint.com/:b:/g/personal/shoyadsabur_bme_buet_ac_bd/IQBctxESJ4c_RKEYNgUiBb9iAZ0fUSxjZaR0qQE2-3-GzLA?e=qY3FUo','2022-07','BME 300');
insert into stg_off values ('2023-07','July 2023','BME 300','BME 20',null,'This course will introduce undergraduate students to the fundamental methodology of biomedical engineering design
Students will interact with medical professionals to identify and assess clinical needs
The course will involve students in the concept generation of a medical device and develop a demonstrable prototype
Students will become familiar with the ethical principles, regulatory framework, and other concepts.','Bangladesh University of Engineering and Technology
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No:			BME 300
Course Title:		Biomedical Engineering Design II
Credit hours:		3				Contact hours:	3
Level/Term:			3/1
Academic Session: 	2022-2023
Course Teacher(s):
Name | Office/Room | Email | Class routine
Md. Kawsar Ahmed | ECE-1018 | kawsarahmed@bme.buet.ac.bd
+1 (434) 882-5397 | Saturday:
11:00 AM-1:30 PM
Shoyad Ibn Sabur Khan Nuhash | ECE-1018 | shoyadsabur@bme.buet.ac.bd
+880 1515212213 | 
Taufiq Hasan Aneem | ECE-1018 | taufiqhaneem@bme.buet.ac.bd
+880 1742-134695 | 
Wahidur Rahman Rafsan | ECE-1018 | wahidurrahman@bme.buet.ac.bd
+8801611518006 | 
Samiul Based Shuvo | ECE-1018 | sbshuvo@bme.buet.ac.bd
+ 880 1521-258181 | 
Shams Nafisa Ali | ECE-1019 | nafisa@bme.buet.ac.bd
+880 1731-953973 | 
Course Objectives:
This course will introduce undergraduate students to the fundamental methodology of biomedical engineering design
Students will interact with medical professionals to identify and assess clinical needs
The course will involve students in the concept generation of a medical device and develop a demonstrable prototype
Students will become familiar with the ethical principles, regulatory framework, and other concepts.
Course Outcomes:
Assess clinical needs identified through systematic observations made in a relevant healthcare setting
Create a conceptual design according to feasibility considering clinical, social, cultural, and environmental factors
Estimate the cost of developing a prototype considering component expenses and manufacturing
Develop a working prototype medical device based on the technical specifications of a design concept
Display the ability to function within a multidisciplinary team
Demonstrate ethical practices standards in case of dealing with clinical/patient data
Show effective communication skills within and outside the team
Assessment:
Continuous Assessment 	10%
Presentation			30%
Demonstration			40%
Final Report			20%
Assessment Strategy
Continuous Assessment: Continuous assessment through assigned tasks by the supervisor. The scheme of the continuous assessment for the course will be decided by the supervisor, which may include presentations, demonstrations or written assignments.
Presentation: Presentation will be given by the student on the design work conducted within the course period.
Demonstration: Demonstrations will be given by the student on the design work conducted within the course period.
Report: A final report is required to be submitted on the design project.
Textbooks and References:
Paul, Stefanos A. Zenios Josh Makower, and G. Yock. "Biodesign: The Process Of Innovating Medical Technologies.": The Process Of Innovating Medical Technologies."
Ogrodnik, Peter J. Medical device design: innovation from concept to market. Academic Press, 2019.
Yazdi, Youseph, and Soumyadipta Acharya. "A new model for graduate education and innovation in medical technology." Annals of Biomedical Engineering 41.9 (2013): 1822-1833.
Bos, Gert. "ISO 13485: 2003/2016—Medical Devices—Quality Management Systems—Requirements for Regulatory Purposes." Handbook of Medical Device Regulatory Affairs in Asia. Pan Stanford, 2018. 153-174. (Sec 7.3)
Weekly Schedule:
Week# | Lecture Topics
1 | Identify clinical needs
- 	Observations in healthcare setting
- 	Disease state fundamentals
- 	Problem identification
2 | Analysis of existing solutions
- 	Treatment options and pathways
- 	Market analysis
3 | Assess the identified clinical needs
- 	Compare the clinical needs based on potential impact
- 	Need statement development
4 | Create a set of conceptual designs and continuous assessment
- 	Ideation and brainstorming
- 	Concept screening
5 | Create a set of conceptual designs and continuous assessment
- 	Ideation and brainstorming
- 	Concept screening
6 | Evaluate conceptual designs and continuous assessment
- 	Intellectual property basics
- 	Reimbursement basics
- 	Concept exploring and testing
7 | Evaluate conceptual designs and continuous assessment
- 	Intellectual property basics
- 	Reimbursement basics
- 	Concept exploring and testing
- 	Final concept selection
8 | Final concept presentation
9 | Develop a working prototype and continuous assessment
- 	Material selection
- 	Prototyping
- 	Trial and error
10 | Develop a working prototype and continuous assessment
- 	Material selection
- 	Prototyping
- 	Trial and error
11 | Develop a working prototype and continuous assessment
- 	Material selection
- 	Prototyping
- 	Trial and error
12 | Develop a working prototype and continuous assessment
- 	Material selection
- 	Prototyping
- 	Trial and error
13 | Final Presentation
14 | Project demonstration and report submission','[{"name": "Md. Kawsar Ahmed", "room": "ECE-1018", "email": "kawsarahmed@bme.buet.ac.bd"}, {"name": "Shoyad Ibn Sabur Khan Nuhash", "room": "ECE-1018", "email": "shoyadsabur@bme.buet.ac.bd"}, {"name": "Taufiq Hasan Aneem", "room": "ECE-1018", "email": "taufiqhaneem@bme.buet.ac.bd"}, {"name": "Wahidur Rahman Rafsan", "room": "ECE-1018", "email": "wahidurrahman@bme.buet.ac.bd"}, {"name": "Samiul Based Shuvo", "room": "ECE-1018", "email": "sbshuvo@bme.buet.ac.bd"}, {"name": "Shams Nafisa Ali", "room": "ECE-1019", "email": "nafisa@bme.buet.ac.bd"}]'::jsonb,'[]'::jsonb,'[{"component": "Continuous Assessment", "weight": 0.1, "marks": 15}, {"component": "Presentations", "weight": 0.3, "marks": 45}, {"component": "Demonstrations", "weight": 0.4, "marks": 60}, {"component": "Final Report", "weight": 0.2, "marks": 30}]'::jsonb,'{"folder": "1 - Course Files/L3T1/BME 300 Course File/July 2023", "files": {"co_po_mapping": "July 2023/CO-PO mapping.docx", "outline": "July 2023/BME 300 Course Outline.docx", "assessment_workbook": "July 2023/Assessments and Scripts/BME 300_CO-PO-Assessments-Jul-23 (BME20).xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 300\nCourse Title: | Biomedical Engineering Design I\nLevel, Term and Section | 3/1\nAcademic Term | July 2023\nTextbooks used: | Paul, Stefanos A. Zenios Josh Makower, and G. Yock. \"Biodesign: The Process of Innovating Medical Technologies.\"\nOgrodnik, Peter J. Medical device design: innovation from concept to market. Academic Press, 2019.\nYazdi, Youseph, and Soumyadipta Acharya. \"A new model for graduate education and innovation in medical technology.\" Annals of Biomedical Engineering 41.9 (2013): 1822-1833.\nBos, Gert. \"ISO 13485: 2003/2016—Medical Devices—Quality Management Systems—Requirements for Regulatory Purposes.\" Handbook of Medical Device Regulatory Affairs in Asia. Pan Stanford, 2018. 153-174. (Sec 7.3)\nLast term when the course was offered | July 2022\nPart B. Attainment for current and previous terms\nCurrent term:\n(From the excel worksheet)\nCO1 | CO2 | CO3 | CO4 | CO5 | CO6 | CO7 | CO8 | CO9 | CO10 | CO11 | CO12\n100 | 100 | 100 | 100 | 100 | 100 | 100 | NA | NA | NA | NA | NA\nY | Y | Y | Y | Y | Y | Y | NA | NA | NA | NA | NA\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\nNA | 100 | 100 | NA | 100 | NA | NA | 100 | 100 | 100 | 100 | NA\nNA | Y | Y | NA | Y | NA | NA | Y | Y | Y | Y | NA\nPrevious term:\nCO1 | CO2 | CO3 | CO4 | CO5 | CO6 | CO7 | CO8 | CO9 | CO10 | CO11 | CO12\n100 | 100 | 100 | 100 | 100 | 100 | 100 | NA | NA | NA | NA | NA\nY | Y | Y | Y | Y | Y | Y | NA | NA | NA | NA | NA\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\nNA | 100 | 100 | NA | 100 | NA | NA | 100 | 100 | 100 | 100 | NA\nNA | Y | Y | NA | Y | NA | NA | Y | Y | Y | Y | NA\nPart C. Analysis\nTeachers’ comment on attainment: All the course outcomes (COs) mapped to this course were achieved by 100% of students. The overall attainment is satisfactory, with all assessed outcomes surpassing the attainment threshold of 40%.\nInterpretation of student feedback: N/A\nTeachers’ comment on teaching learning: The current structure effectively facilitates student engagement in design-based learning.\nPart D. Comments on CQI implemented based on last assessment\nN/A\nPart E. Recommendation\nMajor issues: None\nPlan for future actions for further improvement:\nIt is recommended that a CO be added in future offerings to ensure these important dimensions are formally incorporated and assessed, in alignment with OBE and accreditation expectations.\nIntegration of CEP Assessment Tools: To strengthen the evidence of attainment for complex engineering competencies, it is recommended that,\nA Complex Engineering Problems (CEP) Assessment Form be introduced and filled out once the design project topic has been finalized. This will help verify that the chosen design problems meet the criteria for complexity as per accreditation standards, from both the students'' and instructors'' perspectives.\nSignature(s):\nName: Mr. Kawsar Ahmed | Mr. Shoyad Ibn Sabur Khan Nuhash | Name: Ms. Shams Nafisa Ali | Name: Mr. Samiul Based Shuvo\nSignature: | Signature: | Signature: | Signature:"}'::jsonb,'{}'::text[],true,true);
insert into stg_co values ('2023-07','BME 300',1,'Assess clinical needs identified through systematic observations made in a relevant healthcare setting',array['C4']::text[],array['Lectures','Hospital visits']::text[],array['Presentations']::text[],array['K1','K2','K3','K4']::text[],array['PO2']::text[]);
insert into stg_co values ('2023-07','BME 300',2,'Create a conceptual design according to feasibility considering clinical, social, cultural, and environmental factors',array['C6']::text[],array['Lectures']::text[],array['Presentations','Demonstration']::text[],array['K5','K6','K8','P1','P2','P3','P6','P7']::text[],array['PO3']::text[]);
insert into stg_co values ('2023-07','BME 300',3,'Estimate the cost of developing a prototype considering component expenses and manufacturing',array['C4']::text[],array['Lectures']::text[],array['Presentations','Reports']::text[],array['K2']::text[],array['PO11']::text[]);
insert into stg_co values ('2023-07','BME 300',4,'Develop a working prototype medical device based on the technical specifications of a design concept',array['C6','PS3']::text[],array['Lectures']::text[],array['Demonstration','Presentations']::text[],array['K3','K4','K5','K6','P1','P2','P3']::text[],array['PO5']::text[]);
insert into stg_co values ('2023-07','BME 300',5,'Display the ability to function within a multidisciplinary team',array['AF3']::text[],array['Lectures','Discussion']::text[],array['Continuous Assessment']::text[],array['K7']::text[],array['PO9']::text[]);
insert into stg_co values ('2023-07','BME 300',6,'Demonstrate ethical practices standards in case of dealing with clinical/patient data',array['AF3']::text[],array['Lectures','Discussion']::text[],array['Demonstration','Reports']::text[],array['K7']::text[],array['PO8']::text[]);
insert into stg_co values ('2023-07','BME 300',7,'Show effective communication skills within and outside the team',array['AF3']::text[],array['Lectures','Discussion']::text[],array['Presentations','Demonstration','Reports']::text[],array['A1','A2','A3']::text[],array['PO10']::text[]);
insert into stg_crit values ('2023-07','BME 300',0,'Presentation 01','Clinical Need Identification',7.5,array['CO1']::text[]);
insert into stg_crit values ('2023-07','BME 300',1,'Presentation 01','Initial Solution Concepts',2.5,array['CO2']::text[]);
insert into stg_crit values ('2023-07','BME 300',2,'Presentation 01','Proposed Design Solution: Methodology',2.5,array['CO2']::text[]);
insert into stg_crit values ('2023-07','BME 300',3,'Presentation 01','Proposed Design Solution: Feasibility',2.5,array['CO2']::text[]);
insert into stg_crit values ('2023-07','BME 300',4,'Presentation 01','Cost Estimation / Resource Planning',2.5,array['CO3']::text[]);
insert into stg_crit values ('2023-07','BME 300',5,'Presentation 01','Presentation Skills',2.5,array['CO7']::text[]);
insert into stg_crit values ('2023-07','BME 300',6,'Presentation 01','Participation in QnA',2.5,array['CO7']::text[]);
insert into stg_crit values ('2023-07','BME 300',7,'Demo 01','Prototype Design: Feasibility',20,array['CO2']::text[]);
insert into stg_crit values ('2023-07','BME 300',8,'Demo 01','Prototype Design: Technical Soundness and Functionality',10,array['CO4']::text[]);
insert into stg_crit values ('2023-07','BME 300',9,'Presentation 02','Problem Statement',2,array['CO7']::text[]);
insert into stg_crit values ('2023-07','BME 300',10,'Presentation 02','Design Specification (Aim & Objevtive)',2,array['CO4']::text[]);
insert into stg_crit values ('2023-07','BME 300',11,'Presentation 02','Design Implementation',3.5,array['CO4']::text[]);
insert into stg_crit values ('2023-07','BME 300',12,'Presentation 02','Performance Evaluation',2,array['CO4']::text[]);
insert into stg_crit values ('2023-07','BME 300',13,'Presentation 02','Novelty',2,array['CO7']::text[]);
insert into stg_crit values ('2023-07','BME 300',14,'Presentation 02','Cost & Financial Analysis',5,array['CO3']::text[]);
insert into stg_crit values ('2023-07','BME 300',15,'Presentation 02','Further Directions/ Recommendations',2,array['CO7']::text[]);
insert into stg_crit values ('2023-07','BME 300',16,'Presentation 02','Presentation Skills',2,array['CO7']::text[]);
insert into stg_crit values ('2023-07','BME 300',17,'Presentation 02','Participation in QnA',2,array['CO7']::text[]);
insert into stg_crit values ('2023-07','BME 300',18,'Demo 02','Design Requirement',5,array['CO4']::text[]);
insert into stg_crit values ('2023-07','BME 300',19,'Demo 02','Design Accomplishment',5,array['CO4']::text[]);
insert into stg_crit values ('2023-07','BME 300',20,'Demo 02','Result Analysis and Design Verification',10,array['CO4']::text[]);
insert into stg_crit values ('2023-07','BME 300',21,'Demo 02','Adherence to Ethical Practices/Codes',5,array['CO6']::text[]);
insert into stg_crit values ('2023-07','BME 300',22,'Demo 02','Poster',5,array['CO7']::text[]);
insert into stg_crit values ('2023-07','BME 300',23,'Report','Introduction to Problem',3,array['CO7']::text[]);
insert into stg_crit values ('2023-07','BME 300',24,'Report','Background and Literature Review',3,array['CO7']::text[]);
insert into stg_crit values ('2023-07','BME 300',25,'Report','Effective Presentation of Methodology',6,array['CO7']::text[]);
insert into stg_crit values ('2023-07','BME 300',26,'Report','Adherence to Ethical Practices/Codes',6,array['CO6']::text[]);
insert into stg_crit values ('2023-07','BME 300',27,'Report','Financial Analysis',6,array['CO3']::text[]);
insert into stg_crit values ('2023-07','BME 300',28,'Report','Overall Formatting',6,array['CO7']::text[]);
insert into stg_att values ('2023-07','BME 300','CO','CO1',100,'workbook');
insert into stg_att values ('2023-07','BME 300','CO','CO2',100,'workbook');
insert into stg_att values ('2023-07','BME 300','CO','CO3',100,'workbook');
insert into stg_att values ('2023-07','BME 300','CO','CO4',100,'workbook');
insert into stg_att values ('2023-07','BME 300','CO','CO5',100,'workbook');
insert into stg_att values ('2023-07','BME 300','CO','CO6',100,'workbook');
insert into stg_att values ('2023-07','BME 300','CO','CO7',100,'workbook');
insert into stg_att values ('2023-07','BME 300','PO','PO2',100,'workbook');
insert into stg_att values ('2023-07','BME 300','PO','PO3',100,'workbook');
insert into stg_att values ('2023-07','BME 300','PO','PO5',100,'workbook');
insert into stg_att values ('2023-07','BME 300','PO','PO8',100,'workbook');
insert into stg_att values ('2023-07','BME 300','PO','PO9',100,'workbook');
insert into stg_att values ('2023-07','BME 300','PO','PO10',100,'workbook');
insert into stg_att values ('2023-07','BME 300','PO','PO11',100,'workbook');
insert into stg_car values ('2023-07','BME 300','Teachers’ comment on attainment: All the course outcomes (COs) mapped to this course were achieved by 100% of students. The overall attainment is satisfactory, with all assessed outcomes surpassing the attainment threshold of 40%.
Interpretation of student feedback: N/A
Teachers’ comment on teaching learning: The current structure effectively facilitates student engagement in design-based learning.','','Major issues: None
Plan for future actions for further improvement:
It is recommended that a CO be added in future offerings to ensure these important dimensions are formally incorporated and assessed, in alignment with OBE and accreditation expectations.
Integration of CEP Assessment Tools: To strengthen the evidence of attainment for complex engineering competencies, it is recommended that,
A Complex Engineering Problems (CEP) Assessment Form be introduced and filled out once the design project topic has been finalized. This will help verify that the chosen design problems meet the criteria for complexity as per accreditation standards, from both the students'' and instructors'' perspectives.');
insert into stg_off values ('2025-01','January 2025','BME 300','BME 21','Integrated design of medical devices following related design considerations, prototyping, and demonstration.','This course will introduce undergraduate students to the fundamental methodology of biomedical engineering design
Students will interact with medical professionals to identify and assess clinical needs
The course will involve students in the concept generation of a medical device and develop a demonstrable prototype
Students will become familiar with the ethical principles, regulatory framework, and other concepts.','Bangladesh University of Engineering and Technology
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No:			BME 300
Course Title:		Biomedical Engineering Design-I
Credit hours:		1.5				Contact hours:	3
Level/Term:			3/1
Academic Session: 	2023-2024
Course Teacher(s):
Name | Office | Contact Info | Class routine
Mr. Shoyad Ibn Sabur Khan Nuhash | ECE 1121 | shoyadsabur@bme.buet.ac.bd
+880 1515-212213 | Saturday (A1)
02:30 PM-05:00 PM
Mr. Samiul Based Shuvo | ECE 1121 | sbshuvo@bme.buet.ac.bd
+880 1521-258181 | 
Ms. Samina Nishat Binte Akram | ECE 1125 | samina@bme.buet.ac.bd
+880 1973-730183 | 
Ms. Srija Sarker Anannya | ECE 1013 | srijasarker2111@gmail.com
1918012@bme.buet.ac.bd
+880 1787-151545 | 
Mr. Shoyad Ibn Sabur Khan Nuhash | ECE 1121 | shoyadsabur@bme.buet.ac.bd
+880 1515-212213 | Sunday (A2)
11:00 AM-01:30 PM
Ms. Shams Nafisa Ali | ECE 1013 | nafisa@bme.buet.ac.bd
+880 1731-953973 | 
Mr. Md. Tazuddin Ahmed Akash | ECE 1123 | mdtuahmed@bme.buet.ac.bd
+880 1797-091595 | 
Mr. Abdullah Al Mamun | ECE 1123 | abdullah@bme.buet.ac.bd
+880 1639-008395 | 
Course Contents:
Integrated design of medical devices following related design considerations, prototyping, and demonstration.
Course Objectives:
This course will introduce undergraduate students to the fundamental methodology of biomedical engineering design
Students will interact with medical professionals to identify and assess clinical needs
The course will involve students in the concept generation of a medical device and develop a demonstrable prototype
Students will become familiar with the ethical principles, regulatory framework, and other concepts.
Course Outcomes:
At the end of this course, students will be able to:
Assess clinical needs identified through systematic observations made in a relevant healthcare setting
Create a conceptual design according to feasibility concerning clinical, social, cultural, and environmental factors
Estimate the cost of developing a prototype considering component expenses and manufacturing
Develop a working prototype medical device based on the technical specifications of a design concept
Display the ability to function within a multidisciplinary team
Demonstrate ethical practices standards in case of dealing with clinical/patient data
Show effective communication skills within and outside the team
Analyze the societal, health, safety, legal, and cultural implications relevant to the design project
Assessment Strategy:
Continuous Assessment: Continuous assessment through assigned tasks by the supervisor. The scheme of the continuous assessment for the course will be decided by the supervisor, which may include presentations or written assignments.
Demonstration: Demonstrations will be given by the student on the design work conducted within the course period.
Presentation: Presentation will be given by the student on the design work conducted within the course period.
Final Report: A final report is required to be submitted on the design project.
Intermediate Submissions: Intermediate submissions from students will include peer review forms, and documentation on clinical needs assessment.
Final Report: A final report is required to be submitted on the design work
Assessment:
Continuous Assessment				10%
	Presentation						25%
Demonstration					40%
	Report						15%
	Intermediate Submissions and Questionnaire	10%
Total							100%
Textbooks and References:
Paul, Stefanos A. Zenios Josh Makower, and G. Yock. "Biodesign: The Process of Innovating Medical Technologies.
Ogrodnik, Peter J. Medical device design: innovation from concept to market. Academic Press, 2019.
Yazdi, Youseph, and Soumyadipta Acharya. "A new model for graduate education and innovation in medical technology." Annals of Biomedical Engineering 41.9 (2013): 1822-1833.
Bos, Gert. "ISO 13485: 2003/2016—Medical Devices—Quality Management Systems—Requirements for Regulatory Purposes." Handbook of Medical Device Regulatory Affairs in Asia. Pan Stanford, 2018. 153-174. (Sec 7.3)
Weekly Schedule:
Week | Topics
1 | Identify clinical needs: Observations in healthcare setting, Disease state fundamentals, Problem identification
2 | Analysis of existing solutions: Treatment options and pathways, Market analysis
3 | Assess the identified clinical needs: Compare the clinical needs based on potential impact, Need statement development
4 | Create a set of conceptual designs and continuous assessment: Ideation and brainstorming, Concept screening
5 | Create a set of conceptual designs and continuous assessment: Ideation and brainstorming, Concept screening
6 | Evaluate conceptual designs and continuous assessment: Intellectual property basics, Reimbursement basics, Concept exploring and testing
7 | Evaluate conceptual designs and continuous assessment: Intellectual property basics, Reimbursement basics, Concept exploring and testing, Final concept selection
Mid Break and Eid Vacation
8 | Final concept presentation
9 | Develop a working prototype and continuous assessment: Material selection, Prototyping, Trial and error
10 | Develop a working prototype and continuous assessment: Material selection, Prototyping, Trial and error
11 | Develop a working prototype and continuous assessment: Material selection, Prototyping, Trial and error
12 | Develop a working prototype and continuous assessment: Material selection, Prototyping, Trial and error
13 | Develop a working prototype and continuous assessment: Material selection, Prototyping, Trial and error
14 | Final Presentation, Demonstration, & Report submission','[{"name": "Mr. Shoyad Ibn Sabur Khan Nuhash", "room": "ECE 1121", "email": "shoyadsabur@bme.buet.ac.bd"}, {"name": "Mr. Samiul Based Shuvo", "room": "ECE 1121", "email": "sbshuvo@bme.buet.ac.bd"}, {"name": "Ms. Samina Nishat Binte Akram", "room": "ECE 1125", "email": "samina@bme.buet.ac.bd"}, {"name": "Ms. Srija Sarker Anannya", "room": "ECE 1013", "email": "srija@bme.buet.ac.bd"}, {"name": "Mr. Shoyad Ibn Sabur Khan Nuhash", "room": "ECE 1121", "email": "shoyadsabur@bme.buet.ac.bd"}, {"name": "Ms. Shams Nafisa Ali", "room": "ECE 1013", "email": "nafisa@bme.buet.ac.bd"}, {"name": "Mr. Md. Tazuddin Ahmed Akash", "room": "ECE 1123", "email": "mdtuahmed@bme.buet.ac.bd"}, {"name": "Mr. Abdullah Al Mamun", "room": "ECE 1123", "email": "abdullah@bme.buet.ac.bd"}]'::jsonb,'[{"component": "Continuous Assessment", "percent": 10.0}, {"component": "Presentation", "percent": 25.0}, {"component": "Demonstration", "percent": 40.0}, {"component": "Report", "percent": 15.0}, {"component": "Intermediate Submissions and Questionnaire", "percent": 10.0}]'::jsonb,'[{"component": "Continuous Assessment", "weight": 0.1, "marks": 15}, {"component": "Initial Presentation", "weight": 0.1, "marks": 15}, {"component": "Final Presentation", "weight": 0.15, "marks": 22.5}, {"component": "Demonstrations", "weight": 0.4, "marks": 60}, {"component": "Final Report", "weight": 0.15, "marks": 22.5}, {"component": "Intermediate Submissions and Questionnaire", "weight": 0.1, "marks": 15}]'::jsonb,'{"folder": "1 - Course Files/L3T1/BME 300 Course File/January 2025", "files": {"co_po_mapping": "January 2025/CO-PO mapping.docx", "outline": "January 2025/BME 300 Course Outline.docx", "assessment_workbook": "January 2025/Assessments and Scripts/BME 300-CO-PO-Assessment Marks-Jan-25 (BME21).xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 300\nCourse Title: | Biomedical Engineering Design I\nLevel, Term and Section | 3/1\nAcademic Term | January 2025\nTextbooks used: | Paul, Stefanos A. Zenios Josh Makower, and G. Yock. \"Biodesign: The Process of Innovating Medical Technologies.\"\nOgrodnik, Peter J. Medical device design: innovation from concept to market. Academic Press, 2019.\nYazdi, Youseph, and Soumyadipta Acharya. \"A new model for graduate education and innovation in medical technology.\" Annals of Biomedical Engineering 41.9 (2013): 1822-1833.\nBos, Gert. \"ISO 13485: 2003/2016—Medical Devices—Quality Management Systems—Requirements for Regulatory Purposes.\" Handbook of Medical Device Regulatory Affairs in Asia. Pan Stanford, 2018. 153-174. (Sec 7.3)\nLast term when the course was offered | July 2023\nPart B. Attainment for current and previous terms\nCurrent term:\n(From the excel worksheet)\nCO1 | CO2 | CO3 | CO4 | CO5 | CO6 | CO7 | CO8 | CO9 | CO10 | CO11 | CO12\n100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | NA | NA | NA | NA\nY | Y | Y | Y | Y | Y | Y | Y | NA | NA | NA | NA\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\nNA | 100 | 100 | NA | 100 | 100 | NA | 100 | 100 | 100 | 100 | NA\nNA | Y | Y | NA | Y | Y | NA | Y | Y | Y | Y | NA\nPrevious term:\nJuly 2023 term\nCO1 | CO2 | CO3 | CO4 | CO5 | CO6 | CO7 | CO8 | CO9 | CO10 | CO11 | CO12\n100 | 100 | 100 | 100 | 100 | 100 | 100 | NA | NA | NA | NA | NA\nY | Y | Y | Y | Y | Y | Y | NA | NA | NA | NA | NA\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\nNA | 100 | 100 | NA | 100 | NA | NA | 100 | 100 | 100 | 100 | NA\nNA | Y | Y | NA | Y | NA | NA | Y | Y | Y | Y | NA\nPart C. Analysis\nTeachers’ comments on attainment: All course outcomes (COs) mapped to this course were successfully attained by 100% of students. The overall attainment level is satisfactory, with all evaluated outcomes exceeding the threshold of 40%.\nInterpretation of student feedback: N/A\nTeachers’ comments on teaching learning: The current course structure effectively promotes student engagement in design-based learning, enabling students to apply engineering concepts through iterative design, problem-solving, and presentation activities.\nPart D. Comments on CQI implemented based on last assessment\nThe addition of CO8, corresponding to PO6, has made the course more comprehensive. Students are now able to analyze societal, health, safety, legal, and cultural implications of their design projects, enhancing the ethical and contextual dimensions of their work.\nThe incorporation of the Complex Engineering Problem (CEP) Assessment Form has strengthened the evaluation process, ensuring that all student projects demonstrably address the attributes of complex engineering problems as defined by BAETE.\nPart E. Recommendation\nMajor issues: None\nPlan for future actions for further improvement:\nIntegration of Additional Program Outcomes (PO1, PO4, PO7, PO12): The current set of course outcomes does not map to PO1, PO4, PO7, and PO12. Incorporating these program outcomes will further enhance the comprehensiveness of the course and broaden the scope of student competencies.\nDocumentation of Continuous and Demonstration-Based Assessments: Although continuous assessment and demonstrations were conducted effectively through in-person evaluations, no physical evidence was retained. \n\nIn future offerings:\nStructured documentary evidence (e.g., evaluation forms, supervisor logs) should be maintained.\nVideo recordings may be used to document design demonstrations.\nSupervisors may maintain weekly journals or structured evaluation sheets to systematically record progress and feedback.\nIntegration of CEA Assessment Tools: To enhance evidence of attainment in Complex Engineering Activities (CEA), it is recommended that a CEA Assessment Form be introduced and completed at the end of each semester. This will ensure systematic evaluation and provide structured feedback on the level, scope, and nature of complex activities undertaken by students.\nSignature(s):\nName: Mr. Shoyad Ibn Sabur Khan Nuhash | Mr. Samiul Based Shuvo | Name: Mr. Md. Tazuddin Ahmed Akash | Name: Mr. Abdullah Al Mamun | Name: Ms. Samina Nishat Binte Akram\nSignature: | Signature: | Signature: | Signature: | Signature:"}'::jsonb,'{}'::text[],true,true);
insert into stg_co values ('2025-01','BME 300',1,'Assess clinical needs identified through systematic observations made in a relevant healthcare setting',array['C4']::text[],array['Lectures','Hospital visits']::text[],array['Presentations','Intermediate Submission']::text[],array['K1','K2','K3','K4','P1','P3','P4']::text[],array['PO2']::text[]);
insert into stg_co values ('2025-01','BME 300',2,'Create a conceptual design according to feasibility considering clinical, social, cultural, and environmental factors',array['C6']::text[],array['Lectures']::text[],array['Presentations','Demonstration']::text[],array['K5','P1','P2','P3','P6','P7']::text[],array['PO3']::text[]);
insert into stg_co values ('2025-01','BME 300',3,'Estimate the cost of developing a prototype considering component expenses and manufacturing',array['C4']::text[],array['Lectures']::text[],array['Presentations','Reports']::text[],'{}'::text[],array['PO11']::text[]);
insert into stg_co values ('2025-01','BME 300',4,'Develop a working prototype medical device based on the technical specifications of a design concept',array['C6','PS3']::text[],array['Lectures']::text[],array['Demonstration','Presentations']::text[],array['K6','P1','P2','P3']::text[],array['PO5']::text[]);
insert into stg_co values ('2025-01','BME 300',5,'Display the ability to function within a multidisciplinary team',array['AF3']::text[],array['Lectures','Discussion']::text[],array['Continuous Assessment','Intermediate Submission']::text[],'{}'::text[],array['PO9']::text[]);
insert into stg_co values ('2025-01','BME 300',6,'Demonstrate ethical practices standards in case of dealing with clinical/patient data',array['AF3']::text[],array['Lectures','Discussion']::text[],array['Demonstration','Reports']::text[],array['K7']::text[],array['PO8']::text[]);
insert into stg_co values ('2025-01','BME 300',7,'Show effective communication skills within and outside the team',array['AF3']::text[],array['Lectures','Discussion']::text[],array['Presentations','Demonstration','Reports']::text[],array['A1','A2','A3']::text[],array['PO10']::text[]);
insert into stg_co values ('2025-01','BME 300',8,'Analyze the societal, health, safety, legal, and cultural implications relevant to the design project',array['C4']::text[],array['Lectures','Discussion']::text[],array['Presentations','Reports']::text[],array['K7','K8','P1','P5','P6']::text[],array['PO6']::text[]);
insert into stg_crit values ('2025-01','BME 300',0,'Continuous Assessment','Continuous Assessment',15,array['CO5']::text[]);
insert into stg_crit values ('2025-01','BME 300',1,'Initial Presentation','Clinical Need Identification',10,array['CO1']::text[]);
insert into stg_crit values ('2025-01','BME 300',2,'Initial Presentation','Initial Solution Concepts',5,array['CO2']::text[]);
insert into stg_crit values ('2025-01','BME 300',3,'Initial Presentation','Proposed Design Solution: Methodology',5,array['CO2']::text[]);
insert into stg_crit values ('2025-01','BME 300',4,'Initial Presentation','Proposed Design Solution: Feasibility',5,array['CO2']::text[]);
insert into stg_crit values ('2025-01','BME 300',5,'Initial Presentation','Cost Estimation & Resource Planning',5,array['CO3']::text[]);
insert into stg_crit values ('2025-01','BME 300',6,'Initial Presentation','Presentation Skills',5,array['CO7']::text[]);
insert into stg_crit values ('2025-01','BME 300',7,'Initial Presentation','Participation in QnA',5,array['CO7']::text[]);
insert into stg_crit values ('2025-01','BME 300',8,'Final Presentation','Final Design Concept',5,array['CO2']::text[]);
insert into stg_crit values ('2025-01','BME 300',9,'Final Presentation','Feasibility of Design Concept',5,array['CO8']::text[]);
insert into stg_crit values ('2025-01','BME 300',10,'Final Presentation','Prototype Development',10,array['CO4']::text[]);
insert into stg_crit values ('2025-01','BME 300',11,'Final Presentation','Ethical Consideration',10,array['CO6']::text[]);
insert into stg_crit values ('2025-01','BME 300',12,'Final Presentation','Cost & Resource Planning',10,array['CO3']::text[]);
insert into stg_crit values ('2025-01','BME 300',13,'Final Presentation','Performance Testing and Evaluation',10,array['CO4']::text[]);
insert into stg_crit values ('2025-01','BME 300',14,'Final Presentation','Communication and Stakeholder Engagement',10,array['CO7']::text[]);
insert into stg_crit values ('2025-01','BME 300',15,'Final Presentation','Societal and Contextual Impact',10,array['CO8']::text[]);
insert into stg_crit values ('2025-01','BME 300',16,'Demonstration','Final Design Concept',5,array['CO2']::text[]);
insert into stg_crit values ('2025-01','BME 300',17,'Demonstration','Feasibility of Design Concept',5,array['CO2']::text[]);
insert into stg_crit values ('2025-01','BME 300',18,'Demonstration','Prototyping and Functionality',10,array['CO4']::text[]);
insert into stg_crit values ('2025-01','BME 300',19,'Demonstration','Alignment with Design Objectives',10,array['CO4']::text[]);
insert into stg_crit values ('2025-01','BME 300',20,'Demonstration','Ethical and Regulatory Compliance',5,array['CO6']::text[]);
insert into stg_crit values ('2025-01','BME 300',21,'Demonstration','Effective Communication (Demo)',10,array['CO7']::text[]);
insert into stg_crit values ('2025-01','BME 300',22,'Demonstration','Effective Communication (Poster)',5,array['CO7']::text[]);
insert into stg_crit values ('2025-01','BME 300',23,'Report','Cost Estimation',5,array['CO3']::text[]);
insert into stg_crit values ('2025-01','BME 300',24,'Report','Cost-Effectiveness',5,array['CO3']::text[]);
insert into stg_crit values ('2025-01','BME 300',25,'Report','Ethical Practices',10,array['CO6']::text[]);
insert into stg_crit values ('2025-01','BME 300',26,'Report','Communication: Report',20,array['CO7']::text[]);
insert into stg_crit values ('2025-01','BME 300',27,'Report','Communication: Within the team',5,array['CO7']::text[]);
insert into stg_crit values ('2025-01','BME 300',28,'Report','Communication: Outside the team',5,array['CO7']::text[]);
insert into stg_crit values ('2025-01','BME 300',29,'Report','Societal, health, safety, legal, and cultural implications',10,array['CO8']::text[]);
insert into stg_crit values ('2025-01','BME 300',30,'Intermediate Submissions','Identification of Clinical Needs',10,array['CO1']::text[]);
insert into stg_crit values ('2025-01','BME 300',31,'Intermediate Submissions','Contribution to Team (Questionnaire)',10,array['CO5']::text[]);
insert into stg_att values ('2025-01','BME 300','CO','CO1',100,'workbook');
insert into stg_att values ('2025-01','BME 300','CO','CO2',100,'workbook');
insert into stg_att values ('2025-01','BME 300','CO','CO3',100,'workbook');
insert into stg_att values ('2025-01','BME 300','CO','CO4',100,'workbook');
insert into stg_att values ('2025-01','BME 300','CO','CO5',100,'workbook');
insert into stg_att values ('2025-01','BME 300','CO','CO6',100,'workbook');
insert into stg_att values ('2025-01','BME 300','CO','CO7',100,'workbook');
insert into stg_att values ('2025-01','BME 300','CO','CO8',100,'workbook');
insert into stg_att values ('2025-01','BME 300','PO','PO2',100,'workbook');
insert into stg_att values ('2025-01','BME 300','PO','PO3',100,'workbook');
insert into stg_att values ('2025-01','BME 300','PO','PO5',100,'workbook');
insert into stg_att values ('2025-01','BME 300','PO','PO6',100,'workbook');
insert into stg_att values ('2025-01','BME 300','PO','PO8',100,'workbook');
insert into stg_att values ('2025-01','BME 300','PO','PO9',100,'workbook');
insert into stg_att values ('2025-01','BME 300','PO','PO10',100,'workbook');
insert into stg_att values ('2025-01','BME 300','PO','PO11',100,'workbook');
insert into stg_car values ('2025-01','BME 300','Teachers’ comments on attainment: All course outcomes (COs) mapped to this course were successfully attained by 100% of students. The overall attainment level is satisfactory, with all evaluated outcomes exceeding the threshold of 40%.
Interpretation of student feedback: N/A
Teachers’ comments on teaching learning: The current course structure effectively promotes student engagement in design-based learning, enabling students to apply engineering concepts through iterative design, problem-solving, and presentation activities.','The addition of CO8, corresponding to PO6, has made the course more comprehensive. Students are now able to analyze societal, health, safety, legal, and cultural implications of their design projects, enhancing the ethical and contextual dimensions of their work.
The incorporation of the Complex Engineering Problem (CEP) Assessment Form has strengthened the evaluation process, ensuring that all student projects demonstrably address the attributes of complex engineering problems as defined by BAETE.','Major issues: None
Plan for future actions for further improvement:
Integration of Additional Program Outcomes (PO1, PO4, PO7, PO12): The current set of course outcomes does not map to PO1, PO4, PO7, and PO12. Incorporating these program outcomes will further enhance the comprehensiveness of the course and broaden the scope of student competencies.
Documentation of Continuous and Demonstration-Based Assessments: Although continuous assessment and demonstrations were conducted effectively through in-person evaluations, no physical evidence was retained.

In future offerings:
Structured documentary evidence (e.g., evaluation forms, supervisor logs) should be maintained.
Video recordings may be used to document design demonstrations.
Supervisors may maintain weekly journals or structured evaluation sheets to systematically record progress and feedback.
Integration of CEA Assessment Tools: To enhance evidence of attainment in Complex Engineering Activities (CEA), it is recommended that a CEA Assessment Form be introduced and completed at the end of each semester. This will ensure systematic evaluation and provide structured feedback on the level, scope, and nature of complex activities undertaken by students.');
insert into stg_bugs values ('BUGS 20.08.04',null,'https://buetedu-my.sharepoint.com/:b:/g/personal/shoyadsabur_bme_buet_ac_bd/IQCI2w1ILQdkS7cz3U_AZ7j8AUiU-wqu9YQ7SHnNHsOdW_o?e=OBhk7N','2025-01','BME 300');
insert into stg_bugs values ('BUGS 09.04.25','2025-04-09','https://buetedu-my.sharepoint.com/:b:/g/personal/shoyadsabur_bme_buet_ac_bd/IQCjIvypYsjBQLUopsrX7yx3AZtJDMIoD-etVNDs3LN3IwY?e=2OdeOt','2025-01','BME 300');
insert into stg_off values ('2025-01','January 2025','BME 303',null,'Basic concepts of medical instrumentation: principles and properties of a medical instrumentation and measurement system; Basic sensors and principles: biophysical parameters, transducers; Biopotential electrodes and amplifiers: polarization, circuit models, interface between skin and electrodes, motion artifacts techniques, grounding, shielding; Body surface potential: EOG, electroretinogram, electrocochleogram; Biosensors: ion selective and immunologically sensitive field effect transistors, non-invasive blood gas monitoring, electronic noses; Cardiovascular measurements: photoplethysmography, arrhythmia monitor, QRS detection techniques, exercise stress testing, cardiotocograph, methods of monitoring fetal heart rate and labour activity; Measurement of respiratory volumes and flow: impedance pneumography; Measurement of pressure, flow and volume of blood: direct measurements and analysis of blood pressure, measurement of system response, bandwidth requirement for measurement, PCG, tonometry, indicator dilution method, electromagnetic flowmeters, ultrasonic flowmeters, thermal convection velocity sensors; Therapeutic and prosthetic devices: ventilator, inhaler, defibrillator, pacemaker, neural simulator, respirator, heart lung machine; Clinical laboratory instrumentation: electrophoresis, hematology; Electrical safety: physiological effects of electricity, macro and micro shock hazards, electrical safety codes and standards, protection for power distribution and equipment design.','The course will introduce students to the basic concepts of medical instrumentation, sensors, electrodes, amplifiers and body surface potential
This course will enable the students to investigate the characteristics of different biomedical measurement systems
The course will introduce the principles of different therapeutic devices, prosthetic devices and clinical laboratory instruments
The course will enable the students to analyze electrical safety of biomedical instruments','Bangladesh University of Engineering and Technology
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No:			BME 303
Course Title:		Biomedical Instrumentation and Measurements
Credit hours:		3.0				Contact hours:	3.0
Level/Term:			3/1
Academic Session: 	2023-2024
Course Teacher(s):
Name | Office/Room | Email & Telephone | Class routine
Mr. Shoyad Ibn Sabur Khan Nuhash | ECE 1123 | shoyadsabur@bme.buet.ac.bd
+880 1515 212 213 | Saturday:
09:00 AM-09:50 AM Monday:
09:00 AM-09:50 AM Tuesday:
10:00 AM-10:50:00
Mr. Md. Abdullah Al Mamun | ECE 1121 | abdullah@bme.buet.ac.bd
+880 1639 008 395 | Saturday:
09:00 AM-09:50 AM Monday:
09:00 AM-09:50 AM Tuesday:
10:00 AM-10:50:00
Course Contents:
Basic concepts of medical instrumentation: principles and properties of a medical instrumentation and measurement system; Basic sensors and principles: biophysical parameters, transducers; Biopotential electrodes and amplifiers: polarization, circuit models, interface between skin and electrodes, motion artifacts techniques, grounding, shielding; Body surface potential: EOG, electroretinogram, electrocochleogram; Biosensors: ion selective and immunologically sensitive field effect transistors, non-invasive blood gas monitoring, electronic noses; Cardiovascular measurements: photoplethysmography, arrhythmia monitor, QRS detection techniques, exercise stress testing, cardiotocograph, methods of monitoring fetal heart rate and labour activity; Measurement of respiratory volumes and flow: impedance pneumography; Measurement of pressure, flow and volume of blood: direct measurements and analysis of blood pressure, measurement of system response, bandwidth requirement for measurement, PCG, tonometry, indicator dilution method, electromagnetic flowmeters, ultrasonic flowmeters, thermal convection velocity sensors; Therapeutic and prosthetic devices: ventilator, inhaler, defibrillator, pacemaker, neural simulator, respirator, heart lung machine; Clinical laboratory instrumentation: electrophoresis, hematology; Electrical safety: physiological effects of electricity, macro and micro shock hazards, electrical safety codes and standards, protection for power distribution and equipment design.
Course Objectives:
The course will introduce students to the basic concepts of medical instrumentation, sensors, electrodes, amplifiers and body surface potential
This course will enable the students to investigate the characteristics of different biomedical measurement systems
The course will introduce the principles of different therapeutic devices, prosthetic devices and clinical laboratory instruments
The course will enable the students to analyze electrical safety of biomedical instruments
Course Outcomes:
Explain the basic concepts of medical instrumentation, sensors, body surface potential, and electrodes
Apply engineering principles in different clinical applications of biosensors
Explain the working principles of different therapeutic, prosthetic and clinical laboratory instruments
Analyze different techniques of electrical safety measurements and medical equipment design
Analyze circuits’ requirements for biomedical instrumentation systems
Assessment:
Class Participation	10%
Continuous Assessment	20%
Final Examination	70%
Textbooks and References:
Webster, J. G. (Ed.). (2009). Medical instrumentation: application and design. John Wiley  Sons.
Webb, A. G. (2018). Principles of biomedical instrumentation. Cambridge University Press.
Crowell, L. (1996). Biomedical Instrumentation and Measurement.
Khandpur, R. S. (2005). Biomedical instrumentation: Technology and applications (Vol. 1). New York: Mcgraw-hill.
Northrop, R. B. (2001). Noninvasive instrumentation and measurement in medical diagnosis. CRC press.
Weekly Schedule:
Lecture | Topics
1—3 | Basic concepts of medical instrumentation, sensors:
Principles and properties of a medical instrumentation and measurement system
Basic sensors and principles:biophysical parameters, transducers
4—6 | Biopotential electrodes and amplifiers:
Polarization
Circuit models
Interface between skin and electrodes
Motion artifacts techniques, grounding, shielding
7—9 | Body surface potential:
EOG
Electroretinogram
Electrocochleogram
Class test #1 (CO-1)
10—12 | Biosensors:
Ion selective and immunologically sensitive field effect transistors
Non - invasive blood gas monitoring
Electronic noises
Cardiovascular Measurement:
Photoplethysmography
Arrhythmia monitor
13—15 | Cardiovascular Measurement:
QRS detection techniques
Exercise stress testing
Cardiotocograph
Methods of monitoring fetal heart rate and labour activity
16—18 | Measurement of respiratory volumes and flow:
Impedance pneumography
Class test #2 (CO-2)
19—21 | Measurement of pressure, flow and volume of blood:
Direct measurements and analysis of blood pressure
Measurement of system response
Bandwidth requirement for measurement
PCG
22—24 | Measurement of pressure, flow and volume of blood :
Tonometry
Indicator dilution method
Electromagnetic flowmeters, ultrasonic flow meters
Thermal convection velocity sensors
25—27 | Therapeutic and prosthetic devices:
Ventilator
Inhaler
28—30 | Therapeutic and prosthetic devices:
Defibrillator
Pacemaker
Neural simulator
31—33 | Therapeutic and prosthetic devices:
Respirator
Heart lung machine
Class test #3 (CO-3)
34—36 | Clinical laboratory instrumentation:
Electrophoresis
37—39 | Clinical laboratory instrumentation:
Hematology
40—42 | Electrical safety:
Physiological effects of electricity
Macro and micro shock hazards
Electrical safety codes and standards
Protection for power distribution and equipment design
Class test # 4 (CO-3, CO-4)
Prepared by:
Name:
Signature:
Date: | Mr. Shoyad Ibn Sabur Khan Nuhash
Name:
Signature:
Date: | Mr. Md. Abdullah Al Mamun','[{"name": "Mr. Shoyad Ibn Sabur Khan Nuhash", "room": "ECE 1123", "email": "shoyadsabur@bme.buet.ac.bd"}, {"name": "Mr. Md. Abdullah Al Mamun", "room": "ECE 1121", "email": "abdullah@bme.buet.ac.bd"}]'::jsonb,'[{"component": "Class participation/Attendance", "percent": 10.0}, {"component": "Continuous Assessment", "percent": 20.0}, {"component": "Term Final", "percent": 70.0}]'::jsonb,'[]'::jsonb,'{"folder": "1 - Course Files/L3T1/BME 303 Course File/January 2025", "files": {"co_po_mapping": "January 2025/CO-PO Mapping.docx", "outline": "January 2025/BME 303_Course outline.docx", "assessment_workbook": "January 2025/Assessment and Scripts/BME 303-CO-PO-Assessment-marks.xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 303\nCourse Title: | Biomedical Instrumentation and Measurements\nLevel, Term and Section | 3/1\nAcademic Term | January 2025\nTextbooks used: | Webster, J. G. (Ed.). (2009). Medical instrumentation: application and design. John Wiley  Sons.\nWebb, A. G. (2018). Principles of biomedical instrumentation. Cambridge University Press.\nCrowell, L. (1996). Biomedical Instrumentation and Measurement.\nKhandpur, R. S. (2005). Biomedical instrumentation: Technology and applications (Vol. 1). New York: Mcgraw-hill.\nNorthrop, R. B. (2001). Noninvasive instrumentation and measurement in medical diagnosis. CRC press.\nLast term when the course was offered | N/A\nPart B. Attainment for current and previous terms\nJanuary 2025\nCO1 | CO2 | CO3 | CO4 | CO5\n35.29% | 98.04% | 78.43% | 84.31% | 94.12%\nN | Y | Y | Y | Y\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\n92.16% | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A\nY | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A\nPart C. Analysis\nTeachers’ comment on attainment:\nInterpretation of student feedback:\nTeachers’ comment on teaching learning:\nPart D. Comments on CQI implemented based on last assessment\nPart E. Recommendation\nMajor issues:\nPlan for future actions for further improvement:\nSignature(s):\nName: Mr. Shoyad Ibn Sabur Khan Nuhash | Name: Mr. Md. Abdullah Al Mamun\nSignature: | Signature:"}'::jsonb,array['No K/P/A matrix in CO-PO mapping doc','Cohort CO1 NOT attained: 35.29% of students (threshold 40%)']::text[],true,true);
insert into stg_co values ('2025-01','BME 303',1,'Explain the basic concepts of medical instrumentation, sensors, body surface potential, and electrodes',array['C2']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-01','BME 303',2,'Apply engineering principles in different clinical applications of biosensors',array['C3']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-01','BME 303',3,'Explain the working principles of different therapeutic, prosthetic and clinical laboratory instruments',array['C2']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-01','BME 303',4,'Analyze different techniques of electrical safety measurements and medical equipment design',array['C4']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-01','BME 303',5,'Analyze circuits’ requirements for biomedical instrumentation systems',array['C4']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_crit values ('2025-01','BME 303',0,'Term Final','Q01 (a)',20,array['CO5']::text[]);
insert into stg_crit values ('2025-01','BME 303',1,'Term Final','Q01 (b)',15,array['CO4']::text[]);
insert into stg_crit values ('2025-01','BME 303',2,'Term Final','Q01 (c)',10,array['CO3']::text[]);
insert into stg_crit values ('2025-01','BME 303',3,'Term Final','Q05 (a)',15,array['CO5']::text[]);
insert into stg_crit values ('2025-01','BME 303',4,'Term Final','Q05 (b)',15,array['CO2']::text[]);
insert into stg_crit values ('2025-01','BME 303',5,'Term Final','Q05 (c)',15,array['CO1']::text[]);
insert into stg_att values ('2025-01','BME 303','CO','CO1',35.29,'workbook');
insert into stg_att values ('2025-01','BME 303','CO','CO2',98.04,'workbook');
insert into stg_att values ('2025-01','BME 303','CO','CO3',78.43,'workbook');
insert into stg_att values ('2025-01','BME 303','CO','CO4',84.31,'workbook');
insert into stg_att values ('2025-01','BME 303','CO','CO5',94.12,'workbook');
insert into stg_att values ('2025-01','BME 303','PO','PO1',92.16,'workbook');
insert into stg_off values ('2025-01','January 2025','BME 304',null,'(As approved by the Academic Council)
Sessional based on BME 303.','The course will introduce the basic concepts of different biomedical measuring instruments
This course will enable students to design biomedical circuits ensuring electrical safety
This course will demonstrate the design of different types of active filters, instrumentation amplifier and stimulation circuits
This course will familiarize the students with various physiological signals and their measurement techniques
This course will engage the students with knowledge of recent research literature relating to biomedical instrumentation and measurements','Bangladesh University of Engineering and Technology
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No:			BME 304
Course Title:		Biomedical Instrumentation and Measurements
Sessional
Credit hours:		3				Contact hours:	3
Level/Term:			3/1
Academic Session: 	2023-2024
Course Teacher(s):
Name | Office/Room | Email | Class routine
Samiul Based Shuvo | ECE-1121 | sbshuvo@bme.buet.ac.bd
+880 1521258181 | Monday:
11:00 AM-02:00 PM
Wednesday:
02:00 PM-05:00 PM
Abdullah Al Mamun | ECE-1123 | abdullah@bme.buet.ac.bd
+880 1639008395 | 
Srija Sarkar Anannya | ECE-1013 | srija@bme.buet.ac.bd
+880 1787151545 | 
Course Contents:
(As approved by the Academic Council)
Sessional based on BME 303.
Course Objectives:
The course will introduce the basic concepts of different biomedical measuring instruments
This course will enable students to design biomedical circuits ensuring electrical safety
This course will demonstrate the design of different types of active filters, instrumentation amplifier and stimulation circuits
This course will familiarize the students with various physiological signals and their measurement techniques
This course will engage the students with knowledge of recent research literature relating to biomedical instrumentation and measurements
Course Outcome:
Operate basic biomedical laboratory instruments to generate, observe, measure, and verify basic electronic signals using function generators, oscilloscopes, and relevant safety practices.
Construct different active filters for different biomedical signal acquisition
Construct bio-instrumentation amplifiers for biomedical signals acquisition, stimulation and measurements
Apply principles of biomedical instrumentation under different specifications and constraints
Assessment:
 | 
Continuous Assessment | 20%
Lab Test | 30%
Lab Viva | 10%
Final Quiz | 40%
Total | 100%
Textbooks and References:
1. Webster, J. G. (Ed.). (2009). Medical instrumentation: application and design. John Wiley & Sons.
2. Instrumentation Handbook for Biomedical Engineers (2021), Mesut Sahin Howard Fidel, Raquel Perez-Castillejos.
3. Khandpur. R. S., “Handbook of Biomedical Instrumentation”, Prentice Hall of India, New Delhi, 2003.
4. Cromwell, “Biomedical Instrumentation and Measurements”, Prentice Hall of India, New Delhi, 2007.
5. The Art of Electronics (3rd Edition), Paul Horowitz, Winfield Hill
Weekly Schedule:
Lecture No. | Lecture Topics
1 | - An Introduction to Basic Laboratory Instruments
- Basic understanding of various laboratory instruments
- Block diagram and basic controls of a Function Generator
- Generate several basic electronic signals
- Verify the signal’s parameters with oscilloscope measurements using different mode
2 | Active Filters
- Basic understanding of active and passive filters
- Design and implement buffer circuit, low-pass, high-pass and band-pass
3 | Active Filters
- Design and implement 2nd order low-pass and different type of notch filter
4 | Instrumentation Amplifiers
- Use instrumentation amplifiers to acquire physiologic signals
- Understand and determine common mode rejection ratio (CMRR), power supply rejection ratio (PSRR), Gain Bandwidth product (GBWP)
5 | Measurement of Electrode Contact Impedance
- Gain a basic understanding of conducting impedance
- Design and implement circuits to measure the frequency response of electrode conduct impedance
6 | - Lab Test-01
7 | Electrical Safety
- Device isolation systems
- Surge protection systems
8 | Implementation of functional electrical stimulation (FES)
- Design a constant current electrical stimulation circuit
- Observe its impact on frog muscle
9 | Building a PPG sensor circuit
- Design and implement a circuit that will acquire, filter and amplify the PPG signal
- Count heart rate from the measured PPG signal
10 | Design of Electrocardiogram Measurement System
- Understand different components of ECG system
- Compare different lead signal and generate augmented lead vector
- Design and implement the signal acquisition and conditioning electronics for an ECG system
11 | Design of Physiological Measurement System
- Understand different components of EMG and EOG system
- Design and implement the signal acquisition and conditioning electronics for an EMG system
- Design and implement the signal acquisition and conditioning electronics for an EOG system
12 | Lab Test-02
13 | Lab Viva
14 | Final Quiz
Prepared by: | 
Name:
Signature:
Date: | Samiul Based Shuvo
Name:
Signature:
Date: | Abdullah Al Mamun
Name:
Signature:
Date: | Srija Sarkar','[{"name": "Samiul Based Shuvo", "room": "ECE-1121", "email": "sbshuvo@bme.buet.ac.bd"}, {"name": "Abdullah Al Mamun", "room": "ECE-1123", "email": "abdullah@bme.buet.ac.bd"}, {"name": "Srija Sarkar Ananya", "room": "ECE- 1013", "email": "srija@bme.buet.ac.bd"}]'::jsonb,'[]'::jsonb,'[{"component": "Continuous Assessment", "weight": 0.2, "marks": 30}, {"component": "Lab Test", "weight": 0.3, "marks": 45}, {"component": "Lab Quiz", "weight": 0.4, "marks": 60}, {"component": "Lab Viva", "weight": 0.1, "marks": 15}]'::jsonb,'{"folder": "1 - Course Files/L3T1/BME 304 Course File/January 2025", "files": {"co_po_mapping": "January 2025/CO-PO Mapping.docx", "outline": "January 2025/BME 304_Course Outline.docx", "assessment_workbook": "January 2025/Assessment and Scripts/BME 304_CO-PO-Assessment-marks.xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 304\nCourse Title: | Biomedical Instrumentation and Measurements Sessional\nLevel, Term and Section | 3-1, A1,A2\nAcademic Term | January 2025\nTextbooks used: | Webster, J. G. (Ed.). (2009). Medical instrumentation: application and design. John Wiley & Sons.\nWebb, A. G. (2018). Principles of biomedical instrumentation. Cambridge University Press.\nCrowell, L. (1996). Biomedical Instrumentation and Measurement.\nKhandpur, R. S. (2005). Biomedical instrumentation: Technology and applications (Vol. 1). New York: Mcgraw-hill.\nNorthrop, R. B. (2001). Noninvasive instrumentation and measurement in medical diagnosis. CRC press.\nLast term when the course was offered | January 2024\nPart B. Attainment for current and previous terms\nJanuary 2025\nFrom the excel worksheet\nCO1 | CO2 | CO3 | CO4 | CO5 | CO6 | CO7 | CO8 | CO9 | CO10 | CO11 | CO12\n98.04% | 96.08% | 96.08% | 98.04% | NA | NA | NA | NA | NA | NA | NA | NA\nY | Y | Y | Y | NA | NA | NA | NA | NA | NA | NA | NA\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\nNA | NA | NA | 98.04% | 96.08% | NA | NA | NA | NA | NA | NA | NA\nNA | NA | NA | Y | Y | NA | NA | NA | NA | NA | NA | NA\nPart C. Analysis\nTeachers’ comment on attainment: Satisfactory\nInterpretation of student feedback: N/A\nTeachers’ comment on teaching learning: Can be more interactive, with more real life applications.\nPart D. Comments on CQI implemented based on last assessment\nN/A\nPart E. Recommendation\nMajor issues: None\nPlan for future actions for further improvement: Addition of new content, such as drafting, compliance of devices with ISO standards, etc.\nSignature(s):\nName: Samiul Based Shuvo | Name: Abdullah Al Mamun | Name: Srija Sarker Anannya\nSignature: | Signature: | Signature:"}'::jsonb,array['No K/P/A matrix in CO-PO mapping doc']::text[],true,true);
insert into stg_co values ('2025-01','BME 304',1,'Demonstrate the basic concepts of different biomedical measuring instruments',array['PS4']::text[],array['Lectures','Homework']::text[],array['Continuous Assessment','Lab Quiz']::text[],'{}'::text[],array['PO5']::text[]);
insert into stg_co values ('2025-01','BME 304',2,'Construct different active filters for different biomedical signal acquisition and measurements',array['PS5']::text[],array['Lectures','Homework']::text[],array['Continuous Assessment','Lab Test']::text[],'{}'::text[],array['PO5']::text[]);
insert into stg_co values ('2025-01','BME 304',3,'Construct bio-instrumentation amplifiers for biomedical signals acquisition ,stimulation and measurements',array['PS5']::text[],array['Lectures','Homework']::text[],array['Continuous Assessment','Lab Test','Lab Viva']::text[],'{}'::text[],array['PO5']::text[]);
insert into stg_co values ('2025-01','BME 304',4,'Apply principles of biomedical instrumentation under different specifications and constraints',array['PS5']::text[],array['Lectures','Homework']::text[],array['Lab Test','Lab Quiz','Lab Viva']::text[],'{}'::text[],array['PO4']::text[]);
insert into stg_crit values ('2025-01','BME 304',0,'Continuous Assessment','Demonstrate basic biomedical measuring instruments',10,array['CO1']::text[]);
insert into stg_crit values ('2025-01','BME 304',1,'Continuous Assessment','Design active filters for biomedical signal measurement',10,array['CO2']::text[]);
insert into stg_crit values ('2025-01','BME 304',2,'Continuous Assessment','Design bio-amplifiers for signal acquisition',10,array['CO3']::text[]);
insert into stg_crit values ('2025-01','BME 304',3,'Lab Test','Design active filters for biomedical signal measurement',15,array['CO2']::text[]);
insert into stg_crit values ('2025-01','BME 304',4,'Lab Test','Design bio-amplifiers for signal acquisition',15,array['CO3']::text[]);
insert into stg_crit values ('2025-01','BME 304',5,'Lab Test','Apply biomedical instrumentation principles under various constraints',15,array['CO4']::text[]);
insert into stg_crit values ('2025-01','BME 304',6,'Lab Quiz','Demonstrate basic biomedical measuring instruments',30,array['CO1']::text[]);
insert into stg_crit values ('2025-01','BME 304',7,'Lab Quiz','Apply biomedical instrumentation principles under various constraints',30,array['CO4']::text[]);
insert into stg_crit values ('2025-01','BME 304',8,'Lab Viva','Design bio-amplifiers for signal acquisition',5,array['CO3']::text[]);
insert into stg_crit values ('2025-01','BME 304',9,'Lab Viva','Apply biomedical instrumentation principles under various constraints',10,array['CO4']::text[]);
insert into stg_att values ('2025-01','BME 304','CO','CO1',98.04,'workbook');
insert into stg_att values ('2025-01','BME 304','CO','CO2',96.08,'workbook');
insert into stg_att values ('2025-01','BME 304','CO','CO3',96.08,'workbook');
insert into stg_att values ('2025-01','BME 304','CO','CO4',98.04,'workbook');
insert into stg_att values ('2025-01','BME 304','PO','PO4',98.04,'workbook');
insert into stg_att values ('2025-01','BME 304','PO','PO5',96.08,'workbook');
insert into stg_car values ('2025-01','BME 304','Teachers’ comment on attainment: Satisfactory
Interpretation of student feedback: N/A
Teachers’ comment on teaching learning: Can be more interactive, with more real life applications.','','Major issues: None
Plan for future actions for further improvement: Addition of new content, such as drafting, compliance of devices with ISO standards, etc.');
insert into stg_off values ('2025-01','January 2025','BME 309',null,null,null,null,'[{"name": "Dr. Jahid Ferdous", "room": "ECE-1015", "email": "ferdousj@bme.buet.ac.bd"}, {"name": "Mr. Shoyad Ibn Sabur Khan Nuhash", "room": "ECE-1014", "email": "shoyadsabur@bme.buet.ac.bd"}]'::jsonb,'[{"component": "Class participation/Attendance", "percent": 10.0}, {"component": "Continuous Assessment", "percent": 20.0}, {"component": "Term Final", "percent": 70.0}]'::jsonb,'[]'::jsonb,'{"folder": "1 - Course Files/L3T1/BME 309 Course File/January 2025", "files": {"co_po_mapping": "January 2025/CO-PO Mapping.docx", "outline": "January 2025/BME 309 - Course outline - January 2025.pdf", "assessment_workbook": "January 2025/Assessments and scripts/BME 309-CO-PO-Assessment-marks.xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 309\nCourse Title: | Quantitative Physiology\nLevel, Term and Section | 3/1\nAcademic Term | January 2025\nTextbooks used: | Quantitative Human Physiology: An introduction, Second Edition, Joseph Feher.\nHuman Physiology: An Integrated Approach, Eighth Edition, Dee Unglaub Silverthorn.\nMathematical Physiology II: Systems Physiology, Second Edition, James Keener, James Sneyd.\nPhysiology by Numbers: An Encouragement to Quantitative Thinking, Second Edition, Richard F. Burton.\nLast term when the course was offered | July 2023\nPart B. Attainment for current and previous terms\nJanuary 2025\nCO Attainment | CO1 | CO2 | CO3 | CO4 | CO5 | CO6 | CO7 | CO8 | CO9 | CO10 | CO11 | CO12\n%student attained | 78.00% | 96.00% | 98.00% | 98.00% | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A\nCohort Attainment | Y | Y | Y | Y | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A\nPO Attainment | PO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\n%student attained | 98.00% | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A\nCohort Attainment | Y | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A\nPart C. Analysis\nTeachers’ comment on attainment: Satisfactory\nInterpretation of student feedback: None\nTeachers’ comment on teaching learning: None\nPart D. Comments on CQI implemented based on last assessment\nN/A\nPart E. Recommendation\nMajor issues: None\nPlan for future actions for further improvement: None\nSignature(s):\nName: Dr. Jahid Ferdous | Name: Mr. Shoyad Ibn Sabur Khan Nuhash\nSignature: | Signature:"}'::jsonb,array['No K/P/A matrix in CO-PO mapping doc']::text[],false,true);
insert into stg_co values ('2025-01','BME 309',1,'Develop mathematical models of various physiological systems.',array['C5']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-01','BME 309',2,'Solve mathematical problems relating to different physiological systems.',array['C3']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-01','BME 309',3,'Explain the techniques to measure different physiological systems and parameters.',array['C3']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-01','BME 309',4,'Identify mathematical characteristics of different pathophysiological conditions.',array['C4']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_crit values ('2025-01','BME 309',0,'Term Final','Q01 (a)',10,array['CO4']::text[]);
insert into stg_crit values ('2025-01','BME 309',1,'Term Final','Q01 (b)',20,array['CO1']::text[]);
insert into stg_crit values ('2025-01','BME 309',2,'Term Final','Q01 (c)',15,array['CO4']::text[]);
insert into stg_crit values ('2025-01','BME 309',3,'Term Final','Q05 (a)',25,array['CO4']::text[]);
insert into stg_crit values ('2025-01','BME 309',4,'Term Final','Q05 (b)',10,array['CO2']::text[]);
insert into stg_crit values ('2025-01','BME 309',5,'Term Final','Q05 (c)',10,array['CO3']::text[]);
insert into stg_att values ('2025-01','BME 309','CO','CO1',78.0,'workbook');
insert into stg_att values ('2025-01','BME 309','CO','CO2',96.0,'workbook');
insert into stg_att values ('2025-01','BME 309','CO','CO3',98.0,'workbook');
insert into stg_att values ('2025-01','BME 309','CO','CO4',98.0,'workbook');
insert into stg_att values ('2025-01','BME 309','PO','PO1',98.0,'workbook');
insert into stg_car values ('2025-01','BME 309','Teachers’ comment on attainment: Satisfactory
Interpretation of student feedback: None
Teachers’ comment on teaching learning: None','','');
insert into stg_off values ('2025-01','January 2025','BME 310',null,null,null,null,'[{"name": "Shoyad Ibn Sabur Khan Nuhash", "room": "ECE-1121", "email": "shoyadsabur@bme.buet.ac.bd"}, {"name": "Tasnia Binte Mamun", "room": "ECE-1125", "email": "tasnia@bme.buet.ac.bd"}, {"name": "Shams Nafisa Ali", "room": "ECE-1013", "email": "nafisa@bme.buet.ac.bd"}]'::jsonb,'[{"component": "Class participation", "percent": 10.0}, {"component": "Continuous assessment", "percent": 20.0}, {"component": "Lab test", "percent": 40.0}, {"component": "Project", "percent": 30.0}]'::jsonb,'[{"component": "Continuous Assessment", "weight": 0.3, "marks": 45}, {"component": "Lab Test", "weight": 0.4, "marks": 60}, {"component": "Project", "weight": 0.3, "marks": 45}]'::jsonb,'{"folder": "1 - Course Files/L3T1/BME 310 Course Files/January 2025", "files": {"co_po_mapping": "January 2025/CO-PO Mapping.docx", "outline": "January 2025/BME 310 - Course outline - January 2025 (1).pdf", "assessment_workbook": "January 2025/Assessment and Scripts/BME 310-CO-PO-Assessment Marks.xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 310\nCourse Title: | Communicating Protocols for Biomedical Instruments Sessional\nLevel, Term and Section | 3/1\nAcademic Term | January 2025\nTextbooks used: | Communication Systems, 4th Edition. S. Haykin, (2004). John Wiley & Sons, Inc.\nPrinciples of Digital Communication (Vol. 1). Gallager, R. G. (2008). Cambridge University Press.\nPython Crash Course: A Hands-on, Project-based Introduction to Programming. E. Matthes, (2019). No Starch Press.\nLearning Python, 5th Edition. M. Lutz, (2016). O''Reilly Media, Inc.\nIntroduction to Machine Learning with Python: A Guide for Data Scientists. A. C. Müller, & S. Guido (2016). O''Reilly Media, Inc.\nChapter 11: Modulation and Demodulation of Biomedical Signals, Analysis and Application of Analog Electronic Circuits to Biomedical Instrumentation, 2nd Edition. R. B. Northrop, (2003). CRC press.\nHannan, M. A., Abbas, S. M., Samad, S. A., & Hussain, A. (2011). Modulation Techniques for Biomedical Implanted Devices and Their Challenges. Sensors, 12(1), 297-319.\nISO 13485 - Quality Management for Medical Devices.[Available at: https://www.iso.org/publication/PUB100377.html\n, Accessed on: July 12, 2022]\nIEEE 11073-20701-2018- IEEE Standard - Health informatics--Point-of-care medical device communication - Part 20701: Service-Oriented Medical Device Exchange Architecture and Protocol Binding. [Available at: https://standards.ieee.org/ieee/11073-20701/6059/, Accessed on: July 12, 2022]\nLast term when the course was offered | July 2023\nPart B. Attainment for current and previous terms\nCurrent term:\n(From the excel worksheet)\nCO1 | CO2 | CO3 | CO4 | CO5 | CO6 | CO7 | CO8 | CO9 | CO10 | CO11 | CO12\n96.08 | 100 | 98.04 | NA | NA | NA | NA | NA | NA | NA | NA | NA\nY | Y | Y | NA | NA | NA | NA | NA | NA | NA | NA | NA\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\n96 | 96 | NA | NA | 100 | NA | NA | NA | NA | NA | NA | NA\nY | Y | NA | NA | Y | NA | NA | NA | NA | NA | NA | NA\nPrevious term: Not available\nPart C. Analysis\nTeachers’ comment on attainment: The overall attainment is satisfactory, with all assessed outcomes surpassing the attainment threshold of 40%.\nInterpretation of student feedback: N/A\nTeachers’ comment on teaching learning: Enhancing existing resources can help ensure the class runs smoothly.\nPart D. Comments on CQI implemented based on last assessment\nN/A\nPart E. Recommendation\nMajor issues: None\nPlan for future actions for further improvement: Enhancing resource.\nSignature(s):\nName: Ms. Tasnia Binte Mamun | Mr. Shoyad Ibn Sabur Khan Nuhash | Name: Ms. Shams Nafisa Ali\nSignature: | Signature: | Signature:"}'::jsonb,'{}'::text[],false,true);
insert into stg_co values ('2025-01','BME 310',1,'Apply the communication protocols and standards for safe, effective and ethical operations of biomedical instruments and systems',array['C3']::text[],array['Lectures','Coding Tasks','Homework']::text[],array['Continuous Assessment','Lab Test']::text[],array['K6','P1','P2']::text[],array['PO5']::text[]);
insert into stg_co values ('2025-01','BME 310',2,'Inspect distinct quantitative findings and conclusions in the context of biomedical research using computer programing and different data analysis tools',array['C4']::text[],array['Lectures','Video Tutorials','Homework']::text[],array['Continuous Assessment','Lab Test']::text[],array['K6','P1','P3']::text[],array['PO5']::text[]);
insert into stg_co values ('2025-01','BME 310',3,'Evaluate different machine learning based analytical pipelines as per requirement based on research literature',array['C5']::text[],array['Term Project']::text[],array['Project Demonstration and Presentation','Reports']::text[],array['K8','P1','P3','P7']::text[],array['PO4']::text[]);
insert into stg_crit values ('2025-01','BME 310',0,'Continuous Assessment','Apply the communication protocols and standards for safe, effective and ethical operations of biomedical instruments and systems',25,array['CO1']::text[]);
insert into stg_crit values ('2025-01','BME 310',1,'Continuous Assessment','Inspect distinct quantitative findings and conclusions in the context of biomedical research using computer programing and different data analysis tools',20,array['CO2']::text[]);
insert into stg_crit values ('2025-01','BME 310',2,'Lab Test','Apply the communication protocols and standards for safe, effective and ethical operations of biomedical instruments and systems',30,array['CO1']::text[]);
insert into stg_crit values ('2025-01','BME 310',3,'Lab Test','Inspect distinct quantitative findings and conclusions in the context of biomedical research using computer programing and different data analysis tools',30,array['CO2']::text[]);
insert into stg_crit values ('2025-01','BME 310',4,'Demo 01','Evaluate different machine learning based analytical pipelines as per requirement based on research literature',45,array['CO3']::text[]);
insert into stg_att values ('2025-01','BME 310','CO','CO1',96.08,'workbook');
insert into stg_att values ('2025-01','BME 310','CO','CO2',100,'workbook');
insert into stg_att values ('2025-01','BME 310','CO','CO3',98.04,'workbook');
insert into stg_att values ('2025-01','BME 310','PO','PO4',98.04,'workbook');
insert into stg_att values ('2025-01','BME 310','PO','PO5',98.04,'workbook');
insert into stg_car values ('2025-01','BME 310','Teachers’ comment on attainment: The overall attainment is satisfactory, with all assessed outcomes surpassing the attainment threshold of 40%.
Interpretation of student feedback: N/A
Teachers’ comment on teaching learning: Enhancing existing resources can help ensure the class runs smoothly.','','Major issues: None
Plan for future actions for further improvement: Enhancing resource.');
insert into stg_bugs values ('BUGS 09.04.25','2025-04-09','https://buetedu-my.sharepoint.com/:b:/g/personal/shoyadsabur_bme_buet_ac_bd/IQCjIvypYsjBQLUopsrX7yx3AZtJDMIoD-etVNDs3LN3IwY?e=2OdeOt','2025-01','BME 310');
insert into stg_off values ('2025-01','January 2025','BME 311',null,'Biosignals and their non-deterministic properties, models of biomedical systems, basic operation on signals, elementary signals, representation of signals using impulse function. Properties of Linear Time-Invariant(LTI) systems: Linearity, causality, time invariance, memory, stability, invertibility. Time-domain analysis of LTI systems: Differential equations- system representation, the order of the system, solution techniques, zero state, and zero input response, system properties; impulse response- convolution integral, determination of system properties. Frequency domain analysis of LTI systems: Fourier series- properties, harmonic representation, system response, the frequency response of LTI systems; Fourier transformation- properties, system transfer function, system response, and distortion-less systems. Applications of time and frequency domain analyses: solution of analog electrical and mechanical systems, amplitude modulation and demodulation, time-division, and frequency-division multiplexing. Laplace transformation: properties, inverse transform, solution of system equations, system transfer function, system stability, and frequencyresponse and application. Analog filter design methods for biomedical instrumentation.','The course will introduce the main concepts of signals and linear systems for bio-signals
Two major concepts of time-domain and frequency-domain analysis of signals will be introduced
The course will cover the theory and applications of Fourier series, Fourier transform and Laplace transform with applications in biomedical signals and systems','Bangladesh University of Engineering and Technology
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No:			BME 311
Course Title:		Biomedical Signals and Systems
Credit hours:		3				Contact hours:	3
Level/Term:			3/1
Academic Session: 	2023-2024
Course Teacher(s):
Name | Office/Room | Email | Class routine
Dr. Taufiq Hasan | ECE-1017 | taufiq@bme.buet.ac.bd
+880 1817579844 | Sunday:
09:00 AM-09:50 AM
Monday:
12:00 PM-12:50 PM
Wednsday:
09:00 AM-09:50 AM
Md. Tazuddin Ahmed | ECE-1123 | mdtuahmed@bme.buet.ac.bd
+880 1797 091 595 | 
Course Contents:
Biosignals and their non-deterministic properties, models of biomedical systems, basic operation on signals, elementary signals, representation of signals using impulse function. Properties of Linear Time-Invariant(LTI) systems: Linearity, causality, time invariance, memory, stability, invertibility. Time-domain analysis of LTI systems: Differential equations- system representation, the order of the system, solution techniques, zero state, and zero input response, system properties; impulse response- convolution integral, determination of system properties. Frequency domain analysis of LTI systems: Fourier series- properties, harmonic representation, system response, the frequency response of LTI systems; Fourier transformation- properties, system transfer function, system response, and distortion-less systems. Applications of time and frequency domain analyses: solution of analog electrical and mechanical systems, amplitude modulation and demodulation, time-division, and frequency-division multiplexing. Laplace transformation: properties, inverse transform, solution of system equations, system transfer function, system stability, and frequencyresponse and application. Analog filter design methods for biomedical instrumentation.
Course Objectives:
The course will introduce the main concepts of signals and linear systems for bio-signals
Two major concepts of time-domain and frequency-domain analysis of signals will be introduced
The course will cover the theory and applications of Fourier series, Fourier transform and Laplace transform with applications in biomedical signals and systems
Course Outcomes:
Apply the fundamental concepts of signals and systems in biomedical signals.
Analyze biomedical signals in the time domain based on given requirements.
Apply Fourier analysis on biomedical signals and systems based on requirements.
Analyze biomedical signals and systems using Laplace transform given specific requirements.
Assessment:
Class Participation                  10%
Continuous Assessment          20%
Final Examination                     70%
Total                                        100%
Textbooks and References:
Signals and Systems Analysis in Biomedical Engineering, Second Edition, Robert B. Northrop.
Principles of Linear Systems and Signals Paperback, by B.P. Lathi
Samir S. Solaiman, Mandyam D. Srinath - “Continuous and Discrete Signals and Systems” (2nd Edition)
Signals and Systems in Biomedical Engineering, by Devasahayam, Suresh R. (1st edition)
Weekly Schedule:
Week | Topics
1-3 | Course introduction
• Fundamental properties of biosignals.
• Classification of biosignals: deterministic vs. stochastic, stationary vs. non-stationary.
• Fundamentals of biomedical systems
4-6 | Basic operation on signals
- Time Shifting, Time Scaling, Time Reversal
- Combined Operations, Worked out problems.
7-9 | Elementary signals:
- Unit step function. Worked out examples
- The Dirac delta function/Impulse function.
- Representation of signals using impulse function. Worked out problems.
- Class test # 1
10-12 | Linear Time-Invariant (LTI) systems:
- Properties: Linearity, causality, time invariance.
- Properties: memory, stability, invertibility
13-15 | Time-domain analysis of LTI systems:
- Differential equations system representation
- The order of the system, solution techniques
- Zero state and zero input response
16-18 | Time-domain analysis of LTI systems:
- System properties, impulse response.
- Convolution integral, determination of system properties.
Worked out problems.
19-21 | Models of physiological systems:
- Fluid, mechanical and electrical system analog
- Biomedical applications of LTI system analysis
- Worked out examples
- Class test # 2
22-24 | Frequency domain analysis of LTI systems:
- Trigonometric Fourier series, properties, harmonic representation
- System response, the frequency response of LTI systems
- Fourier series: compact form, Dirichlet conditions, Parseval’s theorem
25-27 | Fourier Transform
- Development of Fourier transform from Fourier series
- Properties of Fourier transformation: system transfer function
- System response, distortion-less systems, worked out problems
28-30 | Applications of time and frequency domain analyses:
- Solution of analog electrical and mechanical systems.
- Amplitude modulation and demodulation
- Time-division and frequency-division multiplexing
31-33 | Applications of time and frequency domain analyses:
- Applications in biomedical signals systems
- Worked out problems- Class test - 3
34-36 | Laplace transformation
- Motivation and relationship with Fourier transform
- Properties, inverse transform, solution of system equations.
- Laplace transformation: system transfer function
37-39 | Laplace transformation:
- System stability, frequency response
- Biomedical engineering applications
- Worked out problems
40-42 | Analog filter design methods for biomedical instrumentation:
- Passive and active filters
- Low-pass, high-pass, band-pass and band-stop filters.
- Class test # 4
Prepared by: | 
Name:
Signature:
Date: | Dr. Taufiq Hasan
Name:
Signature:
Date: | Md. Tazuddin Ahmed','[{"name": "Dr. Taufiq Hasan", "room": "ECE 1017", "email": "taufiq@bme.buet.ac.bd"}, {"name": "Md. Tazuddin Ahmed", "room": "ECE 1123", "email": "mdtuahmed@bme.buet.ac.bd"}]'::jsonb,'[{"component": "Class Participation", "percent": 10.0}, {"component": "Continuous Assessment", "percent": 20.0}, {"component": "Final Examination", "percent": 70.0}]'::jsonb,'[]'::jsonb,'{"folder": "1 - Course Files/L3T1/BME 311 Course File/January 2025", "files": {"co_po_mapping": "January 2025/CO-PO Mapping.docx", "outline": "January 2025/BME 311_Course Outline .docx", "assessment_workbook": "January 2025/Assessments and scripts/BME 311-CO-PO-Assessment Marks.xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 311\nCourse Title: | Biomedical Signals and Systems\nLevel, Term and Section | 3/1\nAcademic Term | January 2025\nTextbooks used: | Signals and Systems Analysis in Biomedical Engineering, Second Edition, Robert B. Northrop.\nPrinciples of Linear Systems and Signals Paperback, by B.P. Lathi\nSamir S. Solaiman, Mandyam D. Srinath - “Continuous and Discrete Signals and Systems” (2nd Edition)\nSignals and Systems in Biomedical Engineering, by Devasahayam, Suresh R. (1st edition)\nLast term when the course was offered | July 2023\nPart B. Attainment for current and previous terms\nJanuary 2025\nCO1 | CO2 | CO3 | CO4\n92.16% | 98.04% | 96.08% | 96.08%\nY | Y | Y | Y\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\n100.00% | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A\nY | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A\nPart C. Analysis\nTeachers’ comment on attainment: Satisfactory\nInterpretation of student feedback: Did not receive feedback as of now.\nTeachers’ comment on teaching learning: None.\nPart D. Comments on CQI implemented based on last assessment\nNot applicable.\nPart E. Recommendation\nMajor issues: None\nPlan for future actions for further improvement: None\nSignature(s):\nName: Dr. Taufiq Hasan | Name: Md. Tazuddin Ahmed\nSignature: | Signature:"}'::jsonb,array['No K/P/A matrix in CO-PO mapping doc']::text[],true,true);
insert into stg_co values ('2025-01','BME 311',1,'Apply the fundamental concepts of signals and systems in biomedical signals',array['C3']::text[],array['Lectures','Audio-visual demonstration','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-01','BME 311',2,'Analyze biomedical signals in the time domain based on given requirements',array['C4']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-01','BME 311',3,'Apply Fourier analysis on biomedical signals and systems based on requirements',array['C3']::text[],array['Lectures','Homework','Audio-visual demonstration']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-01','BME 311',4,'Analyze biomedical signals and systems using Laplace transform given specific requirements',array['C4']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_crit values ('2025-01','BME 311',0,'Term Final','Q01 (a)',15,array['CO1']::text[]);
insert into stg_crit values ('2025-01','BME 311',1,'Term Final','Q01 (b)',15,array['CO3']::text[]);
insert into stg_crit values ('2025-01','BME 311',2,'Term Final','Q01 (c)',15,array['CO3']::text[]);
insert into stg_crit values ('2025-01','BME 311',3,'Term Final','Q05 (a)',25,array['CO2']::text[]);
insert into stg_crit values ('2025-01','BME 311',4,'Term Final','Q05 (b)',20,array['CO4']::text[]);
insert into stg_att values ('2025-01','BME 311','CO','CO1',92.16,'workbook');
insert into stg_att values ('2025-01','BME 311','CO','CO2',98.04,'workbook');
insert into stg_att values ('2025-01','BME 311','CO','CO3',96.08,'workbook');
insert into stg_att values ('2025-01','BME 311','CO','CO4',96.08,'workbook');
insert into stg_att values ('2025-01','BME 311','PO','PO1',100,'workbook');
insert into stg_car values ('2025-01','BME 311','Teachers’ comment on attainment: Satisfactory
Interpretation of student feedback: Did not receive feedback as of now.
Teachers’ comment on teaching learning: None.','Not applicable.','');
insert into stg_bugs values ('BUGS 09.04.25','2025-04-09','https://buetedu-my.sharepoint.com/:b:/g/personal/shoyadsabur_bme_buet_ac_bd/IQCjIvypYsjBQLUopsrX7yx3AZtJDMIoD-etVNDs3LN3IwY?e=2OdeOt','2025-01','BME 311');
insert into stg_off values ('2025-07','July 2025','BME 305',null,'Introduction to modeling: what is a model and why model, modeling physical systems; Multi-scale organization of living organisms: cell to organ homeostasis; Examples of biomedical control systems: physiological systems and medical robotics; Tools for modeling physical systems: review of linear systems, laplace transform, Fourier series and Fourier transform, system response in the time and frequency domains, transfer function, open loop control, feedback control, stability of systems, steady state and transient analysis, design of control systems, design of PID controllers; Modeling of cardiovascular systems: blood pressure and flow, vascular impedance, lumped parameter models, Windkessel model of circulation, cardiac mechanics; Modeling of endocrine system: enzymes and hormones, Michaelis-Menten enzyme kinetics, examples of endocrine control- glucose insulin system, thyroid hormone system; Modeling of nervous system; Modeling of respiratory system: respiratory mechanics, lung models; Modeling of musculoskeletal system: Hill model of muscle contraction, muscle stretch reflex; Modeling complex physiological systems: regulation of cardiac output- Starling’s law, pressure volume curves, coupled model of cardiopulmonary system, blood pressure regulation- baroreceptor reflex, kidney for blood pressure regulation, blood glucose regulation- insulin control of glucose, glucose utilization in muscle; Applications to medical robotics: prostheses and artificial limbs, orthotic devices and exoskeleton, robot assisted surgery, haptic technology, soft robotics.','The course will introduce tools for modeling biomedical systems.
The course will enable students to investigate the characteristics of different biomedical control systems.
The course will enable students to design or modify system characteristics to imitate different physiological conditions.','Bangladesh University of Engineering and Technology
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No:			BME 305
Course Title:		Biomedical Control Systems
Credit hours:		3				Contact hours:	3
Level/Term:			3/2
Academic Session: 	2023-2024
Course Teacher(s):
Name | Office/
Room | Email & Telephone | Class routine
Dr. Taufiq Hasan Al Banna | ECE 1021 | taufiq@bme.buet.ac.bd
+880 1817-579844 | Sunday:
11:00 AM - 11:50 AM
Monday:
09:00 AM - 09:50 AM
Wednesday:
09:00 AM - 09:50 AM
Mr. Shoyad Ibn Sabur Khan Nuhash | ECE 1015 | shoyadsabur@bme.buet.ac.bd
+880 1515-212213 | 
Course Contents:
Introduction to modeling: what is a model and why model, modeling physical systems; Multi-scale organization of living organisms: cell to organ homeostasis; Examples of biomedical control systems: physiological systems and medical robotics; Tools for modeling physical systems: review of linear systems, laplace transform, Fourier series and Fourier transform, system response in the time and frequency domains, transfer function, open loop control, feedback control, stability of systems, steady state and transient analysis, design of control systems, design of PID controllers; Modeling of cardiovascular systems: blood pressure and flow, vascular impedance, lumped parameter models, Windkessel model of circulation, cardiac mechanics; Modeling of endocrine system: enzymes and hormones, Michaelis-Menten enzyme kinetics, examples of endocrine control- glucose insulin system, thyroid hormone system; Modeling of nervous system; Modeling of respiratory system: respiratory mechanics, lung models; Modeling of musculoskeletal system: Hill model of muscle contraction, muscle stretch reflex; Modeling complex physiological systems: regulation of cardiac output- Starling’s law, pressure volume curves, coupled model of cardiopulmonary system, blood pressure regulation- baroreceptor reflex, kidney for blood pressure regulation, blood glucose regulation- insulin control of glucose, glucose utilization in muscle; Applications to medical robotics: prostheses and artificial limbs, orthotic devices and exoskeleton, robot assisted surgery, haptic technology, soft robotics.
Course Objectives:
The course will introduce tools for modeling biomedical systems.
The course will enable students to investigate the characteristics of different biomedical control systems.
The course will enable students to design or modify system characteristics to imitate different physiological conditions.
Course Outcomes:
At the end of this course, students will be able to:
Explain the fundamental techniques required for modeling biomedical control systems
Solve mathematical problems relating to biomedical control systems
Analyze characteristics of different biomedical control systems
Construct biomedical control systems that meet specified requirements
Assessment:
Class participation/Attendance:		10%
Homework Assignment and Quizzes:	20%
Term Final Exam:				70%
Textbooks and References:
CONTROL SYSTEMS ENGINEERING - Seventh Edition - Norman S. Nise.
PHYSIOLOGICAL CONTROL SYSTEMS - Analysis, Simulation, and Estimation - Second Edition, - Michael C.K. Khoo.
AUTOMATIC CONTROL SYSTEMS IN BIOMEDICAL ENGINEERING - An Interactive Educational Approach - J. Fernández de Cañete, C. Galindo, J. Barbancho, A. Luque. (2018).
Weekly Schedule:
Week | Topics
1 | Introduction to modeling: what is a model and why model, modeling physical systems; Multiscale organization of living organisms: cell to organ homeostasis; Examples of biomedical control systems: physiological systems and medical robotics; Review of linear systems, Laplace transform, Fourier series & Fourier transform.
2 | Modeling in the frequency domain, transfer function, open loop control, feedback control
3 | Modeling in the time domain; Time response, steady state and transient analysis
Winter and mid break
4 | Stability of systems
5 | Steady state error
6 | Design of control systems: Root locus technique and Design via Root locus
7 | Design of PID controllers
8 | Modeling of cardiovascular systems: Blood pressure and flow models, Vascular impedance, Lumped parameter models, Windkessel model of circulation, cardiac mechanics
9 | Modeling of respiratory system: Respiratory mechanics, Lung models
10 | Modeling complex physiological systems: Regulation of cardiac output- Starling’s law, pressure volume curves, coupled model of cardiopulmonary system, blood pressure regulation baroreceptor reflex
11 | Modeling of endocrine system: Enzymes and hormones, Michaelis-Menten enzyme kinetics, Examples of endocrine control- glucose insulin system
Thyroid hormone system, Examples of endocrine control- glucose insulin system, Thyroid hormone system
12 | Modeling of nervous system; Modeling of musculoskeletal system: Hill model of muscle contraction, Muscle stretch reflex
13 | Kidney for blood pressure regulation, Blood glucose regulation- insulin control of glucose, Glucose utilization in muscle;
Applications to medical robotics: Prostheses and artificial limbs, Orthotic devices and exoskeleton, Robot assisted surgery, Haptic technology, Soft robotics
Prepared by: | 
Name:
Signature:
Date: | Dr. Taufiq Hasan Al Banna
30/11/2025
Name:
Signature:
Date: | Mr. Shoyad Ibn Sabur Khan Nuhash
30/11/2025','[{"name": "Dr. Taufiq Hasan Al Banna", "room": "ECE-1021", "email": "taufiq@bme.buet.ac.bd"}, {"name": "Mr. Shoyad Ibn Sabur Khan Nuhash", "room": "ECE-1017", "email": "shoyadsabur@bme.buet.ac.bd"}]'::jsonb,'[{"component": "Class participation/Attendance", "percent": 10.0}, {"component": "Continuous Assessment", "percent": 20.0}, {"component": "Term Final", "percent": 70.0}]'::jsonb,'[]'::jsonb,'{"folder": "1 - Course Files/L3T2/BME 305 Course Files/July 2025", "files": {"co_po_mapping": "July 2025/CO-PO Mapping_BME 305_July 2025.docx", "outline": "July 2025/BME 305_Course Outline_July 2025.docx", "assessment_workbook": "July 2025/Assessments and scripts/BME 305-CO-PO-Assessment-marks.xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 305\nCourse Title: | Biomedical Control Systems\nLevel, Term and Section | 3/2\nAcademic Term | July 2025\nTextbooks used: | Control Systems Engineering - Seventh Edition - Norman S. Nise.\nPhysiological Control Systems - Analysis, Simulation, and Estimation - Second Edition, - Michael C.K. Khoo.\nAutomatic Control Systems In Biomedical Engineering - An Interactive Educational Approach - J. Fernández de Cañete, C. Galindo, J. Barbancho, A. Luque. (2018)\nLast term when the course was offered | January 2024\nPart B. Attainment for current and previous terms\nCurrent Term: July 2025 Term\nCO Attainment | CO1 | CO2 | CO3 | CO4\n%student attained | 94.00% | 98.00% | 98.00% | 92.00%\nCohort Attainment | Y | Y | Y | Y\nPO Attainment | PO1\n%student attained | 98.00%\nCohort Attainment | Y\nPart C. Analysis\nTeachers’ comment on attainment: CO1, CO4 attainment needs improvement.\nInterpretation of student feedback: N/A\nTeachers’ comment on teaching learning: More case studies and practical scenario related problems should be solved in class.\nPart D. Comments on CQI implemented based on last assessment\n(Course file and corresponding CAR were not maintained previously. The changes were done based on faculty feedbacks.)\nCO4 statement was updated to improve explainability, corresponding CO/PO mapping was kept unchanged\n‘Interactive discussions’ was included as a delivery method across all four COs\nPart E. Recommendation\nMajor issues: None\nPlan for future actions for further improvement: None\nSignature(s):\nName: Shoyad Ibn Sabur Khan Nuhash | Name: Md. Abdullah Al Mamun\nSignature: | Signature:"}'::jsonb,'{}'::text[],true,true);
insert into stg_co values ('2025-07','BME 305',1,'Explain the fundamental techniques required for modeling biomedical control systems',array['C2']::text[],array['Lectures','Homework','Interactive discussions']::text[],array['Written exams']::text[],array['K1','K2','K3','K4','P1']::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 305',2,'Solve mathematical problems relating to biomedical control systems',array['C3']::text[],'{}'::text[],'{}'::text[],array['K1','K2','K3','K4','P1']::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 305',3,'Analyze characteristics of different biomedical control systems',array['C4']::text[],'{}'::text[],'{}'::text[],array['K1','K2','K3','K4','P1']::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 305',4,'Construct biomedical control systems that meet specified requirements',array['C3']::text[],'{}'::text[],'{}'::text[],array['K1','K2','K3','K4','P1']::text[],array['PO1']::text[]);
insert into stg_crit values ('2025-07','BME 305',0,'Term Final','Q. 01 (a)',10,array['CO2']::text[]);
insert into stg_crit values ('2025-07','BME 305',1,'Term Final','Q. 01 (b)',12,array['CO2']::text[]);
insert into stg_crit values ('2025-07','BME 305',2,'Term Final','Q. 01 (c)',13,array['CO2']::text[]);
insert into stg_crit values ('2025-07','BME 305',3,'Term Final','Q. 01 (d)',10,array['CO1']::text[]);
insert into stg_crit values ('2025-07','BME 305',4,'Term Final','Q. 05 (a)',20,array['CO3']::text[]);
insert into stg_crit values ('2025-07','BME 305',5,'Term Final','Q. 05 (b)',10,array['CO3']::text[]);
insert into stg_crit values ('2025-07','BME 305',6,'Term Final','Q. 05 (c)',15,array['CO4']::text[]);
insert into stg_att values ('2025-07','BME 305','CO','CO1',94.0,'workbook');
insert into stg_att values ('2025-07','BME 305','CO','CO2',98.0,'workbook');
insert into stg_att values ('2025-07','BME 305','CO','CO3',98.0,'workbook');
insert into stg_att values ('2025-07','BME 305','CO','CO4',92.0,'workbook');
insert into stg_att values ('2025-07','BME 305','PO','PO1',98.0,'workbook');
insert into stg_car values ('2025-07','BME 305','Teachers’ comment on attainment: CO1, CO4 attainment needs improvement.
Interpretation of student feedback: N/A
Teachers’ comment on teaching learning: More case studies and practical scenario related problems should be solved in class.','(Course file and corresponding CAR were not maintained previously. The changes were done based on faculty feedbacks.)
CO4 statement was updated to improve explainability, corresponding CO/PO mapping was kept unchanged
‘Interactive discussions’ was included as a delivery method across all four COs','');
insert into stg_off values ('2025-07','July 2025','BME 306',null,'Sessional based on BME 305.','The course will introduce simulation tools - Matlab and Simulink for modeling control systems.
The course will demonstrate the concept of modeling control systems, enable students to build and simulate models of biomedical control systems
The course will enable students to investigate the characteristics of biomedical control systems and engage students with the relevant research literature.','Bangladesh University of Engineering and Technology
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No:			BME 306
Course Title:		Biomedical Control Systems Sessional
Credit hours:		1.5				Contact hours:	3.0
Level/Term:			3/2
Academic Session: 	2023-2024
Course Teacher(s):
Name | Office/Room | Email & Telephone | Class routine
Shoyad Ibn Sabur Khan Nuhash | ECE 1017 | shoyadsabur@bme.buet.ac.bd
+8801515212213 | Monday (A1):
02:00 PM-05:00 PM Wednesday (A2):
11:00 AM-14:00:00
Samiul Based Shuvo | ECE 1121 | sbshuvo@bme.buet.ac.bd
+8801844453637 | Monday (A1):
02:00 PM-05:00 PM Wednesday (A2):
11:00 AM-14:00:00
Sayeed Sajjad Razin | ECE 1121 | razin@bme.buet.ac.bd
+8801521258181 | Monday (A1):
02:00 PM-05:00 PM Wednesday (A2):
11:00 AM-14:00:00
Course Contents:
Sessional based on BME 305.
Course Objectives:
The course will introduce simulation tools - Matlab and Simulink for modeling control systems.
The course will demonstrate the concept of modeling control systems, enable students to build and simulate models of biomedical control systems
The course will enable students to investigate the characteristics of biomedical control systems and engage students with the relevant research literature.
Course Outcomes:
Demonstrate understanding of basic principles of control systems
Apply control theory to model biomedical systems
Investigate biomedical control systems from recent research literature via designing, conducting experiments, and data analysis
Assessment:
Class Participation and Continuous Assessment	15%
Lab test	25%
Project	30%
Lab Quiz	30%
Textbooks and References:
Control Systems Engineering - Seventh Edition - Norman S. Nise.
Physiological Control Systems - Analysis, Simulation, and Estimation - Second Edition, - Michael C.K. Khoo.
Automatic Control Systems In Biomedical Engineering - An Interactive Educational Approach - J. Fernández de Cañete, C. Galindo, J. Barbancho, A. Luque. (2018)
Weekly Schedule:
Lecture | Topics
1 | Introduction to Simulink
2 | Implementation of Basic Control System Principles with MATLAB and SIMULINK
Reduction of multiple subsystems
Analysis of transient response of a second order system
System stability and effect of pole location on system stability
3 | Systems modeling of a robotic arm using PID controllers
4 | Continuous Assessment
5 | Linear model of lungs respiratory mechanics
Developing the initial linear model of lung respiratory mechanics
Calculating the volume delivered to the patient
6 | Intermediate presentation on project
7 | Neuromuscular reflex motion model
8 | Glucose - insulin regulation
9 | Stability analysis of control systems
10 | Construction of plots for frequency-response analysis of control systems
11 | Frequency response of a model of circulatory control
12 | Project presentation
13 | Lab test
14 | Final quiz
Prepared by:
Name:
Signature:
Date: | Shoyad Ibn Sabur Khan Nuhash
Name:
Signature:
Date: | Samiul Based Shuvo
Name:
Signature:
Date: | Sayeed Sajjad Razin','[{"name": "Shoyad Ibn Sabur Khan Nuhash", "room": "ECE 1017", "email": "shoyadsabur@bme.buet.ac.bd"}, {"name": "Samiul Based Shuvo", "room": "ECE 1121", "email": "sbshuvo@bme.buet.ac.bd"}, {"name": "Sayeed Sajjad Razin", "room": "ECE 1121", "email": "razin@bme.buet.ac.bd"}]'::jsonb,'[{"component": "Class Participation and Continuous Assessment", "percent": 15.0}, {"component": "Lab test", "percent": 25.0}, {"component": "Project", "percent": 30.0}, {"component": "Lab Quiz", "percent": 30.0}]'::jsonb,'[]'::jsonb,'{"folder": "1 - Course Files/L3T2/BME 306 Course Files/July 2025", "files": {"co_po_mapping": "July 2025/CO-PO Mapping.docx", "outline": "July 2025/BME 306_Course outline.docx", "assessment_workbook": "July 2025/Assessments and scripts/BME 306-CO-PO-Assessment-marks.xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 306\nCourse Title: | Biomedical Control Systems Sessional\nLevel, Term and Section | 3/2\nAcademic Term | July 2025\nTextbooks used: | Control Systems Engineering - Seventh Edition - Norman S. Nise.\nPhysiological Control Systems - Analysis, Simulation, and Estimation - Second Edition, - Michael C.K. Khoo.\nAutomatic Control Systems In Biomedical Engineering - An Interactive Educational Approach - J. Fernández de Cañete, C. Galindo, J. Barbancho, A. Luque. (2018)\nLast term when the course was offered | N/A\nPart B. Attainment for current and previous terms\nJuly 2025\nCO1 | CO2 | CO3\n100.00% | 86.27% | 100.00%\nY | Y | Y\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\nN/A | N/A | N/A | 100% | 98% | N/A | N/A | N/A | N/A | N/A | N/A | N/A\nN/A | N/A | N/A | Y | Y | N/A | N/A | N/A | N/A | N/A | N/A | N/A\nPart C. Analysis\nTeachers’ comment on attainment: Satisfactory\nInterpretation of student feedback: Satisfactory\nTeachers’ comment on teaching learning: None\nPart D. Comments on CQI implemented based on last assessment\nCO-PO mapping, lecture plan, and marks distribution were updated on this term upon discussion on the feedback mentioned in the previous CAR.\nPart E. Recommendation\nMajor issues: None\nPlan for future actions for further improvement: Additional experiments related to prosthetics and robotics can be added. The projects done in this lab can be enriched by modifying the requirements towards novelty.\nSignature(s):\nName: Shoyad Ibn Sabur Khan Nuhash | Name: Samiul Based Shuvo | Name: Sayeed Sajjad Razin\nSignature: | Signature: | Signature:"}'::jsonb,array['No K/P/A matrix in CO-PO mapping doc']::text[],true,true);
insert into stg_co values ('2025-07','BME 306',1,'Demonstrate understanding of basic principles of control systems',array['PS2']::text[],array['Lectures','Guided Instruction','Homework']::text[],array['Continuous Assessment','Lab Quiz']::text[],'{}'::text[],array['PO5']::text[]);
insert into stg_co values ('2025-07','BME 306',2,'Apply control theory to model biomedical systems',array['C3','PS3']::text[],array['Lectures','Guided Instruction','Homework']::text[],array['Lab Test','Lab Quiz']::text[],'{}'::text[],array['PO5']::text[]);
insert into stg_co values ('2025-07','BME 306',3,'Investigate biomedical control systems from recent research literature via designing, conducting experiments, and data analysis',array['C4','PS3']::text[],array['Interactive discussions']::text[],array['Project Presentation and/or Report']::text[],'{}'::text[],array['PO4']::text[]);
insert into stg_crit values ('2025-07','BME 306',0,'Continuous Assessment','Demonstrate understanding of basic principles of control systems',22.5,array['CO1']::text[]);
insert into stg_crit values ('2025-07','BME 306',1,'Project Presentation and/or Report','Investigate biomedical control systems from recent research literature via designing, conducting experiments, and data analysis',45,array['CO3']::text[]);
insert into stg_crit values ('2025-07','BME 306',2,'Lab Test','Apply control theory to model biomedical systems',37.5,array['CO2']::text[]);
insert into stg_crit values ('2025-07','BME 306',3,'Lab Quiz','Demonstrate understanding of basic principles of control systems',22.5,array['CO1']::text[]);
insert into stg_crit values ('2025-07','BME 306',4,'Lab Quiz','Apply control theory to model biomedical systems',22.5,array['CO2']::text[]);
insert into stg_att values ('2025-07','BME 306','CO','CO1',100,'workbook');
insert into stg_att values ('2025-07','BME 306','CO','CO2',86.27,'workbook');
insert into stg_att values ('2025-07','BME 306','CO','CO3',100,'workbook');
insert into stg_att values ('2025-07','BME 306','PO','PO4',100,'workbook');
insert into stg_att values ('2025-07','BME 306','PO','PO5',98.04,'workbook');
insert into stg_car values ('2025-07','BME 306','Teachers’ comment on attainment: Satisfactory
Interpretation of student feedback: Satisfactory
Teachers’ comment on teaching learning: None','CO-PO mapping, lecture plan, and marks distribution were updated on this term upon discussion on the feedback mentioned in the previous CAR.','Major issues: None
Plan for future actions for further improvement: Additional experiments related to prosthetics and robotics can be added. The projects done in this lab can be enriched by modifying the requirements towards novelty.');
insert into stg_bugs values ('BUGS 26.10.25','2025-10-26','https://buetedu-my.sharepoint.com/:b:/g/personal/shoyadsabur_bme_buet_ac_bd/IQCy_jpgTQFiT5eiZAwUwCoCAa3SOSsoXvVcBvXkXCbvP2o?e=dw7GtT','2025-07','BME 306');
insert into stg_off values ('2025-07','July 2025','BME 307',null,'Introduction to mass, momentum and heat transport in living systems; Conservation relations: mass, momentum and energy balance; Navier- Stokes equation; Passive scalar transport; Dimensional analysis and scaling; Low Reynolds number flow; Integral form of the conservation equations; Boundary layer theory; Peristaltic pumping; Flow in circulation and tissues; Basic molecular mechanics of fluid and electrolyte transport across cell membranes and epithelia; Mass transfer in biological systems:Conservations relations, constitutive relations, diffusion, diffusion with convection; Mass transfer coefficient and mass transfer in kidney dialysis; Transport in porous media; Mass transfer with biochemical interactions: Reaction, enzyme kinetics, cell-surface ligand-receptor kinetics; Heat transport: heat transfer by conduction, heat transport by convection, bioheat-transfer.','The course will discuss the roles of mass, momentum and heat transport in the function of physiological processes
The course will enable the students to analyze, solve and interpret mass, momentum and heat transport problems for both physiological and pathological conditions in biological systems
The course will help the students to develop an intermediate/advanced understanding of trans-endothelial transport and gas exchange between tissues and organs
The course will teach the students to apply dimensional analysis and other simplification techniques to the equations for the problems in mass, momentum and heat transport
The course will build an understanding of receptor-ligand kinetics and how to apply the kinetic models to study cell adhesion and intracellular signaling among students
The course will demonstrate the application of transport phenomena knowledge in designing biomedical devices','Bangladesh University of Engineering and Technology
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No:			BME 307
Course Title:		Biomedical Transport Fundamentals
Credit hours:		3.0				Contact hours:	3.0
Level/Term:			3/2
Academic Session: 	2023-2024
Course Teacher(s):
Name | Office/Room | Email & Telephone | Class routine
Md. Abdullah Al Mamun | ECE 1123 | abdullah@bme.buet.ac.bd
+8801797091595 | Saturday:
09:00 AM-09:50 AM Sunday:
09:00 AM-09:50 AM Tuesday:
11:00 AM-11:50:00
Dr. Jahid Ferdous | ECE 1121 | ferdousj@bme.buet.ac.bd
+8801844453637 | Saturday:
09:00 AM-09:50 AM Sunday:
09:00 AM-09:50 AM Tuesday:
11:00 AM-11:50:00
Course Contents:
Introduction to mass, momentum and heat transport in living systems; Conservation relations: mass, momentum and energy balance; Navier- Stokes equation; Passive scalar transport; Dimensional analysis and scaling; Low Reynolds number flow; Integral form of the conservation equations; Boundary layer theory; Peristaltic pumping; Flow in circulation and tissues; Basic molecular mechanics of fluid and electrolyte transport across cell membranes and epithelia; Mass transfer in biological systems:Conservations relations, constitutive relations, diffusion, diffusion with convection; Mass transfer coefficient and mass transfer in kidney dialysis; Transport in porous media; Mass transfer with biochemical interactions: Reaction, enzyme kinetics, cell-surface ligand-receptor kinetics; Heat transport: heat transfer by conduction, heat transport by convection, bioheat-transfer.
Course Objectives:
The course will discuss the roles of mass, momentum and heat transport in the function of physiological processes
The course will enable the students to analyze, solve and interpret mass, momentum and heat transport problems for both physiological and pathological conditions in biological systems
The course will help the students to develop an intermediate/advanced understanding of trans-endothelial transport and gas exchange between tissues and organs
The course will teach the students to apply dimensional analysis and other simplification techniques to the equations for the problems in mass, momentum and heat transport
The course will build an understanding of receptor-ligand kinetics and how to apply the kinetic models to study cell adhesion and intracellular signaling among students
The course will demonstrate the application of transport phenomena knowledge in designing biomedical devices
Course Outcomes:
Understand the basic concepts of biomedical transport phenomena
Apply conservation equations for different biomedical conditions
Infer solutions based on the analysis of biomedical transport problems
Analyze reaction kinetics and associated compartmental models
Assessment:
Class Participation	10%
Continuous Assessment	20%
Final Examination	70%
Textbooks and References:
Truskey, G. A., Yuan, F.,  Katz, D. F. (2010). Transport phenomena in biological systems. 2nd Edition. New Jersey: Pearson.
Fournier, R. L. (2017). Basic transport phenomena in biomedical engineering. 4th Edition. CRC press.
Cengel, Y.,  Cimbala, J. (2013). Fluid Mechanics Fundamentals and Applications (SI units). 4th Edition. McGraw Hill.
Datta, A. K. (2017). Heat and Mass Transfer: A Biological Context. 2nd Edition. CRC Press.
Kundu, P. K., Cohen, I. M.,  Dowling, D. R. (2015). Fluid mechanics. 6th Edition. Academic press.
Peattie, R. A., Fisher, R. J., Bronzino, J. D.,  Peterson, D. R. (Eds.). (2012). Transport phenomena in biomedical engineering: principles and practices. CRC Press.
Sharma, K. R. (2010). Transport Phenomena in Biomedical Engineering: Artificial organ Design and Development, and Tissue Engineering. McGraw-Hill Education.
Weekly Schedule:
Lecture | Topics
1—3 | Course introduction
- Introduction to mass, momentum and heat transport in living systems
- Examples of physiological transfer phenomena
- Lagrangian vs Eulerian approach; streamline, pathline
- Velocity; local and convective acceleration
4—6 | Basic concepts: mass, momentum and energy balance
- Fluid statics; buoyancy force
- Constitutive relations; rheology of Non-Newtonian fluid
- Rheology of blood flow in large vessels; Fahreus and Fahreus-Lindquist Effect
7—9 | Basic concepts: mass, momentum and energy balance
- Pressure driven flow of a power law fluid through a cylinder
- Flow between rotating cylinders; Taylor number
- Membrane and cortical tension
- Class test # 1
10—12 | Conservation relations: mass, momentum and energy balance
- Mass and momentum balance
- Cauchy momentum equation; integral form of the conservation equations
- Rotation of a fluid element
- Stress tensor; strain-rate tensor; viscous stress tensor
Dimensional analysis and scaling
- Moody diagram; Buckingham pi theorem
- Dimensional similarity; dimensionless numbers
13—15 | Navier- Stokes equation
- Derivations; Steady pressure driven flow in rectangular channel
Passive scalar transport
- Derivation; Applications
Low Reynolds number flow
- Derivation; Applications
16—18 | Boundary layer theory
Peristaltic pumping
Flow in circulation and tissues
19—21 | Heat transport
- Fourier’s Law; heat conduction equation; Pennes’ bioheat equation
- Unsteady state heat transfer; heat transport by convection
- 1D transient conduction problems (semi-infinite solid)
- Effect of convection on temperature profile
- Separation of variables techniques for solution of differential equation
- Theoretical determination of thermal properties for biomaterial
- Class test # 2
22—24 | - Introduction to mass transfer in biological systems
- Solute fluxes, constitutive relations, Diffusion
25—27 | - Conservation relations in rectangular and cylindrical coordinates.
28—30 | - Conservation relations in spherical coordinates.
- Mass transfer coefficient and its application in kidney dialysis
31—33 | - Fluid flow in porous media
- Mass transfer in porous media
- Class test # 3
34—36 | - Reaction and enzyme kinetics
- Enzyme Kinetics
37—39 | - Cell surface ligand-receptor kinetics
40—42 | - Transvascular transport
- Compartmental models for pharmacokinetic analyses
- Class test # 4
Prepared by:
Name:
Signature:
Date: | Md. Abdullah Al Mamun
Name:
Signature:
Date: | Dr. Jahid Ferdous','[{"name": "Md. Abdullah Al Mamun", "room": "ECE 1123", "email": "abdullah@bme.buet.ac.bd"}, {"name": "Dr. Jahid Ferdous", "room": "ECE 1121", "email": "ferdousj@bme.buet.ac.bd"}]'::jsonb,'[{"component": "Class Participation", "percent": 10.0}, {"component": "Continuous Assessment", "percent": 20.0}, {"component": "Final Examination", "percent": 70.0}]'::jsonb,'[]'::jsonb,'{"folder": "1 - Course Files/L3T2/BME 307 Course Files/July 2025", "files": {"co_po_mapping": "July 2025/CO-PO Mapping.docx", "outline": "July 2025/BME 307_Course outline.docx", "assessment_workbook": "July 2025/Assessments and scripts/BME 307-CO-PO-Assessment-marks.xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 307\nCourse Title: | Biomedical Transport Fundamentals\nLevel, Term and Section | 3/2\nAcademic Term | July 2025\nTextbooks used: | Truskey, G. A., Yuan, F.,  Katz, D. F. (2010). Transport phenomena in biological systems. 2nd Edition. New Jersey: Pearson.\nFournier, R. L. (2017). Basic transport phenomena in biomedical engineering. 4th Edition. CRC press.\nCengel, Y.,  Cimbala, J. (2013). Fluid Mechanics Fundamentals and Applications (SI units). 4th Edition. McGraw Hill.\nDatta, A. K. (2017). Heat and Mass Transfer: A Biological Context. 2nd Edition. CRC Press.\nKundu, P. K., Cohen, I. M.,  Dowling, D. R. (2015). Fluid mechanics. 6th Edition. Academic press.\nPeattie, R. A., Fisher, R. J., Bronzino, J. D.,  Peterson, D. R. (Eds.). (2012). Transport phenomena in biomedical engineering: principles and practices. CRC Press.\nSharma, K. R. (2010). Transport Phenomena in Biomedical Engineering: Artificial organ Design and Development, and Tissue Engineering. McGraw-Hill Education.\nLast term when the course was offered | N/A\nPart B. Attainment for current and previous terms\nJuly 2025\nCO1 | CO2 | CO3 | CO4\n78.43% | 92.16% | 80.39% | 66.67%\nY | Y | Y | Y\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\n88.24% | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A\nY | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A\nPart C. Analysis\nTeachers’ comment on attainment:\nInterpretation of student feedback:\nTeachers’ comment on teaching learning:\nPart D. Comments on CQI implemented based on last assessment\nPart E. Recommendation\nMajor issues:\nPlan for future actions for further improvement:\nSignature(s):\nName: Md. Abdullah Al Mamun | Name: Dr. Jahid Ferdous\nSignature: | Signature:"}'::jsonb,array['No K/P/A matrix in CO-PO mapping doc']::text[],true,true);
insert into stg_co values ('2025-07','BME 307',1,'Understand the basic concepts of biomedical transport phenomena',array['C2']::text[],array['Lectures','Homework','Audio-visual demonstration']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 307',2,'Apply conservation equations for different biomedical conditions',array['C3']::text[],array['Lectures','Homework','Tutorials']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 307',3,'Infer solutions based on the analysis of biomedical transport problems',array['C4']::text[],array['Lectures','Homework','Guided Discussion and Practice']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 307',4,'Analyze reaction kinetics and associated compartmental models',array['C4']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_crit values ('2025-07','BME 307',0,'Term Final','Q01 (a)',25,array['CO1']::text[]);
insert into stg_crit values ('2025-07','BME 307',1,'Term Final','Q01 (b)',20,array['CO3']::text[]);
insert into stg_crit values ('2025-07','BME 307',2,'Term Final','Q05 (a)',25,array['CO4']::text[]);
insert into stg_crit values ('2025-07','BME 307',3,'Term Final','Q05 (b)',20,array['CO2']::text[]);
insert into stg_att values ('2025-07','BME 307','CO','CO1',78.43,'workbook');
insert into stg_att values ('2025-07','BME 307','CO','CO2',92.16,'workbook');
insert into stg_att values ('2025-07','BME 307','CO','CO3',80.39,'workbook');
insert into stg_att values ('2025-07','BME 307','CO','CO4',66.67,'workbook');
insert into stg_att values ('2025-07','BME 307','PO','PO1',88.24,'workbook');
insert into stg_off values ('2025-07','July 2025','BME 313',null,'DNA and chromosomes: structure, regulation, DNA replication, repair and recombination from DNA to protein, control of gene expression; Modern recombinant DNA technology: manipulating and analysing DNA molecules,  DNA cloning in bacteria, DNA cloning by PCR, exploring and exploiting gene function; Membrane structure: the lipid bilayer, membrane proteins; Transport across cell membranes: transporters, ion channel, nerve cell signalling, intracellular compartments and protein transport; Cell signalling: general principles, G-protein-coupled receptors, enzyme-coupled receptors; Introduction to the immune system: properties and overview of immune responses, innate immunity, cells and tissue of the adaptive immune system; Recognition of antigens: antibodies and antigens, major histocompatibility complex, antigen processing and presentation to T lymphocytes, maturation, activation and regulation of lymphocytes; Effector mechanism: cytokines, effector mechanism for cell-mediated and humoral immunity.','The course will introduce the main concepts of gene expression and regulation
Different DNA recombinant experimental procedures will be covered
Principles of  transport across the cell membrane and cell signaling process will be discussed
Basic concepts, theories, and functions of the human immune system will be explained','Bangladesh University of Engineering and Technology
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No:			BME 313
Course Title:		Molecular Biology and Immunology
Credit hours:		3				Contact hours:	3
Level/Term:			3/2
Academic Session: 	2023-2024
Course Teacher(s):
Name | Office/Room | Email | Class routine
Samina Nishat Binte Akram | ECE 1125 | samina@bme.buet.ac.bd
+8801973730183 | Sunday:
12:00 AM-12:50 AM
Monday:
12:00 AM-12:50 AM
Tuesday:
9:00 AM-9:50:00
Dr. Jahid Ferdous | ECE 1021 | ferdousj@bme.buet.ac.bd
+880 1708-528993 | 
Course Contents:
DNA and chromosomes: structure, regulation, DNA replication, repair and recombination from DNA to protein, control of gene expression; Modern recombinant DNA technology: manipulating and analysing DNA molecules,  DNA cloning in bacteria, DNA cloning by PCR, exploring and exploiting gene function; Membrane structure: the lipid bilayer, membrane proteins; Transport across cell membranes: transporters, ion channel, nerve cell signalling, intracellular compartments and protein transport; Cell signalling: general principles, G-protein-coupled receptors, enzyme-coupled receptors; Introduction to the immune system: properties and overview of immune responses, innate immunity, cells and tissue of the adaptive immune system; Recognition of antigens: antibodies and antigens, major histocompatibility complex, antigen processing and presentation to T lymphocytes, maturation, activation and regulation of lymphocytes; Effector mechanism: cytokines, effector mechanism for cell-mediated and humoral immunity.
Course Objectives:
The course will introduce the main concepts of gene expression and regulation
Different DNA recombinant experimental procedures will be covered
Principles of  transport across the cell membrane and cell signaling process will be discussed
Basic concepts, theories, and functions of the human immune system will be explained
Course Outcomes:
Explain the central dogma of biochemistry and control of gene expressions
Identify experimental procedures using molecular and cell-based methods of modern recombinant DNA technology
Explain different cellular transport and signaling mechanisms
Describe the immune system and fundamental principles of immune responses
Identify various antigen recognition and effector mechanism of the immune system
Assessment:
Class participation/Attendance:		10%
Homework Assignment and Quizzes:	20%
Term Final Exam:				70%
Textbooks and References:
Essential Cell Biology 4th Edition by Bruce Alberts, Dennis Bray, Karen Hopkin, Alexander Johnson, Julian Lewis, Martin Raff, Keith Roberts, Peter Walter (2013)
Cellular and Molecular Immunology 9th Edition by Abul K. Abbas MBBS, Andrew H. Lichtman, Shiv Pillai (2018)
Basic Immunology: Functions and Disorders of the Immune System 5th Edition by Abul K. Abbas MBBS, Andrew H. Lichtman, Shiv Pillai (2016)
Weekly Schedule:
Week | Lecture Topics
1 | DNA and chromosomes:
Structure, regulation
DNA replication, transcription, translation, and repair
Control of gene expression
2 | Modern recombinant DNA technology
Manipulating and analyzing DNA molecules
DNA cloning in bacteria, DNA cloning by PCR
Exploring and exploiting gene function
Stem cells to treat diseases
3 | Membrane structure:
The lipid bilayer
Membrane proteins
4 | Transport across cell membranes:
Transporters, ion channel
Nerve cell signaling
Intracellular compartments and protein transport
5 | Cell signaling:
General principles
G-protein-coupled receptors
Enzyme-coupled receptors
Mid-term break
6 | Introduction to the immune system:
Overview of immune responses
Properties of immune responses
7 | Cell and tissue of immune system:
Innate immunity
Cells and tissue of the adaptive immune system
8 | Recognition of antigens:
Antibodies and antigens
Major histocompatibility complex
Polymer-cell interaction in suspension
Polymer scaffold-cell interaction
Inflammation
9 | T cell activation:
Antigen processing and presentation to T lymphocytes
Maturation, activation and regulation of T lymphocytes
10 | B Cell Activation:
Maturation, activation and regulation of B lymphocytes
Role of complement system on B cell activation
11 | Effector mechanism(cytokines):
Introduction to cytokines
Cytokines of Adaptive Immunity i.e., IL-2, IL-4, Interferon-gamma etc.
12-13 | Effector mechanism:
Cell-mediated immunity
Humoral immunity
Prepared by: | 
Name:
Signature:
Date: | Dr. Jahid Ferdous
Name:
Signature:
Date: | Samina Nishat Binte Akram','[{"name": "Samina Nishat Binte Akram", "room": "ECE 1125", "email": "samina@bme.buet.ac.bd"}, {"name": "Dr. Jahid Ferdous", "room": "ECE 1021", "email": "ferdousj@bme.buet.ac.bd"}]'::jsonb,'[{"component": "Class Participation", "percent": 10.0}, {"component": "Continuous Assessment", "percent": 20.0}, {"component": "Final Examination", "percent": 70.0}]'::jsonb,'[]'::jsonb,'{"folder": "1 - Course Files/L3T2/BME 313 Course Files/July 2025", "files": {"co_po_mapping": "July 2025/CO-PO Mapping.docx", "outline": "July 2025/BME 313_Course Outline.docx", "assessment_workbook": "July 2025/Assessments and scripts/BME 313-CO-PO-Assessment.xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 313\nCourse Title: | Molecular Biology and Immunology\nLevel, Term and Section | 3/2\nAcademic Term | July 2025\nTextbooks used: | Essential Cell Biology 4th Edition by Bruce Alberts, Dennis Bray, Karen Hopkin, Alexander Johnson, Julian Lewis, Martin Raff, Keith Roberts, Peter Walter (2013)\nCellular and Molecular Immunology 9th Edition by Abul K. Abbas MBBS, Andrew H. Lichtman, Shiv Pillai (2021)\nLast term when the course was offered | N/A\nPart B. Attainment for current and previous terms\nJuly 2025\nCO1 | CO2 | CO3 | CO4 | CO5\n76.47% | 84.31% | 62.75% | 70.59% | 96.08%\nY | Y | Y | Y | Y\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\n92.16% | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A\nY | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A\nPart C. Analysis\nTeachers’ comment on attainment: Attained\nInterpretation of student feedback:\nTeachers’ comment on teaching learning:\nPart D. Comments on CQI implemented based on last assessment\nPart E. Recommendation\nMajor issues:\nPlan for future actions for further improvement:\nSignature(s):\nName: Samina Nishat Binte Akram | Name: Dr. Jahid Ferdous\nSignature: | Signature:"}'::jsonb,'{}'::text[],true,true);
insert into stg_co values ('2025-07','BME 313',1,'Explain the central dogma of biochemistry and control of gene expressions',array['C2']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],array['K1','K2','K3','K4','P1']::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 313',2,'Identify experimental procedures using molecular and cell-based methods of modern recombinant DNA technology',array['C1']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],array['K1','K2','K3','K4','P1']::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 313',3,'Explain different cellular transport and signaling mechanisms',array['C2']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],array['K1','K2','K3','K4','P1']::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 313',4,'Describe the immune system and fundamental principles of immune responses',array['C1']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],array['K1','K2','K3','K4','P1']::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 313',5,'Identify various antigen recognition and effector mechanism of the immune system',array['C1']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],array['K1','K2','K3','K4','P1']::text[],array['PO1']::text[]);
insert into stg_crit values ('2025-07','BME 313',0,'Term Final','Q01 (a)',15,array['CO5']::text[]);
insert into stg_crit values ('2025-07','BME 313',1,'Term Final','Q01 (b)',10,array['CO5']::text[]);
insert into stg_crit values ('2025-07','BME 313',2,'Term Final','Q01 (c)',7,array['CO5']::text[]);
insert into stg_crit values ('2025-07','BME 313',3,'Term Final','Q01 (d)',8,array['CO4']::text[]);
insert into stg_crit values ('2025-07','BME 313',4,'Term Final','Q01 (e)',5,array['CO4']::text[]);
insert into stg_crit values ('2025-07','BME 313',5,'Term Final','Q05 (a)',15,array['CO1']::text[]);
insert into stg_crit values ('2025-07','BME 313',6,'Term Final','Q05 (b)',15,array['CO2']::text[]);
insert into stg_crit values ('2025-07','BME 313',7,'Term Final','Q05 (c)',15,array['CO3']::text[]);
insert into stg_att values ('2025-07','BME 313','CO','CO1',76.47,'workbook');
insert into stg_att values ('2025-07','BME 313','CO','CO2',84.31,'workbook');
insert into stg_att values ('2025-07','BME 313','CO','CO3',62.75,'workbook');
insert into stg_att values ('2025-07','BME 313','CO','CO4',70.59,'workbook');
insert into stg_att values ('2025-07','BME 313','CO','CO5',96.08,'workbook');
insert into stg_att values ('2025-07','BME 313','PO','PO1',92.16,'workbook');
insert into stg_car values ('2025-07','BME 313','Teachers’ comment on attainment: Attained
Interpretation of student feedback:
Teachers’ comment on teaching learning:','','');
insert into stg_bugs values ('BUGS 26.10.25','2025-10-26','https://buetedu-my.sharepoint.com/:b:/g/personal/shoyadsabur_bme_buet_ac_bd/IQCy_jpgTQFiT5eiZAwUwCoCAa3SOSsoXvVcBvXkXCbvP2o?e=dw7GtT','2025-07','BME 313');
insert into stg_off values ('2025-07','July 2025','BME 317',null,'Proteins: amino acid sequences, primary, secondary, tertiary and quaternary structure; classification of proteins; Enzyme kinetics: mechanism and regulation; Bioenergetics: the role of ATP, biological oxidation, respiratory chain, phosphorylation; Carbohydrates metabolism: citric acid cycle, glycolysis, oxidation of pyruvate, gluconeogenesis and the control of blood glucose, glycogen metabolism; Lipid metabolism: dietary lipid metabolism, fatty acid metabolism, triacylglycerol metabolism, ketone body metabolism, cholesterol metabolism, lipoprotein metabolism, steroid metabolism; Protein and amino acid metabolism: nitrogen disposal, degradation and synthesis, conversion to specialized products; Heme metabolism; Integration of metabolism: metabolism effect of insulin and glucagon, the fed-fast cycle, diabetes mellitus, obesity; Special topics: nutrition, vitamins and minerals, free radicals and antioxidants, metabolism of xenobiotics; Clinical biochemistry.','The course will introduce students to the basic knowledge of proteins, bioenergetics, nutrition, vitamins  minerals, free radicals  antioxidants
Enzyme kinetics will be covered in this course
This course will cover different metabolism techniques
Integration and effects of metabolism will be covered
Some topics of clinical biochemistry will be covered in this course','Bangladesh University of Engineering and Technology
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No:			BME 317
Course Title:		Biochemistry for Biomedical Engineers
Credit hours:		3.0				Contact hours:	3.0
Level/Term:			3/2
Academic Session: 	2023-2024
Course Teacher(s):
Name | Office/Room | Email & Telephone | Class routine
Md. Tazuddin Ahmed | ECE 1123 | mdtuahmed@bme.buet.ac.bd
+8801797091595 | Saturday:
09:00 AM-09:50 AM Sunday:
09:00 AM-09:50 AM Tuesday:
11:00 AM-11:50:00
Sayeed Sajjad Razin | ECE 1121 | razin@bme.buet.ac.bd
+8801844453637 | Saturday:
09:00 AM-09:50 AM Sunday:
09:00 AM-09:50 AM Tuesday:
11:00 AM-11:50:00
Course Contents:
Proteins: amino acid sequences, primary, secondary, tertiary and quaternary structure; classification of proteins; Enzyme kinetics: mechanism and regulation; Bioenergetics: the role of ATP, biological oxidation, respiratory chain, phosphorylation; Carbohydrates metabolism: citric acid cycle, glycolysis, oxidation of pyruvate, gluconeogenesis and the control of blood glucose, glycogen metabolism; Lipid metabolism: dietary lipid metabolism, fatty acid metabolism, triacylglycerol metabolism, ketone body metabolism, cholesterol metabolism, lipoprotein metabolism, steroid metabolism; Protein and amino acid metabolism: nitrogen disposal, degradation and synthesis, conversion to specialized products; Heme metabolism; Integration of metabolism: metabolism effect of insulin and glucagon, the fed-fast cycle, diabetes mellitus, obesity; Special topics: nutrition, vitamins and minerals, free radicals and antioxidants, metabolism of xenobiotics; Clinical biochemistry.
Course Objectives:
The course will introduce students to the basic knowledge of proteins, bioenergetics, nutrition, vitamins  minerals, free radicals  antioxidants
Enzyme kinetics will be covered in this course
This course will cover different metabolism techniques
Integration and effects of metabolism will be covered
Some topics of clinical biochemistry will be covered in this course
Course Outcomes:
Illustrate different properties and classification of biomolecules, mechanism and regulation of enzymes
Discuss the role and process of bioenergetics
Explain carbohydrates, lipid, protein and amino acid metabolism processes
Discuss the integration and effect of different metabolism processes
Assessment:
Class Participation	10%
Continuous Assessment	20%
Final Examination	70%
Textbooks and References:
Lippincott Illustrated Reviews: Biochemistry (Lippincott Illustrated Reviews Series) 7th Edition
Harper''s Illustrated Biochemistry Thirty-First Edition 31st Edition
Weekly Schedule:
Lecture | Topics
1—3 | Proteins
amino acid sequences
primary, secondary, tertiary and quaternary structure
classification of proteins
4—6 | Enzyme kinetics
mechanism and regulation
7—9 | Bioenergetics
the role of ATP
biological oxidation
respiratory chain
phosphorylation
Class Test#01(CO-1,CO-2)
10—12 | Carbohydrates metabolism
citric acid cycle
Glycolysis
oxidation of pyruvate
gluconeogenesis and the control of blood glucose
13—15 | Carbohydrates metabolism
glycogen metabolism
Lipid metabolism
dietary lipid metabolism
fatty acid metabolism
triacylglycerol metabolism
ketone body metabolism
16—18 | Lipid metabolism
cholesterol metabolism
lipoprotein metabolism
steroid metabolism
Class Test#02(CO-3)
19—21 | Protein and amino acid metabolism
nitrogen disposal
degradation and synthesis
22—24 | Protein and amino acid metabolism
conversion to specialized products
Heme metabolism
25—27 | Integration of metabolism
metabolism effect of insulin and glucagon
Class Test#03(CO-3,CO-4)
28—30 | Integration of metabolism
the fed-fast cycle
31—33 | Integration of metabolism
diabetes mellitus
obesity
34—36 | Special topics
Nutrition
vitamins and minerals
free radicals and antioxidants
37—39 | Special topics
metabolism of xenobiotics
Class Test#04(CO-4,CO-1)
40—42 | Clinical biochemistry
Prepared by:
Name:
Signature:
Date: | Md. Tazuddin Ahmed
Name:
Signature:
Date: | Sayeed Sajjad Razin','[{"name": "Md. Tazuddin Ahmed", "room": "ECE 1123", "email": "mdtuahmed@bme.buet.ac.bd"}, {"name": "Sayeed Sajjad Razin", "room": "ECE 1121", "email": "razin@bme.buet.ac.bd"}]'::jsonb,'[{"component": "Class Participation", "percent": 10.0}, {"component": "Continuous Assessment", "percent": 20.0}, {"component": "Final Examination", "percent": 70.0}]'::jsonb,'[]'::jsonb,'{"folder": "1 - Course Files/L3T2/BME 317 Course Files/July 2025", "files": {"co_po_mapping": "July 2025/CO-PO Mapping.docx", "outline": "July 2025/BME 317_Course outline.docx", "assessment_workbook": "July 2025/Assessments and scripts/BME 317-CO-PO-Assessment-marks.xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 317\nCourse Title: | Biochemistry for Biomedical Engineers\nLevel, Term and Section | 3/2\nAcademic Term | July 2025\nTextbooks used: | Lippincott Illustrated Reviews: Biochemistry (Lippincott Illustrated Reviews Series) 7th Edition\nHarper''s Illustrated Biochemistry Thirty-First Edition 31st Edition\nLast term when the course was offered | N/A\nPart B. Attainment for current and previous terms\nJuly 2025\nCO1 | CO2 | CO3 | CO4\n94.12% | 84.31% | 86.27% | 84.31%\nY | Y | Y | Y\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\n90.2% | 84.3% | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A\nY | Y | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A\nPart C. Analysis\nTeachers’ comment on attainment: Satisfactory\nInterpretation of student feedback: Satisfactory\nTeachers’ comment on teaching learning: The course mainly relies on slides that reduce engagement in the classroom.\nPart D. Comments on CQI implemented based on last assessment\nN/A\nPart E. Recommendation\nMajor issues: None\nPlan for future actions for further improvement: The course content can be increased to include more fundamental concepts of human biochemistry. Efforts can also be made to make the content more structured.\nSignature(s):\nName: Md. Tazuddin Ahmed | Name: Sayeed Sajjad Razin\nSignature: | Signature:"}'::jsonb,array['No K/P/A matrix in CO-PO mapping doc']::text[],true,true);
insert into stg_co values ('2025-07','BME 317',1,'Illustrate different properties and classification of biomolecules, mechanism and regulation of enzymes',array['C2']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 317',2,'Discuss the role and process of bioenergetics',array['C2']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 317',3,'Explain carbohydrates, lipid, protein and amino acid metabolism processes',array['C2']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 317',4,'Discuss the integration and effect of different metabolism processes',array['C2']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO2']::text[]);
insert into stg_crit values ('2025-07','BME 317',0,'Term Final','Q01 (a)',15,array['CO3']::text[]);
insert into stg_crit values ('2025-07','BME 317',1,'Term Final','Q01 (b)',15,array['CO4']::text[]);
insert into stg_crit values ('2025-07','BME 317',2,'Term Final','Q01 (c)',10,array['CO3']::text[]);
insert into stg_crit values ('2025-07','BME 317',3,'Term Final','Q01 (d)',5,array['CO4']::text[]);
insert into stg_crit values ('2025-07','BME 317',4,'Term Final','Q05 (a)',15,array['CO1']::text[]);
insert into stg_crit values ('2025-07','BME 317',5,'Term Final','Q05 (b)',15,array['CO2']::text[]);
insert into stg_crit values ('2025-07','BME 317',6,'Term Final','Q05 (c)',15,array['CO2']::text[]);
insert into stg_att values ('2025-07','BME 317','CO','CO1',94.12,'workbook');
insert into stg_att values ('2025-07','BME 317','CO','CO2',84.31,'workbook');
insert into stg_att values ('2025-07','BME 317','CO','CO3',86.27,'workbook');
insert into stg_att values ('2025-07','BME 317','CO','CO4',84.31,'workbook');
insert into stg_att values ('2025-07','BME 317','PO','PO1',90.2,'workbook');
insert into stg_att values ('2025-07','BME 317','PO','PO2',84.31,'workbook');
insert into stg_car values ('2025-07','BME 317','Teachers’ comment on attainment: Satisfactory
Interpretation of student feedback: Satisfactory
Teachers’ comment on teaching learning: The course mainly relies on slides that reduce engagement in the classroom.','','Major issues: None
Plan for future actions for further improvement: The course content can be increased to include more fundamental concepts of human biochemistry. Efforts can also be made to make the content more structured.');
insert into stg_off values ('2025-07','July 2025','BME 320',null,null,'This course aims to provide the students with practical hands-on training and knowledge about technologies and topics of BME specific to the industry/organization s/he will be assigned to
This course enhances and supplements the theoretical knowledge and skills of the students
Through this course, the students are given the opportunity to nurture, practice and enhance their ability, competence, leadership skills, interpersonal relationship and responsibility to efficiently execute an assigned task in a professional job environment
This course provides a comprehensive platform to students where they can build up and enhance their employability skills and become ready for the job market
This course exposes the students to a professional job environment to gain hands on practice and experience along with rules, regulations and safety practices
Knowledge required
Basic engineering and biomedical engineering knowledge','Department of Biomedical Engineering
Bangladesh University of Engineering and Technology | COURSE OUTLINE
PART A: General Information
Course Number			BME 320
Course Title			Industrial Attachment
Credit (Contact) Hours		1.0 (3 weeks)
Level and Term (Section)	Level-3, Term-2
Academic Term			July 2025
Type of Course			Core
Offered to			Department of Biomedical Engineering
Pre-requisite Course(s)
Course Website			https://teams.microsoft.com (BME 320)
Lecture Schedule		N/A
Important Dates	For important dates and examination schedules and latest updates, please 
follow the announcements on the Microsoft Teams group.
Course Teacher(s)
Name | Office | Email | Consultation Hour(s)
Md. Tazuddin Ahmed | ECE 1123 | mdtuahmed@bme.buet.ac.bd | Wednesday (2:00 – 3.00 PM)
Sayeed Sajjad Razin | ECE 1121 | razin@bme.buet.ac.bd | Wednesday (2:00 – 3.00 PM)
PART B: Course Details
Course Content (As approved by the Academic Council)
The student will be placed in an organization where s/he will gain practical hands-on training on certain topics of BME. The organization will be in the medical equipment manufacturing / assembling industry, hospital, clinic, and so on. The student will be evaluated by the course teacher based on evaluation and feedback of the attached organization.
Course Objectives
This course aims to provide the students with practical hands-on training and knowledge about technologies and topics of BME specific to the industry/organization s/he will be assigned to
This course enhances and supplements the theoretical knowledge and skills of the students
Through this course, the students are given the opportunity to nurture, practice and enhance their ability, competence, leadership skills, interpersonal relationship and responsibility to efficiently execute an assigned task in a professional job environment
This course provides a comprehensive platform to students where they can build up and enhance their employability skills and become ready for the job market
This course exposes the students to a professional job environment to gain hands on practice and experience along with rules, regulations and safety practices
Knowledge required
Basic engineering and biomedical engineering knowledge
Course Outcomes
CO No. | CO Statement | Corresponding PO(s)* | Domains and Taxonomy level(s)** | Delivery Method(s) and Activity(-ies) | Assessment Tool(s)
1 | Understand and describe the relevant organisational structure, workflow, work culture and safety protocols of biomedical industries or healthcare institutions. | PO-6 | C2 | Guided instructions by professionals, documenting workflows and structures | Presentation
2 | Engage in professional activities and apply hands-on skills under supervision in a biomedical or clinical environment. | PO-5 | PS3 | On-site demonstrations and Hands-on activities | Daily Reports
3 | Demonstrate effective interpersonal skills, including teamwork, communication, and adaptability in a professional setting | PO-10 | AF-3 | Group activity,
Attending meetings,
Collaborating on daily tasks | Assessment Report
*PO-1: Engineering knowledge; PO-2: Problem analysis; PO-3: Design/development of solutions; PO-4: Investigation; PO-
  5: Modern tool use; PO-6: The engineer and society; PO-7: Environment and sustainability; PO-8: Ethics; PO-9: Individual 
  work and teamwork; PO-10: Communication; PO-11: Project management and finance; PO-12: life-long learning.
**C-Cognitive: C1: Knowledge; C2: Comprehension; C3: Application; C4: Analysis; C5: Synthesis; C6: Evaluation.
A-Affective: A1: Receiving; A2: Responding; A3: Valuing; A4: Organizing; A5: Characterizing.
P-Psychomotor: P1: Perception; P2: Set; P3: Guided Response; P4: Mechanism; P5: Complex Overt Response; P6:   Adaptation; P7: Organization.
Lecture Plan
Week # | Lecture Topics | Corresponding CO(s)
1 | Demonstrations of various facilities and hands-on training
(To be coordinated by the industry) | CO-1, CO-2, CO-3
2 | Demonstrations of various facilities and hands-on training (ctd.)
(To be coordinated by the industry)
# Site visit by faculty members | CO-1, CO-2, CO-3
3 | Demonstrations of various facilities and hands-on training (ctd.)
(To be coordinated by the industry) | CO-1, CO-2, CO-3
4 | Submission of daily report and assessment reports
Presentation to the department | CO-1, CO-2, CO-3
Assessment Strategy
Assessment Reports: Each industry/organization will provide an assessment report for each student with detailed information about the student’s participation and performance during the industrial attachment period.
Daily Report: Each student will have to submit a detailed official report for each day at the attachment site to the department following the industrial attachment.
Presentation: Students will also be required to give a presentation about his/her industrial attachment program experience.
Distribution of Marks
Assessment Component | Marks
Assessment report | 20%
Daily report | 10%
Presentation | 70%
Textbook/References
To be provided by the specific industry/organization
Important University Policies:
Rules and regulations for the undergraduate programmes: Ordinance for the Undergraduate Programme
Important Departmental/Course Policies
Program Outcomes: Link to program outcomes
Learning Domains: Link to learning domains
Prepared by
Name: Sayeed Sajjad Razin
Signature:
Date of Preparation: 20/10/25
Date of Approval by BUGS: 26/10/25','[{"name": "Md. Tazuddin Ahmed", "room": "ECE 1123", "email": "mdtuahmed@bme.buet.ac.bd"}, {"name": "Sayeed Sajjad Razin", "room": "ECE 1121", "email": "razin@bme.buet.ac.bd"}]'::jsonb,'[{"component": "Assessment report", "percent": 20.0}, {"component": "Daily report", "percent": 10.0}, {"component": "Presentation", "percent": 70.0}]'::jsonb,'[]'::jsonb,'{"folder": "1 - Course Files/L3T2/BME 320 Course Files/July 2025", "files": {"co_po_mapping": "July 2025/CO-PO Mapping.docx", "outline": "July 2025/BME 320_Course outline.docx", "assessment_workbook": "July 2025/Assessments and scripts/BME 320-CO-PO-Assessment-marks.xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 320\nCourse Title: | Industrial Attachment\nLevel, Term and Section | 3/2\nAcademic Term | July 2025\nTextbooks used: | To be provided by the specific industry/organization\nLast term when the course was offered | N/A\nPart B. Attainment for current and previous terms\nJuly 2025\nCO1 | CO2 | CO3\n98.00% | 98.00% | 98.00%\nY | Y | Y\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\nN/A | N/A | N/A | N/A | 98.00% | 98.00% | N/A | N/A | N/A | 98.00% | N/A | N/A\nN/A | N/A | N/A | N/A | Y | Y | N/A | N/A | N/A | Y | N/A | N/A\nPart C. Analysis\nTeachers’ comment on attainment: Satisfactory\nInterpretation of student feedback: N/A\nTeachers’ comment on teaching learning: N/A\nPart D. Comments on CQI implemented based on last assessment\nAssessment tools and their corresponding weightage were updated based on feedback from alumni through CAR of previous iteration.\nPart E. Recommendation\nMajor issues: None.\nPlan for future actions for further improvement:\nWe need to have MOU with at least some of the sites before the next attachment session starts; this will help to run things smoother.\nRegarding preference collection, this must be more efficient; students should have an easier option to properly order the sites based on preference. Current modality collects site names as question answer: inconvenient for both students while submitting, and for us while automating preference extraction\nSignature(s):\nName: Md. Tazuddin Ahmed | Name: Sayeed Sajjad Razin\nSignature: | Signature:"}'::jsonb,array['No K/P/A matrix in CO-PO mapping doc']::text[],true,true);
insert into stg_co values ('2025-07','BME 320',1,'Understand and describe the relevant organisational structure, workflow, work culture and safety protocols of biomedical industries or healthcare institutions.',array['C2']::text[],array['Guided instructions by professionals','documenting workflows and structures']::text[],array['Presentations']::text[],'{}'::text[],array['PO6']::text[]);
insert into stg_co values ('2025-07','BME 320',2,'Engage in professional activities and apply hands-on skills under supervision in a biomedical or clinical environment.',array['PS3']::text[],array['On-site demonstrations and Hands-on activities']::text[],array['Daily Reports']::text[],'{}'::text[],array['PO5']::text[]);
insert into stg_co values ('2025-07','BME 320',3,'Demonstrate effective interpersonal skills, including teamwork, communication, and adaptability in a professional setting',array['AF3']::text[],array['Group activity','Attending meetings','Collaborating on daily tasks']::text[],array['Assessment Report']::text[],'{}'::text[],array['PO10']::text[]);
insert into stg_crit values ('2025-07','BME 320',0,'Presentation','Understand and describe the relevant organisational structure, workflow, work culture and safety protocols of biomedical industries or healthcare institutions.',70,array['CO1']::text[]);
insert into stg_crit values ('2025-07','BME 320',1,'Daily Reports','Engage in professional activities and apply hands-on skills under supervision in a biomedical or clinical environment.',10,array['CO2']::text[]);
insert into stg_crit values ('2025-07','BME 320',2,'Assessment Report','Demonstrate effective interpersonal skills, including teamwork, communication, and adaptability in a professional setting',20,array['CO3']::text[]);
insert into stg_att values ('2025-07','BME 320','CO','CO1',100,'workbook');
insert into stg_att values ('2025-07','BME 320','CO','CO2',100,'workbook');
insert into stg_att values ('2025-07','BME 320','CO','CO3',100,'workbook');
insert into stg_att values ('2025-07','BME 320','PO','PO5',100,'workbook');
insert into stg_att values ('2025-07','BME 320','PO','PO6',100,'workbook');
insert into stg_att values ('2025-07','BME 320','PO','PO10',100,'workbook');
insert into stg_car values ('2025-07','BME 320','Teachers’ comment on attainment: Satisfactory
Interpretation of student feedback: N/A
Teachers’ comment on teaching learning: N/A','Assessment tools and their corresponding weightage were updated based on feedback from alumni through CAR of previous iteration.','Major issues: None.
Plan for future actions for further improvement:
We need to have MOU with at least some of the sites before the next attachment session starts; this will help to run things smoother.
Regarding preference collection, this must be more efficient; students should have an easier option to properly order the sites based on preference. Current modality collects site names as question answer: inconvenient for both students while submitting, and for us while automating preference extraction');
insert into stg_off values ('2023-01','January 2023','BME 350','BME 19',null,'This course will introduce undergraduate students to the advanced methods of biomedical engineering design
The course will involve students in the concept generation of a medical device and develop a demonstrable prototype
Students will interact with medical professionals to iteratively improve design concepts
Students will become familiar with the ethical principles, regulatory framework, and commercial aspects of bioengineering design.','Bangladesh University of Engineering and Technology
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No:			BME 350
Course Title:		Biomedical Engineering Design II
Credit hours:		3				Contact hours:	3
Level/Term:			3/2
Academic Session: 	2021-2022
Course Teacher(s):
Name | Office/Room | Email and Telephone No. | Class routine
Md. Kawsar Ahmed | ECE-1018 | kawsarahmed@bme.buet.ac.bd
+1 (434) 882-5397 | Sunday:
11:00 AM-1:30 PM
Shoyad Ibn Sabur Khan Nuhash | ECE-1018 | shoyadsabur@bme.buet.ac.bd
+880 1515212213 | 
Taufiq Hasan Aneem | ECE-1018 | taufiqhaneem@bme.buet.ac.bd
+880 1742-134695 | 
Md. Tazuddin Ahmed | ECE-1018 | mdtuahmed@bme.buet.ac.bd
+880 1797-091595 | 
Samiul Based Shuvo | ECE-1018 | sbshuvo@bme.buet.ac.bd
+ 880 1521-258181 | 
Shams Nafisa Ali | ECE-1019 | nafisa@bme.buet.ac.bd
+880 1731-953973 | 
Course Objectives:
This course will introduce undergraduate students to the advanced methods of biomedical engineering design
The course will involve students in the concept generation of a medical device and develop a demonstrable prototype
Students will interact with medical professionals to iteratively improve design concepts
Students will become familiar with the ethical principles, regulatory framework, and commercial aspects of bioengineering design.
Course Outcomes:
Design of experiments for clinical feasibility evaluation based on appropriate ethical guidelines
Revise the conceptual design of the medical device considering clinical feasibility and the regulatory pathway
Assess the environmental impact and sustainability of the conceptual design
Modify medical device prototype based on the revised conceptual design and perform bench-top testing
Evaluate the commercial aspects of the developed medical device
Display the ability to function within a multidisciplinary team
Demonstrate ethical practices standards in case of dealing with clinical/patient data
Shows effective communication skills within and outside the team
Assessment:
Continuous Assessment 	10%
Presentation			25%
Demonstration			40%
Report				15%
Intermediate Submissions 	10%
Assessment Strategy
Continuous Assessment: Continuous assessment through assigned tasks by the supervisor. The scheme of the continuous assessment for the course will be decided by the supervisor, which may include presentations, demonstrations or written assignments.
Demonstration: Demonstrations will be given by the student on the design work conducted within the course period.
Presentation: Presentation will be given by the student on the design work conducted within the course period.
Final Report: A final report is required to be submitted on the design project.
Intermediate Submissions : Intermediate submissions from the students will be taken in the form of written documentations on IRB (Institutional Review Board) and Patents
Textbooks and References:
Paul, Stefanos A. Zenios Josh Makower, and G. Yock. "Biodesign: The Process Of Innovating Medical Technologies."
Ogrodnik, Peter J. Medical device design: innovation from concept to market. Academic Press, 2019.
Yazdi, Youseph, and Soumyadipta Acharya. "A new model for graduate education and innovation in medical technology." Annals of Biomedical Engineering 41.9 (2013): 1822-1833.
Bos, Gert. "ISO 13485: 2003/2016—Medical Devices—Quality Management Systems—Requirements for Regulatory Purposes." Handbook of Medical Device Regulatory Affairs in Asia. Pan Stanford, 2018. 153-174. (Sec 7.3)
Weekly Schedule:
Week# | Lecture Topics
1 | Design experiments for clinical feasibility evaluation
- 	Assess regulatory pathway
- 	Design experiments for device evaluation
- 	Plan for possible device failure modes
- 	Assess safety (Patient, User &  Device level safety)
2 | Assess the clinical feasibility
- 	Check device failure modes
- 	Get clinical usability feedback from experts
- 	Get patient feedback
3 | Assess the environmental impact and sustainability of the medical device prototype
- 	Assess the environmental impact - such as biodegradable / disposable / reusable/ toxic to the environment/ recyclable etc
- 	Assess the sustainability of the device
4 | Revise the design of the medical device based on assessments
- 	Consider the device failure modes
- 	Consider patient & expert feedback
- 	Consider the environmental impact and regulatory pathway
5 | Modify the prototype based on the revised design
6 | Continue developing and improving prototype
7 | Continue developing and improving prototype
8. | Continue developing and improving prototype
9 | Assess the patentability, manufacturing feasibility and scalability of the final prototype
10 | Evaluate the commercial aspects of the developed medical device
11 | Validate the medical device prototype through bench-top testing
-         Perform bench-top testing
-         Evaluate the performance of the device against standards and specifications
12 | Validate the final prototype in an appropriate healthcare setting
- 	Perform experiments based on prepared protocols
13 | Final Demonstration & report submission','[{"name": "Md. Kawsar Ahmed", "room": "ECE-1018", "email": "kawsarahmed@bme.buet.ac.bd"}, {"name": "Shoyad Ibn Sabur Khan Nuhash", "room": "ECE-1018", "email": "shoyadsabur@bme.buet.ac.bd"}, {"name": "Taufiq Hasan Aneem", "room": "ECE-1018", "email": "taufiqhaneem@bme.buet.ac.bd"}, {"name": "Md. Tazuddin Ahmed", "room": "ECE-1018", "email": "mdtuahmed@bme.buet.ac.bd"}, {"name": "Samiul Based Shuvo", "room": "ECE-1018", "email": "sbshuvo@bme.buet.ac.bd"}, {"name": "Shams Nafisa Ali", "room": "ECE-1019", "email": "nafisa@bme.buet.ac.bd"}]'::jsonb,'[]'::jsonb,'[{"component": "Continuous Assessment", "weight": 0.1, "marks": 15}, {"component": "Presentation", "weight": 0.25, "marks": 37.5}, {"component": "Demonstration", "weight": 0.4, "marks": 60}, {"component": "Report", "weight": 0.15, "marks": 22.5}, {"component": "Intermediate Submissions", "weight": 0.1, "marks": 15}]'::jsonb,'{"folder": "1 - Course Files/L3T2/BME 350 Course Files/January 2023", "files": {"co_po_mapping": "January 2023/CO-PO mapping.docx", "outline": "January 2023/BME 350 Course Outline.docx", "assessment_workbook": "January 2023/Assessments and Scripts/BME 350-CO-PO-Assessment Marks-Jan-23 (BME19).xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 350\nCourse Title: | Biomedical Engineering Design II\nLevel, Term and Section | 3/2\nAcademic Term | January 2023\nTextbooks used: | Quantitative Human Physiology: An Introduction, Second Edition, Joseph Feher.\nHuman Physiology: An Integrated Approach, Eighth Edition, Dee Unglaub\nSilverthorn.\nMathematical Physiology II: Systems Physiology, Second Edition, James Keener, James Sneyd.\nPhysiology by Numbers: An Encouragement to Quantitative Thinking, Second Edition, Richard F. Burton.\nLast term when the course was offered | January 2022\nPart B. Attainment for current and previous terms\nCurrent term:\n(From the excel worksheet)\nCO1 | CO2 | CO3 | CO4 | CO5 | CO6 | CO7 | CO8 | CO9 | CO10 | CO11 | CO12\n100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | NA | NA | NA | NA\nY | Y | Y | Y | Y | Y | Y | Y | NA | NA | NA | NA\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\nNA | NA | NA | 100 | 100 | NA | 100 | 100 | 100 | 100 | 100 | NA\nNA | NA | NA | Y | Y | NA | Y | Y | Y | Y | Y | NA\nPrevious term: Not available\nPart C. Analysis\nTeachers’ comment on attainment: All the course outcomes (COs) mapped to this course were achieved by 100% of students. The overall attainment is highly satisfactory, with all assessed outcomes surpassing the attainment threshold of 40%.\nInterpretation of student feedback: N/A\nTeachers’ comment on teaching learning: The current structure effectively facilitates student engagement in design-based learning. However, in future iterations, increased exposure to field observations and stakeholder interaction is recommended to further strengthen design contextualization and real-world applicability.\nPart D. Comments on CQI implemented based on last assessment\nThe assessment tools, delivery methods, and marks distribution were revised based on feedback from the course teachers obtained through CAR (course assessment report) and deliberations within the BUGS meeting.\nPart E. Recommendation\nMajor issues: None\nPlan for future actions for further improvement:\nBased on the current course delivery and outcome assessment, the following actions are recommended to enhance the alignment of BME 350: Biomedical Engineering Design II with the Outcome-Based Education (OBE) framework and to support continuous quality improvement.\nRefinement and Expansion of COs: The wording of several existing COs may be revised to better reflect the intended learning domains and to ensure alignment with the Program Outcomes (POs), particularly with respect to the Bloom’s Taxonomy and BAETE’s prescribed taxonomy levels. Additionally, new COs should be introduced to explicitly map to PO-2 (problem analysis) and PO-6 (understanding societal, health, safety, legal, and cultural issues), as these are presently underrepresented in the current course structure. These revisions will improve both the clarity and relevance of outcome assessment.\nInclusion of Self and Peer Evaluation Mechanisms: To more accurately assess students’ ability to function effectively within multidisciplinary teams, as mapped to CO-9 and PO-9, the implementation of Self and Peer Evaluation tools is recommended. These evaluations will offer insight into team dynamics, individual contributions, and collaborative effectiveness, thus providing a more comprehensive measure of teamwork-related outcomes.\nSignature(s):\nName: Mr. Md. Wahidur Rahman Rafsan | Name: Mr. Shoyad Ibn Sabur Khan Nuhash | Name: Ms. Shams Nafisa Ali | Name: Mr. Samiul Based Shuvo\nSignature: | Signature: | Signature: | Signature:"}'::jsonb,'{}'::text[],true,true);
insert into stg_co values ('2023-01','BME 350',1,'Design of experiments for clinical feasibility evaluation based on appropriate ethical guidelines',array['C6']::text[],array['Lectures']::text[],array['Presentations','Demonstration']::text[],array['K6','K8','P1','P4','A1']::text[],array['PO8']::text[]);
insert into stg_co values ('2023-01','BME 350',2,'Revise the conceptual design of the medical device considering clinical feasibility and the regulatory pathway',array['C5']::text[],array['Discussion','Clinical Observation','Lectures']::text[],array['Presentations']::text[],array['K2','K3','K4','K5','K6','K8','P1','P2','P3','P4','P6','P7','A1','A2','A3']::text[],array['PO4']::text[]);
insert into stg_co values ('2023-01','BME 350',3,'Assess the environmental impact and sustainability of the conceptual design',array['C5']::text[],array['Case Study','Discussion','Lectures']::text[],array['Presentations']::text[],array['K6','P2','P3','P4','A1','A2']::text[],array['PO7']::text[]);
insert into stg_co values ('2023-01','BME 350',4,'Modify medical device prototype based on the revised conceptual design and perform bench-top testing',array['PS5']::text[],array['Discussion','Lectures']::text[],array['Presentations']::text[],array['K2','K3','K4','K5','K6','K8','P1','P2','P3','P4','P6','P7','A1','A2','A3']::text[],array['PO5']::text[]);
insert into stg_co values ('2023-01','BME 350',5,'Evaluate the commercial aspects of the developed medical device',array['C5']::text[],array['Discussion','Lectures']::text[],array['Presentations','Final Report']::text[],array['K7','A1']::text[],array['PO11']::text[]);
insert into stg_co values ('2023-01','BME 350',6,'Display the ability to function within a multidisciplinary team',array['AF5']::text[],array['Lectures']::text[],array['Continuous Assessment']::text[],array['K7','A1']::text[],array['PO9']::text[]);
insert into stg_co values ('2023-01','BME 350',7,'Demonstrate ethical practices standards in case of dealing with clinical/patient data',array['AF5']::text[],array['Lectures']::text[],array['Demonstration','Final Report','Intermediate Submission']::text[],array['K7','A1']::text[],array['PO8']::text[]);
insert into stg_co values ('2023-01','BME 350',8,'Shows effective communication skills within and outside the team',array['AF5']::text[],array['Lectures']::text[],array['Presentations','Demonstration','Final Report','Intermediate Submission']::text[],array['K7','A1']::text[],array['PO10']::text[]);
insert into stg_crit values ('2023-01','BME 350',0,'Continuous Assessment','Continuous Assessment',15,array['CO6']::text[]);
insert into stg_crit values ('2023-01','BME 350',1,'Presentation 01','Background/motivation',1,array['CO1']::text[]);
insert into stg_crit values ('2023-01','BME 350',2,'Presentation 01','Feedback from stakeholders',1,array['CO1']::text[]);
insert into stg_crit values ('2023-01','BME 350',3,'Presentation 01','Iteration 1',4.5,array['CO2']::text[]);
insert into stg_crit values ('2023-01','BME 350',4,'Presentation 01','Technical Feasibility',1,array['CO2']::text[]);
insert into stg_crit values ('2023-01','BME 350',5,'Presentation 01','Method of Evaluation of key parameters',1,array['CO1']::text[]);
insert into stg_crit values ('2023-01','BME 350',6,'Presentation 01','Time management & presentation skills',1.5,array['CO8']::text[]);
insert into stg_crit values ('2023-01','BME 350',7,'Demo 01','Clinical Feasibility Evaluation',10,array['CO1']::text[]);
insert into stg_crit values ('2023-01','BME 350',8,'Demo 01','Modification steps taken from iteration 1',20,array['CO4']::text[]);
insert into stg_crit values ('2023-01','BME 350',9,'Presentation 02','Presentation skills',2.5,array['CO8']::text[]);
insert into stg_crit values ('2023-01','BME 350',10,'Presentation 02','Environment and Sustainibility',2.5,array['CO3']::text[]);
insert into stg_crit values ('2023-01','BME 350',11,'Presentation 02','Financial Analysis',5,array['CO5']::text[]);
insert into stg_crit values ('2023-01','BME 350',12,'Presentation 02','Design',2.5,array['CO4']::text[]);
insert into stg_crit values ('2023-01','BME 350',13,'Presentation 02','Performance Evaluation/ Results and Discussions',2.5,array['CO4']::text[]);
insert into stg_crit values ('2023-01','BME 350',14,'Presentation 02','QNA',8,array['CO8']::text[]);
insert into stg_crit values ('2023-01','BME 350',15,'Demo 02','Design Requirement',5,array['CO4']::text[]);
insert into stg_crit values ('2023-01','BME 350',16,'Demo 02','Design Accomplishment',5,array['CO4']::text[]);
insert into stg_crit values ('2023-01','BME 350',17,'Demo 02','Result Analysis and Design Verification (Bencho top testing or other forms of verification)',10,array['CO4']::text[]);
insert into stg_crit values ('2023-01','BME 350',18,'Demo 02','Adherence to ethical standards',5,array['CO7']::text[]);
insert into stg_crit values ('2023-01','BME 350',19,'Demo 02','Poster',5,array['CO8']::text[]);
insert into stg_crit values ('2023-01','BME 350',20,'Final Report','Introduction to Problem',2.5,array['CO4']::text[]);
insert into stg_crit values ('2023-01','BME 350',21,'Final Report','Background and Literature Review',2.5,array['CO4']::text[]);
insert into stg_crit values ('2023-01','BME 350',22,'Final Report','Effective Presentation of Methodology',5,array['CO4']::text[]);
insert into stg_crit values ('2023-01','BME 350',23,'Final Report','Adherence to Ethical Practices/Codes',5,array['CO7']::text[]);
insert into stg_crit values ('2023-01','BME 350',24,'Final Report','Financial Analysis',5,array['CO8']::text[]);
insert into stg_crit values ('2023-01','BME 350',25,'Intermediate Submissions','IRB',12,array['CO7']::text[]);
insert into stg_crit values ('2023-01','BME 350',26,'Intermediate Submissions','Patent',3,array['CO8']::text[]);
insert into stg_att values ('2023-01','BME 350','CO','CO1',100,'workbook');
insert into stg_att values ('2023-01','BME 350','CO','CO2',100,'workbook');
insert into stg_att values ('2023-01','BME 350','CO','CO3',100,'workbook');
insert into stg_att values ('2023-01','BME 350','CO','CO4',100,'workbook');
insert into stg_att values ('2023-01','BME 350','CO','CO5',100,'workbook');
insert into stg_att values ('2023-01','BME 350','CO','CO6',100,'workbook');
insert into stg_att values ('2023-01','BME 350','CO','CO7',100,'workbook');
insert into stg_att values ('2023-01','BME 350','CO','CO8',100,'workbook');
insert into stg_att values ('2023-01','BME 350','PO','PO4',100,'workbook');
insert into stg_att values ('2023-01','BME 350','PO','PO5',100,'workbook');
insert into stg_att values ('2023-01','BME 350','PO','PO7',100,'workbook');
insert into stg_att values ('2023-01','BME 350','PO','PO8',100,'workbook');
insert into stg_att values ('2023-01','BME 350','PO','PO9',100,'workbook');
insert into stg_att values ('2023-01','BME 350','PO','PO10',100,'workbook');
insert into stg_att values ('2023-01','BME 350','PO','PO11',100,'workbook');
insert into stg_car values ('2023-01','BME 350','Teachers’ comment on attainment: All the course outcomes (COs) mapped to this course were achieved by 100% of students. The overall attainment is highly satisfactory, with all assessed outcomes surpassing the attainment threshold of 40%.
Interpretation of student feedback: N/A
Teachers’ comment on teaching learning: The current structure effectively facilitates student engagement in design-based learning. However, in future iterations, increased exposure to field observations and stakeholder interaction is recommended to further strengthen design contextualization and real-world applicability.','The assessment tools, delivery methods, and marks distribution were revised based on feedback from the course teachers obtained through CAR (course assessment report) and deliberations within the BUGS meeting.','Major issues: None
Plan for future actions for further improvement:
Based on the current course delivery and outcome assessment, the following actions are recommended to enhance the alignment of BME 350: Biomedical Engineering Design II with the Outcome-Based Education (OBE) framework and to support continuous quality improvement.
Refinement and Expansion of COs: The wording of several existing COs may be revised to better reflect the intended learning domains and to ensure alignment with the Program Outcomes (POs), particularly with respect to the Bloom’s Taxonomy and BAETE’s prescribed taxonomy levels. Additionally, new COs should be introduced to explicitly map to PO-2 (problem analysis) and PO-6 (understanding societal, health, safety, legal, and cultural issues), as these are presently underrepresented in the current course structure. These revisions will improve both the clarity and relevance of outcome assessment.
Inclusion of Self and Peer Evaluation Mechanisms: To more accurately assess students’ ability to function effectively within multidisciplinary teams, as mapped to CO-9 and PO-9, the implementation of Self and Peer Evaluation tools is recommended. These evaluations will offer insight into team dynamics, individual contributions, and collaborative effectiveness, thus providing a more comprehensive measure of teamwork-related outcomes.');
insert into stg_bugs values ('BUGS 24.05.23','2023-05-24','https://buetedu-my.sharepoint.com/:b:/g/personal/shoyadsabur_bme_buet_ac_bd/IQCwGTaeGZKSSrsUez4AqbU7AQPjaRxzhveK0TT7McKogGw?e=b5IQmP','2023-01','BME 350');
insert into stg_off values ('2024-01','January 2024','BME 350','BME 20',null,'This course will introduce undergraduate students to the advanced methods of biomedical engineering design
The course will involve students in the concept generation of a medical device and develop a demonstrable prototype
Students will interact with medical professionals to iteratively improve design concepts
Students will become familiar with the ethical principles, regulatory framework, and commercial aspects of bioengineering design.','Bangladesh University of Engineering and Technology
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No:			BME 350
Course Title:		Biomedical Engineering Design II
Credit hours:		3				Contact hours:	3
Level/Term:			3/2
Academic Session: 	2022-2023
Course Teacher(s):
Name | Office/Room | Email | Class routine
Samina Nishat Binte Akram | ECE-1125 | samina@bme.buet.ac.bd
+880 1973730183 | Saturday (A1)
11:00 AM - 01:30 PM
Shoyad Ibn Sabur Khan Nuhash | ECE-1018 | shoyadsabur@bme.buet.ac.bd
+880 1515212213 | 
Samiul Based Shuvo | ECE-1018 | sbshuvo@bme.buet.ac.bd
+ 880 1521-258181 | 
Md. Tazuddin Ahmed | ECE-1018 | mdtuahmed@bme.buet.ac.bd
+880 1797-091595 | 
Tasnia Binte Mamun | ECE-1125 | tasnia@bme.buet.ac.bd
+880 1677 900 345 | Monday (A2)
02:30 PM - 05:00 PM
Shoyad Ibn Sabur Khan Nuhash | ECE-1018 | shoyadsabur@bme.buet.ac.bd
+880 1515212213 | 
Shams Nafisa Ali | ECE-1019 | nafisa@bme.buet.ac.bd
+880 1731-953973 | 
Md. Abdullah Al Mamun | ECE-1123 | abdullah@bme.buet.ac.bd
+880 1639 008 395 | 
Course Objectives:
This course will introduce undergraduate students to the advanced methods of biomedical engineering design
The course will involve students in the concept generation of a medical device and develop a demonstrable prototype
Students will interact with medical professionals to iteratively improve design concepts
Students will become familiar with the ethical principles, regulatory framework, and commercial aspects of bioengineering design.
Course Outcomes:
Design of experiments for clinical feasibility evaluation based on appropriate ethical guidelines
Revise the conceptual design of the medical device considering clinical feasibility and the regulatory pathway
Assess the environmental impact and sustainability of the conceptual design
Modify medical device prototype based on the revised conceptual design and perform bench-top testing
Evaluate the commercial aspects of the developed medical device
Display the ability to function within a multidisciplinary team
Demonstrate ethical practices standards in case of dealing with clinical/patient data
Shows effective communication skills within and outside the team
Assessment:
Continuous Assessment 	10%
Presentation			25%
Demonstration			40%
Report				15%
Intermediate Submissions 	10%
Assessment Strategy
Continuous Assessment: Continuous assessment through assigned tasks by the supervisor. The scheme of the continuous assessment for the course will be decided by the supervisor, which may include presentations, demonstrations or written assignments.
Demonstration: Demonstrations will be given by the student on the design work conducted within the course period.
Presentation: Presentation will be given by the student on the design work conducted within the course period.
Final Report: A final report is required to be submitted on the design project.
Intermediate Submissions : Intermediate submissions from the students will be taken in the form of written documentations on IRB (Institutional Review Board) and Patents
Textbooks and References:
Paul, Stefanos A. Zenios Josh Makower, and G. Yock. "Biodesign: The Process Of Innovating Medical Technologies."
Ogrodnik, Peter J. Medical device design: innovation from concept to market. Academic Press, 2019.
Yazdi, Youseph, and Soumyadipta Acharya. "A new model for graduate education and innovation in medical technology." Annals of Biomedical Engineering 41.9 (2013): 1822-1833.
Bos, Gert. "ISO 13485: 2003/2016—Medical Devices—Quality Management Systems—Requirements for Regulatory Purposes." Handbook of Medical Device Regulatory Affairs in Asia. Pan Stanford, 2018. 153-174. (Sec 7.3)
Weekly Schedule:
Week# | Lecture Topics
1 | Design experiments for clinical feasibility evaluation
- 	Assess regulatory pathway
- 	Design experiments for device evaluation
- 	Plan for possible device failure modes
- 	Assess safety (Patient, User &  Device level safety)
2 | Assess the clinical feasibility
- 	Check device failure modes
- 	Get clinical usability feedback from experts
- 	Get patient feedback
3 | Assess the environmental impact and sustainability of the medical device prototype
- 	Assess the environmental impact - such as biodegradable / disposable / reusable/ toxic to the environment/ recyclable etc
- 	Assess the sustainability of the device
4 | Revise the design of the medical device based on assessments
- 	Consider the device failure modes
- 	Consider patient & expert feedback
- 	Consider the environmental impact and regulatory pathway
5 | Modify the prototype based on the revised design
6 | Continue developing and improving prototype
7 | Continue developing and improving prototype
8. | Continue developing and improving prototype
9 | Assess the patentability, manufacturing feasibility and scalability of the final prototype
10 | Evaluate the commercial aspects of the developed medical device
11 | Validate the medical device prototype through bench-top testing
-         Perform bench-top testing
-         Evaluate the performance of the device against standards and specifications
12 | Validate the final prototype in an appropriate healthcare setting
- 	Perform experiments based on prepared protocols
13 | Final Demonstration & report submission','[{"name": "Md. Kawsar Ahmed", "room": "ECE-1018", "email": "kawsarahmed@bme.buet.ac.bd"}, {"name": "Shoyad Ibn Sabur Khan Nuhash", "room": "ECE-1018", "email": "shoyadsabur@bme.buet.ac.bd"}, {"name": "Taufiq Hasan Aneem", "room": "ECE-1018", "email": "taufiqhaneem@bme.buet.ac.bd"}, {"name": "Md. Tazuddin Ahmed", "room": "ECE-1018", "email": "mdtuahmed@bme.buet.ac.bd"}, {"name": "Samiul Based Shuvo", "room": "ECE-1018", "email": "sbshuvo@bme.buet.ac.bd"}, {"name": "Shams Nafisa Ali", "room": "ECE-1019", "email": "nafisa@bme.buet.ac.bd"}]'::jsonb,'[]'::jsonb,'[{"component": "Continuous Assessment", "weight": 0.1, "marks": 15}, {"component": "Presentation", "weight": 0.25, "marks": 37.5}, {"component": "Demonstration", "weight": 0.4, "marks": 60}, {"component": "Report", "weight": 0.15, "marks": 22.5}, {"component": "Intermediate Submissions", "weight": 0.1, "marks": 15}]'::jsonb,'{"folder": "1 - Course Files/L3T2/BME 350 Course Files/January 2024", "files": {"co_po_mapping": "January 2024/CO-PO mapping.docx", "outline": "January 2024/BME 350 Course Outline.docx", "assessment_workbook": "January 2024/Assessments and Scripts/BME 350_CO-PO-Assessments-Jan-24 (BME20).xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 350\nCourse Title: | Biomedical Engineering Design II\nLevel, Term and Section | 3/2\nAcademic Term | January 2024\nTextbooks used: | Quantitative Human Physiology: An Introduction, Second Edition, Joseph Feher.\nHuman Physiology: An Integrated Approach, Eighth Edition, Dee Unglaub\nSilverthorn.\nMathematical Physiology II: Systems Physiology, Second Edition, James Keener, James Sneyd.\nPhysiology by Numbers: An Encouragement to Quantitative Thinking, Second Edition, Richard F. Burton.\nLast term when the course was offered | January 2023\nPart B. Attainment for current and previous terms\nCurrent term:\n(From the excel worksheet)\nCO1 | CO2 | CO3 | CO4 | CO5 | CO6 | CO7 | CO8 | CO9 | CO10 | CO11 | CO12\n100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | NA | NA | NA | NA\nY | Y | Y | Y | Y | Y | Y | Y | NA | NA | NA | NA\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\nNA | NA | NA | 100 | 100 | NA | 100 | 100 | 100 | 100 | 100 | NA\nNA | NA | NA | Y | Y | NA | Y | Y | Y | Y | Y | NA\nPrevious term:\nCO1 | CO2 | CO3 | CO4 | CO5 | CO6 | CO7 | CO8 | CO9 | CO10 | CO11 | CO12\n100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | NA | NA | NA | NA\nY | Y | Y | Y | Y | Y | Y | Y | NA | NA | NA | NA\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\nNA | NA | NA | 100 | 100 | NA | 100 | 100 | 100 | 100 | 100 | NA\nNA | NA | NA | Y | Y | NA | Y | Y | Y | Y | Y | NA\nPart C. Analysis\nTeachers’ comment on attainment: All the course outcomes (COs) mapped to this course were achieved by 100% of students. The overall attainment is highly satisfactory, with all assessed outcomes surpassing the attainment threshold of 40%.\nInterpretation of student feedback: N/A\nTeachers’ comment on teaching learning: The current structure effectively facilitates student engagement in design-based learning. However, in future iterations, increased exposure to field observations and stakeholder interaction is recommended to further strengthen design contextualization and real-world applicability.\nPart D. Comments on CQI implemented based on last assessment\nN/A\nPart E. Recommendation\nMajor issues: None\nPlan for future actions for further improvement:\nBased on the current course delivery and outcome assessment, the following actions are recommended to enhance the alignment of BME 350: Biomedical Engineering Design II with the Outcome-Based Education (OBE) framework and to support continuous quality improvement.\nInclusion of Self and Peer Evaluation Mechanisms: To more accurately assess students’ ability to function effectively within multidisciplinary teams, as mapped to CO-9 and PO-9, the implementation of Self and Peer Evaluation tools is recommended.\nIntegration of CEA Assessment Tools: To strengthen the evidence of attainment for complex engineering competencies, it is recommended that,\nA Complex Engineering Activities (CEA) Assessment Form be incorporated and completed at the end of the semester. This will provide structured feedback on the level and nature of complex activities undertaken by students.\nSignature(s):\nName: Mr. Md. Wahidur Rahman Rafsan | Name: Mr. Shoyad Ibn Sabur Khan Nuhash | Name: Ms. Shams Nafisa Ali | Name: Mr. Samiul Based Shuvo\nSignature: | Signature: | Signature: | Signature:"}'::jsonb,'{}'::text[],true,true);
insert into stg_co values ('2024-01','BME 350',1,'Design of experiments for clinical feasibility evaluation based on appropriate ethical guidelines',array['C6']::text[],array['Lectures']::text[],array['Presentations','Demonstration']::text[],array['K6','K8','P1','P4','A1']::text[],array['PO8']::text[]);
insert into stg_co values ('2024-01','BME 350',2,'Revise the conceptual design of the medical device considering clinical feasibility and the regulatory pathway',array['C5']::text[],array['Discussion','Clinical Observation','Lectures']::text[],array['Presentations']::text[],array['K2','K3','K4','K5','K6','K8','P1','P2','P3','P4','P6','P7','A1','A2','A3']::text[],array['PO4']::text[]);
insert into stg_co values ('2024-01','BME 350',3,'Assess the environmental impact and sustainability of the conceptual design',array['C5']::text[],array['Case Study','Discussion','Lectures']::text[],array['Presentations']::text[],array['K6','P2','P3','P4','A1','A2']::text[],array['PO7']::text[]);
insert into stg_co values ('2024-01','BME 350',4,'Modify medical device prototype based on the revised conceptual design and perform bench-top testing',array['PS5']::text[],array['Discussion','Lectures']::text[],array['Presentations']::text[],array['K2','K3','K4','K5','K6','K8','P1','P2','P3','P4','P6','P7','A1','A2','A3']::text[],array['PO5']::text[]);
insert into stg_co values ('2024-01','BME 350',5,'Evaluate the commercial aspects of the developed medical device',array['C5']::text[],array['Discussion','Lectures']::text[],array['Presentations','Final Report']::text[],array['K7','A1']::text[],array['PO11']::text[]);
insert into stg_co values ('2024-01','BME 350',6,'Display the ability to function within a multidisciplinary team',array['AF5']::text[],array['Lectures']::text[],array['Continuous Assessment']::text[],array['K7','A1']::text[],array['PO9']::text[]);
insert into stg_co values ('2024-01','BME 350',7,'Demonstrate ethical practices standards in case of dealing with clinical/patient data',array['AF5']::text[],array['Lectures']::text[],array['Demonstration','Final Report','Intermediate Submission']::text[],array['K7','A1']::text[],array['PO8']::text[]);
insert into stg_co values ('2024-01','BME 350',8,'Shows effective communication skills within and outside the team',array['AF5']::text[],array['Lectures']::text[],array['Presentations','Demonstration','Final Report','Intermediate Submission']::text[],array['K7','A1']::text[],array['PO10']::text[]);
insert into stg_crit values ('2024-01','BME 350',0,'Continuous Assessment','Continuous Assessment',15,array['CO6']::text[]);
insert into stg_crit values ('2024-01','BME 350',1,'Presentation 01','Background/motivation',1,array['CO1']::text[]);
insert into stg_crit values ('2024-01','BME 350',2,'Presentation 01','Feedback from stakeholders',1,array['CO1']::text[]);
insert into stg_crit values ('2024-01','BME 350',3,'Presentation 01','Iteration 1',4.5,array['CO2']::text[]);
insert into stg_crit values ('2024-01','BME 350',4,'Presentation 01','Technical Feasibility',1,array['CO2']::text[]);
insert into stg_crit values ('2024-01','BME 350',5,'Presentation 01','Method of Evaluation of key parameters',1,array['CO1']::text[]);
insert into stg_crit values ('2024-01','BME 350',6,'Presentation 01','Time management & presentation skills',1.5,array['CO8']::text[]);
insert into stg_crit values ('2024-01','BME 350',7,'Demo 01','Clinical Feasibility Evaluation',10,array['CO1']::text[]);
insert into stg_crit values ('2024-01','BME 350',8,'Demo 01','Modification steps taken from iteration 1',20,array['CO4']::text[]);
insert into stg_crit values ('2024-01','BME 350',9,'Presentation 02','Presentation skills',2.5,array['CO8']::text[]);
insert into stg_crit values ('2024-01','BME 350',10,'Presentation 02','Environment and Sustainibility',2.5,array['CO3']::text[]);
insert into stg_crit values ('2024-01','BME 350',11,'Presentation 02','Financial Analysis',5,array['CO5']::text[]);
insert into stg_crit values ('2024-01','BME 350',12,'Presentation 02','Design',2.5,array['CO4']::text[]);
insert into stg_crit values ('2024-01','BME 350',13,'Presentation 02','Performance Evaluation/ Results and Discussions',2.5,array['CO4']::text[]);
insert into stg_crit values ('2024-01','BME 350',14,'Presentation 02','Novelty',1.5,array['CO8']::text[]);
insert into stg_crit values ('2024-01','BME 350',15,'Presentation 02','Pros & Cons',1.5,array['CO8']::text[]);
insert into stg_crit values ('2024-01','BME 350',16,'Presentation 02','Further Directions/ Future Recommendation',1.5,array['CO8']::text[]);
insert into stg_crit values ('2024-01','BME 350',17,'Presentation 02','QNA',8,array['CO8']::text[]);
insert into stg_crit values ('2024-01','BME 350',18,'Demo 02','Design Requirement',5,array['CO4']::text[]);
insert into stg_crit values ('2024-01','BME 350',19,'Demo 02','Design Accomplishment',5,array['CO4']::text[]);
insert into stg_crit values ('2024-01','BME 350',20,'Demo 02','Result Analysis and Design Verification (Bencho top testing or other forms of verification)',10,array['CO4']::text[]);
insert into stg_crit values ('2024-01','BME 350',21,'Demo 02','Adherence to ethical standards',5,array['CO7']::text[]);
insert into stg_crit values ('2024-01','BME 350',22,'Demo 02','Poster',5,array['CO8']::text[]);
insert into stg_crit values ('2024-01','BME 350',23,'Final Report','Introduction to Problem',2.5,array['CO8']::text[]);
insert into stg_crit values ('2024-01','BME 350',24,'Final Report','Background and Literature Review',2.5,array['CO8']::text[]);
insert into stg_crit values ('2024-01','BME 350',25,'Final Report','Effective Presentation of Methodology',5,array['CO8']::text[]);
insert into stg_crit values ('2024-01','BME 350',26,'Final Report','Adherence to Ethical Practices/Codes',5,array['CO7']::text[]);
insert into stg_crit values ('2024-01','BME 350',27,'Final Report','Financial Analysis',5,array['CO5']::text[]);
insert into stg_crit values ('2024-01','BME 350',28,'Final Report','Overall Formatting',2.5,array['CO8']::text[]);
insert into stg_crit values ('2024-01','BME 350',29,'Intermediate Submissions','IRB',12,array['CO7']::text[]);
insert into stg_crit values ('2024-01','BME 350',30,'Intermediate Submissions','Patent',3,array['CO8']::text[]);
insert into stg_att values ('2024-01','BME 350','CO','CO1',100,'workbook');
insert into stg_att values ('2024-01','BME 350','CO','CO2',100,'workbook');
insert into stg_att values ('2024-01','BME 350','CO','CO3',100,'workbook');
insert into stg_att values ('2024-01','BME 350','CO','CO4',100,'workbook');
insert into stg_att values ('2024-01','BME 350','CO','CO5',100,'workbook');
insert into stg_att values ('2024-01','BME 350','CO','CO6',100,'workbook');
insert into stg_att values ('2024-01','BME 350','CO','CO7',100,'workbook');
insert into stg_att values ('2024-01','BME 350','CO','CO8',100,'workbook');
insert into stg_att values ('2024-01','BME 350','PO','PO4',100,'workbook');
insert into stg_att values ('2024-01','BME 350','PO','PO5',100,'workbook');
insert into stg_att values ('2024-01','BME 350','PO','PO7',100,'workbook');
insert into stg_att values ('2024-01','BME 350','PO','PO8',100,'workbook');
insert into stg_att values ('2024-01','BME 350','PO','PO9',100,'workbook');
insert into stg_att values ('2024-01','BME 350','PO','PO10',100,'workbook');
insert into stg_att values ('2024-01','BME 350','PO','PO11',100,'workbook');
insert into stg_car values ('2024-01','BME 350','Teachers’ comment on attainment: All the course outcomes (COs) mapped to this course were achieved by 100% of students. The overall attainment is highly satisfactory, with all assessed outcomes surpassing the attainment threshold of 40%.
Interpretation of student feedback: N/A
Teachers’ comment on teaching learning: The current structure effectively facilitates student engagement in design-based learning. However, in future iterations, increased exposure to field observations and stakeholder interaction is recommended to further strengthen design contextualization and real-world applicability.','','Major issues: None
Plan for future actions for further improvement:
Based on the current course delivery and outcome assessment, the following actions are recommended to enhance the alignment of BME 350: Biomedical Engineering Design II with the Outcome-Based Education (OBE) framework and to support continuous quality improvement.
Inclusion of Self and Peer Evaluation Mechanisms: To more accurately assess students’ ability to function effectively within multidisciplinary teams, as mapped to CO-9 and PO-9, the implementation of Self and Peer Evaluation tools is recommended.
Integration of CEA Assessment Tools: To strengthen the evidence of attainment for complex engineering competencies, it is recommended that,
A Complex Engineering Activities (CEA) Assessment Form be incorporated and completed at the end of the semester. This will provide structured feedback on the level and nature of complex activities undertaken by students.');
insert into stg_off values ('2025-07','July 2025','BME 350','BME 21',null,null,null,'[{"name": "Samiul Based Shuvo", "room": "ECE-1121", "email": "sbshuvo@bme.buet.ac.bd"}, {"name": "Shoyad Ibn Sabur Khan Nuhash", "room": "ECE-1017", "email": "shoyadsabur@bme.buet.ac.bd"}, {"name": "Samina Nishat Binte Akram", "room": "ECE- 1125", "email": "samina@bme.buet.ac.bd"}, {"name": "Srija Sarkar Anannya", "room": "ECE- 1013", "email": "srija@bme.buet.ac.bd"}, {"name": "Md. Tazuddin Ahmed", "room": "ECE-1123", "email": "mdtuahmed@bme.buet.ac.bd"}, {"name": "Samiul Based Shuvo", "room": "ECE-1121", "email": "sbshuvo@bme.buet.ac.bd"}, {"name": "Md. Abdullah Al Mamun", "room": "ECE-1123", "email": "abdullah@bme.buet.ac.bd"}, {"name": "Tasnia Binte Mamun", "room": "ECE- 1125", "email": "tasnia@bme.buet.ac.bd"}]'::jsonb,'[{"component": "Continuous Assessment", "percent": 10.0}, {"component": "Presentation", "percent": 25.0}, {"component": "Demonstration", "percent": 40.0}, {"component": "Report", "percent": 15.0}, {"component": "Intermediate Submissions", "percent": 10.0}]'::jsonb,'[{"component": "Continuous Assessment", "weight": 0.1, "marks": 15}, {"component": "Presentation -1", "weight": 0.1, "marks": 15}, {"component": "Demonstration", "weight": 0.4, "marks": 60}, {"component": "Presentation -2", "weight": 0.15, "marks": 22.5}, {"component": "Report", "weight": 0.25, "marks": 37.5}]'::jsonb,'{"folder": "1 - Course Files/L3T2/BME 350 Course Files/July 2025", "files": {"co_po_mapping": "July 2025/CO-PO Mapping.docx", "outline": "July 2025/BME 350 - July 2025 - Course Outline.pdf", "assessment_workbook": "July 2025/Assessments and Scripts/BME 350_CO-PO-Assessment-Jul-25 (BME21).xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 350\nCourse Title: | Biomedical Engineering Design II\nLevel, Term and Section | 3/2\nAcademic Term | July 2025\nTextbooks used: | Paul, Stefanos A. Zenios Josh Makower, and G. Yock. \"Biodesign: The Process Of Innovating Medical Technologies.\"\nOgrodnik, Peter J. Medical device design: innovation from concept to market. Academic Press, 2019.\nYazdi, Youseph, and Soumyadipta Acharya. \"A new model for graduate education and innovation in medical technology.\" Annals of Biomedical Engineering 41.9 (2013): 1822-1833.\nBos, Gert. \"ISO 13485: 2003/2016—Medical Devices—Quality Management Systems—Requirements for Regulatory Purposes.\" Handbook of Medical Device Regulatory Affairs in Asia. Pan Stanford, 2018. 153-174. (Sec 7.3)\nLast term when the course was offered | January 2024\nPart B. Attainment for current and previous terms\nCurrent term:\n(From the excel worksheet)\nCO1 | CO2 | CO3 | CO4 | CO5 | CO6 | CO7 | CO8 | CO9 | CO10 | CO11 | CO12\n100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | NA | NA\nY | Y | Y | Y | Y | Y | Y | Y | Y | Y | NA | NA\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\nNA | 100 | NA | 100 | 100 | NA | 100 | 100 | 1 | NA | 100 | NA\nNA | Y | NA | Y | Y | NA | Y | Y | Y | NA | Y | NA\nPrevious term:\nCO1 | CO2 | CO3 | CO4 | CO5 | CO6 | CO7 | CO8 | CO9 | CO10 | CO11 | CO12\n100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | NA | NA | NA | NA\nY | Y | Y | Y | Y | Y | Y | Y | NA | NA | NA | NA\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\nNA | NA | NA | 100 | 100 | NA | 100 | 100 | 100 | 100 | 100 | NA\nNA | NA | NA | Y | Y | NA | Y | Y | Y | Y | Y | NA\nPart C. Analysis\nTeachers’ comment on attainment: All the course outcomes (COs) mapped to this course were achieved by 100% of students. The overall attainment is highly satisfactory, with all assessed outcomes surpassing the attainment threshold of 40%.\nInterpretation of student feedback: N/A\nTeachers’ comment on teaching learning: The current structure effectively facilitates student engagement in design-based learning. However, in future iterations, increased exposure to field observations and stakeholder interaction is recommended to further strengthen design contextualization and real-world applicability.\nPart D. Comments on CQI implemented based on last assessment\nThe wording of several CO statements was revised, and two new COs (CO1, and CO10) were added corresponding to PO2 and PO6, respectively, based on feedback from the course teachers obtained through CAR (course assessment report) and deliberations within the BUGS meeting.\nAdditionally, the incorporation of the Complex Engineering Activity (CEA) Assessment Form after feedback on the previous CAR, has strengthened the evaluation process, ensuring that all student projects demonstrably address the attributes of complex engineering problems as defined by BAETE.\nPart E. Recommendation\nMajor issues: None\nPlan for future actions for further improvement:\nFuture incorporation of industry personnel for a more holistic approach would be helpful\nAn assessment rubric for CEA assessment from demonstration should be prepared and used from next term,\nSignature(s):\nName: Mr. Shoyad Ibn Sabur Khan Nuhash | Name: Mr. Samiul Based Shuvo | Name: Mr. Tazuddin Ahmed | Name: Mr.  Abdullah Al Mamun\nSignature: | Signature: | Signature: | Signature:\nMs. Samina Nishat Binte Akram | Ms. Tasnia Binte Mamun | Ms. Srija sarkar Ananya | \nSignature: | Signature: | Signature: | "}'::jsonb,'{}'::text[],false,true);
insert into stg_co values ('2025-07','BME 350',1,'Apply mathematical, scientific, and engineering principles to analyze the scope of improvement of the medical device concept',array['C4']::text[],array['Discussion','Lectures','Case Study']::text[],array['Final Report']::text[],array['K1','K2','K3','K4','P1','P3','P4']::text[],array['PO2']::text[]);
insert into stg_co values ('2025-07','BME 350',2,'Apply ethical principles and guidelines to design experiments for clinical feasibility evaluation',array['C3']::text[],array['Lectures']::text[],array['Presentations']::text[],array['K7']::text[],array['PO8']::text[]);
insert into stg_co values ('2025-07','BME 350',3,'Revise the medical device concept considering clinical feasibility, regulatory constraints, and user needs in line with engineering design principles',array['C5']::text[],array['Discussion','Clinical Observation','Lectures']::text[],array['Presentations','Demonstration']::text[],array['K8','P1','P2','P5','P6']::text[],array['PO4']::text[]);
insert into stg_co values ('2025-07','BME 350',4,'Assess the environmental impact and sustainability of the conceptual design',array['C4']::text[],array['Case Study','Discussion','Lectures']::text[],array['Presentations','Demonstration']::text[],array['K7','P1','P2','P5']::text[],array['PO7']::text[]);
insert into stg_co values ('2025-07','BME 350',5,'Modify medical device prototype based on the revised conceptual design and perform bench-top testing',array['C6','PS3']::text[],array['Discussion','Lectures']::text[],array['Presentations']::text[],array['K6','K8','P1','P2','P3']::text[],array['PO5']::text[]);
insert into stg_co values ('2025-07','BME 350',6,'Evaluate the commercial aspects of the developed medical device',array['C5']::text[],array['Discussion','Lectures']::text[],array['Presentations','Final Report']::text[],'{}'::text[],array['PO11']::text[]);
insert into stg_co values ('2025-07','BME 350',7,'Display the ability to function within a multidisciplinary team',array['AF3']::text[],array['Lectures']::text[],array['Continuous Assessment']::text[],'{}'::text[],array['PO9']::text[]);
insert into stg_co values ('2025-07','BME 350',8,'Demonstrate ethical practices standards in case of dealing with clinical/patient data',array['AF3']::text[],array['Lectures']::text[],array['Final Report']::text[],array['K7']::text[],array['PO8']::text[]);
insert into stg_co values ('2025-07','BME 350',9,'Show effective communication skills within and outside the team',array['AF3']::text[],array['Lectures']::text[],array['Presentations','Demonstration','Final Report']::text[],array['A1','A2']::text[],array['PO10']::text[]);
insert into stg_co values ('2025-07','BME 350',10,'Analyze the societal, health, safety, legal, and cultural implications relevant to the design project',array['C4']::text[],array['Discussion','Lectures']::text[],array['Presentations']::text[],array['K7','P1','P2','P3']::text[],array['PO6']::text[]);
insert into stg_crit values ('2025-07','BME 350',0,'Continuous Assessment','Ability to interact and cooperate within the team, as assessed by faculty and peer review forms',15,array['CO7']::text[]);
insert into stg_crit values ('2025-07','BME 350',1,'Presentation 01','Proposed design Solution: Environmental impact and sustainibility',1.5,array['CO4']::text[]);
insert into stg_crit values ('2025-07','BME 350',2,'Presentation 01','Proposed design Solution: Methodology',1.5,array['CO3']::text[]);
insert into stg_crit values ('2025-07','BME 350',3,'Presentation 01','Proposed design Solution: Feasibility',1.5,array['CO2']::text[]);
insert into stg_crit values ('2025-07','BME 350',4,'Presentation 01','Cost estimation & resource planning',1.5,array['CO6']::text[]);
insert into stg_crit values ('2025-07','BME 350',5,'Presentation 01','Revised conceptual design & bench top testing',1.5,array['CO5']::text[]);
insert into stg_crit values ('2025-07','BME 350',6,'Presentation 01','Participation in QnA',1.5,array['CO9']::text[]);
insert into stg_crit values ('2025-07','BME 350',7,'Presentation 01','Ability to communicate with External evaluators',6,array['CO9']::text[]);
insert into stg_crit values ('2025-07','BME 350',8,'Demo 01','Engineering Design, Technical Execution, Regulatory & Safety Constraints',35,array['CO3']::text[]);
insert into stg_crit values ('2025-07','BME 350',9,'Demo 01','Graphic Literacy and Q/A',25,array['CO9']::text[]);
insert into stg_crit values ('2025-07','BME 350',10,'Presentation 02','Feasibility of Design concept & final design concept',3.75,array['CO3']::text[]);
insert into stg_crit values ('2025-07','BME 350',11,'Presentation 02','Environmental impact and sustainibility',1.875,array['CO4']::text[]);
insert into stg_crit values ('2025-07','BME 350',12,'Presentation 02','Final prototype development & performance testing and evaluation',3.75,array['CO5']::text[]);
insert into stg_crit values ('2025-07','BME 350',13,'Presentation 02','Ethical consideration',1.875,array['CO2']::text[]);
insert into stg_crit values ('2025-07','BME 350',14,'Presentation 02','Cost & Resource planning',3.75,array['CO6']::text[]);
insert into stg_crit values ('2025-07','BME 350',15,'Presentation 02','Communication & stakeholder Engagement',3.75,array['CO9']::text[]);
insert into stg_crit values ('2025-07','BME 350',16,'Presentation 02','Societal and contextual impact',3.75,array['CO10']::text[]);
insert into stg_crit values ('2025-07','BME 350',17,'Final Report','Problem Framing & Prior Art',5.625,array['CO1']::text[]);
insert into stg_crit values ('2025-07','BME 350',18,'Final Report','Engineering Design & Prototype',7.5,array['CO1']::text[]);
insert into stg_crit values ('2025-07','BME 350',19,'Final Report','Validation & Results',7.5,array['CO1']::text[]);
insert into stg_crit values ('2025-07','BME 350',20,'Final Report','Ethical & Regulatory Compliance',5.625,array['CO8']::text[]);
insert into stg_crit values ('2025-07','BME 350',21,'Final Report','Commercial Feasibility & IP',5.625,array['CO6']::text[]);
insert into stg_crit values ('2025-07','BME 350',22,'Final Report','Project Mgt. & Teamwork',1.875,array['CO9']::text[]);
insert into stg_crit values ('2025-07','BME 350',23,'Final Report','Overall Communication',3.75,array['CO9']::text[]);
insert into stg_att values ('2025-07','BME 350','CO','CO1',100,'workbook');
insert into stg_att values ('2025-07','BME 350','CO','CO2',100,'workbook');
insert into stg_att values ('2025-07','BME 350','CO','CO3',100,'workbook');
insert into stg_att values ('2025-07','BME 350','CO','CO4',100,'workbook');
insert into stg_att values ('2025-07','BME 350','CO','CO5',100,'workbook');
insert into stg_att values ('2025-07','BME 350','CO','CO6',100,'workbook');
insert into stg_att values ('2025-07','BME 350','CO','CO7',100,'workbook');
insert into stg_att values ('2025-07','BME 350','CO','CO8',100,'workbook');
insert into stg_att values ('2025-07','BME 350','CO','CO9',100,'workbook');
insert into stg_att values ('2025-07','BME 350','CO','CO10',100,'workbook');
insert into stg_att values ('2025-07','BME 350','PO','PO2',100,'workbook');
insert into stg_att values ('2025-07','BME 350','PO','PO4',100,'workbook');
insert into stg_att values ('2025-07','BME 350','PO','PO5',100,'workbook');
insert into stg_att values ('2025-07','BME 350','PO','PO7',100,'workbook');
insert into stg_att values ('2025-07','BME 350','PO','PO8',100,'workbook');
insert into stg_att values ('2025-07','BME 350','PO','PO9',100,'workbook');
insert into stg_att values ('2025-07','BME 350','PO','PO11',100,'workbook');
insert into stg_car values ('2025-07','BME 350','Teachers’ comment on attainment: All the course outcomes (COs) mapped to this course were achieved by 100% of students. The overall attainment is highly satisfactory, with all assessed outcomes surpassing the attainment threshold of 40%.
Interpretation of student feedback: N/A
Teachers’ comment on teaching learning: The current structure effectively facilitates student engagement in design-based learning. However, in future iterations, increased exposure to field observations and stakeholder interaction is recommended to further strengthen design contextualization and real-world applicability.','The wording of several CO statements was revised, and two new COs (CO1, and CO10) were added corresponding to PO2 and PO6, respectively, based on feedback from the course teachers obtained through CAR (course assessment report) and deliberations within the BUGS meeting.
Additionally, the incorporation of the Complex Engineering Activity (CEA) Assessment Form after feedback on the previous CAR, has strengthened the evaluation process, ensuring that all student projects demonstrably address the attributes of complex engineering problems as defined by BAETE.','Major issues: None
Plan for future actions for further improvement:
Future incorporation of industry personnel for a more holistic approach would be helpful
An assessment rubric for CEA assessment from demonstration should be prepared and used from next term,');
insert into stg_bugs values ('BUGS 09.04.25','2025-04-09','https://buetedu-my.sharepoint.com/:b:/g/personal/shoyadsabur_bme_buet_ac_bd/IQCjIvypYsjBQLUopsrX7yx3AZtJDMIoD-etVNDs3LN3IwY?e=2OdeOt','2025-07','BME 350');
insert into stg_off values ('2025-01','January 2025','BME 403',null,null,null,null,'[{"name": "Ms. Tasnia Binte Mamun", "room": "ECE-1125", "email": "tasnia@bme.buet.ac.bd"}, {"name": "Mr. Taufiq Hasan", "room": "ECE-1110", "email": "taufiq@bme.buet.ac.bd"}]'::jsonb,'[{"component": "Class participation/Attendance", "percent": 10.0}, {"component": "Continuous Assessment", "percent": 20.0}, {"component": "Term Final", "percent": 70.0}]'::jsonb,'[]'::jsonb,'{"folder": "1 - Course Files/L4T1/BME 403 Course Files/January 2025", "files": {"co_po_mapping": "January 2025/CO-PO Mapping.docx", "outline": "January 2025/BME 403 - Course outline - January 2025.pdf", "assessment_workbook": "January 2025/Assessment and Scripts/BME 403-CO-PO-Assessment-marks.xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 403\nCourse Title: | Medical Imaging\nLevel, Term and Section | 4/1\nAcademic Term | January 2025\nTextbooks used: | Medical Imaging Signals and Systems, Second Edition, Jerry L. Prince, Jonathan M.\nIntroduction to Medical Imaging Physics: Engineering and Clinical Applications, Nadine Barrie Smith, Andrew Webb.\nMedical Imaging Systems: An Introductory Guide, Andreas Maier, Stefan Steidl, Vincent Christlein, Joachim Hornegger (Eds.).\nThe Essential Physics of Medical Imaging, Fourth Edition, Shadi AminololamaShakeri, Erin Angel, Ramsey Badawi, John D. Boice Jr.\nLast term when the course was offered | January 2024\nPart B. Attainment for current and previous terms\nJanuary 2025\nCO Attainment | CO1 | CO2 | CO3 | CO4 | CO5 | CO6 | CO7 | CO8 | CO9 | CO10 | CO11 | CO12\n%student attained | 90 | 82 | 92 | 90 | NA | NA | NA | NA | NA | NA | NA | NA\nCohort attainment | Y | Y | Y | Y | NA | NA | NA | NA | NA | NA | NA | NA\n |  |  |  |  |  | \n |  |  |  |  |  | \nPO Attainment | PO(a) | PO(b) | PO(c) | PO(d) | PO(e) | PO(f) | PO(g) | PO(h) | PO(i) | PO(j) | PO(k) | PO(l)\n%student attained | 92 | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA\nCohort attainment | Y | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA\n |  |  |  |  |  |  |  |  |  |  | \n |  |  |  |  |  |  |  |  |  |  | \n |  |  |  |  |  |  |  |  |  |  | \n |  |  |  |  |  |  |  |  |  |  | \n |  |  |  |  |  |  |  |  |  |  | \n |  |  |  |  |  |  |  |  |  |  | \nTeachers’ comment on attainment: Satisfactory\nInterpretation of student feedback: - None\nTeachers’ comment on teaching learning: - None\nPart D. Comments on CQI implemented based on last assessment\nN/A\nPart E. Recommendation\nMajor issues: None\nPlan for future actions for further improvement: No change is required for now.\nSignature(s):\nName: Dr. Taufiq Hasan | Name: Mrs Tasnia Binte Mamun\nSignature: | Signature:"}'::jsonb,array['No K/P/A matrix in CO-PO mapping doc']::text[],false,true);
insert into stg_co values ('2025-01','BME 403',1,'Solve problems relating to medical image quality',array['C3']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-01','BME 403',2,'Describe basic principles and instrumentation of different imaging modalities',array['C2']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-01','BME 403',3,'Solve problems relating to different imaging modalities',array['C3']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-01','BME 403',4,'Apply of imaging modalities that meet specified clinical applications',array['C3']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_crit values ('2025-01','BME 403',0,'Term Final','1(a)',15,array['CO1']::text[]);
insert into stg_crit values ('2025-01','BME 403',1,'Term Final','1(b)',15,array['CO3']::text[]);
insert into stg_crit values ('2025-01','BME 403',2,'Term Final','1(c)',15,array['CO3']::text[]);
insert into stg_crit values ('2025-01','BME 403',3,'Term Final','5(a)',15,array['CO2']::text[]);
insert into stg_crit values ('2025-01','BME 403',4,'Term Final','5(b)',15,array['CO4']::text[]);
insert into stg_crit values ('2025-01','BME 403',5,'Term Final','5(c)',15,array['CO3']::text[]);
insert into stg_att values ('2025-01','BME 403','CO','CO1',90,'summary');
insert into stg_att values ('2025-01','BME 403','CO','CO2',82,'summary');
insert into stg_att values ('2025-01','BME 403','CO','CO3',92,'summary');
insert into stg_att values ('2025-01','BME 403','CO','CO4',90,'summary');
insert into stg_att values ('2025-01','BME 403','PO','PO1',92,'summary');
insert into stg_car values ('2025-01','BME 403','Teachers’ comment on attainment: Satisfactory
Interpretation of student feedback: - None
Teachers’ comment on teaching learning: - None','','Major issues: None
Plan for future actions for further improvement: No change is required for now.');
insert into stg_off values ('2025-01','January 2025','BME 404',null,'Sessional based on BME 403.','• The course will enable students to perform image processing operations and techniques
• The course will enable students to build user-friendly graphical user interfaces (GUI) for displaying and processing images
• The course will introduce students to instrumentation and image acquisition techniques of different medical imaging modalities','Bangladesh University of Engineering and Technology
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No:		BME 404
Course Title:		Medical Imaging Sessional
Credit hours:		1.5				       Contact hours:  3
Level/Term:		4/1
Academic Session: 	2023-2024
Course Teacher(s):
Name | Office/Room | Email | Class routine
Shams Nafisa Ali | ECE-1013 | nafisa@bme.buet.ac.bd
+880 1773 735196 | Sunday:
02:00 PM-04:50 AM
Tuesday:
08:00 AM-10:50  AM
Samiul Based Shuvo | ECE-1021 | sbshuvo@bme.buet.ac.bd
+880 1521258181 | 
Md. Tazuddin Ahmed | ECE-1123 | mdtuahmed@bme.buet.ac.bd+880 1797 091 595 | 
Tasnia Binte Mamun | ECE-1125 | tasnia@bme.buet.ac.bd
+880 1677-900345 | 
Srija Sarker | ECE-1013 | srija@bme.buet.ac.bd
+880 1787151545 | 
Course Contents:
Sessional based on BME 403.
Course Objectives:
• The course will enable students to perform image processing operations and techniques
• The course will enable students to build user-friendly graphical user interfaces (GUI) for displaying and processing images
• The course will introduce students to instrumentation and image acquisition techniques of different medical imaging modalities
Course Outcomes:
Employ appropriate image processing operations and techniques.
Apply knowledge of various medical image acquisition tools.
Solve problems relating to different imaging modalities.
Textbooks and References:
Medical Imaging Signals and Systems, Second Edition, Jerry L. Prince, Jonathan M. Links.
Digital Image Processing, 4th Edition, Rafael C. Gonzalez, Richard E. Woods.
Respective Lab Manuals.
Weekly Schedule:
Week | Topics
1 | Introduction to Image processing (i)
- Image processing toolbox
- Intensity transformation and spatial filtering
- Logarithmic and contrast stretching transformation
2 | Introduction to Image processing (ii)
- Histogram processing
- Function plotting
- Linear and non-linear spatial filter
- Sharpening filter
3 | Introduction to Image processing (iii)
- Fourier domain processing
- Filtering in frequency domain
4 | Lab test 1
5 | MRI Brain scan: Segmentation and Volume Visualization
- Montage creation in MR images
- Segmentation of brain from a slice
- Constructing 3D model of brain
6 | Reconstruction of CT Images
- Parallel beam geometry
- Fan beam geometry
7 | Ultrasound RF signal processing
- Generate RF data
- Create B-mode image
8 | Lab test 2
9 | Radiology Department Visit at a Medical Facility
- CT machine
- X-ray Machine
10 | Thermal Imager instrumentation and image acquisition
- Basics of thermography
- Image acquisition, editing, store and interpretation
11 | Ultrasound instrumentation and image acquisition
- Parts of ultrasound machine
- Different mode analysis
- Image acquisition and interpretation
12 | Project/Assignment
13 | MicroCT instrumentation and image acquisition
- Scanning a micro-mouse phantom
- Data acquisition, analysis and image reconstruction
14 | Quiz
Assessment:
Class participation/Attendance	            10%
Lab-test                                                           50%
Term Project                              	            15%
Lab Quiz                                    	            25%
Total                                                               100%
Prepared by: | 
Name:
Signature:
Date: | Shams Nafisa Ali
Name:
Signature:
Date: | Samiul Based Shuvo
Name:
Signature:
Date: | Md. Tazuddin Ahmed
Name:
Signature:
Date: | Tasnia Binte Mamun
Name:
Signature:
Date: | Srija Sarker','[{"name": "Shams Nafisa Ali", "room": "ECE-1013", "email": "nafisa@bme.buet.ac.bd"}, {"name": "Samiul Based Shuvo", "room": "ECE-1021", "email": "sbshuvo@bme.buet.ac.bd"}, {"name": "Md. Tazuddin Ahmed", "room": "ECE-1123", "email": "mdtuahmed@bme.buet.ac.bd"}, {"name": "Tasnia Binte Mamun", "room": "ECE-1125", "email": "tasnia@bme.buet.ac.bd"}, {"name": "Srija Sarker", "room": "ECE-1013", "email": "srija@bme.buet.ac.bd"}]'::jsonb,'[{"component": "Class Participation and Continuous Assessment", "percent": 10.0}, {"component": "Lab-Test - (×2)", "percent": 50.0}, {"component": "Term Project", "percent": 15.0}, {"component": "Lab Quiz", "percent": 25.0}]'::jsonb,'[{"component": "Continuous Assessment", "weight": 0.1, "marks": 15}, {"component": "Lab Test", "weight": 0.5, "marks": 75}, {"component": "Lab Quiz", "weight": 0.25, "marks": 37.5}, {"component": "Project", "weight": 0.15, "marks": 22.5}]'::jsonb,'{"folder": "1 - Course Files/L4T1/BME 404 Course Files/January 2025", "files": {"co_po_mapping": "January 2025/CO-PO mapping.docx", "outline": "January 2025/BME 404_Course Outline.docx", "assessment_workbook": "January 2025/Assessment and Scripts/BME 404-CO-PO-Assessment-Marks.xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 404\nCourse Title: | Medical Imaging Sessional\nLevel, Term and Section | 4/1\nAcademic Term | January 2025\nTextbooks used: | Medical Imaging Signals and Systems, Second Edition, Jerry L. Prince, Jonathan M. Links\nDigital Image Processing, 4th Edition, Rafael C. Gonzalez, Richard E. Woods\nRespective Lab Manuals\nLast term when the course was offered | July 2023\nPart B. Attainment for current and previous terms\nCO Attainment | CO1 | CO2 | CO3\n% Student Attained | 88.00% | 96.00% | 88.00%\nCohort attainment | Y | Y | Y\nPO Attainment | % Student Attained | Cohort\nPO1 | NA | NA\nPO2 | 88.00% | Y\nPO3 | NA | NA\nPO4 | NA | NA\nPO5 | 98.00% | Y\nPO6 | NA | NA\nPO7 | NA | NA\nPO8 | NA | NA\nPO9 | NA | NA\nPO10 | NA | NA\nPO11 | NA | NA\nPO12 | NA | NA\nPart C. Analysis\nTeachers’ comment on attainment: Satisfactory.\nInterpretation of student feedback: N/A\nTeachers’ comment on teaching learning: Continuous Assessment should be done for each experiment from next time.\nPart D. Comments on CQI implemented based on last assessment\nN/A\nPart E. Recommendation\nMajor issues: None\nPlan for future actions for further improvement:\nWeightage of CO2 is quite low. Have to design additional assessment tasks or topics within the corresponding CO.\nThere can be a separated course outcome to address the students’ ability to develop tools for medical image analysis from recent research literature.\nSignature(s):\nName: Md Tazuddin Ahmed | Name: Samiul Based Shuvo | Shams Nafisa Ali | Tasnia Binte Mamun\nSignature: | Signature: | Signature: | Signature:"}'::jsonb,'{}'::text[],true,true);
insert into stg_co values ('2025-01','BME 404',1,'Employ appropriate image processing operations and techniques',array['C3']::text[],array['Lectures','Homework','Coding Tasks','Term Project']::text[],array['Continuous Assessment','Lab Test','Project Presentation']::text[],array['K6','P1']::text[],array['PO5']::text[]);
insert into stg_co values ('2025-01','BME 404',2,'Apply knowledge of various medical image acquisition tools',array['C3']::text[],array['Lectures','Homework','Demonstrations']::text[],array['Continuous Assessment']::text[],array['K6','P1']::text[],array['PO5']::text[]);
insert into stg_co values ('2025-01','BME 404',3,'Solve problems relating to different imaging modalities',array['C3']::text[],array['Lectures','Coding Tasks']::text[],array['Continuous Assessment','Lab Quiz']::text[],array['K1','K2','K3','K4','P1','P2','P3']::text[],array['PO2']::text[]);
insert into stg_crit values ('2025-01','BME 404',0,'Continuous Assessment','Image Processing Coding Labs',2.5,array['CO1']::text[]);
insert into stg_crit values ('2025-01','BME 404',1,'Continuous Assessment','Hardware Lab Assessments/ Assignments',10,array['CO2']::text[]);
insert into stg_crit values ('2025-01','BME 404',2,'Continuous Assessment','CT, MRI, US Coding Labs',2.5,array['CO3']::text[]);
insert into stg_crit values ('2025-01','BME 404',3,'Lab Test','Labtest',75,array['CO1']::text[]);
insert into stg_crit values ('2025-01','BME 404',4,'Quiz','Problems relating to engineering drawing for computer aided design',37.5,array['CO3']::text[]);
insert into stg_crit values ('2025-01','BME 404',5,'Project','Problems relating to engineering drawing for computer aided design',22.5,array['CO1']::text[]);
insert into stg_att values ('2025-01','BME 404','CO','CO1',88.0,'car');
insert into stg_att values ('2025-01','BME 404','CO','CO2',96.0,'car');
insert into stg_att values ('2025-01','BME 404','CO','CO3',88.0,'car');
insert into stg_att values ('2025-01','BME 404','PO','PO2',88.0,'car');
insert into stg_att values ('2025-01','BME 404','PO','PO5',98.0,'car');
insert into stg_car values ('2025-01','BME 404','Teachers’ comment on attainment: Satisfactory.
Interpretation of student feedback: N/A
Teachers’ comment on teaching learning: Continuous Assessment should be done for each experiment from next time.','','Major issues: None
Plan for future actions for further improvement:
Weightage of CO2 is quite low. Have to design additional assessment tasks or topics within the corresponding CO.
There can be a separated course outcome to address the students’ ability to develop tools for medical image analysis from recent research literature.');
insert into stg_off values ('2025-01','January 2025','BME 425',null,'Fundamentals of drug delivery: types of drug release, mechanisms and principles of controlling drug, improving the water solubility and poorly soluble drugs, immediate, delayed, sustained and controlled release delivery systems, basic pharmacokinetics; Parenteral routes for drug delivery and targeting: long acting injections and implants; Non-parenteral routes for drug delivery and targeting: oral drug delivery, buccal and sublingual drug delivery, transdermal drug delivery, nasal drug delivery, pulmonary drug delivery, ophthalmic drug delivery; Emerging technologies: gene delivery, vaccine delivery, and nanofabrication techniques and their application in drug delivery; Nano drug delivery: techniques, chemistry, advantages and challenges.','The course will introduce the concepts of drug delivery and pharmacokinetics.
The course will teach students about the different types and mechanisms of drug delivery.
The course will present different drug delivery routes.
The course will introduce students with the recent advancements and emerging nanotechnologies in the drug delivery field.','Bangladesh University of Engineering and Technology 
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No: BME 425
Course Title: Drug delivery
Credit hours: 3                                                               Contact hours:     3
Level/Term: 4/1
Academic Session:  2023-2024
Course Teacher(s):
Name | Office/Room | Email | Class routine
Dr. Muhammad Tarik Arafat | ECE-1025 | tarikarafat@bme.buet.ac.bd
+880184445363 | Saturday: 9:00 AM to 9:50 AM
Sunday: 9:00 AM to 9:50 AM
Wednesday: 9:00 AM to 9:50 AM
Samina Nishat Binte Akram | ECE-1123 | samina@bme.buet.ac.bd
+8801973730183 | 
Course Contents:
Fundamentals of drug delivery: types of drug release, mechanisms and principles of controlling drug, improving the water solubility and poorly soluble drugs, immediate, delayed, sustained and controlled release delivery systems, basic pharmacokinetics; Parenteral routes for drug delivery and targeting: long acting injections and implants; Non-parenteral routes for drug delivery and targeting: oral drug delivery, buccal and sublingual drug delivery, transdermal drug delivery, nasal drug delivery, pulmonary drug delivery, ophthalmic drug delivery; Emerging technologies: gene delivery, vaccine delivery, and nanofabrication techniques and their application in drug delivery; Nano drug delivery: techniques, chemistry, advantages and challenges.
Course Objectives:
The course will introduce the concepts of drug delivery and pharmacokinetics.
The course will teach students about the different types and mechanisms of drug delivery.
The course will present different drug delivery routes.
The course will introduce students with the recent advancements and emerging nanotechnologies in the drug delivery field.
Course Outcomes:
Explain the concepts of drug delivery.
State the solubility, release profile, and basic pharmacokinetics of drug delivery systems.
Compare between different parenteral and non-parenteral routes of drug delivery.
Illustrate the emerging techniques and recent trends in the field of drug delivery.
Assessment:
Class participation/Attendance: 10%
Homework Assignment and Quizzes: 20%
Term Final Exam: 70%
Textbooks and References:
Ashim Mitra, Chi H. Lee, Kun Cheng - Advanced Drug Delivery (2013, Wiley)
Drug Delivery: Materials Design and Clinical Perspective by Eric P. Holowka and Sujata K. Bhatia
Hillery, Anya M. Park, Kinam - Drug Delivery: Fundamentals and Applications-CRC Press (2017)
Juergen Sieppman, Fundamentals and applications of controlled release drug delivery
Lecture Plan:
Lec# | Lecture Topics
1—6 | Introduction:
- Concepts of drug delivery
- Review of human anatomy and physiology and effect of drug
7—12 | Fundamentals of drug delivery:
- Types of drug release
- Mechanisms and principles of controlling drug
- Improving the water solubility of poorly soluble drugs
- Class Test #1 (CO-1, CO-2)
13—15 | Fundamentals of drug delivery :
- Immediate, delayed, sustained and controlled release delivery systems
- Basic pharmacokinetics
16—18 | Fundamentals of drug delivery :
- Basic pharmacokinetics
18—21 | Parenteral routes for drug delivery and targeting:
- Long-acting injections and implants
- Class Test #2 (CO-2, CO-3)
22—24 | Non-parenteral routes for drug delivery and targeting:
- Oral drug delivery
- Buccal and sublingual drug delivery
- Transdermal drug delivery
25—27 | Non-parenteral routes for drug delivery and targeting:
-Transdermal drug delivery
- Ophthalmic drug delivery
28—30 | Non-parenteral routes for drug delivery and targeting:
Nasal drug delivery, pulmonary drug delivery
- Class Test #3 (CO-3)
31—33 | Emerging technologies:
- Gene delivery
- Vaccine delivery
- Nanofabrication techniques and their application in drug delivery
32—34 | Emerging technologies:
- Vaccine delivery
35—37 | Emerging technologies:
- Nanofabrication techniques and their application in drug delivery
37—42 | Nano drug delivery
- Techniques
- Chemistry
- Advantages and challenges.
- Class Test #4 (CO-4)
Prepared by: | 
Name:
Signature:
Date: | Dr. Muhammad Tarik Arafat
Name:
Signature:
Date: | Samina Nishat Binte Akram','[{"name": "Dr. Muhammad Tarik Arafat", "room": "ECE-1017", "email": "tarikarafat@bme.buet.ac.bd"}, {"name": "Samina Nishat Binte Akram", "room": "ECE-1123", "email": "nishatakram1414@gmail.com"}]'::jsonb,'[{"component": "Class participation/Attendance", "percent": 10.0}, {"component": "Homework Assignment and Quizzes", "percent": 20.0}, {"component": "Term Final Exam", "percent": 70.0}]'::jsonb,'[]'::jsonb,'{"folder": "1 - Course Files/L4T1/BME 425 Course files/January 2025", "files": {"co_po_mapping": "January 2025/CO-PO Mapping.docx", "outline": "January 2025/BME 425_Course Outline.docx", "assessment_workbook": "January 2025/Assessments and Scripts/BME 425-CO-PO-Assessment-Marks.xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 425\nCourse Title: | Drug Delivery\nLevel, Term and Section | 4/1\nAcademic Term | January 2025\nTextbooks used: | Ashim Mitra, Chi H. Lee, Kun Cheng - Advanced Drug Delivery (2013, Wiley)\nDrug Delivery: Materials Design and Clinical Perspective by Eric P. Holowka and Sujata K. Bhatia\nHillery, Anya M. Park, Kinam - Drug Delivery: Fundamentals and Applications-CRC Press (2017)\nJuergen Sieppman, Fundamentals and applications of controlled release drug delivery\nLast term when the course was offered | N/A\nPart B. Attainment for current and previous terms\nJanuary 2025\nCO Attainment | CO1 | CO2 | CO3 | CO4 | CO5 | CO6 | CO7 | CO8 | CO9 | CO10 | CO11 | CO12\n%student attained | 94 | 96 | 90 | 80 | NA | NA | NA | NA | NA | NA | NA | NA\nCohort attainment | Y | Y | Y | Y | NA | NA | NA | NA | NA | NA | NA | NA\nPO Attainment | PO(a) | PO(b) | PO(c) | PO(d) | PO(e) | PO(f) | PO(g) | PO(h) | PO(i) | PO(j) | PO(k) | PO(l)\n%student attained | 96 | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA\nCohort attainment | Y | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA\nPart C. Analysis\nTeachers’ comment on attainment: Satisfactory\nInterpretation of student feedback: None\nTeachers’ comment on teaching learning: None\nPart D. Comments on CQI implemented based on last assessment\nN/A\nPart E. Recommendation\nMajor issues: None\nPlan for future actions for further improvement: No change required for now.\nSignature(s):\nName: Dr. Muhammad Tarik Arafat | Name: Samina Nishat Binte Akram\nSignature: | Signature:"}'::jsonb,'{}'::text[],true,true);
insert into stg_co values ('2025-01','BME 425',1,'Explain the concepts of drug delivery.',array['C4']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],array['K1','K2','K3','K4','P1']::text[],array['PO1']::text[]);
insert into stg_co values ('2025-01','BME 425',2,'State the solubility, release profile, and basic pharmacokinetics of drug delivery systems.',array['C1']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],array['K1','K2','K3','K4','P1']::text[],array['PO1']::text[]);
insert into stg_co values ('2025-01','BME 425',3,'Compare between different parenteral and non-parenteral routes of drug delivery.',array['C2']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],array['K1','K2','K3','K4','P1']::text[],array['PO1']::text[]);
insert into stg_co values ('2025-01','BME 425',4,'Illustrate the emerging techniques and recent trends in the field of drug delivery.',array['C3']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],array['K1','K2','K3','K4','P1']::text[],array['PO1']::text[]);
insert into stg_crit values ('2025-01','BME 425',0,'Term Final','1(a)',15,array['CO1']::text[]);
insert into stg_crit values ('2025-01','BME 425',1,'Term Final','1(b)',15,array['CO2']::text[]);
insert into stg_crit values ('2025-01','BME 425',2,'Term Final','1(c)',15,array['CO3']::text[]);
insert into stg_crit values ('2025-01','BME 425',3,'Term Final','5(a)',20,array['CO2']::text[]);
insert into stg_crit values ('2025-01','BME 425',4,'Term Final','5(b)',15,array['CO4']::text[]);
insert into stg_crit values ('2025-01','BME 425',5,'Term Final','5(c)',10,array['CO4']::text[]);
insert into stg_att values ('2025-01','BME 425','CO','CO1',94,'summary');
insert into stg_att values ('2025-01','BME 425','CO','CO2',96,'summary');
insert into stg_att values ('2025-01','BME 425','CO','CO3',90,'summary');
insert into stg_att values ('2025-01','BME 425','CO','CO4',80,'summary');
insert into stg_att values ('2025-01','BME 425','PO','PO1',96,'summary');
insert into stg_car values ('2025-01','BME 425','Teachers’ comment on attainment: Satisfactory
Interpretation of student feedback: None
Teachers’ comment on teaching learning: None','','Major issues: None
Plan for future actions for further improvement: No change required for now.');
insert into stg_off values ('2025-01','January 2025','BME 441',null,'Introduction to neural engineering and design; Basic principles of brain anatomy; Visual
processing; Retinal implants; Introduction to electroencephalogram (EEG); Visual
evoked potentials in EEG; Auditory processing; Cochlear implants; Neural signal
processing; Motor cortex; Somatosensory cortex; Sensorimotor brain-computer
interfaces (BCIs); Electrical stimulation modalities; Basal ganglia; Deep brain
stimulation; Brain plasticity and neurorehabilitation; Real-time functional magnetic
resonance imaging (fMRI) BCIs; Real-time functional magnetoencephalogram (MEG)
BCIs; BCI application I: psychiatric disorders; BCI application II: neurological disorders;
BCI application III: movement disorders; Structural connectivity in the brain; Prediction
of neurological disease; Functional near-infrared spectroscopy (fNIRS) BCIs;
Optogenetics.','● The course will introduce concepts of brain anatomy and function
● The course will introduce the principles of different neurophysiological recording,stimulation, and imaging technologies
● The course will enable students to learn about the applications of neural
engineering in sensory, motor, neurological and mental disorders
● The course will enable students to understand the current challenges and future direction of neural engineering','Bangladesh University of Engineering and Technology
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No:			BME 441
Course Title:		Neural Engineering
Credit hours:		3				Contact hours:	3
Level/Term:			4/1
Academic Session: 	2023-2024
Course Teacher(s):
Name | Office/Room | Email | Class routine
Samiul Based Shuvo | ECE-1121 | sbshuvo@bme.buet.ac.bd
+880 1521258181 | Saturday:
10:00 AM - 10:50 AM
Sunday:
10:00 AM - 10:50 AM
Monday:
10:00 AM - 10:50 AM
Md. Tazuddin Ahmed | ECE-1123 | mdtuahmedakash@gmail.com
+880 1797091595 | 
Course Contents:
Introduction to neural engineering and design; Basic principles of brain anatomy; Visual
processing; Retinal implants; Introduction to electroencephalogram (EEG); Visual
evoked potentials in EEG; Auditory processing; Cochlear implants; Neural signal
processing; Motor cortex; Somatosensory cortex; Sensorimotor brain-computer
interfaces (BCIs); Electrical stimulation modalities; Basal ganglia; Deep brain
stimulation; Brain plasticity and neurorehabilitation; Real-time functional magnetic
resonance imaging (fMRI) BCIs; Real-time functional magnetoencephalogram (MEG)
BCIs; BCI application I: psychiatric disorders; BCI application II: neurological disorders;
BCI application III: movement disorders; Structural connectivity in the brain; Prediction
of neurological disease; Functional near-infrared spectroscopy (fNIRS) BCIs;
Optogenetics.
Course Objectives:
● The course will introduce concepts of brain anatomy and function
● The course will introduce the principles of different neurophysiological recording,stimulation, and imaging technologies
● The course will enable students to learn about the applications of neural
engineering in sensory, motor, neurological and mental disorders
● The course will enable students to understand the current challenges and future direction of neural engineering
Course Outcomes:
1. Explain the fundamental concepts of brain anatomy and physiology
2. Discuss applications of neural engineering in sensory, motor, neurological and
mental disorders
3. Describe principles of different neurophysiological recording, stimulation and
imaging technologies
4. Analyze challenges in a specified neural engineering application
Assessment:
Class participation/Attendance:		10%
Homework Assignment and Quizzes:	20%
Term Final Exam:				70%
Textbooks and References:
1. Brain Computer Interfacing: An Introduction, Rao
2. Neural Engineering, He
3. Neuroengineering, DiLorenzo
Weekly Schedule:
Week | Topics
1 | - Introduction to neural engineering and design
- Basic principles of brain anatomy
2 | - Introduction to electroencephalogram (EEG)
3 | - Visual evoked potentials in EEG
- Class test # 1
4 | - Visual processing
- Retinal implants
5 | - Auditory processing
- Cochlear implants
6 | - Cochlear implants
- Neural signal processing
- Class test # 2
7 | - Brain Imaging Technology: Functional near-infrared spectroscopy
(fNIRS)
- Brain Imaging Technology: functional magnetic resonance imaging
(fMRI)
8 | - Basal ganglia
- Motor cortex
9 | - Somatosensory cortex
- Sensorimotor brain-computer interfaces (BCIs
10 | - Brain plasticity and neurorehabilitation
- Electrical stimulation modalities
- Deep brain stimulation
11 | - BCI application I: psychiatric disorders
- BCI application II: neurological disorders
- Class test - 3 (CO-2/ CO-4)
12 | - BCI application III: movement disorders
- Structural connectivity in the brain
13 | - Prediction of neurological disease
- Real-time functional magnetoencephalogram (MEG) BCI
14 | - Functional near-infrared spectroscopy (fNIRS) and functional
magnetic resonance imaging (fMRI) based BCIs
- Optogenetics
- Class test # 4 (CO-2/CO-3/CO-4)
Prepared by: | 
Name:
Signature:
Date: | Samiul Based Shuvo
12/04/2025
Name:
Signature:
Date: | Md. Tazuddin Ahmed
12/04/2025','[{"name": "Mr. Samiul based Shuvo", "room": "ECE-1121", "email": "sbshuvo@bme.buet.ac.bd"}, {"name": "Mr. Md Tazuddin Ahmed", "room": "ECE-1123", "email": "mdtuahmed@bme.buet.ac.bd"}]'::jsonb,'[{"component": "Class participation/Attendance", "percent": 10.0}, {"component": "Continuous Assessment", "percent": 20.0}, {"component": "Term Final", "percent": 70.0}]'::jsonb,'[]'::jsonb,'{"folder": "1 - Course Files/L4T1/BME 441 Course Files/January 2025", "files": {"co_po_mapping": "January 2025/CO-PO Mapping.docx", "outline": "January 2025/BME 441_Course Outline.docx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 441\nCourse Title: | Neural Engineering\nLevel, Term and Section | 4/1\nAcademic Term | January 2025\nTextbooks used: | Brain Computer Interfacing: An Introduction, Rao\nNeural Engineering, He\nNeuroengineering, DiLorenzo\nBiological Psychology, Kalat\nPrinciples of Neural Science, Kandel\nLast term when the course was offered | July 2023\nPart B. Attainment for current and previous terms\nJanuary 2025\nCO1 | CO2 | CO3 | CO4 | CO5 | CO6 | CO7 | CO8 | CO9 | CO10 | CO11 | CO12\n90 | 95 | 100 | 100 | NA | NA | NA | NA | NA | NA | NA | NA\nY | Y | Y | Y | NA | NA | NA | NA | NA | NA | NA | NA\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\n100 | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA\nY | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA\nTeachers’ comment on attainment: Satisfactory\nInterpretation of student feedback: -\nTeachers’ comment on teaching learning: -\nPart D. Comments on CQI implemented based on last assessment\nN/A\nPart E. Recommendation\nMajor issues: None\nPlan for future actions for further improvement:\nThe first CO statement is mapped to C4, we need to discuss before next time if we want to readjust this mapping.\nWe need to enrich the contents in MEG (Magnetoencephalography) part. That segment of the syllabus was very brief.\nSignature(s):\nName: Mr. Samiul Based Shuvo | Name: Mr. Md Tazuddin Ahmed\nSignature: | Signature:"}'::jsonb,array['No K/P/A matrix in CO-PO mapping doc','No item-to-CO mapping found (no CO-PO assessment workbook, or an unrecognised layout)']::text[],true,false);
insert into stg_co values ('2025-01','BME 441',1,'Explain the fundamental concepts of brain anatomy and physiology',array['C4']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-01','BME 441',2,'Discuss applications of neural engineering in sensory, motor, neurological and mental disorders',array['C2']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-01','BME 441',3,'Describe principles of different neurophysiological recording, stimulation and imaging technologies',array['C2']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-01','BME 441',4,'Analyze challenges in a specified neural engineering application',array['C4']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_att values ('2025-01','BME 441','CO','CO1',90,'summary');
insert into stg_att values ('2025-01','BME 441','CO','CO2',95,'summary');
insert into stg_att values ('2025-01','BME 441','CO','CO3',100,'summary');
insert into stg_att values ('2025-01','BME 441','CO','CO4',100,'summary');
insert into stg_att values ('2025-01','BME 441','PO','PO1',100,'summary');
insert into stg_car values ('2025-01','BME 441','Teachers’ comment on attainment: Satisfactory
Interpretation of student feedback: -
Teachers’ comment on teaching learning: -','','Major issues: None
Plan for future actions for further improvement:
The first CO statement is mapped to C4, we need to discuss before next time if we want to readjust this mapping.
We need to enrich the contents in MEG (Magnetoencephalography) part. That segment of the syllabus was very brief.');
insert into stg_bugs values ('BUGS 09.04.25','2025-04-09','https://buetedu-my.sharepoint.com/:b:/g/personal/shoyadsabur_bme_buet_ac_bd/IQCjIvypYsjBQLUopsrX7yx3AZtJDMIoD-etVNDs3LN3IwY?e=2OdeOt','2025-01','BME 441');
insert into stg_off values ('2023-07','July 2023','BME 400',null,null,'This course will introduce the undergraduate students to the methodology of research
Students will become familiar with the ethical principles of research, ethical challenges and approval processes
Identify the components of a literature review process
Describe quantitative, qualitative and mixed methods approaches to research
Critically analyze published research','Bangladesh University of Engineering and Technology
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No:			BME 400
Course Title:		Project and Thesis
Credit hours:		3				Contact hours:	3
Level/Term:			4/2
Academic Session: 	2021-2022
Course Teacher(s):
Name | Office/Room | Email | Class routine
Dr. Muhammad Tarik Arafat | 10th floor, ECE Building, BUET, Dhaka | tarikarafat@bme.buet.ac.bd
+(880 2) 55167100 | Tuesday:
11:00 AM-1:30 PM
Dr. Taufiq Hasan | 10th floor, ECE Building, BUET, Dhaka | taufiq@bme.buet.ac.bd
+(880 2) 55167100 | 
Dr. Jahid Ferdous | 10th floor, ECE Building, BUET, Dhaka | ferdousj@bme.buet.ac.bd
+(880 2) 55167100 | 
Course Objectives:
This course will introduce the undergraduate students to the methodology of research
Students will become familiar with the ethical principles of research, ethical challenges and approval processes
Identify the components of a literature review process
Describe quantitative, qualitative and mixed methods approaches to research
Critically analyze published research
Course Outcomes:
Examine state-of-the-art research publications to conduct literature review.
Evaluate state-of-the-art literature to identify contemporary challenging research topics.
Design experiments using appropriate tools to evaluate a specified hypothesis.
Displays effective teamwork ability both as an individual member and as a leader.
Use adequate research machinery and/or equipment to conduct experiments as required.
Analyze acquired research data and arrive at valid conclusions as required.
Prepare research documents as per requirements and academic writing standards.
Demonstrate ethical practices standards in case of dealing with clinical/patient data.
Shows effective communication skills within and outside the team.
Demonstrate curiosity and aptitude for proactively learning new research methodology. Assessment:
Continuous Assessment		30%
Oral Examination			40%
Report					20%
Assessment Strategy
Continuous Assessment: Continuous assessment through assigned tasks by the supervisor. The scheme of the continuous assessment for the course will be decided by the supervisor, which may include presentations or written assignments.
Final Oral Examination: A final presentation will be given by the student on the research work conducted within the course period.
Final Report: A thesis/report is required to be submitted on the research work
Textbooks and References:
To be specified by the assigned supervisor.
Weekly Schedule:
To be determined by the respective supervisor. The students will meet with the supervisor once a week during the BME 400 class schedule. The supervisor will appropriately provide feedback and guidance to advance the research project.','[{"name": "Dr. Muhammad Tarik Arafat", "room": "ECE-1021", "email": "tarikarafat@bme.buet.ac.bd"}, {"name": "Dr. Taufiq Hasan", "room": "ECE-1019", "email": "taufiqhasan@bme.buet.ac.bd"}, {"name": "Dr. Jahid Ferdous", "room": "ECE-1017", "email": "jferdous@bme.buet.ac.bd"}]'::jsonb,'[]'::jsonb,'[]'::jsonb,'{"folder": "1 - Course Files/L4T2/BME 400 Course File/July 2023", "files": {"co_po_mapping": "July 2023/CO-PO Mapping.docx", "outline": "July 2023/BME 400 Course Outline.docx"}, "car_text": "Course Assessment Report\nDepartment of BME, BUET\nPart A. Course Information\n1. Course Number: | BME 400\n2. Course Title: | Thesis/Project\n3. Level, Term and Section | 4/1 & 4/2\n4. Academic Term | July 2023\n5. Textbooks used: | N/A\n6. Last term when the course was offered | N/A\nPart B. Attainment for current and previous terms\nN/A\nPart C. Analysis\nTeachers’ comment on attainment: N/A\nInterpretation of student feedback: N/A\nTeachers’ comment on teaching learning:  Need enough assessment tools for the evaluation of CO and PO attainment\nPart D. Comments on CQI implemented based on last assessment\nN/A\nPart E. Recommendation\nMajor issues:\nAttainment scores could not be calculated since the assessment tools did not measure individual COs.\nPlan for future actions for further improvement:\nThis course should include a CO that can cover PO6 as it is the thesis could have relevant to social and cultural aspects.\nCO statements should be more precise and clearer.\nSignature(s):\nName: Dr. Muhammad Tarik Arafat | Name: Dr. Taufiq Hasan | Dr. Jahid Ferdous\nSignature: | Signature: | Signature:"}'::jsonb,array['No item-to-CO mapping found (no CO-PO assessment workbook, or an unrecognised layout)']::text[],true,false);
insert into stg_co values ('2023-07','BME 400',1,'Examine state-of-the-art research publications to conduct literature review',array['C4']::text[],array['Weekly meetings']::text[],array['Presentations','Assignments']::text[],array['K6','K8','P1','P4','A1']::text[],array['PO4']::text[]);
insert into stg_co values ('2023-07','BME 400',2,'Evaluate state-of-the-art literature to identify contemporary challenging research topics',array['C6']::text[],array['Weekly meetings']::text[],array['Presentations','Assignments']::text[],array['K6','K8','P1','P4','P7','A1','A3']::text[],array['PO4']::text[]);
insert into stg_co values ('2023-07','BME 400',3,'Design experiments using appropriate tools to evaluate a specified hypothesis',array['C6']::text[],array['Weekly meetings']::text[],array['Presentations','Assignments']::text[],array['K6','K8','P1','P2','P4','A1']::text[],array['PO4']::text[]);
insert into stg_co values ('2023-07','BME 400',4,'Displays effective teamwork ability both as an individual member and as a leader',array['AF5']::text[],array['Weekly meetings']::text[],array['Presentations','Assignments']::text[],array['K7']::text[],array['PO9']::text[]);
insert into stg_co values ('2023-07','BME 400',5,'Use adequate research machinery and/or equipment to conduct experiments as required',array['PS4']::text[],array['Weekly meetings']::text[],array['Presentations','Assignments']::text[],array['K6','P4','A1']::text[],array['PO5']::text[]);
insert into stg_co values ('2023-07','BME 400',6,'Analyze acquired research data and arrive at valid conclusions as required',array['C4']::text[],array['Weekly meetings']::text[],array['Presentations','Assignments']::text[],array['K3','K4','K8','P1','P2','P3','P4','P7','A3']::text[],array['PO4']::text[]);
insert into stg_co values ('2023-07','BME 400',7,'Prepare research documents as per requirements and academic writing standards',array['C6']::text[],array['Weekly meetings']::text[],array['Presentations','Assignments']::text[],array['K4','K8','P1','A1']::text[],array['PO10']::text[]);
insert into stg_co values ('2023-07','BME 400',8,'Demonstrate ethical practices standards in case of dealing with clinical/patient data',array['AF5']::text[],array['Weekly meetings']::text[],array['Presentations','Assignments']::text[],array['K7']::text[],array['PO8']::text[]);
insert into stg_co values ('2023-07','BME 400',9,'Shows effective communication skills within and outside the team',array['AF5']::text[],array['Weekly meetings']::text[],array['Presentations','Assignments']::text[],array['K7']::text[],array['PO10']::text[]);
insert into stg_co values ('2023-07','BME 400',10,'Demonstrate curiosity and aptitude for proactively learning new research methodology',array['AF5']::text[],array['Weekly meetings']::text[],array['Presentations','Assignments']::text[],array['K8','P1']::text[],array['PO12']::text[]);
insert into stg_car values ('2023-07','BME 400','Teachers’ comment on attainment: N/A
Interpretation of student feedback: N/A
Teachers’ comment on teaching learning:  Need enough assessment tools for the evaluation of CO and PO attainment','','Major issues:
Attainment scores could not be calculated since the assessment tools did not measure individual COs.
Plan for future actions for further improvement:
This course should include a CO that can cover PO6 as it is the thesis could have relevant to social and cultural aspects.
CO statements should be more precise and clearer.');
insert into stg_off values ('2024-01','January 2024','BME 400','BME 19',null,'This course will introduce the undergraduate students to the methodology of research
Students will become familiar with the ethical principles of research, ethical challenges and approval processes
Identify the components of a literature review process
Describe quantitative, qualitative and mixed methods approaches to research
Critically analyze published research','Bangladesh University of Engineering and Technology
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No:			BME 400
Course Title:		Project and Thesis
Credit hours:		3				Contact hours:	3
Level/Term:			4/1
Academic Session: 	2021-2022
Course Teacher(s):
Name | Office/Room | Email | Class routine
Dr. Muhammad Tarik Arafat | 10th floor, ECE Building, BUET, Dhaka | tarikarafat@bme.buet.ac.bd
+(880 2) 55167100 | Tuesday:
11:00 AM-1:30 PM
Dr. Taufiq Hasan | 10th floor, ECE Building, BUET, Dhaka | taufiq@bme.buet.ac.bd
+(880 2) 55167100 | 
Dr. Jahid Ferdous | 10th floor, ECE Building, BUET, Dhaka | ferdousj@bme.buet.ac.bd
+(880 2) 55167100 | 
Course Objectives:
This course will introduce the undergraduate students to the methodology of research
Students will become familiar with the ethical principles of research, ethical challenges and approval processes
Identify the components of a literature review process
Describe quantitative, qualitative and mixed methods approaches to research
Critically analyze published research
Course Outcomes:
Apply the fundamental knowledge of science and biomedical engineering to understand specific research problems.
Evaluate state-of-the-art literature to identify contemporary challenges and research gaps.
Design solutions that address the identified research gap, considering public health, safety, cultural, societal, and environmental considerations.
Design experiments using appropriate tools to evaluate a specified hypothesis.
Use adequate research machinery and/or equipment to conduct experiments as required.
Analyze acquired research data and provide valid conclusions.
Prepare research documents as per requirements and academic writing standards.
Demonstrate ethical practice standards in case of dealing with clinical/patient data.
Demonstrate effective teamwork ability both as an individual and as a team member or leader.
Demonstrate effective communication skills within and outside the team.
Demonstrate curiosity and aptitude for proactively learning new research methodology.
Assess the societal, health, safety, legal, and cultural implications relevant to the research work based on professional engineering practices.
Assessment:
Continuous Assessment		20%
Oral Examination			30%
Report					50%
Assessment Strategy
Continuous Assessment: Continuous assessment through assigned tasks by the supervisor. The scheme of the continuous assessment for the course will be decided by the supervisor, which may include presentations or written assignments.
Final Oral Examination: A final presentation will be given by the student on the research work conducted within the course period.
Final Report: A thesis/report is required to be submitted on the research work
Textbooks and References:
To be specified by the assigned supervisor.
Weekly Schedule:
To be determined by the respective supervisor. The students will meet with the supervisor once a week during the BME 400 class schedule. The supervisor will appropriately provide feedback and guidance to advance the research project.','[{"name": "Dr. Muhammad Tarik Arafat", "room": "ECE-1021", "email": "tarikarafat@bme.buet.ac.bd"}, {"name": "Dr. Taufiq Hasan", "room": "ECE-1019", "email": "taufiqhasan@bme.buet.ac.bd"}, {"name": "Dr. Jahid Ferdous", "room": "ECE-1017", "email": "jferdous@bme.buet.ac.bd"}]'::jsonb,'[]'::jsonb,'[]'::jsonb,'{"folder": "1 - Course Files/L4T2/BME 400 Course File/January 2024", "files": {"co_po_mapping": "January 2024/CO-PO mapping.docx", "outline": "January 2024/BME 400 Course Outline July 2024.docx"}, "car_text": "Course Assessment Report\nDepartment of BME, BUET\nPart A. Course Information\n1. Course Number: | BME 400\n2. Course Title: | Thesis/Project\n3. Level, Term and Section | 4/1 & 4/2\n4. Academic Term | Jan 2024\n5. Textbooks used: | N/A\n6. Last term when the course was offered | N/A\nPart B. Attainment for current and previous terms\nCurrent Term\nCO Attainment \tCO1 \tCO2 \tCO3 \tCO4 \tCO5 \tCO6 \tCO7 \tCO8 \tCO9 CO10 CO11 CO12\n%student attained | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100%\nCohort attainment | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y\nPO Attainment | PO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\n%student attained | 100% | 100% | 100% | 100% | 100% | 100% | N/A | 100% | 96.55 % | 100% | N/A | 100%\nCohort attainment | Y | Y | Y | Y | Y | Y |  | Y | Y | Y | N/A | Y\nPart C. Analysis\nTeachers’ comment on attainment: All students attained the relevant POs for this course.\nInterpretation of student feedback: No feedback\nTeachers’ comment on teaching learning: Assessment tools need to be further improved to cover social and cultural impact of the research work (PO6). In addition, environmental factors and sustainability were not covered in many projects and thus need to be specified for future terms (PO7). Continuous assessment tools need to be improved.\nPart D. Comments on CQI implemented based on last assessment\nN/A\nPart E. Recommendation\nMajor issues:\nN/A\nPlan for future actions for further improvement:\nExplicitly require students to analyze the social and cultural aspects (PO6) and also consider the environmental and sustainability issues (PO7) in the reports.\nOne interim report will be required after the completion of L4-T1 and the final evaluation (report and presentation) will be done at the end of L4-T2.\nc. Students must mention in their reports about the ethical and safety issues, even though if these are minimal for the research project.\nd. The assessment tools specified in the course outline should be revisited and modified if it requires any change.\nSignature(s):\nName: Dr. Muhammad Tarik Arafat | Name: Dr. Taufiq Hasan | Dr. Jahid Ferdous\nSignature: | Signature: | Signature:"}'::jsonb,array['No item-to-CO mapping found (no CO-PO assessment workbook, or an unrecognised layout)']::text[],true,false);
insert into stg_co values ('2024-01','BME 400',1,'Apply the fundamental knowledge of science and biomedical engineering to understand specific research problems',array['C3']::text[],array['Weekly meetings','Discussion']::text[],array['Presentations','Reports']::text[],array['K1','K2','K3','K4']::text[],array['PO1']::text[]);
insert into stg_co values ('2024-01','BME 400',2,'Evaluate state-of-the-art literature to identify contemporary challenges and research gaps',array['C5']::text[],array['Weekly meetings','Discussion']::text[],array['Presentations','Reports']::text[],array['K1','K2','K3','K4']::text[],array['PO2']::text[]);
insert into stg_co values ('2024-01','BME 400',3,'Design solutions that address the identified research gap, considering public health, safety, cultural, societal, and environmental considerations',array['C6']::text[],array['Weekly meetings','Discussion']::text[],array['Presentations','Reports']::text[],array['K5']::text[],array['PO3']::text[]);
insert into stg_co values ('2024-01','BME 400',4,'Design experiments using appropriate tools to evaluate a specified hypothesis',array['C6']::text[],array['Weekly meetings','Discussion']::text[],array['Presentations','Reports']::text[],array['K6','K8','P1','P2','P3']::text[],array['PO4']::text[]);
insert into stg_co values ('2024-01','BME 400',5,'Use adequate research machinery and/or equipment to conduct experiments as required',array['PS4']::text[],array['Weekly meetings','Discussion']::text[],array['Presentations','Reports']::text[],array['K7']::text[],array['PO5']::text[]);
insert into stg_co values ('2024-01','BME 400',6,'Analyze acquired research data and provide valid conclusions',array['C4']::text[],array['Weekly meetings','Discussion']::text[],array['Presentations','Reports']::text[],array['K6']::text[],array['PO4']::text[]);
insert into stg_co values ('2024-01','BME 400',7,'Prepare research documents as per requirements and academic writing standards',array['C6']::text[],array['Weekly meetings','Discussion']::text[],array['Presentations','Reports']::text[],array['K8','P1']::text[],array['PO10']::text[]);
insert into stg_co values ('2024-01','BME 400',8,'Demonstrate ethical practices standards in case of dealing with clinical/patient data',array['AF3']::text[],array['Weekly meetings','Discussion']::text[],array['Presentations','Reports']::text[],array['K4','K8','A1','A2']::text[],array['PO8']::text[]);
insert into stg_co values ('2024-01','BME 400',9,'Demonstrate effective teamwork ability both as an individual, and as a member or leader',array['AF3']::text[],array['Weekly meetings','Discussion']::text[],array['Presentations','Peer Review']::text[],array['K7']::text[],array['PO9']::text[]);
insert into stg_co values ('2024-01','BME 400',10,'Demonstrate effective communication skills within and outside the team',array['AF3']::text[],array['Weekly meetings','Discussion']::text[],array['Presentations','Reports','Peer Review']::text[],array['A1','A2']::text[],array['PO10']::text[]);
insert into stg_co values ('2024-01','BME 400',11,'Demonstrate curiosity and aptitude for proactively learning new research methodology',array['AF3']::text[],array['Weekly meetings','Discussion']::text[],array['Presentations','Reports','Bi-weekly Meetings']::text[],array['K8','P1']::text[],array['PO12']::text[]);
insert into stg_co values ('2024-01','BME 400',12,'Assess the societal, health, safety, legal, and cultural implications relevant to the research work based on professional engineering practices',array['C4']::text[],array['Weekly meetings','Discussion']::text[],array['Presentations','Reports']::text[],array['K7']::text[],array['PO6']::text[]);
insert into stg_att values ('2024-01','BME 400','CO','CO1',100,'summary');
insert into stg_att values ('2024-01','BME 400','CO','CO2',100,'summary');
insert into stg_att values ('2024-01','BME 400','CO','CO3',100,'summary');
insert into stg_att values ('2024-01','BME 400','CO','CO4',100,'summary');
insert into stg_att values ('2024-01','BME 400','CO','CO5',100,'summary');
insert into stg_att values ('2024-01','BME 400','CO','CO6',100,'summary');
insert into stg_att values ('2024-01','BME 400','CO','CO7',100,'summary');
insert into stg_att values ('2024-01','BME 400','CO','CO8',100,'summary');
insert into stg_att values ('2024-01','BME 400','CO','CO9',100,'summary');
insert into stg_att values ('2024-01','BME 400','CO','CO10',100,'summary');
insert into stg_att values ('2024-01','BME 400','CO','CO11',100,'summary');
insert into stg_att values ('2024-01','BME 400','CO','CO12',100,'summary');
insert into stg_att values ('2024-01','BME 400','PO','PO1',100,'summary');
insert into stg_att values ('2024-01','BME 400','PO','PO2',100,'summary');
insert into stg_att values ('2024-01','BME 400','PO','PO3',100,'summary');
insert into stg_att values ('2024-01','BME 400','PO','PO4',100,'summary');
insert into stg_att values ('2024-01','BME 400','PO','PO5',100,'summary');
insert into stg_att values ('2024-01','BME 400','PO','PO6',100,'summary');
insert into stg_att values ('2024-01','BME 400','PO','PO8',100,'summary');
insert into stg_att values ('2024-01','BME 400','PO','PO9',96.55,'summary');
insert into stg_att values ('2024-01','BME 400','PO','PO10',100,'summary');
insert into stg_att values ('2024-01','BME 400','PO','PO12',100,'summary');
insert into stg_car values ('2024-01','BME 400','Teachers’ comment on attainment: All students attained the relevant POs for this course.
Interpretation of student feedback: No feedback
Teachers’ comment on teaching learning: Assessment tools need to be further improved to cover social and cultural impact of the research work (PO6). In addition, environmental factors and sustainability were not covered in many projects and thus need to be specified for future terms (PO7). Continuous assessment tools need to be improved.','','Major issues:
N/A
Plan for future actions for further improvement:
Explicitly require students to analyze the social and cultural aspects (PO6) and also consider the environmental and sustainability issues (PO7) in the reports.
One interim report will be required after the completion of L4-T1 and the final evaluation (report and presentation) will be done at the end of L4-T2.
c. Students must mention in their reports about the ethical and safety issues, even though if these are minimal for the research project.
d. The assessment tools specified in the course outline should be revisited and modified if it requires any change.');
insert into stg_off values ('2025-07','July 2025','BME 400','BME 20',null,'This course will introduce the undergraduate students to the methodology of research
Students will become familiar with the ethical principles of research, ethical challenges and approval processes
Identify the components of a literature review process
Describe quantitative, qualitative and mixed methods approaches to research
Critically analyze published research','Bangladesh University of Engineering and Technology
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No:		BME 400
Course Title:		Project and Thesis
Credit hours:		3				Contact hours: 3
Level/Term:		4/1 & 4/2
Academic Session: 	2023-2024
Course Teacher(s):
Name | Office/Room | Email | Class routine
Dr. Muhammad Tarik Arafat | 10th floor, ECE Building, BUET, Dhaka | tarikarafat@bme.buet.ac.bd
+(880 2) 55167100 | Tuesday:
11:00 AM-1:30 PM
Dr. Taufiq Hasan | 10th floor, ECE Building, BUET, Dhaka | taufiq@bme.buet.ac.bd
+(880 2) 55167100 | 
Dr. Jahid Ferdous | 10th floor, ECE Building, BUET, Dhaka | ferdousj@bme.buet.ac.bd
+(880 2) 55167100 | 
Course Objectives:
This course will introduce the undergraduate students to the methodology of research
Students will become familiar with the ethical principles of research, ethical challenges and approval processes
Identify the components of a literature review process
Describe quantitative, qualitative and mixed methods approaches to research
Critically analyze published research
Course Outcomes:
Apply the fundamental knowledge of science and biomedical engineering to understand specific research problems
Evaluate state-of-the-art literature to identify contemporary challenges and research gaps
Design solutions that address the identified research gap, considering public health, safety, cultural, societal, and environmental considerations
Design experiments using appropriate tools to evaluate a specified hypothesis
Use adequate research machinery and/or equipment to conduct experiments as required
Analyze acquired research data and provide valid conclusions
Prepare research documents as per requirements and academic writing standards
Demonstrate ethical practices standards in case of dealing with clinical/patient data
Demonstrate effective teamwork ability both as an individual and as a member or leader
Demonstrate effective communication skills within and outside the team
Demonstrate curiosity and aptitude for proactively learning new research methodology
Assess the societal, health, safety, legal, and cultural implications relevant to the research work based on professional engineering practices
Assessment:
Continuous Assessment		20%
Oral Examination			30%
Final Report				50%
Assessment Strategy
Continuous Assessment: Continuous assessment through assigned tasks by the supervisor. The scheme of the continuous assessment for the course will be decided by the supervisor, which may include presentations or written assignments.
Final Oral Examination: A final presentation will be given by the student on the research work conducted within the course period.
Final Report: A thesis/report is required to be submitted on the research work
Textbooks and References:
To be specified by the assigned supervisor.
Weekly Schedule:
To be determined by the respective supervisor. The students will meet with the supervisor once a week during the BME 400 class schedule. The supervisor will appropriately provide feedback and guidance to advance the research project.','[{"name": "Dr. Muhammad Tarik Arafat", "room": "ECE-1021", "email": "tarikarafat@bme.buet.ac.bd"}, {"name": "Dr. Taufiq Hasan", "room": "ECE-1019", "email": "taufiqhasan@bme.buet.ac.bd"}, {"name": "Dr. Jahid Ferdous", "room": "ECE-1017", "email": "jferdous@bme.buet.ac.bd"}]'::jsonb,'[{"component": "Continuous Assessment", "percent": 20.0}, {"component": "Oral Examination", "percent": 30.0}, {"component": "Final Report", "percent": 50.0}]'::jsonb,'[{"component": "Continuous Assessment", "weight": 0.2, "marks": 120}, {"component": "Oral Examination", "weight": 0.3, "marks": 180}, {"component": "Report", "weight": 0.5, "marks": 300}]'::jsonb,'{"folder": "1 - Course Files/L4T2/BME 400 Course File/July 2025", "files": {"co_po_mapping": "July 2025/CO-PO mapping.docx", "outline": "July 2025/BME 400 Course Outline.docx", "assessment_workbook": "7 - BME Culminating Course Assessment Archive/BME 400_Assessment Archieve/July 2025/BME 400_CO-PO_Assessment-Jul-25 (BME20).xlsx"}, "car_text": "Course Assessment Report\nDepartment of BME, BUET\nPart A. Course Information\n1. Course Number: | BME 400\n2. Course Title: | Thesis/Project\n3. Level, Term and Section | 4/1 & 4/2\n4. Academic Term | July 2025\n5. Textbooks used: | N/A\n6. Last term when the course was offered | N/A\nPart B. Attainment for current and previous terms\nCurrent Term\nCO Attainment | CO1 | CO2 | CO3 | CO4 | CO5 | CO6 | CO7 | CO8 | CO9 | CO10 | CO11 | CO12\n%student attained | 98.00% | 98.00% | 98.00% | 98.00% | 98.00% | 98.00% | 98.00% | 98.00% | 100.0% | 100.0% | 98.00% | 98.00%\nCohort attainment | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y\nPO Attainment | PO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\n%student attained | 98% | 98% | 98% | 98% | 98% | 98% | NA | 98% | 100.0% | 98% | NA | 98%\nCohort attainment | Y | Y | Y | Y | Y | Y | NA | Y | Y | Y | NA | Y\nPrevious Term\nCO Attainment \tCO1 \tCO2 \tCO3 \tCO4 \tCO5 \tCO6 \tCO7 \tCO8 \tCO9 CO10 CO11 CO12\n%student attained | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100%\nCohort attainment | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y\nPO Attainment | PO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\n%student attained | 100% | 100% | 100% | 100% | 100% | 100% | N/A | 100% | 96.55% | 100% | N/A | 100%\nCohort attainment | Y | Y | Y | Y | Y | Y |  | Y | Y | Y | N/A | Y\nPart C. Analysis\nTeachers’ comment on attainment: Satisfactory.\nInterpretation of student feedback:\nTeachers’ comment on teaching learning:\nPart D. Comments on CQI implemented based on last assessment\nN/A\nPart E. Recommendation\nMajor issues:\nN/A\nPlan for future actions for further improvement:\nWe can try to organize sessions regarding research methodology next semester.\nFinal report weightage can be reduced, we should discuss about that in department meeting.\nSignature(s):\nName: Dr. Muhammad Tarik Arafat | Name: Dr. Taufiq Hasan | Dr. Jahid Ferdous\nSignature: | Signature: | Signature:"}'::jsonb,'{}'::text[],true,true);
insert into stg_co values ('2025-07','BME 400',1,'Apply the fundamental knowledge of science and biomedical engineering to understand specific research problems',array['C3']::text[],array['Weekly meetings','Discussion']::text[],array['Presentations','Reports']::text[],array['K1','K2','K3','K4']::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 400',2,'Evaluate state-of-the-art literature to identify contemporary challenges and research gaps',array['C5']::text[],array['Weekly meetings','Discussion']::text[],array['Presentations','Reports']::text[],array['K1','K2','K3','K4']::text[],array['PO2']::text[]);
insert into stg_co values ('2025-07','BME 400',3,'Design solutions that address the identified research gap, considering public health, safety, cultural, societal, and environmental considerations',array['C6']::text[],array['Weekly meetings','Discussion']::text[],array['Presentations','Reports']::text[],array['K5']::text[],array['PO3']::text[]);
insert into stg_co values ('2025-07','BME 400',4,'Design experiments using appropriate tools to evaluate a specified hypothesis',array['C6']::text[],array['Weekly meetings','Discussion']::text[],array['Presentations','Reports']::text[],array['K6','K8','P1','P2','P3']::text[],array['PO4']::text[]);
insert into stg_co values ('2025-07','BME 400',5,'Use adequate research machinery and/or equipment to conduct experiments as required',array['PS4']::text[],array['Weekly meetings','Discussion']::text[],array['Presentations','Reports']::text[],array['K7']::text[],array['PO5']::text[]);
insert into stg_co values ('2025-07','BME 400',6,'Analyze acquired research data and provide valid conclusions',array['C4']::text[],array['Weekly meetings','Discussion']::text[],array['Presentations','Reports']::text[],array['K6']::text[],array['PO4']::text[]);
insert into stg_co values ('2025-07','BME 400',7,'Prepare research documents as per requirements and academic writing standards',array['C6']::text[],array['Weekly meetings','Discussion']::text[],array['Presentations','Reports']::text[],array['K8','P1']::text[],array['PO10']::text[]);
insert into stg_co values ('2025-07','BME 400',8,'Demonstrate ethical practices standards in case of dealing with clinical/patient data',array['AF3']::text[],array['Weekly meetings','Discussion']::text[],array['Presentations','Reports']::text[],array['K4','K8','A1','A2']::text[],array['PO8']::text[]);
insert into stg_co values ('2025-07','BME 400',9,'Demonstrate effective teamwork ability both as an individual, and as a member or leader',array['AF3']::text[],array['Weekly meetings','Discussion']::text[],array['Presentations','Peer Review']::text[],array['K7']::text[],array['PO9']::text[]);
insert into stg_co values ('2025-07','BME 400',10,'Demonstrate effective communication skills within and outside the team',array['AF3']::text[],array['Weekly meetings','Discussion']::text[],array['Presentations','Reports','Peer Review']::text[],array['A1','A2']::text[],array['PO10']::text[]);
insert into stg_co values ('2025-07','BME 400',11,'Demonstrate curiosity and aptitude for proactively learning new research methodology',array['AF3']::text[],array['Weekly meetings','Discussion']::text[],array['Presentations','Reports','Bi-weekly Meetings']::text[],array['K8','P1']::text[],array['PO12']::text[]);
insert into stg_co values ('2025-07','BME 400',12,'Assess the societal, health, safety, legal, and cultural implications relevant to the research work based on professional engineering practices',array['C4']::text[],array['Weekly meetings','Discussion']::text[],array['Presentations','Reports']::text[],array['K7']::text[],array['PO6']::text[]);
insert into stg_crit values ('2025-07','BME 400',0,'Continuous Assessment','Background',10,array['CO1']::text[]);
insert into stg_crit values ('2025-07','BME 400',1,'Continuous Assessment','Literature review & Research gap',10,array['CO2']::text[]);
insert into stg_crit values ('2025-07','BME 400',2,'Continuous Assessment','Design solution, Sustainability framework',10,array['CO3']::text[]);
insert into stg_crit values ('2025-07','BME 400',3,'Continuous Assessment','Experiment Design',15,array['CO4']::text[]);
insert into stg_crit values ('2025-07','BME 400',4,'Continuous Assessment','Use of adequate research tool',30,array['CO5']::text[]);
insert into stg_crit values ('2025-07','BME 400',5,'Continuous Assessment','Ethical Compliance',10,array['CO8']::text[]);
insert into stg_crit values ('2025-07','BME 400',6,'Continuous Assessment','Effective teamwork',10,array['CO9']::text[]);
insert into stg_crit values ('2025-07','BME 400',7,'Continuous Assessment','Effective communication',10,array['CO10']::text[]);
insert into stg_crit values ('2025-07','BME 400',8,'Continuous Assessment','Curiosity & Proactiveness',15,array['CO11']::text[]);
insert into stg_crit values ('2025-07','BME 400',9,'Oral Examination','Background',18,array['CO1']::text[]);
insert into stg_crit values ('2025-07','BME 400',10,'Oral Examination','Literature review & Research gap',18,array['CO2']::text[]);
insert into stg_crit values ('2025-07','BME 400',11,'Oral Examination','Design solution, Sustainability framework',18,array['CO3']::text[]);
insert into stg_crit values ('2025-07','BME 400',12,'Oral Examination','Experiment Design',27,array['CO4']::text[]);
insert into stg_crit values ('2025-07','BME 400',13,'Oral Examination','Research tool & Equipment',27,array['CO5']::text[]);
insert into stg_crit values ('2025-07','BME 400',14,'Oral Examination','Data Analysis',54,array['CO6']::text[]);
insert into stg_crit values ('2025-07','BME 400',15,'Oral Examination','Ethical Compliance',9,array['CO8']::text[]);
insert into stg_crit values ('2025-07','BME 400',16,'Oral Examination','Professional impact',9,array['CO12']::text[]);
insert into stg_crit values ('2025-07','BME 400',17,'Report','Application of fundamental knowledge of science and biomedical engineering to understand the research problem',20,array['CO1']::text[]);
insert into stg_crit values ('2025-07','BME 400',18,'Report','Evaluation of the state-of-the-art literature to identify contemporary challenges and research gaps',25,array['CO2']::text[]);
insert into stg_crit values ('2025-07','BME 400',19,'Report','Design of solutions that address the identified research gap, considering public health, safety, cultural, societal, and environmental considerations',40,array['CO3']::text[]);
insert into stg_crit values ('2025-07','BME 400',20,'Report','Design of experiments using appropriate tools to evaluate a specified hypothesis',40,array['CO4']::text[]);
insert into stg_crit values ('2025-07','BME 400',21,'Report','Use of adequate research machinery and/or equipment/tools to conduct experiments for the research work',40,array['CO5']::text[]);
insert into stg_crit values ('2025-07','BME 400',22,'Report','Analysis of acquired research data and providing valid conclusions',60,array['CO6']::text[]);
insert into stg_crit values ('2025-07','BME 400',23,'Report','Preparation of research documents as per requirements and academic writing standards',30,array['CO7']::text[]);
insert into stg_crit values ('2025-07','BME 400',24,'Report','Demonstration of ethical practices standards in the case of dealing with clinical/patient data',15,array['CO8']::text[]);
insert into stg_crit values ('2025-07','BME 400',25,'Report','Assessment of the societal, legal, and cultural implications relevant to the research work based on professional engineering practices',15,array['CO12']::text[]);
insert into stg_crit values ('2025-07','BME 400',26,'Report','Assessment of the health and safety implications relevant to the research work based on professional engineering practices',15,array['CO12']::text[]);
insert into stg_att values ('2025-07','BME 400','CO','CO1',98,'workbook');
insert into stg_att values ('2025-07','BME 400','CO','CO2',98,'workbook');
insert into stg_att values ('2025-07','BME 400','CO','CO3',98,'workbook');
insert into stg_att values ('2025-07','BME 400','CO','CO4',98,'workbook');
insert into stg_att values ('2025-07','BME 400','CO','CO5',98,'workbook');
insert into stg_att values ('2025-07','BME 400','CO','CO6',98,'workbook');
insert into stg_att values ('2025-07','BME 400','CO','CO7',98,'workbook');
insert into stg_att values ('2025-07','BME 400','CO','CO8',98,'workbook');
insert into stg_att values ('2025-07','BME 400','CO','CO9',100,'workbook');
insert into stg_att values ('2025-07','BME 400','CO','CO10',100,'workbook');
insert into stg_att values ('2025-07','BME 400','CO','CO11',98,'workbook');
insert into stg_att values ('2025-07','BME 400','CO','CO12',98,'workbook');
insert into stg_att values ('2025-07','BME 400','PO','PO1',98,'workbook');
insert into stg_att values ('2025-07','BME 400','PO','PO2',98,'workbook');
insert into stg_att values ('2025-07','BME 400','PO','PO3',98,'workbook');
insert into stg_att values ('2025-07','BME 400','PO','PO4',98,'workbook');
insert into stg_att values ('2025-07','BME 400','PO','PO5',98,'workbook');
insert into stg_att values ('2025-07','BME 400','PO','PO6',98,'workbook');
insert into stg_att values ('2025-07','BME 400','PO','PO8',98,'workbook');
insert into stg_att values ('2025-07','BME 400','PO','PO9',100,'workbook');
insert into stg_att values ('2025-07','BME 400','PO','PO10',98,'workbook');
insert into stg_att values ('2025-07','BME 400','PO','PO12',98,'workbook');
insert into stg_car values ('2025-07','BME 400','Teachers’ comment on attainment: Satisfactory.
Interpretation of student feedback:
Teachers’ comment on teaching learning:','','Major issues:
N/A
Plan for future actions for further improvement:
We can try to organize sessions regarding research methodology next semester.
Final report weightage can be reduced, we should discuss about that in department meeting.');
insert into stg_bugs values ('BUGS 09.04.25','2025-04-09','https://buetedu-my.sharepoint.com/:b:/g/personal/shoyadsabur_bme_buet_ac_bd/IQCjIvypYsjBQLUopsrX7yx3AZtJDMIoD-etVNDs3LN3IwY?e=2OdeOt','2025-07','BME 400');
insert into stg_bugs values ('BUGS 25.09.24','2024-09-25','https://buetedu-my.sharepoint.com/:b:/g/personal/shoyadsabur_bme_buet_ac_bd/IQD0kt-gTLO8TIau20QIkosZAc-lTC1JGayFDMEToMDQIB0?e=6VwAH6','2025-07','BME 400');
insert into stg_off values ('2025-07','July 2025','BME 405',null,'Introduction on Leadership in Healthcare, Dealing with Hybrid roles in
Healthcare Management, The influence of Professional Habitus on Healthcare Leadership, Healthcare organizations, Introduction to the codes, standards, ethical issues and regulations governing Healthcare Technology practices; Development of related policies and procedures govern activities such as the selection, planning, and acquisition of medical devices for their safe use; Patient Safety and Privacy; Safety programs; Infection control; Types of Contracts and Contract negotiation; Introduction to Healthcare Systems & Models, Health Informatics & Digital Health.','• The course will introduce the main concepts of management, leadership and medical
organizational hierarchy
• The course will cover key ethical tenets of biomedical engineering and regulatory
guidelines of medical devices
• The course will introduce the main concepts of health informatics and digital health','Bangladesh University of Engineering and Technology
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No:			BME 405
Course Title:		Healthcare System Management
Credit hours:		3				                 Contact hours:	  3
Level/Term:			4/2
Academic Session: 	2024-2025
Course Teacher(s):
Name | Office/
Room | Email & Telephone | Class routine | Tutorial Hour
Ms Chaity Chakraborty | ECE-1013 | chaity@bme.buet.ac.bd
+8801782-754675 | Sunday:
8:00 am – 8:50 am
Monday:
11:00 am – 11:50 am
Tuesday:
10:00 am – 10:50 am | Wednesday:
4:00 PM-5:00 PM
Mr. Md Tazuddin Ahmed | ECE-1123 | mdtuahmed@bme.buet.ac.bd
+880 1797091595 |  | 
Course Contents:
Introduction on Leadership in Healthcare, Dealing with Hybrid roles in
Healthcare Management, The influence of Professional Habitus on Healthcare Leadership, Healthcare organizations, Introduction to the codes, standards, ethical issues and regulations governing Healthcare Technology practices; Development of related policies and procedures govern activities such as the selection, planning, and acquisition of medical devices for their safe use; Patient Safety and Privacy; Safety programs; Infection control; Types of Contracts and Contract negotiation; Introduction to Healthcare Systems & Models, Health Informatics & Digital Health.
Course Objectives:
• The course will introduce the main concepts of management, leadership and medical
organizational hierarchy
• The course will cover key ethical tenets of biomedical engineering and regulatory
guidelines of medical devices
• The course will introduce the main concepts of health informatics and digital health
Course Outcomes:
1. Understand the concept of leadership, management, administration and regulation of
modern healthcare management
2. Explain the structure, components, and functions of different healthcare systems and
models across local and global contexts
3. Explain the concepts of medical device, infection control in medical devices and relevant safety regulations
Assessment Strategy:
Class Participation: Class participation and attendance will be recorded in every class.
Continuous Assessment: Continuous assessment through quizzes and assignments. The scheme of the continuous assessment for the course will be declared on the first day of classes
Final Examination: A comprehensive term final examination will be held at the end of the term following the guideline of the academic council.
Distribution of Marks:
Class participation                                     10%
Continuous assessment                              20%
Final Examination                                      70%
Total                                                           100%
Textbooks and References:
National Research Council. (2003). The Experiences and Challenges of Science and Ethics: Proceedings of an American-Iranian Workshop.
Introduction to Health Care Management, Book by Nancy H. Shanks and Sharon B. Buchbinder
Thompson, J. M., Buchbinder, S. B., & Shanks, N. H. (2012). An overview of healthcare management.
4. El Morr, C., & Ali-Hassan, H. (2019). Analytics in healthcare: a practical introduction. Springer.
Lecture Plan:
Lec# | Lecture Topics
1—3 | Leadership and organization:
- Leadership in Healthcare
- Healthcare organizations: Local and Global
4—6 | Leadership and organization:
- Hospitals and their function
- Healthcare Facilities and Organizations in Bangladesh
7—9 | Healthcare Technology practices:
- The codes, standards, ethical issues and regulations governing
Healthcare Technology practices
10—12 | Infection Control and guidelines:
- Types of cleaning
- Sterilization vs. Disinfection
- FDA guidance on reuse of single use devices
13—15 | Healthcare Technology practices:
- key ethical tenets (principles) for biomedical engineers
- biomedical engineering society: code of ethics
16—18 | Medical device Policies, Regulations and Standards:
- Development of related policies and procedures govern activities
such as the selection, planning, and acquisition of medical devices
for their safe use
19—21 | Medical device Policies, Regulations and Standards:
- Patient Safety and Privacy
22—24 | Healthcare Systems and Models:
- Introduction to Healthcare Systems
- Comparative Healthcare Models
25—27 | Healthcare Systems and Models:
- Global Perspectives on Healthcare Systems
- Healthcare System in Bangladesh
28—30 | Hybrid Professionalism:
- Dealing with Hybrid roles in Healthcare Management  CO-1
- The influence of Professional Habitus on Healthcare Leadership
31—33 | Basic of Contracts:
- Types of Contracts
-Contract negotiation
34—36 | Health Informatics:
- Introduction to Health Informatics
- Health Information Systems
37—39 | Health Informatics:
- Data Standards and Interoperability
- Clinical Decision Support and Analytics
40—42 | Digital Health:
- Introduction to Digital Health
- Digital Transformation of Healthcare Systems
Prepared by: | 
Name:
Signature:
Date: | Mr. Md. Tazuddin Ahmed Akash
Name:
Signature:
Date: | Ms. Chaity Chakraborty','[{"name": "Ms Chaity Chakraborty", "room": "ECE-1013", "email": "chaity@bme.buet.ac.bd"}, {"name": "Mr. Md Tazuddin Ahmed", "room": "ECE-1123", "email": "mdtuahmed@bme.buet.ac.bd"}]'::jsonb,'[{"component": "Class participation/Attendance", "percent": 10.0}, {"component": "Continuous Assessment", "percent": 20.0}, {"component": "Term Final", "percent": 70.0}]'::jsonb,'[]'::jsonb,'{"folder": "1 - Course Files/L4T2/BME 405 Course Files/July 2025", "files": {"co_po_mapping": "July 2025/CO-PO Mapping.docx", "outline": "July 2025/BME 405_Course Outline.docx", "assessment_workbook": "July 2025/Assessments and scripts/BME 405-CO-PO-Assessment-marks.xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 405\nCourse Title: | Healthcare System Management\nLevel, Term and Section | 4/2\nAcademic Term | July 2025\nTextbooks used: | National Research Council. (2003). The Experiences and Challenges of Science and Ethics: Proceedings of an American-Iranian Workshop.\nIntroduction to Health Care Management, Book by Nancy H. Shanks and Sharon B. Buchbinder\nThompson, J. M., Buchbinder, S. B., & Shanks, N. H. (2012). An overview of healthcare management. SB Buchbinder, & NH Shanks, Introduction to Health Care Management, 1-16.\nEl Morr, C., & Ali-Hassan, H. (2019). Analytics in healthcare: a practical introduction. Springer.\nLast term when the course was offered | January 2024\nPart B. Attainment for current and previous terms\nJuly 2025\nCO Attainment | CO1 | CO2 | CO3 |  |  |  |  |  |  |  |  | \n%student attained | 94.00% | 98.00% | 98.00% |  |  |  |  |  |  |  |  | \nCohort Attainment | Y | Y | Y |  |  |  |  |  |  |  |  | \n |  |  |  |  |  |  |  |  |  |  |  | \n |  |  |  |  |  |  |  |  |  |  |  | \nPO Attainment | PO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\n%student attained | 98.00% | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A\nCohort Attainment | Y | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A\nTeachers’ comment on attainment: Satisfactory\nInterpretation of student feedback: -\nTeachers’ comment on teaching learning: - The hospital visit based assignment should be avoided from next time as was suggested in Department Meeting.\nPart D. Comments on CQI implemented based on last assessment\nN/A\nPart E. Recommendation\nMajor issues: None\nPlan for future actions for further improvement:\nThe topic ‘Basic of Contracts’ was not covered for lack of time, need to adjust the course plan to incorporate this topic.\nSignature(s):\nName: Ms. Chaity Chakraborty | Name: Mr. Md Tazuddin Ahmed\nSignature: | Signature:"}'::jsonb,array['No K/P/A matrix in CO-PO mapping doc']::text[],true,true);
insert into stg_co values ('2025-07','BME 405',1,'Understand the concept of leadership, management, administration and regulation of modern healthcare management',array['C2']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 405',2,'Explain the structure, components, and functions of different healthcare systems and models across local and global contexts',array['C2']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 405',3,'Explain the concepts of medical device, infection control in medical devices and relevant safety regulations',array['C2']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_crit values ('2025-07','BME 405',0,'Term Final','Q01 (a)',12,array['CO1']::text[]);
insert into stg_crit values ('2025-07','BME 405',1,'Term Final','Q01 (b)',11,array['CO1']::text[]);
insert into stg_crit values ('2025-07','BME 405',2,'Term Final','Q01 (c)',14,array['CO2']::text[]);
insert into stg_crit values ('2025-07','BME 405',3,'Term Final','Q01 (d)',8,array['CO2']::text[]);
insert into stg_crit values ('2025-07','BME 405',4,'Term Final','Q05 (a)',15,array['CO2']::text[]);
insert into stg_crit values ('2025-07','BME 405',5,'Term Final','Q05 (b)',15,array['CO2']::text[]);
insert into stg_crit values ('2025-07','BME 405',6,'Term Final','Q05 (c)',15,array['CO3']::text[]);
insert into stg_att values ('2025-07','BME 405','CO','CO1',94.0,'workbook');
insert into stg_att values ('2025-07','BME 405','CO','CO2',98.0,'workbook');
insert into stg_att values ('2025-07','BME 405','CO','CO3',98.0,'workbook');
insert into stg_att values ('2025-07','BME 405','PO','PO1',98.0,'workbook');
insert into stg_car values ('2025-07','BME 405','Teachers’ comment on attainment: Satisfactory
Interpretation of student feedback: -
Teachers’ comment on teaching learning: - The hospital visit based assignment should be avoided from next time as was suggested in Department Meeting.','','Major issues: None
Plan for future actions for further improvement:
The topic ‘Basic of Contracts’ was not covered for lack of time, need to adjust the course plan to incorporate this topic.');
insert into stg_bugs values ('BUGS 26.10.25','2025-10-26','https://buetedu-my.sharepoint.com/:b:/g/personal/shoyadsabur_bme_buet_ac_bd/IQCy_jpgTQFiT5eiZAwUwCoCAa3SOSsoXvVcBvXkXCbvP2o?e=dw7GtT','2025-07','BME 405');
insert into stg_off values ('2025-07','July 2025','BME 409',null,'Fundamentals of tissue engineering; Cells: cell culture basics, primary cells, cell lines; Stem cells: different types of stem cells, potency of stem cells, iPSC, stem cell based therapy; Scaffolds: ECM, dECM, synthetic scaffolds/ECM, scaffolds manufacturing technology, cell encapsulation, organ printing; In vitro control of tissue development: bioreactors, growth factors, mechanical cues; Lab-on-a-chip; Tissue engineering of different tissue systems: cardiovascular, skin, bone, liver; Regenerative medicine; Clinical translation','The course will cover the fundamentals of tissue engineering modalities.
Basics of cell culture technologies and methods will be introduced
Development of physiological systems in vitro will be discussed','Bangladesh University of Engineering and Technology
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No:	           BME 409
Course Title:	           Tissue Engineering and Regenerative Medicine
Credit hours:	           3				                               Contact hours:	3
Level/Term:	           4/2
Academic Session:   2024-2025
Course Teacher(s):
Name | Office/ 
Room | Email & Telephone | Class routine
Srija Sarkar Anannya | ECE-1013 | srija@bme.buet.ac.bd
+880 1787-151545 | Saturday: 9:00 AM to 9:50 AM
Monday: 12:00 AM to 12:50 AM
Tuesday: 8:00 AM to 8:50 AM
Chaity Chakraborty | ECE-1013 | chaity@bme.buet.ac.bd
+(880) 1782754675 | 
Course Contents:
Fundamentals of tissue engineering; Cells: cell culture basics, primary cells, cell lines; Stem cells: different types of stem cells, potency of stem cells, iPSC, stem cell based therapy; Scaffolds: ECM, dECM, synthetic scaffolds/ECM, scaffolds manufacturing technology, cell encapsulation, organ printing; In vitro control of tissue development: bioreactors, growth factors, mechanical cues; Lab-on-a-chip; Tissue engineering of different tissue systems: cardiovascular, skin, bone, liver; Regenerative medicine; Clinical translation
Course Objectives:
The course will cover the fundamentals of tissue engineering modalities.
Basics of cell culture technologies and methods will be introduced
Development of physiological systems in vitro will be discussed
Course Outcomes:
Explain the fundamentals of tissue engineering technologies and their applications
Discuss the properties, differentiation, and applications of stem cells in tissue engineering and regenerative medicine
Explain the principles and processes involved in tissue development in a laboratory setting
Analyze organ-on-a-chip technology for different physiological systems and their clinical translation
Assessment:
Class Participation                                10%
Continuous Assessment                       20%
Final Examination                                 70%
Total                                                    100%
Textbooks and References:
Principles of Tissue Engineering – Robert Lanza, Robert Langer, Joseph Vacanti. Elsevier; 2014.
Tissue Engineering - Clemens A. van Blitterswijk and Jan de Boer. Elsevier; 2014.
Tissue Engineering for Artificial Organs – Anwarul Hasan. Wiley; 2017.
Weekly Schedule:
Lec# | Lecture Topics
1—3 | Introduction:
Need of tissue engineering
Basic building blocks of tissue engineering: cells, scaffolds, signals/bioreactors
Tissue engineering and regenerative medicine
3—6 | Stem cells:
Stem cells in tissue engineering
Properties and types of stem cells
Potency of stem cells
Stem cell niche
ESCs, hESCs
Stem cell differentiation
Directed differentiation of ESCs and iPSCs
Transdifferentiation and reprogramming
Stem cells to study diseases
Stem cells to treat diseases
7—9 | Stem cells:
Stem cell differentiation
Directed differentiation of ESCs and iPSCs
Transdifferentiation and reprogramming
Stem cells to study diseases
Stem cells to treat diseases
Class test # 1 (CO-1, CO-2)
10—12 | Biomaterials for tissue engineering:
Tissue engineering – principles and strategy
ECM
Engineered scaffolds function
Methods of decellularization: Physical decellularization, Chemical decellularization – acidic or basic; detergent; Enzymatic decellularization, Examples of decellularized ECM
Scar tissue
13—15 | Biomaterials for tissue engineering:
Scar tissue
Antimicrobial Properties of ECM Bioscaffolds
Clinical translation of ECM Bioscaffolds
Commercially available scaffolds composed of ECM
Biomaterial tissue interaction
16—18 | Biomaterials for tissue engineering:
Properties of Biomaterials
Classification of Biomaterials
Polymer degradation and erosion
Fabrication technology
19—21 | In vitro control of tissue development
Fabrication technology
Engineering functional tissue
Fundamental criteria for engineering functional tissue
Engineering perception of human organ
Concepts for mimicking native environment: Mass transport, Mechanical cues, Electrical signals, Cellular microenvironment
Different types of bioreactors
- Class test # 2 (CO-1, CO-3)
22—24 | In vitro control of tissue development
Fabrication technology
Decellularizing and recellularizing liver for transplantation
Clinical trials of Bioartificial liver
Bioreactor for bone grafts
Limitations of current bioreactors
25—27 | Cell Interactions with Polymers
Limitations of current bioreactors
In vitro cell culture methods
In vivo cell culture methods
Protein adsorption to polymers
Polymer chemistry effects on cell behavior
Surface morphology effects on cell behavior
Surface topography
Control of cell behavior using patterned surfaces
Polymer-cell interaction in suspension
Polymer scaffold-cell interaction
Inflammation
Fibrosis and angiogenesis
28—30 | Cell Interactions with Polymers
Surface topography
Control of cell behavior using patterned surfaces
Polymer-cell interaction in suspension
Polymer scaffold-cell interaction
Inflammation
31—33 | Role of Host Immune Response in Tissue Engineering and Regenerative Medicine:
Surface topography
Stages of wound healing
Foreign body response
Acquired and innate immunity
- Class test # 3 (CO-3)
34—36 | Organ-on-a-chip:
Acquired and innate immunity
Motivation for organ-on-a-chip
Unique advantages of organ-on-a-chip
Drug-testing platform
37—39 | Organ-on-a-chip:
In situ biological study platforms
Blood Vessels-on-a-chip
Lung-on-a-chip
Clinical translation:
Historical perspective
Characterization for development of tissue engineered products
Preclinical phase
Clinical phase
40—42 | Clinical translation:
Typical challenges in clinical phase
Efficacy and effectiveness
Regulatory background
Ethical issues
- Class test # 4 (CO-4)
Prepared by: | 
Name:
Signature:
Date: | Ms. Srija Sarker Anannya
Name:
Signature:
Date: | Ms. Chaity Chakraborty','[{"name": "Srija Sarkar Anannya", "room": "ECE-1013", "email": "srija@bme.buet.ac.bd"}, {"name": "Chaity Chakraborty", "room": "ECE-1013", "email": "chaity@bme.buet.ac.bd"}]'::jsonb,'[{"component": "Class participation/Attendance", "percent": 10.0}, {"component": "Continuous Assessment", "percent": 20.0}, {"component": "Term Final", "percent": 70.0}]'::jsonb,'[]'::jsonb,'{"folder": "1 - Course Files/L4T2/BME 409 Course Files/July 2025", "files": {"co_po_mapping": "July 2025/CO-PO Mapping.docx", "outline": "July 2025/BME 409 _Course outline-July 2025.docx", "assessment_workbook": "July 2025/Assessments and scripts/BME 409-CO-PO-Assessment-Marks.xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 409\nCourse Title: | Tissue Engineering and Regenerative Medicine\nLevel, Term and Section | 4/2\nAcademic Term | July 2025\nTextbooks used: | Principles of Tissue Engineering – Robert Lanza, Robert Langer, Joseph Vacanti. Elsevier; 2014.\nTissue Engineering - Clemens A. van Blitterswijk and Jan de Boer. Elsevier; 2014.\nTissue Engineering for Artificial Organs – Anwarul Hasan. Wiley; 2017.\nLast term when the course was offered | July 2023\nPart B. Attainment for current and previous terms\nJuly 2025\nCO Attainment | CO1 | CO2 | CO3 | CO4 | CO5 | CO6 | CO7 | CO8 | CO9 | CO10 | CO11 | CO12\n%student attained | 100.00% | 100.00% | 80.00% | 82.86% | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A\nCohort Attainment | Y | Y | Y | Y | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A\nPO Attainment | PO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\n%student attained | 97.14% | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A\nCohort Attainment | Y | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A\nPart C. Analysis\nTeachers’ comment on attainment: Satisfactory\nInterpretation of student feedback: None\nTeachers’ comment on teaching learning: None\nPart D. Comments on CQI implemented based on last assessment\nN/A\nPart E. Recommendation\nMajor issues: None\nPlan for future actions for further improvement: More case studies and clinical examples, including recent research developments, should be added.\nSignature(s):\nName: Ms. Srija Sarkar Anannya | Name: Ms. Chaity Chakraborty\nSignature: | Signature:"}'::jsonb,array['No K/P/A matrix in CO-PO mapping doc']::text[],true,true);
insert into stg_co values ('2025-07','BME 409',1,'Explain the fundamentals of tissue engineering technologies and their applications',array['C2']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 409',2,'Discuss the properties, differentiation, and applications of stem cells in tissue engineering and regenerative medicine',array['C2']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 409',3,'Explain the principles and processes involved in tissue development in a laboratory setting',array['C2']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 409',4,'Analyze organ-on-a-chip technology for different physiological systems and their clinical translation',array['C4']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_crit values ('2025-07','BME 409',0,'Term Final','Q01 (a)',20,array['CO3']::text[]);
insert into stg_crit values ('2025-07','BME 409',1,'Term Final','Q01 (b)',15,array['CO4']::text[]);
insert into stg_crit values ('2025-07','BME 409',2,'Term Final','Q01 (c)',10,array['CO3']::text[]);
insert into stg_crit values ('2025-07','BME 409',3,'Term Final','Q05 (a)',10,array['CO1']::text[]);
insert into stg_crit values ('2025-07','BME 409',4,'Term Final','Q05 (b)',10,array['CO2']::text[]);
insert into stg_crit values ('2025-07','BME 409',5,'Term Final','Q05 (c)',8,array['CO3']::text[]);
insert into stg_crit values ('2025-07','BME 409',6,'Term Final','Q05 (d)',17,array['CO2']::text[]);
insert into stg_att values ('2025-07','BME 409','CO','CO1',100,'workbook');
insert into stg_att values ('2025-07','BME 409','CO','CO2',100,'workbook');
insert into stg_att values ('2025-07','BME 409','CO','CO3',80.0,'workbook');
insert into stg_att values ('2025-07','BME 409','CO','CO4',82.86,'workbook');
insert into stg_att values ('2025-07','BME 409','PO','PO1',97.14,'workbook');
insert into stg_car values ('2025-07','BME 409','Teachers’ comment on attainment: Satisfactory
Interpretation of student feedback: None
Teachers’ comment on teaching learning: None','','Major issues: None
Plan for future actions for further improvement: More case studies and clinical examples, including recent research developments, should be added.');
insert into stg_bugs values ('BUGS 26.10.25','2025-10-26','https://buetedu-my.sharepoint.com/:b:/g/personal/shoyadsabur_bme_buet_ac_bd/IQCy_jpgTQFiT5eiZAwUwCoCAa3SOSsoXvVcBvXkXCbvP2o?e=dw7GtT','2025-07','BME 409');
insert into stg_off values ('2025-07','July 2025','BME 437',null,null,null,null,'[{"name": "Samiul Based Shuvo", "room": "ECE-1121", "email": "sbshuvo@bme.buet.ac.bd"}, {"name": "Shoyad Ibn Sabur Khan Nuhash", "room": "ECE-1017", "email": "syadsabur@bme.buet.ac.bd"}]'::jsonb,'[{"component": "Class participation/Attendance", "percent": 10.0}, {"component": "Continuous Assessment", "percent": 20.0}, {"component": "Term Final", "percent": 70.0}]'::jsonb,'[]'::jsonb,'{"folder": "1 - Course Files/L4T2/BME 437 Course File/July 2025", "files": {"co_po_mapping": "July 2025/CO-PO Mapping.docx", "outline": "July 2025/BME 437 - Course outline.pdf"}, "car_text": "Part A. Course Information\nCourse Number: | BME 437\nCourse Title: | Engineering Optics for Medical Application\nLevel, Term and Section | 4/2\nAcademic Term | July 2025\nTextbooks used: | Gerd Keiser. (2016). Biophotonics, Concepts to Applications.\nBoas, D. A., Pitris, C.,  Ramanujam, N. (Eds.). (2016). Handbook of biomedical optics. CRC press.\nSplinter, R. (2006). An introduction to biomedical optics. CRC press.\nWang, L. V.,  Wu, H. I. (2012). Biomedical optics: principles and imaging. John Wiley  Sons.\nLast term when the course was offered | N/A\nPart B. Attainment for current and previous terms\nJuly 2025\nCO1 | CO2 | CO3 | CO4\n89.74% | 94.87% | 94.87% | 87.18%\nY | Y | Y | Y\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\n97.44% | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A\nY | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A\nPart C. Analysis\nTeachers’ comment on attainment: Satisfactory\nInterpretation of student feedback: N/A.\nTeachers’ comment on teaching learning:  N/A.\nPart D. Comments on CQI implemented based on last assessment\nPart E. Recommendation\nMajor issues: No.\nPlan for future actions for further improvement: The course is already well structured.\nSignature(s):\nName: Samiul Based Shuvo | Name: Shoyad Ibn Sabur Khan Nuhash\nSignature: | Signature:"}'::jsonb,array['No K/P/A matrix in CO-PO mapping doc','No item-to-CO mapping found (no CO-PO assessment workbook, or an unrecognised layout)','Basic Information.docx names BME 447 (folder is BME 437)']::text[],false,false);
insert into stg_co values ('2025-07','BME 437',1,'Explain fundamental optical principles and phenomena',array['C2']::text[],array['Lectures','Interactive discussions']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 437',2,'Analyze different optical system design components',array['C3']::text[],'{}'::text[],'{}'::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 437',3,'Analyze the optical properties of biological tissues for designing optical systems',array['C3']::text[],'{}'::text[],'{}'::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 437',4,'Apply optical principles to biomedical imaging and diagnostic systems',array['C3']::text[],'{}'::text[],'{}'::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_att values ('2025-07','BME 437','CO','CO1',89.74,'car');
insert into stg_att values ('2025-07','BME 437','CO','CO2',94.87,'car');
insert into stg_att values ('2025-07','BME 437','CO','CO3',94.87,'car');
insert into stg_att values ('2025-07','BME 437','CO','CO4',87.18,'car');
insert into stg_att values ('2025-07','BME 437','PO','PO1',97.44,'car');
insert into stg_car values ('2025-07','BME 437','Teachers’ comment on attainment: Satisfactory
Interpretation of student feedback: N/A.
Teachers’ comment on teaching learning:  N/A.','','Major issues: No.
Plan for future actions for further improvement: The course is already well structured.');
insert into stg_bugs values ('BUGS 26.10.25','2025-10-26','https://buetedu-my.sharepoint.com/:b:/g/personal/shoyadsabur_bme_buet_ac_bd/IQCy_jpgTQFiT5eiZAwUwCoCAa3SOSsoXvVcBvXkXCbvP2o?e=dw7GtT','2025-07','BME 437');
insert into stg_off values ('2025-07','July 2025','BME 447',null,'Clinical Engineering: major aspects of clinical engineering; The role of clinical engineers in hospital: clinical engineering activities, patient focused engineering; Clinical measurements; Medical devices and their working principles: external defibrillators, anesthesia machines, EKG/ECG, patient monitors, nebulizers, spirometer, electrosurgical devices, mechanical ventilation; Mobility and wheelchair assessment; Mechanical and electromechanical devices: prosthetics, orthotics, arm supports; Medical engineering design: regulations, quality assurance, safety and risk management; Clinical ethics; Management of medical equipment','● The course will introduce the major aspects of clinical engineering
● The course will introduce students to clinical measurements and different medical devices
● The course will cover ethical tenets of clinical engineering, regulatory guidelines, safety and risk
management of medical devices','Bangladesh University of Engineering and Technology
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No:		BME 447
Course Title:		Clinical Engineering
Credit hours:		3				Contact hours:	3
Level/Term:		4/2
Academic Session: 	2024-2025
Course Teacher(s):
Name | Office/
Room | Email & Telephone | Class routine
Samiul Based Shuvo | ECE 1123 | sbshuvo@bme.buet.ac.bd
+8801797091595 | Sunday:
09:00 AM-09:50 AM
Monday:
09:00 AM-09:50 AM
Wednesday:
11:00 AM-11:50:00
M Tarik Arafat | ECE 1015 | tarafat@bme.buet.ac.bd
+880184445363 | Sunday:
09:00 AM-09:50 AM
Monday:
09:00 AM-09:50 AM
Wednesday:
11:00 AM-11:50:00
Course Contents:
Clinical Engineering: major aspects of clinical engineering; The role of clinical engineers in hospital: clinical engineering activities, patient focused engineering; Clinical measurements; Medical devices and their working principles: external defibrillators, anesthesia machines, EKG/ECG, patient monitors, nebulizers, spirometer, electrosurgical devices, mechanical ventilation; Mobility and wheelchair assessment; Mechanical and electromechanical devices: prosthetics, orthotics, arm supports; Medical engineering design: regulations, quality assurance, safety and risk management; Clinical ethics; Management of medical equipment
Course Objectives:
● The course will introduce the major aspects of clinical engineering
● The course will introduce students to clinical measurements and different medical devices
● The course will cover ethical tenets of clinical engineering, regulatory guidelines, safety and risk
management of medical devices
Course Outcomes:
Understand clinical management,engineering activities, administration and regulation
Explain different medical devices and their working principles
Apply the knowledge of clinical engineering in real world scenerio
Assessment:
Class participation/Attendance:		10%
Continuous Assessment                                   20%
Final Examination                                            70%
Total				                        100%
Textbooks and References:
Introduction to Clinical Engineering by Samantha Jacques, Barbara Christe
Clinical engineering: from devices to systems by Dori, Fabrizio; Iadanza, Ernesto; Miniati, Roberto
Clinical Engineering. A Handbook for Clinical and Biomedical Engineers by Azzam Taktak, Paul Ganney, David Long and Paul White (Eds.)
Clinical Engineering (Principles and Applications in Engineering) by Yadin David, Wolf W. von Maltzahn, Michael R. Neuman, Joseph D. Bronzino
Radiation Protection and Safety in Medical Uses of Ionizing Radiation, INTERNATIONAL ATOMIC ENERGY AGENCY, VIENNA, 2018
Lecture Plan:
Lec# | Lecture Topics
1—3 | Clinical Engineering:
- Responsibilities and roles
- Potential employers and career pathways
- Societies and collaboration
- Clinical ethics
- Patient-focused engineering
- Future opportunities for clinical engineering
4—6 | Clinical engineering:
- Development and operation of a Healthcare Technology Management/Clinical
Engineering Department in a Hospital.
- Functions of a clinical engineering department
7—9 | Clinical engineering:
- Fundamental resources for a CE department i.e., Staffing, training, space, test equipment, tools, communications equipment, and a computerised maintenance and management system
10—12 | Medical engineering design: regulations, quality assurance, safety and risk management
- Implications of Safe Medical Device Act (SMDA)
- Impact of regulatory agencies'' (SFDA, JC, etc) requirements on the operations of the Healthcare Technology Management (HTM) program
13—15 | Medical engineering design: regulations, quality assurance, safety and risk management
- Medical device incidents
- Recall management
- Risk management
- Maintenance and Repair
16—18 | Medical devices and their working principles:
- EKG/ECG, patient monitors
- External defibrillators
- Nebulizers
- Spirometer
19—21 | Medical devices and their working principles:
- Anaesthesia machines
- Ventilator:
- CPAP, BiPAP
- High Flow Nasal Cannula (HFNC)
22—24 | Medical devices and their working principles:
- Lithotripsy
- Co-60 Units
- Cyclotron
- Linear Accelerator (LINAC)
25—27 | Medical devices and their working principles:
- Opthalmoscope
- Syringe and Infusion Pumps
- Endoscopy and Colonscopy devices
28—30 | Medical devices and their working principles:
- Dialysis Machine
- Haemodialysis machine
Class test # 3 (CO-1/CO-2/CO-3)
31—33 | Medical devices and their working principles:
- Mobility and wheelchair assessment
- Mechanical and electromechanical devices: prosthetics, orthotics, arm supports;
- Muscle & Nerve stimulators
- EMG Machine
34—36 | Medical devices and their working principles:
- Electrosurgical devices
- ICU/CCU/HDU Equipment and setup
- Heart Lung Machine
37—39 | Facilities Management:
- Electrical power
- Plumbing systems and water quality management
- Medical gas systems
- Heating, ventilation, and air-conditioning systems
40—42 | Facilities Management:
- Building and renovation project management
- Emergency preparedness
- Infection prevention
- Radiation safety management
Class test # 4 (CO-2/CO-3/CO-4)
Prepared by: | 
Name:
Signature:
Date: | M Tarik Arafat
Name:
Signature:
Date: | Samiul Based Shuvo','[{"name": "Samiul Based Shuvo", "room": "ECE 1123", "email": "sbshuvo@bme.buet.ac.bd"}, {"name": "M Tarik Arafat", "room": "ECE 1015", "email": "tarafat@bme.buet.ac.bd"}]'::jsonb,'[{"component": "Class participation/Attendance", "percent": 10.0}, {"component": "Continuous Assessment", "percent": 20.0}, {"component": "Term Final", "percent": 70.0}]'::jsonb,'[]'::jsonb,'{"folder": "1 - Course Files/L4T2/BME 447 Course File/July 2025", "files": {"co_po_mapping": "July 2025/CO-PO Mapping.docx", "outline": "July 2025/BME 447_Course Outline.docx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 447\nCourse Title: | Clinical Engineering\nLevel, Term and Section | 4/2\nAcademic Term | July 2025\nTextbooks used: | Introduction to Clinical Engineering by Samantha Jacques, Barbara Christe\nClinical engineering: from devices to systems by Dori, Fabrizio; Iadanza, Ernesto; Miniati, Roberto\nClinical Engineering. A Handbook for Clinical and Biomedical Engineers by Azzam Taktak, Paul Ganney, David Long and Paul White (Eds.)\nClinical Engineering (Principles and Applications in Engineering) by Yadin David, Wolf W. von Maltzahn, Michael R. Neuman, Joseph D. Bronzino\nRadiation Protection and Safety in Medical Uses of Ionizing Radiation, INTERNATIONAL ATOMIC ENERGY AGENCY, VIENNA, 2018\nLast term when the course was offered | \nPart B. Attainment for current and previous terms\nJuly 2025\nCO1 | CO2 | CO3 | CO4 | CO5 | CO6 | CO7 | CO8 | CO9 | CO10 | CO11 | CO12\n88 | 96 | 94 | NA | NA | NA | NA | NA | NA | NA | NA | NA\nY | Y | Y | NA | NA | NA | NA | NA | NA | NA | NA | NA\nPO(a) | PO(b) | PO(c) | PO(d) | PO(e) | PO(f) | PO(g) | PO(h) | PO(i) | PO(j) | PO(k) | PO(l)\n98 | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA\nY | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA\nTeachers’ comment on attainment: Satisfactory\nInterpretation of student feedback: - N/A\nTeachers’ comment on teaching learning: - N/A\nPart D. Comments on CQI implemented based on last assessment\nN/A\nPart E. Recommendation\nMajor issues: None\nPlan for future actions for further improvement:\nThe course should be merged together with BME 405: Healthcare System Management as there are multiple overlapping topics. So, more coherent and optimized course should be designed\nSignature(s):\nName: Samiul Based Shuvo | Name: M Tarik Arafat\nSignature: | Signature:"}'::jsonb,array['No K/P/A matrix in CO-PO mapping doc','No item-to-CO mapping found (no CO-PO assessment workbook, or an unrecognised layout)']::text[],true,false);
insert into stg_co values ('2025-07','BME 447',1,'Understand clinical management, engineering activities, administration and regulation',array['C2']::text[],array['Lectures']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 447',2,'Explain different medical devices and their working principles',array['C2']::text[],array['Lectures','Hospital visits']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 447',3,'Apply the knowledge of clinical engineering in real world scenerio',array['C3']::text[],array['Lectures']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_att values ('2025-07','BME 447','CO','CO1',88.0,'car');
insert into stg_att values ('2025-07','BME 447','CO','CO2',96.0,'car');
insert into stg_att values ('2025-07','BME 447','CO','CO3',94.0,'car');
insert into stg_att values ('2025-07','BME 447','PO','PO1',98.0,'car');
insert into stg_car values ('2025-07','BME 447','Teachers’ comment on attainment: Satisfactory
Interpretation of student feedback: - N/A
Teachers’ comment on teaching learning: - N/A','','Major issues: None
Plan for future actions for further improvement:
The course should be merged together with BME 405: Healthcare System Management as there are multiple overlapping topics. So, more coherent and optimized course should be designed');
insert into stg_bugs values ('BUGS 09.04.25','2025-04-09','https://buetedu-my.sharepoint.com/:b:/g/personal/shoyadsabur_bme_buet_ac_bd/IQCjIvypYsjBQLUopsrX7yx3AZtJDMIoD-etVNDs3LN3IwY?e=2OdeOt','2025-07','BME 447');
insert into stg_off values ('2025-07','July 2025','BME 449',null,'Introduction to machine learning; Applications in Biomedical Engineering; Types of machine learning; Linear regression; Linear classification; Linear logistic regression; Non-parametric methods; Decision trees; K-Nearest neighbors algorithm; Multi-class Classification; Probabilistic classifiers; Unsupervised clustering; Gaussian mixture model (GMM); K-means clustering; Performance evaluation measures; Dimensionality reduction: Principal components analysis (PCA); Support vector machines (SVM); Neural networks and Deep Learning; Convolutional neural networks (CNN); Optimization methods; Reinforcement learning.','The course will introduce students to the basics of machine learning and deep learning
Different regression , classification and segmentation techniques will be covered in this course
The course will introduce students to the principle of different Optimization and dimensionality reduction techniques
This course will enable the students to apply ML algorithm on different biomedical applications','Bangladesh University of Engineering and Technology 
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No: 			BME 449
Course Title: 		Machine Learning for Biomedical Engineers
Credit hours: 		3.0					Contact hours: 3.0
Level/Term:   		4/2
Academic Session:  	2024-2025
Course Teacher(s):
Name | Office/Room | Email & Telephone | Class routine
Dr. Taufiq Hasan | ECE 1017 | taufiq@bme.buet.ac.bd
+8801817579844 | Sunday:
10:00 AM-10:50 AM Monday:
10:00 AM-10:50 AM Tuesday:
10:00 AM-10:50 AM
Sayeed Sajjad Razin | ECE 1121 | razin@bme.buet.ac.bd
+8801844453637 | 
Course Contents:
Introduction to machine learning; Applications in Biomedical Engineering; Types of machine learning; Linear regression; Linear classification; Linear logistic regression; Non-parametric methods; Decision trees; K-Nearest neighbors algorithm; Multi-class Classification; Probabilistic classifiers; Unsupervised clustering; Gaussian mixture model (GMM); K-means clustering; Performance evaluation measures; Dimensionality reduction: Principal components analysis (PCA); Support vector machines (SVM); Neural networks and Deep Learning; Convolutional neural networks (CNN); Optimization methods; Reinforcement learning.
Course Objectives:
The course will introduce students to the basics of machine learning and deep learning
Different regression , classification and segmentation techniques will be covered in this course
The course will introduce students to the principle of different Optimization and dimensionality reduction techniques
This course will enable the students to apply ML algorithm on different biomedical applications
Course Outcomes:
Understand the fundamental concepts and applications of machine learning in biomedical engineering.
Analyze different classification techniques of machine learning
Explain different dimensionality reduction techniques
Discuss the fundamentals of neural networks, deep learning and reinforcement learning
Compare different optimization methods for machine learning model training
Assessment:
Class Participation 10%
Continuous Assessment 20%
Final Examination 70%
Textbooks and References:
Shalev-Shwartz, S.,  Ben-David, S. (2014). Understanding machine learning: From theory to algorithms. Cambridge university press.
Bishop, C. M.,  Nasrabadi, N. M. (2006). Pattern recognition and machine learning (Vol. 4, No. 4, p. 738). New York: springer.
Sebastian Raschka and Vahid Mirjalili(2020). Python Machine Learning: Machine Learning and Deep Learning with Python, scikit learn, and TensorFlow 2(3rd edition).Packt Publishing.
Weekly Schedule:
Lecture | Topics
1—3 | Introduction to machine learning 
Applications in Biomedical Engineering:Disease detection ,Biosignal denoising
4—6 | Types of machine learning 
Linear regression; 
Linear classification; 
Linear logistic regression;
7—9 | Types of machine learning 
Non-parametric methods; 
Class Test#01(CO-1)
10—12 | Types of machine learning 
Decision trees; K-Nearest neighbors algorithm;
13—15 | Types of machine learning 
Multi-class Classification; Probabilistic classifiers;
16—18 | Types of machine learning 
Unsupervised clustering; Gaussian mixture model (GMM); K-means clustering 
Class Test#02(CO-2)
19—21 | Performance evaluation measures 
Sensitivity and Specificity 
Dice score
22—24 | Dimensionality reduction 
Principal components analysis (PCA)
25—27 | Dimensionality reduction 
Support vector machines (SVM) 
Class Test#03(CO-3)
28—30 | Neural networks and Deep Learning: 
Multilayer perceptron
31—33 | Neural networks and Deep Learning 
Convolutional neural networks (CNN)
34—36 | Neural networks and Deep Learning 
Recurrent neural networks(RNN) 
Reinforcement learning
37—39 | Optimization methods 
Gradient descent
40—42 | Optimization methods 
Stochastic gradient 
Class Test#04(CO-4,CO-5)
Prepared by:
Name: 
Signature:
Date: | Dr. Taufiq Hasan
Name: 
Signature:
Date: | Sayeed Sajjad Razin','[{"name": "Dr. Taufiq Hasan", "room": "ECE 1017", "email": "taufiq@bme.buet.ac.bd"}, {"name": "Sayeed Sajjad Razin", "room": "ECE 1121", "email": "razin@bme.buet.ac.bd"}]'::jsonb,'[{"component": "Class Participation", "percent": 10.0}, {"component": "Continuous Assessment", "percent": 20.0}, {"component": "Final Examination", "percent": 70.0}]'::jsonb,'[]'::jsonb,'{"folder": "1 - Course Files/L4T2/BME 449 Course Files/July 2025", "files": {"co_po_mapping": "July 2025/CO-PO Mapping.docx", "outline": "July 2025/BME 449_Course Outline.docx", "assessment_workbook": "July 2025/Assessments and scripts/BME 449-CO-PO-Assessment-marks.xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 449\nCourse Title: | Machine Learning for Biomedical Engineers\nLevel, Term and Section | 4/2\nAcademic Term | July 2025\nTextbooks used: | Shalev-Shwartz, S.,  Ben-David, S. (2014). Understanding machine learning: From theory to algorithms. Cambridge university press.\nBishop, C. M.,  Nasrabadi, N. M. (2006). Pattern recognition and machine learning (Vol. 4, No. 4, p. 738). New York: springer.\nSebastian Raschka and Vahid Mirjalili(2020). Python Machine Learning: Machine Learning and Deep Learning with Python, scikit learn, and TensorFlow 2(3rd edition).Packt Publishing.\nLast term when the course was offered | N/A\nPart B. Attainment for current and previous terms\nJuly 2025\nCO1 | CO2 | CO3 | CO4 | CO5\n100.00% | 100.00% | 87.10% | 80.65% | 87.10%\nY | Y | Y | Y | Y\nPO1 | PO2 | PO3 | PO4 | PO5 | PO6 | PO7 | PO8 | PO9 | PO10 | PO11 | PO12\n100.00% | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A\nY | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A\nPart C. Analysis\nTeachers’ comment on attainment: Satisfactory\nInterpretation of student feedback: None\nTeachers’ comment on teaching learning: None\nPart D. Comments on CQI implemented based on last assessment\nN/A\nPart E. Recommendation\nMajor issues: None\nPlan for future actions for further improvement: The volume of the course content is too large.\nSignature(s):\nName: Dr. Taufiq Hasan | Name: Sayeed Sajjad Razin\nSignature: | Signature:"}'::jsonb,array['No K/P/A matrix in CO-PO mapping doc']::text[],true,true);
insert into stg_co values ('2025-07','BME 449',1,'Understand the fundamental concepts and applications of machine learning in biomedical engineering.',array['C2']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 449',2,'Analyze different classification techniques of machine learning',array['C4']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 449',3,'Explain different dimensionality reduction techniques',array['C4']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 449',4,'Discuss the fundamentals of neural networks, deep learning and reinforcement learning',array['C2']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 449',5,'Compare different optimization methods for machine learning model training',array['C4']::text[],array['Lectures','Homework']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_crit values ('2025-07','BME 449',0,'Term Final','Q01 (a)',15,array['CO4']::text[]);
insert into stg_crit values ('2025-07','BME 449',1,'Term Final','Q01 (b)',15,array['CO5']::text[]);
insert into stg_crit values ('2025-07','BME 449',2,'Term Final','Q01 (c)',10,array['CO4']::text[]);
insert into stg_crit values ('2025-07','BME 449',3,'Term Final','Q01 (d)',5,array['CO4']::text[]);
insert into stg_crit values ('2025-07','BME 449',4,'Term Final','Q05 (a)',9,array['CO1']::text[]);
insert into stg_crit values ('2025-07','BME 449',5,'Term Final','Q05 (b)',10,array['CO1']::text[]);
insert into stg_crit values ('2025-07','BME 449',6,'Term Final','Q05 (c)',8,array['CO2']::text[]);
insert into stg_crit values ('2025-07','BME 449',7,'Term Final','Q05 (d)',18,array['CO3']::text[]);
insert into stg_att values ('2025-07','BME 449','CO','CO1',100,'workbook');
insert into stg_att values ('2025-07','BME 449','CO','CO2',100,'workbook');
insert into stg_att values ('2025-07','BME 449','CO','CO3',87.1,'workbook');
insert into stg_att values ('2025-07','BME 449','CO','CO4',80.65,'workbook');
insert into stg_att values ('2025-07','BME 449','CO','CO5',87.1,'workbook');
insert into stg_att values ('2025-07','BME 449','PO','PO1',100,'workbook');
insert into stg_car values ('2025-07','BME 449','Teachers’ comment on attainment: Satisfactory
Interpretation of student feedback: None
Teachers’ comment on teaching learning: None','','Major issues: None
Plan for future actions for further improvement: The volume of the course content is too large.');
insert into stg_off values ('2025-07','July 2025','BME 471',null,'Performulation: development phases, initial physicochemical characterization (pH, pKa), organoleptic properties(Color and Odor); Formulated Drugs: the role of excipients, the classification of dosage forms, the stability of medicines, stabilization of pharmaceutical products; Calculation of the Active Drug moiety: chemically equivalent quantities, active drug moiety equivalence, drug availability from dosage form, and delivery system; Therapeutic modalities: generic drug, biological products, cell and gene therapy,intellectual properties and regulatory affairs; Pharmaceutical Processes: size reduction, size separation, heat transfer, evaporation, distillation, drying, mixing, filtration, and centrifugation; Quality Control: UV-visible spectroscopy, IR spectroscopy, mass spectrometry, NMR spectroscopy, chromatography, thermal methods of analysis, electron microscopy; Quality management: basics of quality management, principles of six sigma, pharmaceutical quality management-ICH Q10, knowledge management, quality metrics, operational excellence, and quality management review, WHO-GMP requirements, QC standards- BP, USP, statistical process control (SPC).','The course will cover the fundamentals of pharmaceutical processes
Quality control techniques in pharmacy industry will be discussed
International guidelines and standards relevant to pharmaceutical industry will be introduced','Bangladesh University of Engineering and Technology
DEPARTMENT OF BIOMEDICAL ENGINEERING
Course Outline
Course No:			BME 471
Course Title:		Pharmaceutical Engineering
Credit hours:		3				Contact hours:	3
Level/Term:			4/2
Academic Session: 	2024-2025
Course Teacher(s):
Name | Office/Room | Email | Class routine
Ms. Samina Nishat Binte Akram | ECE-1125 | samina@bme.buet.ac.bd
+880 1973 730183 | Sunday:
11:00 AM-11:50 AM
Monday:
09:00 AM-09:50 AM
Wednesday:
10:00 AM-10:50 AM
Srija Sarkar | ECE-1013 | srija@bme.buet.ac.bd
+880 1787151545 | 
Course Contents:
Performulation: development phases, initial physicochemical characterization (pH, pKa), organoleptic properties(Color and Odor); Formulated Drugs: the role of excipients, the classification of dosage forms, the stability of medicines, stabilization of pharmaceutical products; Calculation of the Active Drug moiety: chemically equivalent quantities, active drug moiety equivalence, drug availability from dosage form, and delivery system; Therapeutic modalities: generic drug, biological products, cell and gene therapy,intellectual properties and regulatory affairs; Pharmaceutical Processes: size reduction, size separation, heat transfer, evaporation, distillation, drying, mixing, filtration, and centrifugation; Quality Control: UV-visible spectroscopy, IR spectroscopy, mass spectrometry, NMR spectroscopy, chromatography, thermal methods of analysis, electron microscopy; Quality management: basics of quality management, principles of six sigma, pharmaceutical quality management-ICH Q10, knowledge management, quality metrics, operational excellence, and quality management review, WHO-GMP requirements, QC standards- BP, USP, statistical process control (SPC).
Course Objectives:
The course will cover the fundamentals of pharmaceutical processes
Quality control techniques in pharmacy industry will be discussed
International guidelines and standards relevant to pharmaceutical industry will be introduced
Course Outcomes:
Explain the principles and applications of pharmaceutical processes used in industry
Describe factors influencing the stability and development of the product in the pharmaceutical industry
Apply the knowledge of various characterization tools to maintain quality of products
Understand international regulatory frameworks and quality management systems followed in the pharmaceutical industry
Lecture Plan:
Lecture No. | Lecture Topics
1—2 | Performulation
- Development phases
- Initial physicochemical characterization (pH, pKa)
- Organoleptic properties
3—5 | Formulated Drugs
- The role of excipients
- Classification of dosage forms
- Stability of medicines
- Stabilization of pharmaceutical products
6—8 | Therapeutic modalities:
- Generic drug
- Biological products, cell and gene therapy
- Intellectual properties and regulatory affairs,
9—10 | Calculation of the Active Drug moiety
- Chemically equivalent quantities
- Active drug moiety equivalence
- Drug availability from dosage form and delivery system
- Class test # 1
11—14 | Pharmaceutical Processes:
- Size reduction- Size separation
- Heat transfer
- Evaporation
- Distillation
- Drying
- Mixing
- Filtration
- Centrifugation
15—18 | Quality control:
- UV-visible spectroscopy
- IR spectroscopy
- Mass spectrometry
- NMR spectroscopy
19—21 | Quality control:
- Chromatography
- Thermal method of analysis
- Electron microscopy
- Class test # 2
22—24 | Quality management:
- Basics of quality management
- Principles of six sigma
25—27 | Quality management:
- Pharmaceutical quality management
-ICH Q10
- Knowledge management
28—30 | Quality management:
- Quality metrics
- Operational excellence
- Class test # 3
31—33 | Quality management:
- Quality management review
34—36 | Quality management:
- QC standards
- BP
37—39 | Quality management:
- QC standards
- USP
Assessment:
Class Participation | 10%
Continuous Assessment | 20%
Final Examination | 70%
Total | 100%
Textbooks and References:
Pharmaceutical Engineering (Principles and practices) (2005), C.V.S. Subrahmanyam, J. Thimma Setty, Mrs Sarasija Suresh
An Introduction to Pharmaceutical Sciences: Production, Chemistry, Techniques and Technology, Jiben Roy
FUNDAMENTALS OF DRUG DEVELOPMENT, Jeffrey S. Barrett
Pharmaceutical Calculations, 13th Edition, Howard C. Ansel
Pharmaceutical Preformulation and Formulation: A Practical Guide from Candidate Drug Selection to Commercial Dosage Form, 2nd Edition, edited by Mark Gibson
Prepared by: | 
Name:
Signature:
Date: | Ms. Samina Nishat Binte Akram
Name:
Signature:
Date: | Srija Sarkar','[{"name": "Samina Nishat Binte Akram", "room": "ECE-1123", "email": "samina@bme.buet.ac.bd"}, {"name": "Srija Sarker Anannya", "room": "ECE-1013", "email": "srija@bme.buet.ac.bd"}]'::jsonb,'[{"component": "Class participation/Attendance", "percent": 10.0}, {"component": "Continuous Assessment", "percent": 20.0}, {"component": "Term Final", "percent": 70.0}]'::jsonb,'[]'::jsonb,'{"folder": "1 - Course Files/L4T2/BME 471 Course Files/July 2025", "files": {"co_po_mapping": "July 2025/CO-PO Mapping.docx", "outline": "July 2025/BME 471_Course Outline.docx", "assessment_workbook": "July 2025/Assessments and scripts/BME 471-CO-PO-Assessment-marks.xlsx"}, "car_text": "Part A. Course Information\nCourse Number: | BME 471\nCourse Title: | Pharmaceutical Engineering\nLevel, Term and Section | 4/2\nAcademic Term | July 2025\nTextbooks used: | Pharmaceutical Engineering (Principles and practices) (2005), C.V .S. Subrahmanyam, J. Thimma Setty, Mrs Sarasija Suresh\nAn Introduction to Pharmaceutical Sciences: Production, Chemistry, Techniques and Technology, Jiben Roy\nFUNDAMENTALS OF DRUG DEVELOPMENT, Jeffrey S. Barrett\nPharmaceutical Calculations, 13th Edition, Howard C. Ansel\nPharmaceutical Preformulation and Formulation: A Practical Guide from Candidate Drug Selection to Commercial Dosage Form, 2nd Edition, edited by Mark Gibson\nLast term when the course was offered | \nPart B. Attainment for current and previous terms\nJuly 2025\nCO1 | CO2 | CO3 | CO4 | CO5 | CO6 | CO7 | CO8 | CO9 | CO10 | CO11 | CO12\n84.44 | 91.11 | 80 | 75.56 | NA | NA | NA | NA | NA | NA | NA | NA\nY | Y | Y | Y | NA | NA | NA | NA | NA | NA | NA | NA\nPO(a) | PO(b) | PO(c) | PO(d) | PO(e) | PO(f) | PO(g) | PO(h) | PO(i) | PO(j) | PO(k) | PO(l)\n93.33 | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA\nY | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA\nTeachers’ comment on attainment: Satisfactory\nInterpretation of student feedback: - N/A\nTeachers’ comment on teaching learning: - N/A\nPart D. Comments on CQI implemented based on last assessment\nN/A\nPart E. Recommendation\nMajor issues: None\nPlan for future actions for further improvement: Including students in the pharmaceutical Engineering process, involving them with industrial personnel would improve the teaching learning activity.\nSignature(s):\nName: Samina Nishat Binte Akram | Name: Srija Sarker Anannya\nSignature: | Signature:"}'::jsonb,array['No K/P/A matrix in CO-PO mapping doc']::text[],true,true);
insert into stg_co values ('2025-07','BME 471',1,'Explain the principles and applications of pharmaceutical processes used in industry',array['C2']::text[],array['Lectures']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 471',2,'Describe factors influencing the stability and development of the product in the pharmaceutical industry',array['C2']::text[],array['Lectures']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 471',3,'Apply the knowledge of various characterization tools to maintain quality of products',array['C3']::text[],array['Lectures']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_co values ('2025-07','BME 471',4,'Understand international regulatory frameworks and quality management systems followed in the pharmaceutical industry',array['C2']::text[],array['Lectures']::text[],array['Written exams']::text[],'{}'::text[],array['PO1']::text[]);
insert into stg_crit values ('2025-07','BME 471',0,'Term Final','Q01 (a)',30,array['CO1']::text[]);
insert into stg_crit values ('2025-07','BME 471',1,'Term Final','Q01 (b)',9,array['CO2']::text[]);
insert into stg_crit values ('2025-07','BME 471',2,'Term Final','Q01 (c)',6,array['CO2']::text[]);
insert into stg_crit values ('2025-07','BME 471',3,'Term Final','Q05 (a)',15,array['CO3']::text[]);
insert into stg_crit values ('2025-07','BME 471',4,'Term Final','Q05 (b)',15,array['CO3']::text[]);
insert into stg_crit values ('2025-07','BME 471',5,'Term Final','Q05 (c)',15,array['CO4']::text[]);
insert into stg_att values ('2025-07','BME 471','CO','CO1',84.44,'workbook');
insert into stg_att values ('2025-07','BME 471','CO','CO2',91.11,'workbook');
insert into stg_att values ('2025-07','BME 471','CO','CO3',80.0,'workbook');
insert into stg_att values ('2025-07','BME 471','CO','CO4',75.56,'workbook');
insert into stg_att values ('2025-07','BME 471','PO','PO1',93.33,'workbook');
insert into stg_car values ('2025-07','BME 471','Teachers’ comment on attainment: Satisfactory
Interpretation of student feedback: - N/A
Teachers’ comment on teaching learning: - N/A','','Major issues: None
Plan for future actions for further improvement: Including students in the pharmaceutical Engineering process, involving them with industrial personnel would improve the teaching learning activity.');
insert into stg_bugs values ('BUGS 26.10.25','2025-10-26','https://buetedu-my.sharepoint.com/:b:/g/personal/shoyadsabur_bme_buet_ac_bd/IQCy_jpgTQFiT5eiZAwUwCoCAa3SOSsoXvVcBvXkXCbvP2o?e=dw7GtT','2025-07','BME 471');
insert into public.terms (code, name) values ('2022-07', 'July 2022') on conflict (code) do nothing;
insert into public.terms (code, name) values ('2023-01', 'January 2023') on conflict (code) do nothing;
insert into public.terms (code, name) values ('2023-07', 'July 2023') on conflict (code) do nothing;
insert into public.terms (code, name) values ('2024-01', 'January 2024') on conflict (code) do nothing;
insert into public.terms (code, name) values ('2025-01', 'January 2025') on conflict (code) do nothing;
insert into public.terms (code, name) values ('2025-07', 'July 2025') on conflict (code) do nothing;

-- ---------------------------------------------------------------- merge
update public.courses set is_culminating = true where code in ('BME 300', 'BME 350', 'BME 400') and not is_culminating;
-- Offerings: an existing offering (e.g. a term imported from the workbook) is reused as it is.
insert into public.offerings (term_id, course_id, status)
select t.id, c.id, 'archived' from stg_off s join public.terms t on t.code = s.term_code join public.courses c on c.code = s.course_code
on conflict (term_id, course_id) do nothing;

create or replace view public.v_stg_off as
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
create table public.stg_fresh as
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
create table public.stg_nocrit as
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

drop view if exists public.v_stg_off;
drop table if exists public.stg_off, public.stg_co, public.stg_crit, public.stg_att, public.stg_car, public.stg_bugs, public.stg_fresh, public.stg_nocrit cascade;
commit;
notify pgrst, 'reload schema';
