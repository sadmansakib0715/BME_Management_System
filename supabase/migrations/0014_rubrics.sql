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
