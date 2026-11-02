-- BME Workflow · 0004 access helpers, sign-up gate, guarded RPCs, notifications

-- ---------------------------------------------------------------- access helpers
create or replace function public.fn_me() returns table (faculty_id uuid, app_role text)
language sql stable security definer set search_path = public as $$
  select a.faculty_id, a.app_role
  from public.profiles p
  join public.allowed_users a on a.email = lower(p.email) and a.active
  where p.user_id = auth.uid()
$$;

create or replace function public.fn_faculty() returns uuid
language sql stable security definer set search_path = public as $$ select faculty_id from public.fn_me() $$;

create or replace function public.fn_is_active() returns boolean
language sql stable security definer set search_path = public as $$ select exists (select 1 from public.fn_me()) $$;

create or replace function public.fn_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fn_me() where app_role in ('admin','hod'))
$$;

create or replace function public.fn_is_hod() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fn_me() where app_role = 'hod')
$$;

create or replace function public.fn_teaches(p_offering uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.section_teachers st join public.sections s on s.id = st.section_id
                 where s.offering_id = p_offering and st.faculty_id = public.fn_faculty())
$$;

create or replace function public.fn_exam_role(p_offering uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.exam_assignments a where a.offering_id = p_offering
                 and public.fn_faculty() in (a.qp_a, a.qp_b, a.mod_1, a.mod_2, a.scrutinizer))
$$;

-- Student marks are visible only to the offering's teachers, its exam-role holders, and admins.
create or replace function public.fn_can_mark(p_offering uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.fn_is_admin() or public.fn_teaches(p_offering) or public.fn_exam_role(p_offering)
$$;

create or replace function public.fn_can_manage(p_offering uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.fn_is_admin() or public.fn_teaches(p_offering)
$$;

create or replace function public.fn_teaches_any() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.section_teachers where faculty_id = public.fn_faculty())
$$;

-- ---------------------------------------------------------------- sign-up gate
-- Only allow-listed addresses can create an account; each account gets a profile row.
create or replace function public.signup_email_allowed(p_email text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.allowed_users where email = lower(trim(p_email)) and active)
$$;

create or replace function public.tg_auth_user_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.signup_email_allowed(new.email) then
    raise exception 'This email is not approved for BME Workflow. Ask the department admin.';
  end if;
  insert into public.profiles (user_id, email) values (new.id, lower(new.email)) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.tg_auth_user_created();

-- ---------------------------------------------------------------- notifications
create table public.notifications_outbox (
  id          uuid primary key default gen_random_uuid(),
  to_faculty  uuid not null references public.faculty(id) on delete cascade,
  kind        text not null,
  subject     text not null,
  body        text not null,
  dedupe_key  text unique,
  status      text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  error       text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);

create or replace function public.fn_notify(p_to uuid, p_kind text, p_subject text, p_body text, p_key text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_to is null then return; end if;
  insert into public.notifications_outbox (to_faculty, kind, subject, body, dedupe_key)
  values (p_to, p_kind, p_subject, p_body, p_key) on conflict (dedupe_key) do nothing;
end $$;

-- ---------------------------------------------------------------- theory exam RPC
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
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
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

-- ---------------------------------------------------------------- sessional gradesheet RPC
create or replace function public.set_sessional_gradesheet(p_offering uuid, p_part text, p_status text)
returns public.sessional_gradesheets
language plpgsql security definer set search_path = public as $$
declare me uuid := public.fn_faculty(); g public.sessional_gradesheets; admin boolean := public.fn_is_admin();
begin
  select * into g from public.sessional_gradesheets where offering_id = p_offering;
  if g is null then raise exception 'No gradesheet assignment for this course' using errcode = 'P0002'; end if;
  if p_part = 'prep' then
    if g.preparer is distinct from me and not admin then raise exception 'Only the gradesheet preparer can update this' using errcode = '42501'; end if;
    if p_status <> 'not_started' and not admin and exists (
        select 1 from public.assessment_items where offering_id = p_offering and status <> 'cancelled'
        and marks_status not in ('published','locked')) then
      raise exception 'Publish every assessment item in all sub-sections first' using errcode = 'P0001';
    end if;
    update public.sessional_gradesheets set prep_status = p_status, updated_at = now() where offering_id = p_offering returning * into g;
    if p_status = 'forwarded' then
      perform public.fn_notify(g.scrutinizer, 'unlocked', 'Sessional gradesheet ready for scrutiny', 'A sessional gradesheet was forwarded to you.', p_offering || ':sg:scrutiny');
    end if;
  elsif p_part = 'scrutiny' then
    if g.scrutinizer is distinct from me and not admin then raise exception 'Only the gradesheet scrutinizer can update this' using errcode = '42501'; end if;
    if p_status <> 'not_started' and g.prep_status <> 'forwarded' and not admin then
      raise exception 'Waiting on the gradesheet preparer' using errcode = 'P0001';
    end if;
    update public.sessional_gradesheets set scrutiny_status = p_status, updated_at = now() where offering_id = p_offering returning * into g;
  else
    raise exception 'Unknown part %', p_part using errcode = '22023';
  end if;
  return g;
end $$;

-- ---------------------------------------------------------------- assessment items
-- Generates items from a component's count, per section when requested. Never deletes an item
-- that already holds marks; the caller gets an error naming it instead.
create or replace function public.generate_items(p_component uuid)
returns setof public.assessment_items
language plpgsql security definer set search_path = public as $$
declare c public.assessment_components; s record; n int; base text;
begin
  select * into c from public.assessment_components where id = p_component;
  if c is null then raise exception 'Component not found' using errcode = 'P0002'; end if;
  if not public.fn_can_manage(c.offering_id) then raise exception 'Not allowed' using errcode = '42501'; end if;

  if exists (select 1 from public.assessment_items i join public.assessment_questions q on q.item_id = i.id
             join public.marks m on m.question_id = q.id
             where i.component_id = c.id and (i.seq > c.item_count
               or (c.per_section and i.section_id is null) or (not c.per_section and i.section_id is not null))) then
    raise exception 'Some items you are removing already have marks. Clear their marks first.' using errcode = 'P0001';
  end if;
  delete from public.assessment_items i where i.component_id = c.id and (i.seq > c.item_count
    or (c.per_section and i.section_id is null) or (not c.per_section and i.section_id is not null));

  base := c.name;
  for s in select id, name from public.sections where offering_id = c.offering_id and c.per_section
           union all select null::uuid, null::text where not c.per_section loop
    for n in 1..c.item_count loop
      insert into public.assessment_items (component_id, offering_id, section_id, seq, title, total_marks)
      values (c.id, c.offering_id, s.id, n,
              base || ' ' || lpad(n::text, 2, '0') || coalesce(' (' || s.name || ')', ''), c.marks_each)
      on conflict (component_id, section_id, seq) do update set total_marks = excluded.total_marks;
    end loop;
  end loop;
  return query select * from public.assessment_items where component_id = c.id order by section_id nulls first, seq;
end $$;

-- Moves an item's date, keeping history and blocking two class tests for one batch on one day.
create or replace function public.reschedule_item(p_item uuid, p_date date, p_reason text default null, p_force boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare i public.assessment_items; kind text; conflicts jsonb;
begin
  select * into i from public.assessment_items where id = p_item;
  if i is null then raise exception 'Item not found' using errcode = 'P0002'; end if;
  if not public.fn_can_manage(i.offering_id) then raise exception 'Not allowed' using errcode = '42501'; end if;
  select c.kind into kind from public.assessment_components c where c.id = i.component_id;

  if kind = 'class_test' and p_date is not null then
    select coalesce(jsonb_agg(jsonb_build_object('item', x.id, 'course', cr.code, 'title', x.title)), '[]') into conflicts
    from public.assessment_items x
    join public.assessment_components xc on xc.id = x.component_id and xc.kind = 'class_test'
    join public.offerings xo on xo.id = x.offering_id
    join public.offerings o on o.id = i.offering_id
    join public.courses cr on cr.id = xo.course_id
    where x.id <> i.id and x.held_on = p_date and x.status <> 'cancelled'
      and xo.term_id = o.term_id and xo.batch is not distinct from o.batch;
    if jsonb_array_length(conflicts) > 0 and not (p_force and public.fn_is_admin() and coalesce(trim(p_reason),'') <> '') then
      return jsonb_build_object('ok', false, 'conflicts', conflicts);
    end if;
  end if;

  if i.held_on is distinct from p_date then
    insert into public.item_date_history (item_id, old_date, new_date, reason, changed_by)
    values (i.id, i.held_on, p_date, p_reason, public.fn_faculty());
  end if;
  update public.assessment_items set held_on = p_date,
    status = case when p_date is not null and status in ('planned','postponed') then 'scheduled' else status end
  where id = p_item;
  return jsonb_build_object('ok', true, 'conflicts', coalesce(conflicts, '[]'::jsonb));
end $$;

-- Locked marks are final: only admins can unlock an item or change its marks.
create or replace function public.tg_item_lock_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.marks_status = 'locked' and new.marks_status <> 'locked' and not public.fn_is_admin() then
    raise exception 'Locked marks can only be reopened by an admin' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger item_lock_guard before update on public.assessment_items
  for each row execute function public.tg_item_lock_guard();

create or replace function public.tg_marks_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare maxm numeric; st text;
begin
  select q.max_marks, i.marks_status into maxm, st
  from public.assessment_questions q join public.assessment_items i on i.id = q.item_id
  where q.id = coalesce(new.question_id, old.question_id);
  if st = 'locked' and not public.fn_is_admin() then
    raise exception 'Marks for this item are locked' using errcode = '42501';
  end if;
  if tg_op <> 'DELETE' then
    if new.value > maxm then raise exception 'Mark % exceeds the question maximum %', new.value, maxm using errcode = '22003'; end if;
    new.updated_by := public.fn_faculty();
    new.updated_at := now();
    return new;
  end if;
  return old;
end $$;
create trigger marks_guard before insert or update or delete on public.marks
  for each row execute function public.tg_marks_guard();

-- ---------------------------------------------------------------- reminders (run daily by pg_cron)
create or replace function public.enqueue_reminders(p_today date default (now() at time zone 'Asia/Dhaka')::date)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0; r record; days int;
begin
  for r in
    select t.offering_id, t.step, coalesce(t.due_on, m.due_on) as due_on, o2.owner_id, c.code
    from public.exam_tasks t
    join public.offerings o on o.id = t.offering_id
    join public.terms tm on tm.id = o.term_id and tm.is_current
    join public.courses c on c.id = o.course_id
    join public.v_exam_owners o2 on o2.offering_id = t.offering_id and o2.step = t.step
    left join public.term_milestones m on m.term_id = o.term_id and m.offering_id is null
      and m.kind = case when t.step in ('qp_a','qp_b','mod_1','mod_2') then 'question_submission' else 'theory_gradesheet' end
    where not public.exam_step_done(t.step, t.status)
  loop
    continue when r.due_on is null or r.owner_id is null;
    days := r.due_on - p_today;
    if days in (7,3,1,0) or (days < 0 and days >= -5) then
      perform public.fn_notify(r.owner_id, 'reminder',
        r.code || ': ' || r.step || case when days < 0 then ' is overdue' when days = 0 then ' is due today' else ' is due in ' || days || ' days' end,
        'Due ' || to_char(r.due_on, 'DD Mon YYYY') || '. Open BME Workflow to update the status.',
        r.offering_id || ':' || r.step || ':' || p_today);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
