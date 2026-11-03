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
