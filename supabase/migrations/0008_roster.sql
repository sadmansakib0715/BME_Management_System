-- BME Workflow · 0008 roster loading. A teacher cannot read a student row until it is enrolled in
-- their course (RLS), so adding and enrolling happen together in one checked function.

create or replace function public.enrol_students(p_offering uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; sid uuid; sec uuid; added int := 0; enrolled int := 0; bad jsonb := '[]'; no text;
begin
  if not public.fn_can_manage(p_offering) then raise exception 'Only this course''s teachers or an admin can change its students' using errcode = '42501'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    no := trim(r->>'student_no');
    if no !~ '^[0-9]{7}$' or coalesce(trim(r->>'name'), '') = '' then
      bad := bad || jsonb_build_object('student_no', no, 'reason', 'Need a 7-digit student ID and a name'); continue;
    end if;
    insert into public.students (student_no, name, batch) values (no, trim(r->>'name'), nullif(trim(r->>'batch'), ''))
    on conflict (student_no) do nothing returning id into sid;
    if sid is null then
      select id into sid from public.students where student_no = no;
      if public.fn_is_admin() then update public.students set name = trim(r->>'name') where id = sid; end if;
    else added := added + 1; end if;
    select id into sec from public.sections where offering_id = p_offering and name = coalesce(nullif(trim(r->>'section'), ''), 'X');
    if sec is null then select id into sec from public.sections where offering_id = p_offering order by name limit 1; end if;
    insert into public.enrolments (offering_id, student_id, section_id) values (p_offering, sid, sec)
    on conflict (offering_id, student_id) do update set section_id = excluded.section_id;
    enrolled := enrolled + 1;
  end loop;
  return jsonb_build_object('added', added, 'enrolled', enrolled, 'rejected', bad);
end $$;

-- Copy one course's roster (with sub-sections matched by name) to another course of the same cohort.
create or replace function public.copy_roster(p_from uuid, p_to uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not (public.fn_can_mark(p_from) and public.fn_can_manage(p_to)) then raise exception 'Not allowed' using errcode = '42501'; end if;
  insert into public.enrolments (offering_id, student_id, section_id)
  select p_to, e.student_id, coalesce(
      (select s2.id from public.sections s2 join public.sections s1 on s1.id = e.section_id where s2.offering_id = p_to and s2.name = s1.name),
      (select id from public.sections where offering_id = p_to order by name limit 1))
  from public.enrolments e where e.offering_id = p_from
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function public.enrol_students(uuid, jsonb), public.copy_roster(uuid, uuid) to authenticated;
