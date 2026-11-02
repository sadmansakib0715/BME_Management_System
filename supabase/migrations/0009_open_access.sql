-- BME Workflow · 0009 open-access switch
-- When app_settings.open_access is true, nobody needs to sign in: every visitor (including
-- anonymous ones) acts as an admin and can read and edit everything, including student marks.
-- Turn security back on at any time with ONE line in the SQL Editor:
--     update public.app_settings set open_access = false;
-- and back off again with:
--     update public.app_settings set open_access = true;

create table if not exists public.app_settings (
  id           boolean primary key default true check (id),   -- exactly one row
  open_access  boolean not null default false,
  updated_at   timestamptz not null default now()
);
insert into public.app_settings (id, open_access) values (true, true)
on conflict (id) do update set open_access = true, updated_at = now();
alter table public.app_settings enable row level security;
drop policy if exists read_all on public.app_settings;
create policy read_all on public.app_settings for select to anon, authenticated using (true);
-- No write policy on purpose: the switch can only be changed in the SQL Editor.

create or replace function public.app_open_access() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select open_access from public.app_settings where id), false)
$$;

-- Permission helpers: open access makes every visitor an active admin and HOD.
create or replace function public.fn_is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_open_access() or exists (select 1 from public.fn_me())
$$;
create or replace function public.fn_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_open_access() or exists (select 1 from public.fn_me() where app_role in ('admin','hod'))
$$;
create or replace function public.fn_is_hod() returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_open_access() or exists (select 1 from public.fn_me() where app_role = 'hod')
$$;

-- The exam RPC must accept callers who are not signed in when open access is on.
create or replace function public.set_exam_task(
  p_offering uuid, p_step text, p_status text, p_note text default null, p_half text default null)
returns public.exam_tasks
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.fn_faculty();
  admin boolean := public.fn_is_admin();
  owner uuid;
  dep text;
  blocked text[] := '{}';
  v_row public.exam_tasks;
  code text;
  step_after text;
begin
  if me is null and not admin then raise exception 'Not signed in' using errcode = '42501'; end if;
  if not (p_status = any (public.exam_step_statuses(p_step))) then
    raise exception 'Status "%" is not valid for step %', p_status, p_step using errcode = '22023';
  end if;

  select owner_id into owner from public.v_exam_owners where offering_id = p_offering and step = p_step;
  if p_step = 'hod' and p_status = 'received' then
    if not public.fn_is_hod() and not admin then raise exception 'Only the HOD can confirm receipt' using errcode = '42501'; end if;
  elsif p_step = 'printing' then
    if not admin then raise exception 'Printing is updated by the department office (admins)' using errcode = '42501'; end if;
  elsif owner is distinct from me and not admin then
    raise exception 'This step belongs to another faculty member' using errcode = '42501';
  end if;

  -- Dependencies: a step can move past not_started only when every prerequisite is done.
  if p_status <> 'not_started' then
    foreach dep in array public.exam_step_deps(p_step) loop
      if not exists (select 1 from public.exam_tasks t where t.offering_id = p_offering and t.step = dep
                     and public.exam_step_done(t.step, t.status)) then
        blocked := blocked || dep;
      end if;
    end loop;
    if array_length(blocked, 1) > 0 and not (admin and coalesce(trim(p_note), '') <> '') then
      raise exception 'Waiting on: %', array_to_string(blocked, ', ') using errcode = 'P0001',
        hint = 'Admins can override with a note.';
    end if;
  end if;

  -- Gradesheet preparation also needs every class test's marks published.
  if p_step = 'gs_prep' and p_status <> 'not_started' and exists (
      select 1 from public.assessment_items i join public.assessment_components c on c.id = i.component_id
      where i.offering_id = p_offering and c.kind = 'class_test' and i.status <> 'cancelled'
        and i.marks_status not in ('published','locked')) and not admin then
    raise exception 'Publish all class test marks before preparing the gradesheet' using errcode = 'P0001';
  end if;

  -- Moderator returns a half for correction.
  if p_step in ('mod_1','mod_2') and p_status = 'needs_correction' then
    if p_half not in ('A','B') then raise exception 'Choose which half (A or B) needs correction' using errcode = '22023'; end if;
    insert into public.moderation_rounds (offering_id, moderator_step, half, comment, returned_by)
    values (p_offering, p_step, p_half, p_note, me);
    update public.exam_tasks set status = 'under_correction', updated_by = me, updated_at = now()
     where offering_id = p_offering and step = case p_half when 'A' then 'qp_a' else 'qp_b' end;
    perform public.fn_notify((select owner_id from public.v_exam_owners where offering_id = p_offering
                               and step = case p_half when 'A' then 'qp_a' else 'qp_b' end),
      'returned', 'Question paper returned for correction',
      coalesce(p_note, 'A moderator returned your half of the question paper.'), null);
  end if;

  -- A preparer resubmits: open rounds close, moderators who returned it go back to reviewing.
  if p_step in ('qp_a','qp_b') and p_status = 'submitted' then
    update public.moderation_rounds set resolved_at = now()
     where offering_id = p_offering and resolved_at is null and half = case p_step when 'qp_a' then 'A' else 'B' end;
    update public.exam_tasks t set status = 'under_moderation', updated_at = now()
     where t.offering_id = p_offering and t.step in ('mod_1','mod_2') and t.status = 'needs_correction'
       and not exists (select 1 from public.moderation_rounds r where r.offering_id = p_offering
                       and r.moderator_step = t.step and r.resolved_at is null);
  end if;

  update public.exam_tasks set status = p_status, note = coalesce(p_note, note), updated_by = me, updated_at = now()
   where offering_id = p_offering and step = p_step
  returning * into v_row;
  if v_row is null then raise exception 'No exam workflow exists for this course yet' using errcode = 'P0002'; end if;

  -- Tell owners of steps that just unlocked.
  select c.code into code from public.offerings o join public.courses c on c.id = o.course_id where o.id = p_offering;
  if public.exam_step_done(p_step, p_status) then
    for step_after in select unnest(array['mod_1','mod_2','printing','exam_a','exam_b','scrutiny','gs_prep','gs_scrutiny','hod']) loop
      if p_step = any (public.exam_step_deps(step_after)) and not exists (
          select 1 from unnest(public.exam_step_deps(step_after)) d
          where not exists (select 1 from public.exam_tasks t where t.offering_id = p_offering and t.step = d
                            and public.exam_step_done(t.step, t.status))) then
        perform public.fn_notify((select owner_id from public.v_exam_owners where offering_id = p_offering and step = step_after),
          'unlocked', code || ': your next exam step is ready',
          'The step "' || step_after || '" for ' || code || ' can now proceed.', p_offering || ':' || step_after || ':unlocked');
      end if;
    end loop;
  end if;
  return v_row;
end $$;

-- Let anonymous visitors through every existing policy; the helpers above decide what they get.
-- With open_access = false, anonymous visitors match no helper and see nothing, as before.
do $$ declare p record; begin
  for p in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('alter policy %I on public.%I to anon, authenticated', p.policyname, p.tablename);
  end loop;
end $$;

grant usage on schema public to anon;
grant select, insert, update, delete on all tables in schema public to anon;
grant execute on function public.app_open_access(), public.set_exam_task(uuid, text, text, text, text),
  public.set_sessional_gradesheet(uuid, text, text), public.generate_items(uuid),
  public.reschedule_item(uuid, date, text, boolean), public.import_term_plan(jsonb),
  public.enrol_students(uuid, jsonb), public.copy_roster(uuid, uuid), public.fn_me() to anon, authenticated;
