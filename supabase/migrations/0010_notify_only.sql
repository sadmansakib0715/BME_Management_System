-- BME Workflow · 0010 notify-only: marks are not kept in this system.
-- Gradesheet preparation no longer waits for marks to be published (they never are here).
-- Same bodies as 0009 set_exam_task and 0004 set_sessional_gradesheet, minus the marks checks.
-- Marks, roster and attainment tables stay in place but are unused by the website.

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

create or replace function public.set_sessional_gradesheet(p_offering uuid, p_part text, p_status text)
returns public.sessional_gradesheets
language plpgsql security definer set search_path = public as $$
declare me uuid := public.fn_faculty(); g public.sessional_gradesheets; admin boolean := public.fn_is_admin();
begin
  select * into g from public.sessional_gradesheets where offering_id = p_offering;
  if g is null then raise exception 'No gradesheet assignment for this course' using errcode = 'P0002'; end if;
  if p_part = 'prep' then
    if g.preparer is distinct from me and not admin then raise exception 'Only the gradesheet preparer can update this' using errcode = '42501'; end if;
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
