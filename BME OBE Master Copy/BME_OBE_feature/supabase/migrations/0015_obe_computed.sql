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
