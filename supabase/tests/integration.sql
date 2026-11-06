-- Integration test for RLS and workflow RPCs. Run against a database with migrations + seed + seed_demo.
-- Requires the local auth stub (auth.users, auth.uid() from request.jwt.claim.sub). Every check raises on failure.
\set ON_ERROR_STOP 1
begin;
-- These checks test sign-in security, so turn the open-access switch off for this transaction.
update public.app_settings set open_access = false;

-- Sign-up gate
do $$ begin
  begin insert into auth.users (email) values ('stranger@example.com'); raise exception 'FAIL: stranger signed up';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
insert into auth.users (id, email) values
 ('10000000-0000-4000-a000-000000000001','hod@example.edu'), ('10000000-0000-4000-a000-000000000002','kamal@example.edu'),
 ('10000000-0000-4000-a000-000000000003','nadia@example.edu'), ('10000000-0000-4000-a000-000000000004','farhan@example.edu'),
 ('10000000-0000-4000-a000-000000000005','tania@example.edu'), ('10000000-0000-4000-a000-000000000006','rafiq@example.edu');

create function pg_temp.as_user(n int) returns void language sql as $$
  select set_config('request.jwt.claim.sub', '10000000-0000-4000-a000-00000000000' || n, true) $$;
create function pg_temp.off(c text) returns uuid language sql as $$
  select o.id from public.offerings o join public.courses c2 on c2.id = o.course_id where c2.code = c $$;
create temp table ids as select pg_temp.off('BME 201') o201, pg_temp.off('BME 203') o203, pg_temp.off('BME 202') o202;
grant select on ids to authenticated;

-- Nadia (teaches BME 201) sees its marks; Rafiq (BME 202 only) does not.
select pg_temp.as_user(3); set local role authenticated;
do $$ begin
  if (select count(*) from public.offerings) <> 3 then raise exception 'FAIL: faculty cannot read offerings'; end if;
  if (select count(*) from public.marks) = 0 then raise exception 'FAIL: teacher cannot read own course marks'; end if;
end $$;
reset role; select pg_temp.as_user(6); set local role authenticated;
do $$ begin
  if (select count(*) from public.marks) <> 0 then raise exception 'FAIL: unrelated faculty sees marks'; end if;
  if (select count(*) from public.students) <> 12 then raise exception 'FAIL: BME 202 teacher should see its roster'; end if;
  update public.exam_tasks set status = 'examined';
  if (select count(*) from public.exam_tasks where status = 'examined') <> 0 then raise exception 'FAIL: direct exam_tasks write allowed'; end if;
end $$;

-- Dependency block: Farhan cannot examine before printing.
reset role; select pg_temp.as_user(4); set local role authenticated;
do $$ begin
  begin perform public.set_exam_task((select o201 from ids), 'exam_a', 'under_examination'); raise exception 'FAIL: dependency ignored';
  exception when others then if sqlerrm not like 'Waiting on:%' then raise; end if; end;
end $$;

-- Ownership: Nadia cannot touch BME 203 question prep A (owned by Tania).
reset role; select pg_temp.as_user(3); set local role authenticated;
do $$ begin
  begin perform public.set_exam_task((select o203 from ids), 'qp_a', 'submitted'); raise exception 'FAIL: non-owner updated';
  exception when others then if sqlerrm not like 'This step belongs%' then raise; end if; end;
end $$;

-- Correction loop on BME 203: both halves submitted, moderator 2 (Rafiq) returns half A, Tania resubmits.
reset role; select pg_temp.as_user(5); set local role authenticated;
select public.set_exam_task((select o203 from ids), 'qp_a', 'submitted');
reset role; select pg_temp.as_user(2); set local role authenticated;
select public.set_exam_task((select o203 from ids), 'qp_b', 'submitted');
reset role; select pg_temp.as_user(6); set local role authenticated;
select public.set_exam_task((select o203 from ids), 'mod_2', 'needs_correction', 'Q3 ambiguous', 'A');
do $$ begin
  if (select status from public.exam_tasks where offering_id = (select o203 from ids) and step = 'qp_a') <> 'under_correction'
    then raise exception 'FAIL: half A not returned'; end if;
end $$;
reset role; select pg_temp.as_user(5); set local role authenticated;
select public.set_exam_task((select o203 from ids), 'qp_a', 'submitted');
do $$ begin
  if (select status from public.exam_tasks where offering_id = (select o203 from ids) and step = 'mod_2') <> 'under_moderation'
    then raise exception 'FAIL: moderator not reopened after resubmission'; end if;
  if exists (select 1 from public.moderation_rounds where resolved_at is null) then raise exception 'FAIL: round left open'; end if;
end $$;

-- CT conflict: BME 203 CT 01 moved onto BME 201 CT 01's date (same batch) is refused.
do $$ declare r jsonb; begin
  r := public.reschedule_item(
    (select i.id from public.assessment_items i join public.assessment_components c on c.id = i.component_id
      where i.offering_id = (select o203 from ids) and c.kind = 'class_test' and seq = 1),
    (select held_on from public.assessment_items i where offering_id = (select o201 from ids) and title = 'CT 01'), 'test');
  if (r->>'ok')::boolean then raise exception 'FAIL: CT clash not detected'; end if;
end $$;

-- Marks: over-maximum rejected; locked item rejects edits and cannot be unlocked by faculty.
reset role; select pg_temp.as_user(3); set local role authenticated;
do $$ declare q uuid; it uuid; begin
  select q2.id, q2.item_id into q, it from public.assessment_questions q2 join public.assessment_items i on i.id = q2.item_id
   where i.offering_id = (select o201 from ids) and i.title = 'CT 03' and q2.label = 'Q1';
  begin update public.marks set value = 99 where question_id = q; raise exception 'FAIL: over-max mark accepted';
  exception when others then if sqlerrm not like 'Mark%exceeds%' then raise; end if; end;
  update public.assessment_items set marks_status = 'locked' where id = it;
  begin update public.marks set value = 1 where question_id = q; raise exception 'FAIL: locked marks edited';
  exception when others then if sqlerrm not like '%locked%' then raise; end if; end;
  begin update public.assessment_items set marks_status = 'published' where id = it; raise exception 'FAIL: faculty unlocked';
  exception when others then if sqlerrm not like 'Locked marks%' then raise; end if; end;
end $$;

-- generate_items by a BME 202 teacher; import by a non-admin is refused, by an admin succeeds.
reset role; select pg_temp.as_user(4); set local role authenticated;
do $$ declare c uuid; n int; begin
  insert into public.assessment_components (offering_id, kind, name, item_count, marks_each, weight, per_section)
  values ((select o202 from ids), 'lab_test', 'Lab Test', 2, 20, 30, true) returning id into c;
  select count(*) into n from public.generate_items(c);
  if n <> 4 then raise exception 'FAIL: expected 4 items (2 x A1/A2), got %', n; end if;
  begin perform public.import_term_plan('{"term":{"code":"X","name":"X"}}'); raise exception 'FAIL: non-admin import';
  exception when others then if sqlerrm not like 'Only admins%' then raise; end if; end;
end $$;
reset role; select pg_temp.as_user(2); set local role authenticated;
do $$ declare r jsonb; begin
  r := public.import_term_plan('{"term":{"code":"JAN-2026","name":"January 2026"},
    "faculty":[{"display_name":"Dr. Test Person"}],
    "offerings":[{"code":"BME 101","sections":[{"name":"X","teachers":["Dr. Test Person"]}]}],
    "exam":[{"code":"BME 101","qp_a":"Dr. Test Person","statuses":{"qp_a":"submitted"}}],
    "class_tests":[{"code":"BME 101","seq":2,"held_on":"2026-07-07","status":"held","marks_status":"published"}],
    "milestones":[{"kind":"question_submission","due_on":"2026-10-05"}]}');
  if (r->>'offerings')::int <> 1 then raise exception 'FAIL: import offerings %', r; end if;
  if (select t.status from public.exam_tasks t join public.offerings o on o.id = t.offering_id join public.terms tm on tm.id = o.term_id
      where tm.code = 'JAN-2026' and step = 'qp_a') <> 'submitted' then raise exception 'FAIL: imported status'; end if;
end $$;

-- Roster: a BME 203 teacher (Tania) adds a new student and immediately sees them; a bad ID is rejected.
reset role; select pg_temp.as_user(5); set local role authenticated;
do $$ declare r jsonb; begin
  r := public.enrol_students((select o203 from ids), '[{"student_no":"2118099","name":"New Student","section":"X"},{"student_no":"12","name":"Bad"}]');
  if (r->>'enrolled')::int <> 1 or jsonb_array_length(r->'rejected') <> 1 then raise exception 'FAIL: roster %', r; end if;
  if not exists (select 1 from public.students where student_no = '2118099') then raise exception 'FAIL: new student invisible to teacher'; end if;
  begin perform public.enrol_students((select o202 from ids), '[{"student_no":"2118098","name":"X"}]'); raise exception 'FAIL: non-teacher enrolled';
  exception when others then if sqlerrm not like 'Only this course%' then raise; end if; end;
end $$;

-- Open access: with the switch on, an anonymous visitor reads and edits everything; with it off, sees nothing.
reset role;
do $$ begin
  if exists (select 1 from public.offerings) is false then raise exception 'FAIL: no data'; end if;
end $$;
select set_config('request.jwt.claim.sub', '', true);   -- a real anonymous visitor carries no user id
set local role anon;
do $$ begin
  if (select count(*) from public.marks) <> 0 then raise exception 'FAIL: anon sees marks while sign-in is required'; end if;
end $$;
reset role; update public.app_settings set open_access = true; set local role anon;
do $$ begin
  if (select count(*) from public.marks) = 0 then raise exception 'FAIL: open access does not show marks'; end if;
  update public.terms set latest_completed_week = 3 where code = 'DEMO-2026';
  if (select latest_completed_week from public.terms where code = 'DEMO-2026') <> 3 then raise exception 'FAIL: open access cannot edit'; end if;
  update public.app_settings set open_access = false;
  if not public.app_open_access() then raise exception 'FAIL: the website could switch security'; end if;
end $$;

-- Activity log (0017): with open access, the "Viewing as" name sent in x-acting-as is recorded with the course.
reset role; update public.app_settings set open_access = true;
select set_config('request.headers', json_build_object('x-acting-as', (select id from public.faculty order by display_name limit 1))::text, true);
set local role anon;
do $$ declare a public.audit_log; begin
  update public.assessment_items set held_on = coalesce(held_on, date '2026-01-01') + 1 where id = (select id from public.assessment_items order by id limit 1);
  select * into a from public.audit_log where table_name = 'assessment_items' order by id desc limit 1;
  if a.actor is null or a.actor_name is null or a.course_code is null then raise exception 'FAIL: activity log missed who or which course: %', row_to_json(a); end if;
  begin insert into public.audit_log (table_name, action) values ('x', 'INSERT'); raise exception 'FAIL: the log can be written to';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
select 'ALL INTEGRATION CHECKS PASSED' as result;
rollback;
